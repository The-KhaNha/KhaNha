import { describe, expect, it } from 'vitest';
import type { ModifierGroup } from '../../types/api';
import {
  choiceHint,
  chosenOptions,
  defaultSelection,
  deltaLabel,
  isCustomisable,
  itemGroups,
  missingGroups,
  optionsLabel,
  toggleOption,
} from './modifierRules';

const opt = (id: string, priceDelta = 0, isDefault = false, isAvailable = true) => ({
  id,
  name: id,
  priceDelta,
  isDefault,
  isAvailable,
});
const size: ModifierGroup = {
  id: 'size',
  name: 'Size',
  minSelect: 1,
  maxSelect: 1,
  options: [opt('small', 0, true), opt('large', 20)],
};
const addOns: ModifierGroup = {
  id: 'add',
  name: 'Add-ons',
  minSelect: 0,
  maxSelect: 2,
  options: [opt('honey', 10, true), opt('ginger', 5, true, false), opt('cream', 15), opt('mint', 5)],
};

describe('modifierRules', () => {
  it("finds an item's groups in its order, skipping one an older menu lacks", () => {
    const item = { modifierGroupIds: ['add', 'gone', 'size'] };
    expect(itemGroups(item, { size, add: addOns }).map((g) => g.id)).toEqual(['add', 'size']);
    expect(isCustomisable(item)).toBe(true);
    expect(isCustomisable({})).toBe(false);
  });

  it('starts each group at its available defaults', () => {
    expect(defaultSelection([size, addOns])).toEqual({ size: ['small'], add: ['honey'] });
  });

  it('switches a one-choice group, and caps a many-choice one at its maximum', () => {
    let s = defaultSelection([size, addOns]);
    s = toggleOption(size, s, 'large');
    expect(s.size).toEqual(['large']);
    s = toggleOption(addOns, s, 'cream');
    s = toggleOption(addOns, s, 'mint'); // a third: refused
    expect(s.add).toEqual(['honey', 'cream']);
    s = toggleOption(addOns, s, 'honey');
    expect(s.add).toEqual(['cream']);
  });

  it('names the groups still short of their minimum', () => {
    expect(missingGroups([size, addOns], { add: [] }).map((g) => g.id)).toEqual(['size']);
    expect(missingGroups([size], { size: ['large'] })).toEqual([]);
  });

  it("keeps the chosen options in the groups' and options' order, with their group's name", () => {
    expect(chosenOptions([size, addOns], { add: ['cream', 'honey'], size: ['large'] })).toEqual([
      { id: 'large', groupName: 'Size', name: 'large', priceDelta: 20 },
      { id: 'honey', groupName: 'Add-ons', name: 'honey', priceDelta: 10 },
      { id: 'cream', groupName: 'Add-ons', name: 'cream', priceDelta: 15 },
    ]);
  });

  it.each([
    [1, 1, 'Choose 1'],
    [0, 1, 'Optional'],
    [0, 3, 'Optional, up to 3'],
    [1, 3, 'Choose up to 3'],
    [2, 3, 'Choose 2 to 3'],
  ])('min %i, max %i reads "%s"', (minSelect, maxSelect, hint) => {
    expect(choiceHint({ minSelect, maxSelect })).toBe(hint);
  });

  it('labels deltas and a line’s options', () => {
    expect([deltaLabel(20), deltaLabel(-20), deltaLabel(0)]).toEqual(['+₹20', '−₹20', '']);
    expect(optionsLabel([{ name: 'Large' }, { name: 'Oat milk' }])).toBe('Large, Oat milk');
  });
});
