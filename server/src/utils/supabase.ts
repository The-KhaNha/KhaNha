import { PostgrestError } from '@supabase/supabase-js';
import { IntegrationError } from './errors';
import { createAdminClient } from '@supabase/server/core';
import type { Database } from '../types/database';
import { env } from './env';

/** Passed to every @supabase/server call so it uses the validated values above, not whatever else is in process.env. */
export const supabaseEnv = {
  url: env.SUPABASE_URL,
  secretKeys: { default: env.SUPABASE_SECRET_KEY },
  ...(env.SUPABASE_JWKS_URL && { jwks: new URL(env.SUPABASE_JWKS_URL) }),
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
  if (!(err instanceof PostgrestError) || err.code !== 'P0001' || err.message !== code)
    return undefined;
  try {
    const detail: unknown = JSON.parse(err.details);
    return typeof detail === 'object' && detail !== null ? (detail as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Transport failures, as undici and Node report them: the request never got a database answer.
const TRANSPORT_FAILURE =
  /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i;

/**
 * The database could not be reached, as an IntegrationError, or undefined for any other error. `.throwOnError()`
 * rethrows undici's own `TypeError: fetch failed` (after postgrest-js's retries of idempotent reads); a non-throwing
 * call returns a PostgREST-shaped error with an empty `code` whose message is that same transport failure.
 */
export function asDatabaseUnavailable(err: unknown): IntegrationError | undefined {
  if (err instanceof IntegrationError) return err;
  const isTransport =
    (err instanceof TypeError && TRANSPORT_FAILURE.test(err.message)) ||
    (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { code?: unknown }).code === '' &&
      TRANSPORT_FAILURE.test(String((err as { message?: unknown }).message)));
  return isTransport
    ? new IntegrationError('supabase', 'postgrest', true, { cause: err })
    : undefined;
}
