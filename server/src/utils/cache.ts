// In-process TTL cache for PUBLIC read data (menu, store). The pending promise is stored, so concurrent requests on
// a cold cache share one database round-trip; a failed load is dropped instead of cached.
//
// Staleness is bounded by the TTL. Writes that go through this API call `invalidate()`, so they show up at once.
// ponytail: per-process. Edits made in the Supabase dashboard, or writes handled by another API instance, show up
// within the TTL. Move to a shared cache (e.g. Redis) or LISTEN/NOTIFY if that window ever matters.
// Never cache anything user-specific or anything a write path relies on (createOrder reads the store uncached).

/** How long public reads (GET /api/menu, GET /api/store) may be served from memory. */
export const PUBLIC_READ_TTL_MS = 10_000;

const entries = new Map<string, { expiresAt: number; value: Promise<unknown> }>();

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = entries.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as Promise<T>;

  const value = load();
  entries.set(key, { expiresAt: Date.now() + ttlMs, value });
  value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key);
  });
  return value;
}

/** Drops one key, or everything when called without one. */
export function invalidate(key?: string): void {
  if (key === undefined) entries.clear();
  else entries.delete(key);
}
