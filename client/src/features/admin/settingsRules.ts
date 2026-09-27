import type { SiteSettings } from '../../types/api';

type LimitKey = 'customerOrderHistoryLimit' | 'staffOrderListLimit';

/** The same bounds as the API (server/src/schemas/admin.schema.ts) and the site_settings check constraints. */
export const SETTING_LIMITS: Record<LimitKey, { label: string; hint: string; max: number }> = {
  customerOrderHistoryLimit: {
    label: 'Customer order history',
    hint: 'How many of their newest orders a customer sees',
    max: 200,
  },
  staffOrderListLimit: {
    label: 'Staff board size',
    hint: 'Newest orders shown on the kitchen board',
    max: 500,
  },
};

export const SETTING_KEYS = Object.keys(SETTING_LIMITS) as LimitKey[];

/** An error message for a typed value, or null when it is a whole number within the bounds. */
export function validateLimit(key: LimitKey, raw: string): string | null {
  const { max } = SETTING_LIMITS[key];
  if (!/^\d+$/.test(raw.trim())) return 'Enter a whole number.';
  const value = Number(raw);
  if (value < 1 || value > max) return `Must be between 1 and ${max}.`;
  return null;
}

/** Only the fields whose typed value differs from what is saved. */
export function changedSettings(
  saved: SiteSettings,
  draft: Record<LimitKey, string>,
): Partial<Record<LimitKey, number>> {
  const changes: Partial<Record<LimitKey, number>> = {};
  for (const key of SETTING_KEYS) {
    const value = Number(draft[key]);
    if (value !== saved[key]) changes[key] = value;
  }
  return changes;
}
