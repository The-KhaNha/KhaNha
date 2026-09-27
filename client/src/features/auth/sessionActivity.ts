import { logger } from '../../lib/logger';

/**
 * A sign-in lasts a week without use; every day the app is used restarts that week. Access tokens stay short (1 h,
 * refreshed in the background by supabase-js); this caps how long an unused device stays signed in.
 * The same limit is Supabase's auth.sessions.inactivity_timeout (server/supabase/config.toml; hosted: dashboard).
 */
export const SESSION_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const KEY = 'fp_last_active';

// markActive runs on every sign-in, sign-out and return to the tab: report a write failure once, not every time.
let reportedWriteFailure = false;

function reportWriteFailure(error: unknown): void {
  if (reportedWriteFailure) return;
  reportedWriteFailure = true;
  const name = error instanceof DOMException || error instanceof Error ? error.name : 'Unknown';
  // warn (not debug/info, which are compiled out of production): storage failure silently disables the 7-day cap.
  logger.warn('Session activity storage unavailable', { operation: 'markActive', error: name });
}

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
  } catch (error) {
    // Storage blocked: the Supabase-side inactivity timeout still applies.
    reportWriteFailure(error);
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
