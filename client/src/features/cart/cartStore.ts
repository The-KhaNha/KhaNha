import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MenuItem } from '../../types/api';
import { availableQuantity, lineLimit } from './cartRules';

export { MAX_LINE_QUANTITY } from './cartRules';

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

interface CartState {
  lines: CartLine[];
  /** Adds `quantity` (default 1) of a menu item, never past its stock or MAX_LINE_QUANTITY. */
  add: (item: MenuItem, quantity?: number) => void;
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
  lines: CartLine[];
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
      lines: [],

      add(item, quantity = 1) {
        set((state) => {
          const maxQuantity = availableQuantity(item);
          const limit = lineLimit(maxQuantity);
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
            return { lines: [...state.lines, line] };
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
              l.quantity >= lineLimit(l.maxQuantity) ? l : { ...l, quantity: l.quantity + 1 },
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
        set({ lines: [] });
      },

      fix(menuItemId) {
        set((state) =>
          withLines(
            state,
            updateLine(state.lines, menuItemId, (l) => {
              const limit = lineLimit(l.maxQuantity);
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
      version: 1,
      partialize: (state): PersistedCart => ({ lines: state.lines }),
      // Carts saved before stock limits existed have no maxQuantity: treat them as unlimited until a menu load says otherwise.
      migrate: (persisted) => {
        const lines = (persisted as Partial<PersistedCart> | undefined)?.lines ?? [];
        return { lines: lines.map((line) => ({ ...line, maxQuantity: line.maxQuantity ?? null })) };
      },
    },
  ),
);

/* Derived selectors — count and total are never stored. */
export const selectLines = (state: CartState) => state.lines;
export const selectCount = (state: CartState) =>
  state.lines.reduce((sum, l) => sum + l.quantity, 0);
export const selectTotal = (state: CartState) =>
  state.lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
export const selectQuantityOf = (menuItemId: string) => (state: CartState) =>
  state.lines.find((l) => l.menuItemId === menuItemId)?.quantity ?? 0;
