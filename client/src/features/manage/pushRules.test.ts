import { describe, expect, it } from 'vitest';
import type { ManagedMenuItem } from '../../types/api';
import { pushPreview } from './pushRules';

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
});
