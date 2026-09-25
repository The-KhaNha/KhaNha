import type { Tables } from '../types/database';
import { notFound } from '../utils/errors';
import { supabaseAdmin } from '../utils/supabase';

/** V0 has exactly one store, created by `npm run seed`. */
export async function getStore(): Promise<Tables<'stores'>> {
  const { data: store } = await supabaseAdmin.from('stores').select().limit(1).maybeSingle().throwOnError();
  if (!store) throw notFound('The store has not been set up yet. Run `npm run seed` in server/.');
  return store;
}
