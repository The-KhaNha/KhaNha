import { cached, PUBLIC_READ_TTL_MS } from '../utils/cache';
import { notFound } from '../utils/errors';
import type { StoreWithBrand } from '../utils/serializers';
import { supabaseAdmin } from '../utils/supabase';

/** Until the store-scoped routes land, "the store" is the oldest one: deterministic, and today's only store. */
export async function getStore(): Promise<StoreWithBrand> {
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('*, brand:brands!inner(id, name, slug)')
    .order('created_at')
    .order('id')
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
export function getCachedStore(): Promise<StoreWithBrand> {
  return cached('store', PUBLIC_READ_TTL_MS, getStore);
}
