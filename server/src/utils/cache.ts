// In-process TTL cache for PUBLIC read data (menu, store). The pending promise is stored, so concurrent requests on
// a cold cache share one database round-trip; a failed load is dropped instead of cached.
//
// Staleness is bounded by the TTL. Writes that go through this API call `invalidate()`, so they show up at once.
// ponytail: per-process. Edits made in the Supabase dashboard, or writes handled by another API instance, show up
// within the TTL. Move to a shared cache (e.g. Redis) or LISTEN/NOTIFY if that window ever matters.
// Never cache anything user-specific or anything a write path relies on (createOrder reads the store uncached).
import { env } from './env';

/** How long public reads (menu, store, site settings) may be served from memory: env PUBLIC_READ_TTL_MS. */
export const PUBLIC_READ_TTL_MS = env.PUBLIC_READ_TTL_MS;

const entries = new Map<string, { expiresAt: number; value: Promise<unknown> }>();

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = entries.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as Promise<T>;

  // While the load is in flight, expiresAt is Infinity so a slow load stays shared with every concurrent caller no
  // matter how long it takes; the TTL only starts once the load has settled.
  const value = load();
  entries.set(key, { expiresAt: Infinity, value });
  value.then(
    () => {
      if (entries.get(key)?.value === value)
        entries.set(key, { expiresAt: Date.now() + ttlMs, value });
    },
    () => {
      if (entries.get(key)?.value === value) entries.delete(key);
    },
  );
  return value;
}

/** Drops one key, or everything when called without one. */
export function invalidate(key?: string): void {
  if (key === undefined) entries.clear();
  else entries.delete(key);
}
