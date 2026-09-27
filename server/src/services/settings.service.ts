import type { AuthUser } from '../types/auth';
import type { Tables } from '../types/database';
import { cached, invalidate, PUBLIC_READ_TTL_MS } from '../utils/cache';
import { supabaseAdmin } from '../utils/supabase';
import type { UpdateSettingsInput } from '../schemas/admin.schema';

type SiteSettings = Tables<'site_settings'>;

/**
 * The single site_settings row. Read on every order list, so it goes through the read cache; the admin's update
 * drops the cache, so a change applies on the next request (other API instances within PUBLIC_READ_TTL_MS).
 */
export function getSettings(): Promise<SiteSettings> {
  return cached('site_settings', PUBLIC_READ_TTL_MS, async () => {
    const { data } = await supabaseAdmin.from('site_settings').select().single().throwOnError();
    return data;
  });
}

export async function updateSettings(
  admin: AuthUser,
  input: UpdateSettingsInput,
): Promise<SiteSettings> {
  const { data } = await supabaseAdmin
    .from('site_settings')
    .update({
      customer_order_history_limit: input.customerOrderHistoryLimit,
      staff_order_list_limit: input.staffOrderListLimit,
      updated_by: admin.id,
    })
    .eq('id', true)
    .select()
    .single()
    .throwOnError();
  invalidate('site_settings');
  return data;
}
