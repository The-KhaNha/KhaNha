import type { Tables } from '../types/database';
import { cached, PUBLIC_READ_TTL_MS } from '../utils/cache';
import { notFound } from '../utils/errors';
import { supabaseAdmin } from '../utils/supabase';

/** V0 has exactly one store, created by `pnpm run seed`. */
export async function getStore(): Promise<Tables<'stores'>> {
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select()
    .limit(1)
    .maybeSingle()
    .throwOnError();
  if (!store) throw notFound('The store has not been set up yet. Run `pnpm run seed` in server/.');
  return store;
}

/**
 * The store for GET /api/store, cached for PUBLIC_READ_TTL_MS. Anything that acts on the store (createOrder's
 * is_open check) calls getStore() instead, so it never trusts a stale copy.
 */
export function getCachedStore(): Promise<Tables<'stores'>> {
  return cached('store', PUBLIC_READ_TTL_MS, getStore);
}
