import type { StoreSettings } from '../../types/api';

export type StoreSettingKey = keyof StoreSettings;

/**
 * The four store settings, in display order. Bounds are not copied here: the API validates them (docs/API.md) and its
 * message is shown on a save, so a bound changed there never leaves a stale copy in this file.
 */
export const STORE_SETTING_FIELDS: Record<StoreSettingKey, { label: string; hint: string }> = {
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
};

export const STORE_SETTING_KEYS = Object.keys(STORE_SETTING_FIELDS) as StoreSettingKey[];

export type StoreSettingsDraft = Record<StoreSettingKey, string>;

export const toStoreDraft = (s: StoreSettings): StoreSettingsDraft =>
  Object.fromEntries(STORE_SETTING_KEYS.map((k) => [k, String(s[k])])) as StoreSettingsDraft;

/** Only a shape check; the range is the server's to judge. */
export const validateStoreSetting = (raw: string): string | null =>
  /^\d+$/.test(raw.trim()) ? null : 'Enter a whole number.';

export function changedStoreSettings(
  saved: StoreSettings,
  draft: StoreSettingsDraft,
): Partial<StoreSettings> {
  const changes: Partial<StoreSettings> = {};
  for (const k of STORE_SETTING_KEYS)
    if (Number(draft[k]) !== saved[k]) changes[k] = Number(draft[k]);
  return changes;
}
