import type { SiteSettings } from '../../types/api';
import { VALIDATION } from '../config/fallbacks';

/** Every editable site setting: the keys of SiteSettings except the timestamp. */
export type SettingKey = Exclude<keyof SiteSettings, 'updatedAt'>;

interface IntegerSetting {
  kind: 'integer';
  label: string;
  hint: string;
  min: number;
  max: number;
}

interface SemverSetting {
  kind: 'semver';
  label: string;
  hint: string;
}

export type SettingField = IntegerSetting | SemverSetting;

/**
 * The admin form's registry, in display order. Bounds are the API's (server/src/schemas/admin.schema.ts) and the
 * site_settings check constraints; docs/CONFIGURATION.md lists who reads each one.
 */
export const SETTING_FIELDS: Record<SettingKey, SettingField> = {
  customerOrderHistoryLimit: {
    kind: 'integer',
    label: 'Customer order history',
    hint: 'How many of their newest orders a customer sees',
    min: 1,
    max: 200,
  },
  staffOrderListLimit: {
    kind: 'integer',
    label: 'Staff board size',
    hint: 'Newest orders shown on the kitchen board',
    min: 1,
    max: 500,
  },
  maxLinesPerOrder: {
    kind: 'integer',
    label: 'Items per order',
    hint: 'Most different items one order may have',
    min: 1,
    max: 100,
  },
  orderPollMs: {
    kind: 'integer',
    label: 'Order page refresh (ms)',
    hint: 'How often a customer’s open order checks for a new status',
    ...VALIDATION.pollMs,
  },
  ordersPollMs: {
    kind: 'integer',
    label: 'Order list refresh (ms)',
    hint: 'How often the customer’s order list refreshes',
    ...VALIDATION.pollMs,
  },
  staffBoardPollMs: {
    kind: 'integer',
    label: 'Staff board refresh (ms)',
    hint: 'How often the kitchen board checks for new orders',
    ...VALIDATION.pollMs,
  },
  minClientVersion: {
    kind: 'semver',
    label: 'Minimum app version',
    hint: 'Older app versions are asked to refresh (0.0.0 asks nobody)',
  },
};

export const SETTING_KEYS = Object.keys(SETTING_FIELDS) as SettingKey[];

export type SettingsDraft = Record<SettingKey, string>;

export function toDraft(settings: SiteSettings): SettingsDraft {
  return Object.fromEntries(
    SETTING_KEYS.map((key) => [key, String(settings[key])]),
  ) as SettingsDraft;
}

/** The field's hint with its accepted range, for the input's helper text. */
export function settingHint(key: SettingKey): string {
  const field = SETTING_FIELDS[key];
  return field.kind === 'integer' ? `${field.hint} (${field.min}–${field.max})` : `${field.hint}`;
}

/** An error message for a typed value, or null when it is valid. */
export function validateSetting(key: SettingKey, raw: string): string | null {
  const field = SETTING_FIELDS[key];
  const value = raw.trim();
  if (field.kind === 'semver') {
    return /^\d+\.\d+\.\d+$/.test(value) ? null : 'Enter a version like 1.2.3.';
  }
  if (!/^\d+$/.test(value)) return 'Enter a whole number.';
  const n = Number(value);
  if (n < field.min || n > field.max) return `Must be between ${field.min} and ${field.max}.`;
  return null;
}

/** Only the fields whose typed value differs from what is saved, typed for the API. */
export function changedSettings(
  saved: SiteSettings,
  draft: SettingsDraft,
): Partial<Pick<SiteSettings, SettingKey>> {
  const changes: Partial<Record<SettingKey, number | string>> = {};
  for (const key of SETTING_KEYS) {
    const value = SETTING_FIELDS[key].kind === 'integer' ? Number(draft[key]) : draft[key].trim();
    if (value !== saved[key]) changes[key] = value;
  }
  return changes as Partial<Pick<SiteSettings, SettingKey>>;
}
