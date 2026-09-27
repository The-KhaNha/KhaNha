import { createClient } from '@supabase/supabase-js';
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
 * Used only for signing in and out. supabase-js keeps the session in localStorage and refreshes the access token
 * before it expires. All data comes from the API; the publishable key cannot read or write any table (RLS).
 */
export const supabase = createClient(url, publishableKey);
