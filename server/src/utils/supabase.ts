import { PostgrestError } from '@supabase/supabase-js';
import { createAdminClient } from '@supabase/server/core';
import type { Database } from '../types/database';
import { env } from './env';

/** Passed to every @supabase/server call so it uses the validated values above, not whatever else is in process.env. */
export const supabaseEnv = {
  url: env.SUPABASE_URL,
  secretKeys: { default: env.SUPABASE_SECRET_KEY },
};

/**
 * The single Supabase client shared by the whole process. It uses the secret key and therefore bypasses RLS:
 * who may see or change what is decided in the services, and the browser's publishable key can touch no table.
 */
export const supabaseAdmin = createAdminClient<Database>({ env: supabaseEnv });

/**
 * The database functions in supabase/migrations report expected failures with `raise exception` whose message is an
 * API error code and whose detail is a JSON object. Returns that detail when `err` is such a failure with `code`.
 */
export function raisedByDatabase(err: unknown, code: string): Record<string, unknown> | undefined {
  if (!(err instanceof PostgrestError) || err.code !== 'P0001' || err.message !== code) return undefined;
  try {
    const detail: unknown = JSON.parse(err.details);
    return typeof detail === 'object' && detail !== null ? (detail as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
