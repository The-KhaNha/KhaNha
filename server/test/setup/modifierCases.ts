// The shared modifier case table (P3.2): the pricing rules' expected outcomes, run through domain/pricing.ts by
// test/unit/pricing.safe.test.ts and through place_order by the order tests (PR 13b), so the two cannot drift.
import type { PricingGroup } from '../../src/domain/pricing';

export const SIZE: PricingGroup = {
  id: 'g-size',
  name: 'Size',
  minSelect: 1,
  maxSelect: 1,
  options: [
    { id: 'o-small', name: 'Small', priceDeltaPaise: -2000, isDefault: false, isAvailable: true },
    { id: 'o-regular', name: 'Regular', priceDeltaPaise: 0, isDefault: true, isAvailable: true },
    { id: 'o-large', name: 'Large', priceDeltaPaise: 3000, isDefault: false, isAvailable: true },
  ],
};
export const MILK: PricingGroup = {
  id: 'g-milk',
  name: 'Milk',
  minSelect: 0,
  maxSelect: 1,
  options: [
    { id: 'o-oat', name: 'Oat', priceDeltaPaise: 2000, isDefault: false, isAvailable: true },
    { id: 'o-soy', name: 'Soy', priceDeltaPaise: 1500, isDefault: false, isAvailable: false },
  ],
};
export const ADDONS: PricingGroup = {
  id: 'g-addons',
  name: 'Add-ons',
  minSelect: 0,
  maxSelect: 2,
  options: [
    {
      id: 'o-shot',
      name: 'Extra shot',
      priceDeltaPaise: 4000,
      isDefault: false,
      isAvailable: true,
    },
    { id: 'o-cream', name: 'Cream', priceDeltaPaise: 2000, isDefault: false, isAvailable: true },
    { id: 'o-syrup', name: 'Syrup', priceDeltaPaise: 1000, isDefault: false, isAvailable: true },
  ],
};
/** Required, with no default: an order must choose. */
export const TEMP: PricingGroup = {
  id: 'g-temp',
  name: 'Temperature',
  minSelect: 1,
  maxSelect: 1,
  options: [
    { id: 'o-hot', name: 'Hot', priceDeltaPaise: 0, isDefault: false, isAvailable: true },
    { id: 'o-iced', name: 'Iced', priceDeltaPaise: 1000, isDefault: false, isAvailable: true },
  ],
};

export interface ModifierCase {
  name: string;
  basePricePaise: number;
  groups: PricingGroup[];
  chosen: string[];
  enabled: boolean;
  /** The unit price and the chosen option names, in group order; or the refusal. */
  expect:
    | { unitPricePaise: number; options: string[] }
    | { code: 'MODIFIER_REQUIRED' | 'MODIFIER_INVALID'; groupName?: string };
}

export const MODIFIER_CASES: ModifierCase[] = [
  {
    name: 'flag off: the item alone, required groups not enforced',
    basePricePaise: 12000,
    groups: [SIZE, TEMP],
    chosen: [],
    enabled: false,
    expect: { unitPricePaise: 12000, options: [] },
  },
  {
    name: 'flag off: options sent are refused',
    basePricePaise: 12000,
    groups: [SIZE],
    chosen: ['o-large'],
    enabled: false,
    expect: { code: 'MODIFIER_INVALID' },
  },
  {
    name: 'nothing chosen: the required group takes its default',
    basePricePaise: 12000,
    groups: [SIZE, MILK],
    chosen: [],
    enabled: true,
    expect: { unitPricePaise: 12000, options: ['Regular'] },
  },
  {
    name: 'the price is the item plus every chosen delta',
    basePricePaise: 12000,
    groups: [SIZE, MILK, ADDONS],
    chosen: ['o-large', 'o-oat', 'o-shot', 'o-cream'],
    enabled: true,
    expect: { unitPricePaise: 23000, options: ['Large', 'Oat', 'Extra shot', 'Cream'] },
  },
  {
    name: 'a negative delta lowers the price',
    basePricePaise: 12000,
    groups: [SIZE],
    chosen: ['o-small'],
    enabled: true,
    expect: { unitPricePaise: 10000, options: ['Small'] },
  },
  {
    name: 'never below zero',
    basePricePaise: 1000,
    groups: [SIZE],
    chosen: ['o-small'],
    enabled: true,
    expect: { code: 'MODIFIER_INVALID' },
  },
  {
    name: 'a required group with no default must be chosen',
    basePricePaise: 12000,
    groups: [TEMP],
    chosen: [],
    enabled: true,
    expect: { code: 'MODIFIER_REQUIRED', groupName: 'Temperature' },
  },
  {
    name: 'more than a group allows',
    basePricePaise: 12000,
    groups: [ADDONS],
    chosen: ['o-shot', 'o-cream', 'o-syrup'],
    enabled: true,
    expect: { code: 'MODIFIER_INVALID', groupName: 'Add-ons' },
  },
  {
    name: 'two sizes at once',
    basePricePaise: 12000,
    groups: [SIZE],
    chosen: ['o-small', 'o-large'],
    enabled: true,
    expect: { code: 'MODIFIER_INVALID', groupName: 'Size' },
  },
  {
    name: 'an unavailable option',
    basePricePaise: 12000,
    groups: [SIZE, MILK],
    chosen: ['o-soy'],
    enabled: true,
    expect: { code: 'MODIFIER_INVALID', groupName: 'Milk' },
  },
  {
    name: "an option of another item's group",
    basePricePaise: 12000,
    groups: [SIZE],
    chosen: ['o-oat'],
    enabled: true,
    expect: { code: 'MODIFIER_INVALID' },
  },
  {
    name: 'the same option twice',
    basePricePaise: 12000,
    groups: [ADDONS],
    chosen: ['o-shot', 'o-shot'],
    enabled: true,
    expect: { code: 'MODIFIER_INVALID' },
  },
];
