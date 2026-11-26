import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fillStorage } from '../../test/storage';
import type { MenuItem } from '../../types/api';
import { CACHE_PREFIX } from '../../lib/useResource';
import fallbacks from '../../config/fallbacks.json';
import {
  selectCount,
  selectLimits,
  selectLines,
  selectQuantityOf,
  selectStoreName,
  selectTotal,
  useCartStore,
} from './cartStore';

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

  it('syncAvailability on an empty cart leaves it empty', () => {
    useCartStore.getState().syncAvailability([menuItem()]);
    expect(selectLines(useCartStore.getState())).toEqual([]);
    expect(useCartStore.getState().storeId).toBeNull();
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

describe('another tab', () => {
  it("takes another tab's cart when it changes, so a paid cart is not paid again here", async () => {
    useCartStore.getState().add(menuItem(), 1, cafe);
    expect(selectCount(useCartStore.getState())).toBe(1);
    // The other tab paid and emptied the cart: only its storage write reaches this tab.
    const emptied = JSON.stringify({
      state: {
        storeId: null,
        storeSlug: null,
        storeName: null,
        lines: [],
        limits: { maxQuantityPerItem: CAP, lowStockThreshold: 5 },
      },
      version: 3,
    });
    localStorage.setItem('fp_cart', emptied);
    window.dispatchEvent(new StorageEvent('storage', { key: 'fp_cart', newValue: emptied }));
    await vi.waitFor(() => expect(useCartStore.getState().lines).toEqual([]));
    expect(useCartStore.getState().storeId).toBeNull();
  });

  it('keeps a replacement cart when a queued removal arrives after it was written', async () => {
    useCartStore.getState().add(menuItem(), 1, cafe);
    const replacement = JSON.stringify({
      state: {
        storeId: cafe.id,
        storeSlug: cafe.slug,
        storeName: cafe.name,
        lines: [
          {
            lineKey: 'item-9',
            menuItemId: 'item-9',
            name: 'Tea',
            unitPrice: 20,
            options: [],
            imageUrl: null,
            quantity: 3,
            maxQuantity: null,
          },
        ],
        limits: { maxQuantityPerItem: CAP, lowStockThreshold: 5 },
      },
      version: 3,
    });
    localStorage.setItem('fp_cart', replacement);
    window.dispatchEvent(new StorageEvent('storage', { key: 'fp_cart', newValue: null }));
    await vi.waitFor(() =>
      expect(useCartStore.getState().lines.map((l) => l.menuItemId)).toEqual(['item-9']),
    );
  });

  it.each([
    ['removes fp_cart', 'fp_cart'],
    ['clears storage', null],
  ])('empties the cart when another tab %s', (_label, key) => {
    useCartStore.getState().add(menuItem(), 1, cafe);
    localStorage.removeItem('fp_cart');
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: null }));
    expect(useCartStore.getState().lines).toEqual([]);
    expect(useCartStore.getState().storeId).toBeNull();
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

describe('an old line of an item that now has a required choice (P3.2)', () => {
  const size = {
    id: 'size',
    name: 'Size',
    minSelect: 1,
    maxSelect: 1,
    options: [
      { id: 'reg', name: 'Regular', priceDelta: 20, isDefault: true, isAvailable: true },
      { id: 'big', name: 'Big', priceDelta: 40, isDefault: false, isAvailable: true },
    ],
  };
  const withSize = menuItem({ modifierGroupIds: ['size'] });

  it('takes the default the server would apply, priced, when the cart reprices', () => {
    useCartStore.getState().add(menuItem(), 2, cafe); // saved before the item had choices
    useCartStore.getState().syncPrices([withSize], { size });
    const [line] = selectLines(useCartStore.getState());
    expect(line).toMatchObject({ lineKey: 'item-1:reg', unitPrice: 140, quantity: 2 });
    expect(line?.options.map((o) => o.id)).toEqual(['reg']);
  });

  it('merges into the line it now matches', () => {
    const regular = { id: 'reg', groupName: 'Size', name: 'Regular', priceDelta: 20 };
    useCartStore.getState().add(menuItem(), 1, cafe);
    useCartStore.getState().add(withSize, 2, cafe, [regular]);
    useCartStore.getState().syncPrices([withSize], { size });
    expect(selectLines(useCartStore.getState()).map((l) => [l.lineKey, l.quantity])).toEqual([
      ['item-1:reg', 3],
    ]);
  });

  it('leaves a line that already chose in the group alone', () => {
    const big = { id: 'big', groupName: 'Size', name: 'Big', priceDelta: 40 };
    useCartStore.getState().add(withSize, 1, cafe, [big]);
    useCartStore.getState().syncPrices([withSize], { size });
    expect(selectLines(useCartStore.getState())[0]?.options.map((o) => o.id)).toEqual(['big']);
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

describe('persistence across tabs', () => {
  it('a sync that changes nothing does not write fp_cart', () => {
    useCartStore.getState().add(menuItem(), 1, cafe);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    useCartStore.getState().syncAvailability([menuItem()]);
    useCartStore.getState().syncOptions([menuItem()], {});
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });

  it('persists a line without optionsStale', () => {
    useCartStore.getState().add(menuItem(), 1, cafe);
    useCartStore.setState((s) => ({ lines: s.lines.map((l) => ({ ...l, optionsStale: true })) }));
    const saved = JSON.parse(localStorage.getItem('fp_cart') ?? '{}') as {
      state: { lines: object[] };
    };
    expect(saved.state.lines).toHaveLength(1);
    expect(saved.state.lines[0]).not.toHaveProperty('optionsStale');
  });
});

describe('cart invariants over random action sequences', () => {
  // Small seeded PRNG (mulberry32): the sequences look random but are identical on every run.
  function prng(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const items = [
    menuItem({ id: 'a', price: 120, stockQuantity: null }),
    menuItem({ id: 'b', price: 35, stockQuantity: 3 }),
    menuItem({ id: 'c', price: 50, stockQuantity: 12 }),
  ];
  const options = [
    [],
    [{ id: 'o1', groupName: 'Size', name: 'Large', priceDelta: 20 }],
    [{ id: 'o2', groupName: 'Milk', name: 'Oat', priceDelta: 15 }],
  ];

  it('count and total stay derived from the lines and every quantity stays within its bounds', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const next = prng(seed);
      const pick = <T>(list: T[]): T => list[Math.floor(next() * list.length)] as T;
      useCartStore.getState().clear();
      const steps = 1 + Math.floor(next() * 15);
      for (let step = 0; step < steps; step += 1) {
        const state = useCartStore.getState();
        const line = state.lines.length > 0 ? pick(state.lines) : null;
        const action = Math.floor(next() * 7);
        if (action <= 2 || !line) {
          state.add(pick(items), 1 + Math.floor(next() * 4), cafe, pick(options));
        } else if (action === 3) state.increment(line.lineKey);
        else if (action === 4) state.decrement(line.lineKey);
        else if (action === 5) state.remove(line.lineKey);
        else if (next() < 0.15) state.clear();
        else state.fix(line.lineKey);

        const after = useCartStore.getState();
        let quantity = 0;
        let total = 0;
        const perItem = new Map<string, number>();
        for (const l of after.lines) {
          expect(Number.isInteger(l.quantity) && l.quantity >= 1, `seed ${seed}`).toBe(true);
          quantity += l.quantity;
          total += l.unitPrice * l.quantity;
          perItem.set(l.menuItemId, (perItem.get(l.menuItemId) ?? 0) + l.quantity);
        }
        expect(selectCount(after), `seed ${seed}`).toBe(quantity);
        expect(selectTotal(after), `seed ${seed}`).toBe(total);
        for (const [id, sum] of perItem) {
          const stock = items.find((i) => i.id === id)?.stockQuantity ?? CAP;
          expect(sum, `seed ${seed}: ${id}`).toBeLessThanOrEqual(Math.min(CAP, stock));
        }
      }
    }
  });
});

/** How many times subscribers were told while `act` ran: a no-op must stay silent. Silence says nothing about storage: see storageUntouched. */
function notifications(act: () => void): number {
  let count = 0;
  const unsubscribe = useCartStore.subscribe(() => {
    count += 1;
  });
  act();
  unsubscribe();
  return count;
}

/**
 * Whether `act`, a no-op here, left fp_cart alone. Another tab just stored a newer cart; persist writes after every
 * `set` (even `set(state => state)`, which notifies nobody), so a no-op that still calls `set` overwrites it with this tab's older lines.
 */
function storageUntouched(act: () => void): boolean {
  const newer = JSON.stringify({ state: { storeId: 's1', lines: [] }, version: 3 });
  localStorage.setItem('fp_cart', newer);
  act();
  return localStorage.getItem('fp_cart') === newer;
}

describe('no-op actions leave the store untouched', () => {
  const large = { id: 'o-large', groupName: 'Size', name: 'Large', priceDelta: 20 };
  const sizeGroup = {
    id: 'size',
    name: 'Size',
    minSelect: 1,
    maxSelect: 1,
    options: [{ id: 'o-large', name: 'Large', priceDelta: 20, isDefault: true, isAvailable: true }],
  };

  it('setLimits with the same values, and a change in either value', () => {
    const { setLimits } = useCartStore.getState();
    expect(notifications(() => setLimits({ maxQuantityPerItem: CAP, lowStockThreshold: 5 }))).toBe(
      0,
    );
    expect(
      storageUntouched(() => setLimits({ maxQuantityPerItem: CAP, lowStockThreshold: 5 })),
    ).toBe(true);
    expect(notifications(() => setLimits({ maxQuantityPerItem: 4, lowStockThreshold: 5 }))).toBe(1);
    expect(notifications(() => setLimits({ maxQuantityPerItem: 4, lowStockThreshold: 2 }))).toBe(1);
    expect(useCartStore.getState().limits).toEqual({ maxQuantityPerItem: 4, lowStockThreshold: 2 });
    setLimits(undefined);
    expect(useCartStore.getState().limits).toEqual(fallbacks.storeDefaults);
  });

  it('add past a full line changes nothing, and an item with none left adds nothing', () => {
    useCartStore.getState().add(menuItem(), CAP, cafe);
    useCartStore.getState().add(menuItem(), 1, cafe);
    expect(selectCount(useCartStore.getState())).toBe(CAP);
    useCartStore.getState().clear();
    expect(
      notifications(() =>
        useCartStore.getState().add(menuItem({ id: 'gone', isAvailable: false }), 1, cafe),
      ),
    ).toBe(0);
    expect(selectLines(useCartStore.getState())).toEqual([]);
    expect(
      storageUntouched(() =>
        useCartStore.getState().add(menuItem({ id: 'gone', isAvailable: false }), 1, cafe),
      ),
    ).toBe(true);
  });

  it('add leaves other items’ lines, and lines already at the seen stock, as they were', () => {
    useCartStore.getState().add(menuItem({ id: 'a' }), 1, cafe);
    useCartStore.getState().add(menuItem({ id: 'b', stockQuantity: 2 }), 1, cafe);
    const [a] = selectLines(useCartStore.getState());
    expect(a?.maxQuantity).toBeNull();
    useCartStore.getState().add(menuItem({ id: 'a' }), 1, cafe);
    expect(selectLines(useCartStore.getState())[1]?.maxQuantity).toBe(2);
    expect(selectLines(useCartStore.getState())[0]).toMatchObject({
      maxQuantity: null,
      quantity: 2,
    });
  });

  it('increment at the limit, and one line beside another', () => {
    useCartStore.getState().add(menuItem({ id: 'a', stockQuantity: 3 }), 3, cafe);
    useCartStore.getState().add(menuItem({ id: 'b' }), 1, cafe);
    expect(notifications(() => useCartStore.getState().increment('a'))).toBe(0);
    expect(storageUntouched(() => useCartStore.getState().increment('a'))).toBe(true);
    useCartStore.getState().increment('b');
    expect(selectLines(useCartStore.getState()).map((l) => [l.lineKey, l.quantity])).toEqual([
      ['a', 3],
      ['b', 2],
    ]);
  });

  it('a line of an item counts its other lines against the limit, not itself or other items', () => {
    const item = menuItem({ id: 'a', stockQuantity: 3 });
    useCartStore.getState().add(item, 1, cafe, [large]);
    useCartStore.getState().add(item, 1, cafe);
    useCartStore.getState().add(menuItem({ id: 'b' }), 5, cafe);
    // 2 of 3 held: one more fits on either line, then none.
    useCartStore.getState().increment('a');
    expect(selectQuantityOf('a')(useCartStore.getState())).toBe(3);
    expect(notifications(() => useCartStore.getState().increment('a:o-large'))).toBe(0);
    expect(selectQuantityOf('b')(useCartStore.getState())).toBe(5);
  });

  it('fix on a line exactly at its limit, and on a line beside others', () => {
    useCartStore.getState().add(menuItem({ id: 'a', stockQuantity: 2 }), 2, cafe);
    useCartStore.getState().add(menuItem({ id: 'b' }), 4, cafe);
    expect(notifications(() => useCartStore.getState().fix('a'))).toBe(0);
    expect(storageUntouched(() => useCartStore.getState().fix('a'))).toBe(true);
    useCartStore.getState().setAvailability('b', 1);
    useCartStore.getState().fix('b');
    expect(selectLines(useCartStore.getState()).map((l) => [l.lineKey, l.quantity])).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });

  it('setAvailability to what the line already has, and for another item', () => {
    useCartStore.getState().add(menuItem({ id: 'a', stockQuantity: 4 }), 1, cafe);
    expect(notifications(() => useCartStore.getState().setAvailability('a', 4))).toBe(0);
    expect(notifications(() => useCartStore.getState().setAvailability('zzz', 1))).toBe(0);
    expect(storageUntouched(() => useCartStore.getState().setAvailability('a', 4))).toBe(true);
    expect(storageUntouched(() => useCartStore.getState().setAvailability('zzz', 1))).toBe(true);
    useCartStore.getState().add(menuItem({ id: 'b' }), 1, cafe);
    useCartStore.getState().setAvailability('a', 1);
    expect(selectLines(useCartStore.getState()).map((l) => l.maxQuantity)).toEqual([1, null]);
  });

  it('syncAvailability and syncOptions that find nothing new', () => {
    useCartStore.getState().add(menuItem(), 1, cafe, [large]);
    const same = [menuItem()];
    useCartStore.getState().syncOptions(same, { size: sizeGroup });
    expect(
      notifications(() => useCartStore.getState().syncAvailability(same, { size: sizeGroup })),
    ).toBe(0);
    expect(
      notifications(() => useCartStore.getState().syncOptions(same, { size: sizeGroup })),
    ).toBe(0);
  });

  it('syncAvailability and syncOptions keep what a line had when the menu cannot say', () => {
    useCartStore.getState().add(menuItem(), 1, cafe);
    useCartStore.setState((s) => ({ lines: s.lines.map((l) => ({ ...l, optionsStale: true })) }));
    // The item vanished: with choices in hand, a missing item is not asked about them.
    useCartStore.getState().syncOptions([], { size: sizeGroup });
    expect(selectLines(useCartStore.getState())[0]?.optionsStale).toBe(true);
    // An older menu without choices says nothing about them.
    useCartStore.getState().syncOptions([menuItem()], undefined);
    expect(selectLines(useCartStore.getState())[0]?.optionsStale).toBe(true);
    useCartStore.getState().syncAvailability([menuItem()], undefined);
    expect(selectLines(useCartStore.getState())[0]).toMatchObject({ optionsStale: true });
    useCartStore.getState().syncAvailability([], { size: sizeGroup });
    expect(selectLines(useCartStore.getState())[0]).toMatchObject({ maxQuantity: 0 });
  });

  it('a stale flag alone is a change to syncAvailability', () => {
    useCartStore.getState().add(menuItem({ modifierGroupIds: ['size'] }), 1, cafe);
    expect(
      notifications(() =>
        useCartStore.getState().syncAvailability([menuItem({ modifierGroupIds: ['size'] })], {
          size: { ...sizeGroup, options: [] },
        }),
      ),
    ).toBe(1);
    expect(selectLines(useCartStore.getState())[0]?.optionsStale).toBe(true);
  });

  it('syncPrices that finds the prices right, or a line whose item left the menu', () => {
    useCartStore.getState().add(menuItem({ id: 'a', price: 100 }), 1, cafe, [large]);
    useCartStore.getState().add(menuItem({ id: 'b' }), 1, cafe);
    const items = [menuItem({ id: 'a', price: 100 })];
    const groups = {
      size: { ...sizeGroup, options: [{ ...sizeGroup.options[0]!, priceDelta: 20 }] },
    };
    expect(notifications(() => useCartStore.getState().syncPrices(items, groups))).toBe(0);
    expect(notifications(() => useCartStore.getState().syncPrices(items))).toBe(0);
    expect(storageUntouched(() => useCartStore.getState().syncPrices(items, groups))).toBe(true);
    expect(selectLines(useCartStore.getState()).map((l) => l.unitPrice)).toEqual([120, 120]);
  });

  it('syncPrices updates when two options move by opposite amounts and the total stays', () => {
    const milk = { id: 'o-oat', groupName: 'Milk', name: 'Oat', priceDelta: 30 };
    useCartStore.getState().add(menuItem(), 1, cafe, [large, milk]);
    const option = (id: string, priceDelta: number) => ({
      id,
      name: id,
      priceDelta,
      isDefault: false,
      isAvailable: true,
    });
    useCartStore.getState().syncPrices([menuItem()], {
      size: { ...sizeGroup, options: [option('o-large', 25)] },
      milk: { ...sizeGroup, id: 'milk', minSelect: 0, options: [option('o-oat', 25)] },
    });
    const [line] = selectLines(useCartStore.getState());
    expect(line?.unitPrice).toBe(170);
    expect(line?.options.map((o) => o.priceDelta)).toEqual([25, 25]);
  });
});

describe('required choices an old line lacks', () => {
  const option = (
    id: string,
    over: Partial<{ priceDelta: number; isDefault: boolean; isAvailable: boolean }> = {},
  ) => ({
    id,
    name: id,
    priceDelta: 10,
    isDefault: true,
    isAvailable: true,
    ...over,
  });
  const group = (
    id: string,
    minSelect: number,
    maxSelect: number,
    options: ReturnType<typeof option>[],
  ) => ({
    id,
    name: id,
    minSelect,
    maxSelect,
    options,
  });

  function reprice(groupIds: string[], groups: Record<string, ReturnType<typeof group>>) {
    useCartStore.getState().add(menuItem(), 1, cafe);
    useCartStore.getState().syncPrices([menuItem({ modifierGroupIds: groupIds })], groups);
    return selectLines(useCartStore.getState())[0]!;
  }

  it('fills only available defaults, up to maxSelect', () => {
    const line = reprice(['g'], {
      g: group('g', 1, 2, [
        option('d1'),
        option('plain', { isDefault: false }),
        option('off', { isAvailable: false }),
        option('d2'),
        option('d3'),
      ]),
    });
    expect(line.options.map((o) => o.id)).toEqual(['d1', 'd2']);
    expect(line.unitPrice).toBe(140);
    expect(line.lineKey).toBe('item-1:d1,d2');
  });

  it('skips optional groups, unknown group ids, and fills each required group on its own', () => {
    const line = reprice(['missing', 'optional', 'a', 'b'], {
      optional: group('optional', 0, 1, [option('x')]),
      a: group('a', 1, 1, [option('a1', { priceDelta: 5 })]),
      b: group('b', 1, 1, [option('b1', { priceDelta: 7 })]),
    });
    expect(line.options.map((o) => [o.id, o.groupName])).toEqual([
      ['a1', 'a'],
      ['b1', 'b'],
    ]);
    expect(line.unitPrice).toBe(132);
  });

  it('does not fill a group the line already chose in, but fills the other', () => {
    const chosen = { id: 'big', groupName: 'size', name: 'Big', priceDelta: 40 };
    useCartStore.getState().add(menuItem(), 1, cafe, [chosen]);
    useCartStore.getState().syncPrices([menuItem({ modifierGroupIds: ['size', 'milk'] })], {
      size: group('size', 1, 1, [
        option('reg'),
        option('big', { isDefault: false, priceDelta: 40 }),
      ]),
      milk: group('milk', 1, 1, [option('oat', { priceDelta: 3 })]),
    });
    expect(selectLines(useCartStore.getState())[0]?.options.map((o) => o.id)).toEqual([
      'big',
      'oat',
    ]);
  });
});

describe('persisted carts and other tabs (more)', () => {
  const stored = (state: unknown, version: number) =>
    localStorage.setItem('fp_cart', JSON.stringify({ state, version }));
  const oldLine = {
    menuItemId: 'item-1',
    name: 'Cold Coffee',
    unitPrice: 120,
    imageUrl: null,
    quantity: 2,
  };

  it('a version 2 cart missing optional fields gets defaults, and keeps the ones it has', async () => {
    stored(
      { storeId: 's1', lines: [oldLine, { ...oldLine, menuItemId: 'item-2', maxQuantity: 5 }] },
      2,
    );
    await useCartStore.persist.rehydrate();
    expect(useCartStore.getState()).toMatchObject({
      storeId: 's1',
      storeSlug: null,
      storeName: null,
      limits: fallbacks.storeDefaults,
    });
    expect(selectLines(useCartStore.getState()).map((l) => l.maxQuantity)).toEqual([null, 5]);

    stored(
      {
        storeId: 's1',
        storeSlug: 'cafe',
        storeName: 'Cafe',
        lines: [],
        limits: { maxQuantityPerItem: 3, lowStockThreshold: 1 },
      },
      2,
    );
    await useCartStore.persist.rehydrate();
    expect(useCartStore.getState()).toMatchObject({
      storeSlug: 'cafe',
      storeName: 'Cafe',
      limits: { maxQuantityPerItem: 3, lowStockThreshold: 1 },
    });
  });

  it('a version 1 cart keeps its saved limits, and an empty save empties the cart', async () => {
    localStorage.setItem(
      `${CACHE_PREFIX}menu:north`,
      JSON.stringify({
        store: { id: 's9', slug: 'north', name: 'North' },
        categories: [{ items: [{ id: 'item-1' }] }],
      }),
    );
    stored({ lines: [oldLine], limits: { maxQuantityPerItem: 4, lowStockThreshold: 2 } }, 1);
    await useCartStore.persist.rehydrate();
    expect(useCartStore.getState()).toMatchObject({
      storeId: 's9',
      storeName: 'North',
      limits: { maxQuantityPerItem: 4, lowStockThreshold: 2 },
    });

    useCartStore.getState().add(menuItem(), 1, cafe);
    localStorage.setItem('fp_cart', JSON.stringify({ version: 1 }));
    await useCartStore.persist.rehydrate();
    expect(selectLines(useCartStore.getState())).toEqual([]);
    expect(useCartStore.getState()).toMatchObject({
      storeId: null,
      limits: fallbacks.storeDefaults,
    });
  });

  it('a version 1 cart finds its menu in a later category and among several items', async () => {
    const menu = (items: { id: string }[][]) =>
      JSON.stringify({
        store: { id: 's9', slug: 'north', name: 'North' },
        categories: items.map((i) => ({ items: i })),
      });
    localStorage.setItem(
      `${CACHE_PREFIX}menu:north`,
      menu([[{ id: 'other' }], [{ id: 'x' }, { id: 'item-1' }]]),
    );
    stored({ lines: [oldLine] }, 1);
    await useCartStore.persist.rehydrate();
    expect(useCartStore.getState().storeId).toBe('s9');
  });

  it('a version 1 cart ignores a saved copy that is not a menu, and survives blocked storage', async () => {
    localStorage.setItem(
      `${CACHE_PREFIX}store:north`,
      JSON.stringify({
        store: { id: 's9', slug: 'n', name: 'N' },
        categories: [{ items: [{ id: 'item-1' }] }],
      }),
    );
    stored({ lines: [oldLine] }, 1);
    await useCartStore.persist.rehydrate();
    expect(selectLines(useCartStore.getState())).toEqual([]);

    localStorage.setItem(
      `${CACHE_PREFIX}menu:north`,
      JSON.stringify({
        store: { id: 's9', slug: 'n', name: 'N' },
        categories: [{ items: [{ id: 'item-1' }] }],
      }),
    );
    stored({ lines: [oldLine] }, 1);
    const blocked = vi.spyOn(Storage.prototype, 'length', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    await useCartStore.persist.rehydrate();
    blocked.mockRestore();
    expect(selectLines(useCartStore.getState())).toEqual([]);
  });

  it('ignores a storage event for another key', () => {
    useCartStore.getState().add(menuItem(), 1, cafe);
    localStorage.removeItem('fp_cart');
    window.dispatchEvent(new StorageEvent('storage', { key: 'something_else', newValue: null }));
    expect(selectLines(useCartStore.getState())).toHaveLength(1);
  });

  it('selectors for the store name and limits', () => {
    useCartStore.getState().add(menuItem(), 1, cafe);
    expect(selectStoreName(useCartStore.getState())).toBe('Cafe');
    expect(selectLimits(useCartStore.getState())).toEqual({
      maxQuantityPerItem: CAP,
      lowStockThreshold: 5,
    });
  });

  it('a fresh store starts empty with the default limits', async () => {
    vi.resetModules();
    const { useCartStore: fresh } = await import('./cartStore');
    expect(fresh.getState()).toMatchObject({
      lines: [],
      storeId: null,
      limits: fallbacks.storeDefaults,
    });
  });
});
