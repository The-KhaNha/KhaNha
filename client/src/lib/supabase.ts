import { createClient } from '@supabase/supabase-js';

// Set per mode in client/.env.<mode> (see client/.env.example); vite.config.ts refuses to build without them.
const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

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
