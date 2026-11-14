import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fillStorage } from '../../test/storage';
import type { MenuItem } from '../../types/api';
import { CACHE_PREFIX } from '../../lib/useResource';
import { selectCount, selectLines, selectQuantityOf, selectTotal, useCartStore } from './cartStore';

const CAP = 10;
const cafe = { id: 's1', slug: 'cafe', name: 'Cafe' };

function menuItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: 'item-1',
    category: 'Coffee',
    name: 'Cold Coffee',
    description: 'Creamy chilled coffee',
    price: 120,
    imageUrl: '/images/cold-coffee.jpg',
    diet: null,
    isAvailable: true,
    isPopular: true,
    sortOrder: 1,
    stockQuantity: null,
    ...overrides,
  };
}

beforeEach(() => {
  // Not setState(_, true): cartStore keeps its actions on the same state object as `lines`, and a
  // replace=true reset would wipe them along with the data. A plain merge resets just the data.
  useCartStore.setState({
    storeId: null,
    storeSlug: null,
    storeName: null,
    lines: [],
    limits: { maxQuantityPerItem: CAP, lowStockThreshold: 5 },
  });
  localStorage.clear();
});

describe('add', () => {
  it('adds a new line at quantity 1 by default', () => {
    useCartStore.getState().add(menuItem(), 1, cafe);
    const lines = selectLines(useCartStore.getState());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ menuItemId: 'item-1', quantity: 1, maxQuantity: null });
  });

  it('tops up an existing line by the given quantity', () => {
    const item = menuItem();
    useCartStore.getState().add(item, 2, cafe);
    useCartStore.getState().add(item, 3, cafe);
    expect(selectQuantityOf('item-1')(useCartStore.getState())).toBe(5);
  });

  it('caps a new line at the item’s stock limit', () => {
    useCartStore.getState().add(menuItem({ stockQuantity: 2 }), 5, cafe);
    expect(selectQuantityOf('item-1')(useCartStore.getState())).toBe(2);
  });

  it('caps at CAP when there is no stock limit', () => {
    useCartStore.getState().add(menuItem(), CAP + 10, cafe);
    expect(selectQuantityOf('item-1')(useCartStore.getState())).toBe(CAP);
  });

  it('caps at the store’s own limit when the menu rules say so', () => {
    useCartStore.getState().setLimits({ maxQuantityPerItem: 3, lowStockThreshold: 1 });
    useCartStore.getState().add(menuItem(), 8, cafe);
    expect(selectQuantityOf('item-1')(useCartStore.getState())).toBe(3);
    useCartStore.getState().increment('item-1');
    expect(selectQuantityOf('item-1')(useCartStore.getState())).toBe(3);
  });

  it('falls back to the defaults when a menu carries no rules', () => {
    useCartStore.getState().setLimits({ maxQuantityPerItem: 3, lowStockThreshold: 1 });
    useCartStore.getState().setLimits(undefined);
    expect(useCartStore.getState().limits).toEqual({
      maxQuantityPerItem: 10,
      lowStockThreshold: 5,
    });
  });

  it('does nothing (limit <= 0) for an unavailable item', () => {
    useCartStore.getState().add(menuItem({ isAvailable: false }), 1, cafe);
    expect(selectLines(useCartStore.getState())).toHaveLength(0);
  });

  it('leaves an already-over-limit line alone instead of pushing it further over', () => {
    const store = useCartStore.getState();
    store.add(menuItem({ stockQuantity: 10 }), 8, cafe);
    // Stock drops to 3 (e.g. someone else bought some) before the next add.
    store.add(menuItem({ stockQuantity: 3 }), 1, cafe);
    expect(selectQuantityOf('item-1')(useCartStore.getState())).toBe(8);
  });
});

