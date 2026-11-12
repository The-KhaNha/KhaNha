import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeJSONStorage } from '../../lib/safeStorage';
import type { MenuItem, MenuResponse } from '../../types/api';
import { CACHE_PREFIX } from '../../lib/useResource';
import fallbacks from '../../config/fallbacks.json';
import { availableQuantity, lineLimit, type CartLimits } from './cartRules';

/** The limits used until a menu says otherwise (config/fallbacks.json, parity-tested against the store defaults). */
const DEFAULT_LIMITS: CartLimits = fallbacks.storeDefaults;

export interface CartLine {
  menuItemId: string;
  name: string;
  unitPrice: number;
  imageUrl: string | null;
  quantity: number;
  /**
   * How many the shop can sell right now, from the last menu the app saw or the server's answer at checkout:
   * null = no stock limit, 0 = sold out / off the menu. Prices are deliberately never refreshed this way (only `syncPrices`, after a PRICE_CHANGED refusal).
   */
  maxQuantity: number | null;
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
  add: (item: MenuItem, quantity?: number, store?: CartStoreRef) => void;
  /** No-op once the line is at its limit (the stepper shakes instead). */
  increment: (menuItemId: string) => void;
  /** Never goes below 1: at quantity 1 the line is removed instead. */
  decrement: (menuItemId: string) => void;
  remove: (menuItemId: string) => void;
  clear: () => void;
  /** Resolves a flagged line: trims it to what is available, or removes it when sold out. */
  fix: (menuItemId: string) => void;
  /** Records what the server said is left of one line (a checkout error's `details.available`). */
  setAvailability: (menuItemId: string, available: number | null) => void;
  /** Refreshes every line's limit from a freshly loaded menu. Prices, names and photos are left alone. */
  syncAvailability: (items: MenuItem[]) => void;
  /** Sets every line's price to the menu's. Only after the server refused an order over a price change (PRICE_CHANGED). */
  syncPrices: (items: MenuItem[]) => void;
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
  let count: number;
  try {
    count = localStorage.length;
  } catch {
    return null; // storage blocked
  }
  for (let i = 0; i < count; i += 1) {
    // Per entry: one damaged or odd-shaped copy must not hide a good one further on.
    try {
      const key = localStorage.key(i);
      if (!key?.startsWith(`${CACHE_PREFIX}menu`)) continue;
      const menu = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<MenuResponse> | null;
      const store = menu?.store;
      const listed =
        Array.isArray(menu?.categories) &&
        menu.categories.some(
          (c) => Array.isArray(c?.items) && c.items.some((item) => item?.id === menuItemId),
        );
      if (listed && store && typeof store.id === 'string' && typeof store.slug === 'string')
        return { id: store.id, slug: store.slug, name: store.name };
    } catch {
      // A malformed copy: try the next.
    }
  }
  return null;
}

/** Applies `update` to one line; returns the SAME array when nothing changed so the store can skip the update. */
function updateLine(
  lines: CartLine[],
  menuItemId: string,
  update: (line: CartLine) => CartLine | null,
): CartLine[] {
  let changed = false;
  const next = lines.flatMap((line) => {
    if (line.menuItemId !== menuItemId) return [line];
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

      add(item, quantity = 1, store) {
        set((state) => {
          if (store && state.lines.length > 0 && state.storeId !== store.id) return state;
          const maxQuantity = availableQuantity(item);
          const limit = lineLimit(maxQuantity, state.limits);
          if (limit <= 0) return state;

          const existing = state.lines.find((line) => line.menuItemId === item.id);
          if (!existing) {
            const line: CartLine = {
              menuItemId: item.id,
              name: item.name,
              unitPrice: item.price,
              imageUrl: item.imageUrl,
              quantity: Math.min(limit, Math.max(1, quantity)),
              maxQuantity,
            };
            return {
              lines: [...state.lines, line],
              ...(store && { storeId: store.id, storeSlug: store.slug, storeName: store.name }),
            };
          }
          // A line already over its limit is left as is (the cart flags it); otherwise top it up to the limit.
          const nextQuantity =
            existing.quantity >= limit
              ? existing.quantity
              : Math.min(limit, existing.quantity + quantity);
          return withLines(
            state,
            updateLine(state.lines, item.id, (l) =>
              l.quantity === nextQuantity && l.maxQuantity === maxQuantity
                ? l
                : { ...l, quantity: nextQuantity, maxQuantity },
            ),
          );
        });
      },

      increment(menuItemId) {
        set((state) =>
          withLines(
            state,
            updateLine(state.lines, menuItemId, (l) =>
              l.quantity >= lineLimit(l.maxQuantity, state.limits)
                ? l
                : { ...l, quantity: l.quantity + 1 },
            ),
          ),
        );
      },

      decrement(menuItemId) {
        set((state) => ({
          lines: updateLine(state.lines, menuItemId, (l) =>
            l.quantity <= 1 ? null : { ...l, quantity: l.quantity - 1 },
          ),
        }));
      },

      remove(menuItemId) {
        set((state) => ({ lines: state.lines.filter((l) => l.menuItemId !== menuItemId) }));
      },

      clear() {
        set({ lines: [], storeId: null, storeSlug: null, storeName: null });
      },

      fix(menuItemId) {
        set((state) =>
          withLines(
            state,
            updateLine(state.lines, menuItemId, (l) => {
              const limit = lineLimit(l.maxQuantity, state.limits);
              if (limit <= 0) return null;
              return l.quantity > limit ? { ...l, quantity: limit } : l;
            }),
          ),
        );
      },

      setAvailability(menuItemId, available) {
        set((state) =>
          withLines(
            state,
            updateLine(state.lines, menuItemId, (l) =>
              l.maxQuantity === available ? l : { ...l, maxQuantity: available },
            ),
          ),
        );
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

      syncPrices(items) {
        set((state) => {
          const prices = new Map(items.map((item) => [item.id, item.price]));
          let changed = false;
          const lines = state.lines.map((line) => {
            const price = prices.get(line.menuItemId);
            if (price === undefined || price === line.unitPrice) return line;
            changed = true;
            return { ...line, unitPrice: price };
          });
          return changed ? { lines } : state;
        });
      },
    }),
    {
      name: 'fp_cart',
      version: 2,
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
      // emptied when none does (a cart is cheap to rebuild; one sent to the wrong store is not).
      migrate: (persisted) => {
        const saved = persisted as Partial<PersistedCart> | undefined;
        const lines = (saved?.lines ?? []).map((line) => ({
          ...line,
          maxQuantity: line.maxQuantity ?? null,
        }));
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
export const selectQuantityOf = (menuItemId: string) => (state: CartState) =>
  state.lines.find((l) => l.menuItemId === menuItemId)?.quantity ?? 0;
