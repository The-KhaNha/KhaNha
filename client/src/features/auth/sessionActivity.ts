/**
 * A sign-in lasts a week without use; every day the app is used restarts that week. Access tokens stay short (1 h,
 * refreshed in the background by supabase-js); this caps how long an unused device stays signed in.
 * The same limit is Supabase's auth.sessions.inactivity_timeout (server/supabase/config.toml; hosted: dashboard).
 */
export const SESSION_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const KEY = 'fp_last_active';

export function readLastActive(): number | null {
  try {
    const value = Number(localStorage.getItem(KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function markActive(now: number = Date.now()): void {
  try {
    localStorage.setItem(KEY, String(now));
  } catch {
    // Storage blocked: the Supabase-side inactivity timeout still applies.
  }
}

export function clearActivity(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

/** No record yet (signed in before this existed) counts as active: the week starts now. */
export function isIdleExpired(lastActive: number | null, now: number = Date.now()): boolean {
  return lastActive !== null && now - lastActive > SESSION_IDLE_TTL_MS;
}
