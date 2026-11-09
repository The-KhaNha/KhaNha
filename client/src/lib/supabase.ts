import type { SupabaseClient } from '@supabase/supabase-js';

let client: Promise<SupabaseClient> | null = null;

const load = () => import('./supabaseClient').then((module) => module.supabase);

/**
 * The supabase-js client, loaded on first use rather than with the app: it is 40% of the JavaScript, and a visitor who
 * only browses the menu never needs it. A failed load is retried once with a fresh import(): Firefox and Safari fetch
 * it again, so a dropped connection recovers there. Chromium caches a failed import() for the page's life, so its
 * retry fails at once. A failure after the retry is kept: only a reload can load it (services/api.ts
 * CLIENT_RELOAD_REQUIRED).
 */
export function getSupabase(): Promise<SupabaseClient> {
  client ??= load().catch(load);
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

/**
 * Removes supabase-js's stored session without loading it: the local sign-out when its chunk failed to load. Left in
 * storage, the session would come back on the reload that failure asks for.
 */
export function clearStoredSession(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && SESSION_KEY.test(key)) localStorage.removeItem(key);
    }
  } catch {
    // Storage blocked: supabase-js could not have stored a session either.
  }
}
