import type { PauseStoreInput } from '../schemas/storePause.schema';
import type { RequestContext } from '../types/auth';
import { invalidate } from '../utils/cache';
import { validationError } from '../utils/errors';
import { raisedByDatabase, supabaseAdmin } from '../utils/supabase';
import { invalidateMenus } from './menu.service';

// A unit conversion, not a tunable duration (check:durations looks for the latter).
const MINUTE_MS = 60 * 1000;

/** The store row carries the pause: every cached read of it, and the menus that show its open state. */
function invalidatePause(storeId: string): void {
  invalidate(`store:${storeId}`);
  invalidate('store');
  invalidate('stores:list');
  invalidateMenus(storeId);
}

/** Pauses new orders for `minutes`, until `until`, or until resumed. A repeat of the same pause changes nothing. */
export async function pauseStore(
  storeId: string,
  input: PauseStoreInput,
  ctx: RequestContext,
  now = new Date(),
): Promise<void> {
  const until =
    input.minutes !== undefined
      ? new Date(now.getTime() + input.minutes * MINUTE_MS)
      : input.until !== undefined
        ? new Date(input.until)
        : null;
  if (until && until <= now) throw validationError('The pause must end in the future.', 'until');
  try {
    await supabaseAdmin
      .rpc('pause_store', {
        p_store_id: storeId,
        p_until: until?.toISOString(),
        p_reason: input.reason,
        p_actor: ctx.actor,
        p_request_id: ctx.requestId,
        p_now: now.toISOString(),
      })
      .throwOnError();
  } catch (err) {
    if (raisedByDatabase(err, 'VALIDATION_ERROR'))
      throw validationError('The pause must end in the future.', 'until');
    throw err;
  }
  invalidatePause(storeId);
}

/** Lifts a pause; a store that is not paused is left as it is. */
export async function resumeStore(storeId: string, ctx: RequestContext): Promise<void> {
  await supabaseAdmin
    .rpc('resume_store', { p_store_id: storeId, p_actor: ctx.actor, p_request_id: ctx.requestId })
    .throwOnError();
  invalidatePause(storeId);
}