describe('increment / decrement', () => {
  it('increments by 1, up to the limit', () => {
    const store = useCartStore.getState();
    store.add(menuItem({ stockQuantity: 2 }), 1, cafe);
    store.increment('item-1');
    expect(selectQuantityOf('item-1')(useCartStore.getState())).toBe(2);
    store.increment('item-1'); // already at the limit: no-op
    expect(selectQuantityOf('item-1')(useCartStore.getState())).toBe(2);
  });

  it('decrements by 1, removing the line once it would go below 1', () => {
    const store = useCartStore.getState();
    store.add(menuItem(), 2, cafe);
    store.decrement('item-1');
    expect(selectQuantityOf('item-1')(useCartStore.getState())).toBe(1);
    store.decrement('item-1');
    expect(selectLines(useCartStore.getState())).toHaveLength(0);
  });
});

describe('remove / clear', () => {
  it('remove drops one line and leaves the others', () => {
    const store = useCartStore.getState();
    store.add(menuItem({ id: 'a' }), 1, cafe);
    store.add(menuItem({ id: 'b' }), 1, cafe);
    store.remove('a');
    expect(selectLines(useCartStore.getState()).map((l) => l.menuItemId)).toEqual(['b']);
  });

  it('clear empties the cart', () => {
    useCartStore.getState().add(menuItem(), 1, cafe);
    useCartStore.getState().clear();
    expect(selectLines(useCartStore.getState())).toHaveLength(0);
  });
});

describe('fix', () => {
  it('trims an over-limit line down to the current limit', () => {
    const store = useCartStore.getState();
    store.add(menuItem({ stockQuantity: 10 }), 8, cafe);
    store.setAvailability('item-1', 3);
    store.fix('item-1');
    expect(selectQuantityOf('item-1')(useCartStore.getState())).toBe(3);
  });

  it('removes a sold-out line entirely', () => {
    const store = useCartStore.getState();
    store.add(menuItem({ stockQuantity: 10 }), 2, cafe);
    store.setAvailability('item-1', 0);
    store.fix('item-1');
    expect(selectLines(useCartStore.getState())).toHaveLength(0);
  });

  it('leaves a line that is already within its limit untouched', () => {
    const store = useCartStore.getState();
    store.add(menuItem({ stockQuantity: 10 }), 2, cafe);
    store.fix('item-1');
    expect(selectQuantityOf('item-1')(useCartStore.getState())).toBe(2);
  });
});

describe('setAvailability / syncAvailability', () => {
  it('setAvailability records what the server said is left for one line', () => {
    useCartStore.getState().add(menuItem(), 1, cafe);
    useCartStore.getState().setAvailability('item-1', 4);
    expect(selectLines(useCartStore.getState()).at(0)?.maxQuantity).toBe(4);
  });

  it('syncAvailability refreshes every line’s limit from a freshly loaded menu', () => {
    useCartStore.getState().add(menuItem({ id: 'a' }), 1, cafe);
    useCartStore.getState().add(menuItem({ id: 'b' }), 1, cafe);
    useCartStore
      .getState()
      .syncAvailability([
        menuItem({ id: 'a', stockQuantity: 2 }),
        menuItem({ id: 'b', isAvailable: false }),
      ]);
    const lines = selectLines(useCartStore.getState());
    expect(lines.find((l) => l.menuItemId === 'a')?.maxQuantity).toBe(2);
    expect(lines.find((l) => l.menuItemId === 'b')?.maxQuantity).toBe(0);
  });

  it('syncAvailability treats an item that vanished from the menu as unavailable (0)', () => {
    useCartStore.getState().add(menuItem({ id: 'a' }), 1, cafe);
    useCartStore.getState().syncAvailability([]);
    expect(selectLines(useCartStore.getState()).at(0)?.maxQuantity).toBe(0);
  });
});

describe('selectors', () => {
  it('selectCount sums quantities; selectTotal sums unitPrice × quantity', () => {
    useCartStore.getState().add(menuItem({ id: 'a', price: 120 }), 2, cafe);
    useCartStore.getState().add(menuItem({ id: 'b', price: 90 }), 3, cafe);
    expect(selectCount(useCartStore.getState())).toBe(5);
    expect(selectTotal(useCartStore.getState())).toBe(120 * 2 + 90 * 3);
  });

  it('selectQuantityOf is 0 for a line that is not in the cart', () => {
    expect(selectQuantityOf('missing')(useCartStore.getState())).toBe(0);
  });
});

