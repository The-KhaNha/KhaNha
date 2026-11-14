import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeJSONStorage } from '../../lib/safeStorage';
import type { MenuItem, MenuResponse, ModifierGroup } from '../../types/api';
import { CACHE_PREFIX } from '../../lib/useResource';
import fallbacks from '../../config/fallbacks.json';
import { availableQuantity, lineLimit, type CartLimits } from './cartRules';

/** The limits used until a menu says otherwise (config/fallbacks.json, parity-tested against the store defaults). */
const DEFAULT_LIMITS: CartLimits = fallbacks.storeDefaults;

/** A modifier option on a cart line, as the menu showed it when added (P3.2). */
export interface CartOption {
  id: string;
  groupName: string;
  name: string;
  /** Whole rupees, may be negative. */
  priceDelta: number;
}

export interface CartLine {
  /** The item and its options (lineKeyOf): two lines of one item with different options are two lines. */
  lineKey: string;
  menuItemId: string;
  name: string;
  /** The item's price plus its options' deltas, as the cart shows and the order expects it. */
  unitPrice: number;
  options: CartOption[];
  imageUrl: string | null;
  quantity: number;
  /**
   * How many the shop can sell right now, from the last menu the app saw or the server's answer at checkout:
   * null = no stock limit, 0 = sold out / off the menu. Prices are deliberately never refreshed this way (only `syncPrices`, after a PRICE_CHANGED refusal).
   */
  maxQuantity: number | null;
}

/** An item's line key: its id alone without options, so a plain item's line is addressed by the item id. */
export function lineKeyOf(menuItemId: string, optionIds: string[]): string {
  return optionIds.length ? `${menuItemId}:${[...optionIds].sort().join(',')}` : menuItemId;
}

/** How many of an item the cart holds in its other lines (stock and the per-item cap are the item's, not a line's). */
function otherQuantity(lines: CartLine[], line: Pick<CartLine, 'menuItemId' | 'lineKey'>): number {
  return lines.reduce(
    (sum, l) =>
      l.menuItemId === line.menuItemId && l.lineKey !== line.lineKey ? sum + l.quantity : sum,
    0,
  );
}

/** The store a cart belongs to: one cart holds one store's items (P2). */
export interface CartStoreRef {
  id: string;
  slug: string;
  name: string;
}

interface CartState {
  storeId: string | null;
  storeSlug: string | null;
  storeName: string | null;
  lines: CartLine[];
  /** The store's limits from its last menu (`MenuResponse.rules`); persisted so the cart page has them without a menu. */
  limits: CartLimits;
  /** Records a loaded menu's rules; an older menu without them keeps the defaults. */
  setLimits: (rules: CartLimits | undefined) => void;
  /**
   * Adds `quantity` (default 1) of a menu item, never past its stock or the store's per-item cap. `store` is the
   * menu's store: an empty cart takes it, and a cart holding another store's items refuses (the caller confirms the
   * replacement first, then clears).
   */
  /** Every line belongs to `store`: an order is placed for exactly one store, so a cart never holds lines without one. */
  add: (item: MenuItem, quantity: number, store: CartStoreRef, options?: CartOption[]) => void;
  /** No-op once the item is at its limit across its lines (the stepper shakes instead). */
  increment: (lineKey: string) => void;
  /** Never goes below 1: at quantity 1 the line is removed instead. */
  decrement: (lineKey: string) => void;
  remove: (lineKey: string) => void;
  clear: () => void;
  /** Resolves a flagged line: trims it to what its item has left, or removes it when nothing is. */
  fix: (lineKey: string) => void;
  /** Records what the server said is left of one item, on every line of it (a checkout error's `details.available`). */
  setAvailability: (menuItemId: string, available: number | null) => void;
  /** Refreshes every line's limit from a freshly loaded menu. Prices, names and photos are left alone. */
  syncAvailability: (items: MenuItem[]) => void;
  /**
   * Sets every line's price to the menu's, its options' deltas included (an option gone from `groups` keeps its
   * delta). Only after the server refused an order over a price change (PRICE_CHANGED).
   */
  syncPrices: (items: MenuItem[], groups?: Record<string, ModifierGroup>) => void;
}

/** What survives a reload; the actions are recreated by the store. */
interface PersistedCart {
  storeId: string | null;
  storeSlug: string | null;
  storeName: string | null;
  lines: CartLine[];
  limits?: CartLimits;
}

