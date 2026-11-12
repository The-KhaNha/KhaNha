import type { RequestContext } from '../types/auth';
import { cached, invalidate, PUBLIC_READ_TTL_MS } from '../utils/cache';
import { notFound } from '../utils/errors';
import type { StoreSettings } from '../utils/serializers';
import { supabaseAdmin } from '../utils/supabase';
import type { UpdateStoreSettingsInput } from '../schemas/storeSettings.schema';
import { invalidateMenus } from './menu.service';

const SETTINGS_SELECT =
  'max_quantity_per_item, low_stock_threshold, staff_order_list_limit, last_order_minutes_before_close';

/**
 * One store's settings (columns of its `stores` row), cached under `store_settings:<id>`. Read for the staff list and
 * the settings endpoint; the menu and the order path read the store row they already hold. updateStoreSettings
 * drops this key and the row's.
 */
export function getStoreSettings(storeId: string): Promise<StoreSettings> {
  return cached(`store_settings:${storeId}`, PUBLIC_READ_TTL_MS, async () => {
    const { data } = await supabaseAdmin
      .from('stores')
      .select(SETTINGS_SELECT)
      .eq('id', storeId)
      .maybeSingle()
      .throwOnError();
    if (!data) throw notFound('Store not found.');
    return data;
  });
}

const COLUMN: { [K in keyof UpdateStoreSettingsInput]-?: keyof StoreSettings } = {
  maxQuantityPerItem: 'max_quantity_per_item',
  lowStockThreshold: 'low_stock_threshold',
  staffOrderListLimit: 'staff_order_list_limit',
  lastOrderMinutesBeforeClose: 'last_order_minutes_before_close',
};

export async function updateStoreSettings(
  storeId: string,
  input: UpdateStoreSettingsInput,
  ctx: RequestContext,
): Promise<StoreSettings> {
  const update: Partial<StoreSettings> = {};
  for (const [field, column] of Object.entries(COLUMN)) {
    const value = input[field as keyof UpdateStoreSettingsInput];
    if (value !== undefined) update[column as keyof StoreSettings] = value;
  }
  const { data } = await supabaseAdmin
    .from('stores')
    .update(update)
    .eq('id', storeId)
    .select(SETTINGS_SELECT)
    .single()
    // The audit trigger reads who and which request from these (audit_row_change).
    .setHeader('x-actor', JSON.stringify(ctx.actor))
    .setHeader('x-request-id', ctx.requestId)
    .throwOnError();
  invalidate(`store_settings:${storeId}`);
  // The store row (`store:<id>`, `store`) carries the settings too, and the menu reads its rules off it.
  invalidate(`store:${storeId}`);
  invalidateMenus(storeId);
  return data;
}