// zustand's persist writes inside every set() and does not catch: a full quota once took /menu down on every load,
// because useMenu's effect calls syncAvailability (even on an empty cart).
describe('with browser storage full', () => {
  let full: ReturnType<typeof fillStorage>;
  beforeEach(() => {
    full = fillStorage();
  });
  afterEach(() => full.mockRestore());

  it('add and syncAvailability still work in memory', () => {
    useCartStore.getState().add(menuItem({ id: 'a', stockQuantity: 3 }), 1, cafe);
    useCartStore.getState().syncAvailability([menuItem({ id: 'a', stockQuantity: 1 })]);
    expect(selectLines(useCartStore.getState())).toMatchObject([
      { menuItemId: 'a', quantity: 1, maxQuantity: 1 },
    ]);
    expect(full).toHaveBeenCalled();
  });

  it('syncAvailability on an empty cart does not throw', () => {
    expect(() => useCartStore.getState().syncAvailability([menuItem()])).not.toThrow();
  });
});

describe('one cart per store', () => {
  const cafe = { id: 's1', slug: 'cafe', name: 'Cafe' };
  const bakery = { id: 's2', slug: 'bakery', name: 'Bakery' };

  it('takes the store of its first line and keeps it while there are lines', () => {
    useCartStore.getState().add(menuItem(), 1, cafe);
    expect(useCartStore.getState()).toMatchObject({ storeId: 's1', storeSlug: 'cafe' });
  });

  it('refuses another store until the cart is cleared (replace), and Keep leaves it as it was', () => {
    useCartStore.getState().add(menuItem(), 1, cafe);
    useCartStore.getState().add(menuItem({ id: 'item-2' }), 1, bakery);
    expect(selectLines(useCartStore.getState()).map((l) => l.menuItemId)).toEqual(['item-1']);

    useCartStore.getState().clear();
    useCartStore.getState().add(menuItem({ id: 'item-2' }), 1, bakery);
    expect(selectLines(useCartStore.getState()).map((l) => l.menuItemId)).toEqual(['item-2']);
    expect(useCartStore.getState().storeName).toBe('Bakery');
  });
});

describe('migration from version 1', () => {
  const line = {
    menuItemId: 'item-1',
    name: 'Cold Coffee',
    unitPrice: 120,
    imageUrl: null,
    quantity: 2,
  };
  const saved = (lines: unknown[]) =>
    localStorage.setItem('fp_cart', JSON.stringify({ state: { lines }, version: 1 }));
  const savedMenu = (key: string, id: string) =>
    localStorage.setItem(
      `${CACHE_PREFIX}${key}`,
      JSON.stringify({
        store: { id: 's9', slug: 'north', name: 'North' },
        categories: [{ name: 'Coffee', items: [{ id }] }],
      }),
    );

  it('gives the cart the store whose saved menu lists its first line', async () => {
    saved([line]);
    savedMenu('menu:north', 'item-1');
    await useCartStore.persist.rehydrate();
    expect(useCartStore.getState()).toMatchObject({ storeId: 's9', storeSlug: 'north' });
    expect(selectLines(useCartStore.getState())).toHaveLength(1);
  });

  it('looks past a damaged or odd-shaped saved menu to a good one', async () => {
    saved([line]);
    localStorage.setItem(`${CACHE_PREFIX}menu:a`, '{not json');
    localStorage.setItem(`${CACHE_PREFIX}menu:b`, JSON.stringify({ store: { id: 'x' } }));
    savedMenu('menu:north', 'item-1');
    await useCartStore.persist.rehydrate();
    expect(useCartStore.getState()).toMatchObject({ storeId: 's9' });
  });

  it('empties a cart whose store cannot be found', async () => {
    saved([line]);
    savedMenu('menu', 'another-item');
    await useCartStore.persist.rehydrate();
    expect(selectLines(useCartStore.getState())).toHaveLength(0);
    expect(useCartStore.getState().storeId).toBeNull();
  });
});