/** The store of the saved (persisted) menu that lists this item, if any menu on this device does. */
function storeOfSavedMenuItem(menuItemId: string): CartStoreRef | null {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) keys.push(localStorage.key(i) ?? '');
  } catch {
    return null; // storage blocked
  }
  for (const key of keys.filter((k) => k.startsWith(`${CACHE_PREFIX}menu`))) {
    // Per entry: a damaged or odd-shaped copy (a throw here) must not hide a good one further on.
    try {
      const menu = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<MenuResponse> | null;
      if (
        menu?.store?.id &&
        menu.categories?.some((c) => c.items.some((it) => it.id === menuItemId))
      )
        return { id: menu.store.id, slug: menu.store.slug, name: menu.store.name };
    } catch {
      // next entry
    }
  }
  return null;
}

/** Applies `update` to one line; returns the SAME array when nothing changed so the store can skip the update. */
function updateLine(
  lines: CartLine[],
  lineKey: string,
  update: (line: CartLine) => CartLine | null,
): CartLine[] {
  let changed = false;
  const next = lines.flatMap((line) => {
    if (line.lineKey !== lineKey) return [line];
    const updated = update(line);
    if (updated === line) return [line];
    changed = true;
    return updated ? [updated] : [];
  });
  return changed ? next : lines;
}

