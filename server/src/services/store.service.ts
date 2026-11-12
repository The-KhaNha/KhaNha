import { STORE_LIST_MAX } from '../schemas/limits';
import type { StoreSummaryDto } from '../types/api';
import { cached, PUBLIC_READ_TTL_MS } from '../utils/cache';
import { notFound } from '../utils/errors';
import { isUuid } from '../utils/ids';
import { logger } from '../utils/logger';
import { STORE_SLUG_PATTERN } from '../schemas/store.schema';
import { computeOpenState, getSchedules, toOpenFields } from './schedule.service';
import { toStoreSummaryDto, type StoreWithBrand } from '../utils/serializers';
import { supabaseAdmin } from '../utils/supabase';

// Named: brands.template_store_id is a second foreign key between the two tables (P3 PR 01).
const STORE_SELECT = '*, brand:brands!stores_brand_id_fkey!inner(id, name, slug)';

/** The store `id` names, uncached, whatever its status (an unknown id is 404). */
export async function getStore(id: string): Promise<StoreWithBrand> {
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select(STORE_SELECT)
    .eq('id', id)
    .maybeSingle()
    .throwOnError();
  if (store) return store;
  throw notFound('Store not found.');
}

/** The id a public `:storeRef` names: a uuid is the id itself, anything else is a slug. Cached; an unknown slug is 404. */
export async function resolveStoreRef(ref: string): Promise<string> {
  // One cache entry per store whatever the casing; a uuid-shaped slug is never minted (the seed and P7.4 make slugs).
  if (isUuid(ref)) return ref.toLowerCase();
  if (!STORE_SLUG_PATTERN.test(ref)) throw notFound('Store not found.');
  return cached(`store_ref:${ref}`, PUBLIC_READ_TTL_MS, async () => {
    const { data } = await supabaseAdmin
      .from('stores')
      .select('id')
      .eq('slug', ref)
      .maybeSingle()
      .throwOnError();
    if (!data) throw notFound('Store not found.');
    return data.id;
  });
}

/**
 * One store whatever its status, cached under `store:<id>`; an unknown id is 404. `requireStore` decides who may see
 * a store that is not ACTIVE, so the cache holds every status and each reader filters.
 */
export function getStoreById(id: string): Promise<StoreWithBrand> {
  return cached(`store:${id}`, PUBLIC_READ_TTL_MS, async () => {
    const { data } = await supabaseAdmin
      .from('stores')
      .select(STORE_SELECT)
      .eq('id', id)
      .maybeSingle()
      .throwOnError();
    if (!data) throw notFound('Store not found.');
    return data;
  });
}

/** One ACTIVE store for the public routes; any other status is 404 like an unknown id. */
export async function getActiveStore(id: string): Promise<StoreWithBrand> {
  const store = await getStoreById(id);
  if (store.status !== 'ACTIVE') throw notFound('Store not found.');
  return store;
}

/** Every ACTIVE store under one key (`stores:list`); `area` narrows it in memory so there is one entry to invalidate. */
export async function listStores(area?: string): Promise<StoreSummaryDto[]> {
  const all = await cached('stores:list', PUBLIC_READ_TTL_MS, async () => {
    const { data } = await supabaseAdmin
      .from('stores')
      .select(STORE_SELECT)
      .eq('status', 'ACTIVE')
      .order('name')
      .order('id')
      .limit(STORE_LIST_MAX)
      .throwOnError();
    // The cap is a safety valve: say so when it bites, or a store missing from its area's list is a silent mystery.
    if (data.length === STORE_LIST_MAX)
      logger.warn({ shown: STORE_LIST_MAX }, 'Store list truncated');
    // Computed here, so a listed state is at most PUBLIC_READ_TTL_MS old (the entry is rebuilt after that).
    const schedules = await getSchedules(data.map((store) => store.id));
    return data.map((store) =>
      toStoreSummaryDto(
        store,
        toOpenFields(
          computeOpenState(store, schedules.get(store.id) ?? { hours: [], exceptions: [] }),
        ),
      ),
    );
  });
  return area === undefined ? all : all.filter((store) => store.area === area);
}