describe('lines with options (P3.2)', () => {
  const large = { id: 'o-large', groupName: 'Size', name: 'Large', priceDelta: 20 };
  const oat = { id: 'o-oat', groupName: 'Milk', name: 'Oat', priceDelta: 30 };

  it('makes one line per choice of options, priced with their deltas, in any order the same line', () => {
    const { add } = useCartStore.getState();
    add(menuItem(), 1, cafe);
    add(menuItem(), 1, cafe, [large, oat]);
    add(menuItem(), 1, cafe, [oat, large]);
    const lines = selectLines(useCartStore.getState());
    expect(lines.map((l) => [l.lineKey, l.unitPrice, l.quantity])).toEqual([
      ['item-1', 120, 1],
      ['item-1:o-large,o-oat', 170, 2],
    ]);
    expect(selectQuantityOf('item-1')(useCartStore.getState())).toBe(3);
    expect(selectTotal(useCartStore.getState())).toBe(120 + 170 * 2);
  });

  it("shares the item's limit across its lines", () => {
    const { add, increment, fix } = useCartStore.getState();
    const item = menuItem({ stockQuantity: 3 });
    add(item, 2, cafe);
    add(item, 5, cafe, [large]); // only 1 left for this line
    expect(selectLines(useCartStore.getState()).map((l) => l.quantity)).toEqual([2, 1]);
    increment('item-1:o-large');
    increment('item-1');
    expect(selectQuantityOf('item-1')(useCartStore.getState())).toBe(3);
    // The shop now has 2: the line fixed first keeps what the other leaves.
    useCartStore.getState().setAvailability('item-1', 2);
    fix('item-1:o-large');
    expect(selectLines(useCartStore.getState()).map((l) => l.lineKey)).toEqual(['item-1']);
  });

  it('takes the stock an add sees onto every line of the item, so none keeps a stale limit', () => {
    const { add, increment } = useCartStore.getState();
    add(menuItem({ stockQuantity: 10 }), 1, cafe);
    add(menuItem({ stockQuantity: 2 }), 1, cafe, [large]);
    increment('item-1');
    expect(selectQuantityOf('item-1')(useCartStore.getState())).toBe(2);
    // Nothing left to add, but the plain line still learns the new stock.
    useCartStore.setState({ lines: selectLines(useCartStore.getState()).slice(0, 1) });
    add(menuItem({ stockQuantity: 1 }), 1, cafe, [large]);
    expect(selectLines(useCartStore.getState())[0]?.maxQuantity).toBe(1);
  });

  it("syncs a line's price with its options' current deltas", () => {
    useCartStore.getState().add(menuItem(), 1, cafe, [large]);
    useCartStore.getState().syncPrices([menuItem({ price: 130 })], {
      g: {
        id: 'g',
        name: 'Size',
        minSelect: 1,
        maxSelect: 1,
        options: [{ ...large, isDefault: false, isAvailable: true, priceDelta: 25 }],
      },
    });
    const [line] = selectLines(useCartStore.getState());
    expect(line?.unitPrice).toBe(155);
    expect(line?.options[0]?.priceDelta).toBe(25);
  });
});

describe('migration from version 2', () => {
  it("keeps the cart and its store; each line's key is its item", async () => {
    localStorage.setItem(
      'fp_cart',
      JSON.stringify({
        state: {
          storeId: 's1',
          storeSlug: 'cafe',
          storeName: 'Cafe',
          lines: [
            {
              menuItemId: 'item-1',
              name: 'Cold Coffee',
              unitPrice: 120,
              imageUrl: null,
              quantity: 2,
              maxQuantity: null,
            },
          ],
        },
        version: 2,
      }),
    );
    await useCartStore.persist.rehydrate();
    expect(useCartStore.getState()).toMatchObject({ storeId: 's1', storeSlug: 'cafe' });
    expect(selectLines(useCartStore.getState())).toEqual([
      expect.objectContaining({
        lineKey: 'item-1',
        menuItemId: 'item-1',
        options: [],
        quantity: 2,
      }),
    ]);
    useCartStore.getState().increment('item-1');
    expect(selectQuantityOf('item-1')(useCartStore.getState())).toBe(3);
  });
});
