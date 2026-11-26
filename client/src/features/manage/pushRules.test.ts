import { describe, expect, it } from 'vitest';
import type { ManagedMenuItem } from '../../types/api';
import { PUSH_FIELDS, pushPreview } from './pushRules';

const item = (over: Partial<ManagedMenuItem> = {}) =>
  ({
    id: 't1',
    name: 'Masala Chai',
    description: 'Spiced',
    category: 'Hot',
    price: 140,
    diet: 'VEG',
    imageUrl: '/images/chai.jpg',
    ...over,
  }) as ManagedMenuItem;

describe('pushPreview', () => {
  it('says each chosen field that differs, from the copy to the template', () => {
    const copy = item({ name: 'Cutting Chai', price: 120, imageUrl: null });
    expect(pushPreview(item(), 'North Gate', copy, ['price', 'name', 'photo', 'category'])).toEqual(
      [
        'Price at North Gate: ₹120 → ₹140',
        'Name at North Gate: Cutting Chai → Masala Chai',
        'Photo at North Gate: replaced',
      ],
    );
  });

  it('leaves out fields not chosen and fields that already match', () => {
    expect(pushPreview(item(), 'North', item({ name: 'Other' }), ['price'])).toEqual([]);
  });

  it('a branch without a copy gets a new one, and is warned when its own item has the same name', () => {
    expect(pushPreview(item(), 'South', undefined, ['price'])).toEqual(['South gets a new copy']);
    expect(pushPreview(item(), 'Old Cafe', undefined, ['price'], true)).toEqual([
      'Old Cafe gets a new copy beside its own “Masala Chai”',
    ]);
  });

  it('compares the values, not their labels: an empty description against "(blank)" is a change', () => {
    expect(
      pushPreview(item({ description: '(blank)' }), 'North', item({ description: '' }), [
        'description',
      ]),
    ).toEqual(['Description at North: (blank) → (blank)']);
  });

  it('lists the fields a manager can push, in order', () => {
    expect(PUSH_FIELDS).toEqual([
      { key: 'price', label: 'Price' },
      { key: 'name', label: 'Name' },
      { key: 'description', label: 'Description' },
      { key: 'category', label: 'Category' },
      { key: 'diet', label: 'Veg / non-veg' },
      { key: 'photo', label: 'Photo' },
    ]);
  });

  it('says nothing about a photo that already matches, even when it is chosen', () => {
    expect(pushPreview(item(), 'North', item(), ['photo'])).toEqual([]);
  });

  it('names a category change', () => {
    expect(pushPreview(item(), 'North', item({ category: 'Cold' }), ['category'])).toEqual([
      'Category at North: Cold → Hot',
    ]);
  });

  it.each([
    ['VEG', 'NON_VEG', 'Veg / non-veg at North: Non-veg → Veg'],
    ['VEG', 'EGG', 'Veg / non-veg at North: Egg → Veg'],
    ['NON_VEG', 'VEG', 'Veg / non-veg at North: Veg → Non-veg'],
    ['VEG', null, 'Veg / non-veg at North: not marked → Veg'],
    [null, 'VEG', 'Veg / non-veg at North: Veg → not marked'],
  ] as const)('diet: template %s over copy %s', (template, copyDiet, line) => {
    expect(
      pushPreview(item({ diet: template }), 'North', item({ diet: copyDiet }), ['diet']),
    ).toEqual([line]);
  });
});
