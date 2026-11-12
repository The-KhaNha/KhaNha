import type { SetStoreHoursInput, CreateExceptionInput } from '../schemas/storeHours.schema';
import { HOURS_LIMITS } from '../schemas/limits';
import type { RequestContext } from '../types/auth';
import type { ScheduleExceptionDto } from '../types/api';
import { invalidate } from '../utils/cache';
import { notFound, validationError } from '../utils/errors';
import { isUuid } from '../utils/ids';
import { raisedByDatabase, supabaseAdmin } from '../utils/supabase';
import { invalidateMenus } from './menu.service';

/** Every cached read an opening-hours write can change: the schedule, the store row and its lists, the menus. */
function invalidateHours(storeId: string): void {
  invalidate(`store_hours:${storeId}`);
  invalidate('stores:list');
  invalidate(`store:${storeId}`);
  invalidate('store');
  invalidateMenus(storeId);
}

/** Replaces the week (set_store_hours). Overlapping intervals are a 400 and change nothing; a repeat is a no-op. */
export async function setStoreHours(
  storeId: string,
  input: SetStoreHoursInput,
  ctx: RequestContext,
): Promise<void> {
  try {
    await supabaseAdmin
      .rpc('set_store_hours', {
        p_store_id: storeId,
        p_hours: input.hours,
        p_actor: ctx.actor,
        p_request_id: ctx.requestId,
      })
      .throwOnError();
  } catch (err) {
    if (raisedByDatabase(err, 'VALIDATION_ERROR'))
      throw validationError('Opening times on a day cannot overlap.', 'hours');
    throw err;
  }
  invalidateHours(storeId);
}

const hhmm = (time: string | null): string | null => time?.slice(0, 5) ?? null;

/** Adds an exception. `today` is the store's local date: only exceptions still ahead count towards the bound. */
export async function createException(
  storeId: string,
  today: string,
  input: CreateExceptionInput,
  ctx: RequestContext,
): Promise<ScheduleExceptionDto> {
  // ponytail: count then insert, so two adds at once can pass the cap by one; a lock in SQL if it ever matters.
  const { count } = await supabaseAdmin
    .from('store_schedule_exceptions')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .gte('ends_on', today)
    .throwOnError();
  if ((count ?? 0) >= HOURS_LIMITS.upcomingExceptions)
    throw validationError(
      `A store can have at most ${HOURS_LIMITS.upcomingExceptions} upcoming exceptions.`,
    );
  const { data } = await supabaseAdmin
    .from('store_schedule_exceptions')
    .insert({
      store_id: storeId,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      kind: input.kind,
      opens_at: input.opensAt ?? null,
      closes_at: input.closesAt ?? null,
      label: input.label,
    })
    .select('id, starts_on, ends_on, kind, opens_at, closes_at, label')
    .single()
    // The audit trigger reads who and which request from these (audit_row_change).
    .setHeader('x-actor', JSON.stringify(ctx.actor))
    .setHeader('x-request-id', ctx.requestId)
    .throwOnError();
  invalidateHours(storeId);
  return {
    id: data.id,
    startsOn: data.starts_on,
    endsOn: data.ends_on,
    kind: data.kind,
    opensAt: hhmm(data.opens_at),
    closesAt: hhmm(data.closes_at),
    label: data.label,
  };
}

/** Deletes one of this store's exceptions; another store's, or an unknown id, is 404. */
export async function deleteException(
  storeId: string,
  exceptionId: string,
  ctx: RequestContext,
): Promise<void> {
  if (!isUuid(exceptionId)) throw notFound('Exception not found.');
  const { data } = await supabaseAdmin
    .from('store_schedule_exceptions')
    .delete()
    .eq('id', exceptionId)
    .eq('store_id', storeId)
    .select('id')
    .maybeSingle()
    .setHeader('x-actor', JSON.stringify(ctx.actor))
    .setHeader('x-request-id', ctx.requestId)
    .throwOnError();
  if (!data) throw notFound('Exception not found.');
  invalidateHours(storeId);
}
