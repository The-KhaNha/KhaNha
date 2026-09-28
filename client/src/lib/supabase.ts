import type { SupabaseClient } from '@supabase/supabase-js';

let client: Promise<SupabaseClient> | null = null;

/**
 * The supabase-js client, loaded on first use rather than with the app: it is 40% of the JavaScript, and a visitor who
 * only browses the menu never needs it. A failed load (offline) is forgotten, so the next call tries again.
 */
export function getSupabase(): Promise<SupabaseClient> {
  client ??= import('./supabaseClient')
    .then((module) => module.supabase)
    .catch((err: unknown) => {
      client = null;
      throw err;
    });
  return client;
}

// supabase-js's own storage key for the session: `sb-<project ref>-auth-token` (plus `-code-verifier` for PKCE).
const SESSION_KEY = /^sb-.+-auth-token$/;

/**
 * Whether this browser may hold a Supabase session, checked without loading supabase-js: its storage key is there.
 * When storage cannot be read the answer is yes, so a signed-in user is never treated as signed out.
 */
export function mayHaveSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      if (SESSION_KEY.test(localStorage.key(i) ?? '')) return true;
    }
    return false;
  } catch {
    return true;
  }
}