/** Returns the untouched state when the lines did not change, so zustand notifies nobody. */
function withLines(state: CartState, lines: CartLine[]): CartState | Pick<CartState, 'lines'> {
  return lines === state.lines ? state : { lines };
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      storeId: null,
      storeSlug: null,
      storeName: null,
      lines: [],
      limits: DEFAULT_LIMITS,

      setLimits(rules) {
        const limits = rules ?? DEFAULT_LIMITS;
        set((state) =>
          state.limits.maxQuantityPerItem === limits.maxQuantityPerItem &&
          state.limits.lowStockThreshold === limits.lowStockThreshold
            ? state
            : { limits },
        );
      },

      add(item, quantity = 1, store, options = []) {
        set((state) => {
          if (state.lines.length > 0 && state.storeId !== store.id) return state;
          const maxQuantity = availableQuantity(item);
          const lineKey = lineKeyOf(
            item.id,
            options.map((o) => o.id),
          );
          const limit =
            lineLimit(maxQuantity, state.limits) -
            otherQuantity(state.lines, { menuItemId: item.id, lineKey });
          if (limit <= 0) return state;

          const existing = state.lines.find((line) => line.lineKey === lineKey);
          if (!existing) {
            const line: CartLine = {
              lineKey,
              menuItemId: item.id,
              name: item.name,
              unitPrice: options.reduce((sum, o) => sum + o.priceDelta, item.price),
              options,
              imageUrl: item.imageUrl,
              quantity: Math.min(limit, Math.max(1, quantity)),
              maxQuantity,
            };
            return {
              lines: [...state.lines, line],
              storeId: store.id,
              storeSlug: store.slug,
              storeName: store.name,
            };
          }
          // A line already over its limit is left as is (the cart flags it); otherwise top it up to the limit.
          const nextQuantity =
            existing.quantity >= limit
              ? existing.quantity
              : Math.min(limit, existing.quantity + quantity);
          return withLines(
            state,
            updateLine(state.lines, lineKey, (l) =>
              l.quantity === nextQuantity && l.maxQuantity === maxQuantity
                ? l
                : { ...l, quantity: nextQuantity, maxQuantity },
            ),
          );
        });
      },

      increment(lineKey) {
        set((state) =>
          withLines(
            state,
            updateLine(state.lines, lineKey, (l) =>
              l.quantity + otherQuantity(state.lines, l) >= lineLimit(l.maxQuantity, state.limits)
                ? l
                : { ...l, quantity: l.quantity + 1 },
            ),
          ),
        );
      },

      decrement(lineKey) {
        set((state) => ({
          lines: updateLine(state.lines, lineKey, (l) =>
            l.quantity <= 1 ? null : { ...l, quantity: l.quantity - 1 },
          ),
        }));
      },

      remove(lineKey) {
        set((state) => ({ lines: state.lines.filter((l) => l.lineKey !== lineKey) }));
      },

      clear() {
        set({ lines: [], storeId: null, storeSlug: null, storeName: null });
      },

      fix(lineKey) {
        set((state) =>
          withLines(
            state,
            updateLine(state.lines, lineKey, (l) => {
              const limit = lineLimit(l.maxQuantity, state.limits) - otherQuantity(state.lines, l);
              if (limit <= 0) return null;
              return l.quantity > limit ? { ...l, quantity: limit } : l;
            }),
          ),
        );
      },

      setAvailability(menuItemId, available) {
        set((state) => {
          let changed = false;
          const lines = state.lines.map((l) => {
            if (l.menuItemId !== menuItemId || l.maxQuantity === available) return l;
            changed = true;
            return { ...l, maxQuantity: available };
          });
          return changed ? { lines } : state;
        });
      },

      syncAvailability(items) {
        set((state) => {
          const byId = new Map(items.map((item) => [item.id, item]));
          let changed = false;
          const lines = state.lines.map((line) => {
            const item = byId.get(line.menuItemId);
            // An item that vanished from the menu can't be ordered either.
            const maxQuantity = item ? availableQuantity(item) : 0;
            if (maxQuantity === line.maxQuantity) return line;
            changed = true;
            return { ...line, maxQuantity };
          });
          return changed ? { lines } : state;
        });
      },

      syncPrices(items, groups = {}) {
        set((state) => {
          const prices = new Map(items.map((item) => [item.id, item.price]));
          const deltas = new Map(
            Object.values(groups).flatMap((g) =>
              g.options.map((o) => [o.id, o.priceDelta] as const),
            ),
          );
          let changed = false;
          const lines = state.lines.map((line) => {
            const base = prices.get(line.menuItemId);
            if (base === undefined) return line;
            const options = line.options.map((o) => {
              const priceDelta = deltas.get(o.id) ?? o.priceDelta;
              return priceDelta === o.priceDelta ? o : { ...o, priceDelta };
            });
            const price = options.reduce((sum, o) => sum + o.priceDelta, base);
            if (price === line.unitPrice && options.every((o, i) => o === line.options[i]))
              return line;
            changed = true;
            return { ...line, unitPrice: price, options };
          });
          return changed ? { lines } : state;
        });
      },
    }),
    {
      name: 'fp_cart',
      version: 3,
      storage: safeJSONStorage(),
      partialize: (state): PersistedCart => ({
        storeId: state.storeId,
        storeSlug: state.storeSlug,
        storeName: state.storeName,
        lines: state.lines,
        limits: state.limits,
      }),
      // Carts saved before stock limits existed have no maxQuantity: treat them as unlimited until a menu load says
      // otherwise. A version-1 cart names no store: it takes the one whose saved menu holds its first line, and is
      // emptied when none does (a cart is cheap to rebuild; one sent to the wrong store is not). Before version 3 a
      // line had no options: its key is its item's id.
      migrate: (persisted, version) => {
        // Lines of an older version lack the fields added since.
        type SavedLine = Omit<CartLine, 'lineKey' | 'options' | 'maxQuantity'> &
          Partial<Pick<CartLine, 'lineKey' | 'options' | 'maxQuantity'>>;
        const saved = persisted as
          (Partial<Omit<PersistedCart, 'lines'>> & { lines?: SavedLine[] }) | undefined;
        const lines = (saved?.lines ?? []).map((line) => ({
          ...line,
          lineKey: line.lineKey ?? line.menuItemId,
          options: line.options ?? [],
          maxQuantity: line.maxQuantity ?? null,
        }));
        if (version >= 2 && saved?.storeId)
          return {
            storeId: saved.storeId,
            storeSlug: saved.storeSlug ?? null,
            storeName: saved.storeName ?? null,
            lines,
            limits: saved.limits ?? DEFAULT_LIMITS,
          };
        const store = lines[0] && storeOfSavedMenuItem(lines[0].menuItemId);
        return {
          storeId: store ? store.id : null,
          storeSlug: store ? store.slug : null,
          storeName: store ? store.name : null,
          lines: store ? lines : [],
          limits: saved?.limits ?? DEFAULT_LIMITS,
        };
      },
    },
  ),
);

/* Derived selectors — count and total are never stored. */
export const selectStoreName = (state: CartState) => state.storeName;
export const selectLimits = (state: CartState) => state.limits;
export const selectLines = (state: CartState) => state.lines;
export const selectCount = (state: CartState) =>
  state.lines.reduce((sum, l) => sum + l.quantity, 0);
export const selectTotal = (state: CartState) =>
  state.lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
/** How many of an item the cart holds, across its lines. */
export const selectQuantityOf = (menuItemId: string) => (state: CartState) =>
  state.lines.reduce((sum, l) => (l.menuItemId === menuItemId ? sum + l.quantity : sum), 0);
