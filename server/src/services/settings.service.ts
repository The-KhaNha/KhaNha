import type { RequestContext } from '../types/auth';
import type { Tables, TablesUpdate } from '../types/database';
import { cached, invalidate, PUBLIC_READ_TTL_MS } from '../utils/cache';
import { supabaseAdmin } from '../utils/supabase';
import type { UpdateSettingsInput } from '../schemas/admin.schema';

type SiteSettings = Tables<'site_settings'>;
type SettingsUpdate = TablesUpdate<'site_settings'>;

// API field → column. Only the fields the admin sent go into the update.
const COLUMN: { [K in keyof UpdateSettingsInput]-?: keyof SettingsUpdate } = {
  customerOrderHistoryLimit: 'customer_order_history_limit',
  staffOrderListLimit: 'staff_order_list_limit',
  maxLinesPerOrder: 'max_lines_per_order',
  orderPollMs: 'order_poll_ms',
  ordersPollMs: 'orders_poll_ms',
  staffBoardPollMs: 'staff_board_poll_ms',
  clientErrorSamplePercent: 'client_error_sample_percent',
  minClientVersion: 'min_client_version',
};

function toColumns(input: UpdateSettingsInput): SettingsUpdate {
  const update: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(COLUMN)) {
    const value = input[field as keyof UpdateSettingsInput];
    if (value !== undefined) update[column] = value;
  }
  return update as SettingsUpdate;
}

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
  input: UpdateSettingsInput,
  ctx: RequestContext,
): Promise<SiteSettings> {
  const { data } = await supabaseAdmin
    .from('site_settings')
    .update({ ...toColumns(input), updated_by: ctx.actor.id })
    .eq('id', true)
    .select()
    .single()
    // The audit trigger reads who and which request from these (the migration's audit_row_change explains why).
    .setHeader('x-actor', JSON.stringify(ctx.actor))
    .setHeader('x-request-id', ctx.requestId)
    .throwOnError();
  invalidate('site_settings');
  return data;
}
