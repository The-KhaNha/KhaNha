import { describe, expect, it } from 'vitest';
import type { StoreSettings } from '../../types/api';
import {
  STORE_SETTING_FIELDS,
  STORE_SETTING_KEYS,
  changedStoreSettings,
  toStoreDraft,
  validateStoreSetting,
} from './storeSettingsRules';

const saved: StoreSettings = {
  maxQuantityPerItem: 10,
  lowStockThreshold: 5,
  staffOrderListLimit: 50,
  lastOrderMinutesBeforeClose: 0,
  staffCanEditStock: false,
};

describe('STORE_SETTING_FIELDS', () => {
  it('words the four settings, in display order', () => {
    expect(STORE_SETTING_KEYS).toEqual([
      'maxQuantityPerItem',
      'lowStockThreshold',
      'staffOrderListLimit',
      'lastOrderMinutesBeforeClose',
    ]);
    expect(STORE_SETTING_FIELDS).toEqual({
      maxQuantityPerItem: {
        label: 'Most of one item per order',
        hint: 'A customer cannot add more than this',
      },
      lowStockThreshold: {
        label: 'Low-stock warning at',
        hint: 'Customers see "Only a few left" at or below this',
      },
      staffOrderListLimit: {
        label: 'Orders on the staff board',
        hint: 'How many of the newest orders the board lists',
      },
      lastOrderMinutesBeforeClose: {
        label: 'Stop orders before closing (minutes)',
        hint: '0 takes orders until the store closes',
      },
    });
  });
});

describe('validateStoreSetting', () => {
  it.each(['0', '12', ' 12 ', '007'])('accepts %j', (raw) => {
    expect(validateStoreSetting(raw)).toBeNull();
  });

  it.each(['', ' ', 'a12', '12a', '1 2', '-3', '2.5'])('refuses %j', (raw) => {
    expect(validateStoreSetting(raw)).toBe('Enter a whole number.');
  });
});

describe('toStoreDraft / changedStoreSettings', () => {
  it('shows each number as text', () => {
    expect(toStoreDraft(saved)).toEqual({
      maxQuantityPerItem: '10',
      lowStockThreshold: '5',
      staffOrderListLimit: '50',
      lastOrderMinutesBeforeClose: '0',
    });
  });

  it('sends only what changed, as numbers', () => {
    expect(changedStoreSettings(saved, { ...toStoreDraft(saved), lowStockThreshold: '3' })).toEqual(
      { lowStockThreshold: 3 },
    );
    expect(changedStoreSettings(saved, toStoreDraft(saved))).toEqual({});
  });
});
