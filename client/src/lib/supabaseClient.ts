import { createClient } from '@supabase/supabase-js';
import { deviceClockFetch } from './deviceClockFetch';
import { runtimeEnv } from './runtimeEnv';

// The web image's runtime values, else client/.env.<mode> (see client/.env.example); vite.config.ts refuses to build
// a normal mode without them.
const url = runtimeEnv.supabaseUrl;
const publishableKey = runtimeEnv.supabasePublishableKey;

if (!url || !publishableKey) {
  throw new Error(
    'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set. See client/.env.example.',
  );
}

/**
 * Load through getSupabase() in lib/supabase.ts, never import directly: this module pulls in supabase-js (~59 KB gzip),
 * which the public pages must not wait for. Used only for signing in and out. supabase-js keeps the session in localStorage and refreshes the access token
 * before it expires (by the device's clock: deviceClockFetch). All data comes from the API; the publishable key cannot
 * read or write any table (RLS).
 */
export const supabase = createClient(url, publishableKey, { global: { fetch: deviceClockFetch } });
