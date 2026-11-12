import { describe, expect, it } from 'vitest';
import type { StoreSummary } from '../../types/api';
import { groupByArea, menuMatchesCart } from './storeRules';

const s = (id: string, area: string | null) => ({ id, area }) as StoreSummary;

describe('groupByArea', () => {
  it('keeps the server order per area and puts stores without one last', () => {
    const groups = groupByArea([s('a', null), s('b', 'North'), s('c', 'South'), s('d', 'North')]);
    expect(groups.map((g) => [g.area, g.stores.map((x) => x.id)])).toEqual([
      ['North', ['b', 'd']],
      ['South', ['c']],
      [null, ['a']],
    ]);
  });

  it('returns nothing for no stores', () => {
    expect(groupByArea([])).toEqual([]);
  });
});

describe('menuMatchesCart', () => {
  const items = [{ id: 'x' }, { id: 'y' }];
  it("applies to an empty cart or one holding this menu's items", () => {
    expect(menuMatchesCart([], items)).toBe(true);
    expect(menuMatchesCart([{ menuItemId: 'y' }], items)).toBe(true);
  });
  it("never to another store's cart", () => {
    expect(menuMatchesCart([{ menuItemId: 'other' }], items)).toBe(false);
  });
});
