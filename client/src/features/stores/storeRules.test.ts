import { describe, expect, it } from 'vitest';
import type { StoreSummary } from '../../types/api';
import { cartHoldsOtherStore, groupByArea } from './storeRules';

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

describe('cartHoldsOtherStore', () => {
  const lines = [{ menuItemId: 'x' }];
  it('is false for an empty cart, whatever store it last named', () => {
    expect(cartHoldsOtherStore({ lines: [], storeId: 'a' }, 'b')).toBe(false);
  });
  it("is false for this store's cart and true for another's", () => {
    expect(cartHoldsOtherStore({ lines, storeId: 'a' }, 'a')).toBe(false);
    expect(cartHoldsOtherStore({ lines, storeId: 'a' }, 'b')).toBe(true);
  });
});
