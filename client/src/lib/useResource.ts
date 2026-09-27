import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from './logger';
import { ApiError } from '../services/api';

interface ResourceState<T> {
  data: T | null;
  /** True only while there is no data yet. */
  isLoading: boolean;
  error: ApiError | null;
  /** Timestamp of the last successful fetch. */
  updatedAt: number | null;
}

interface UseResourceOptions<T> {
  /** Identity of the resource; changing it resets the state and refetches. */
  key: string;
  /** Data to show immediately (e.g. passed through router state). */
  initialData?: T | null;
  /** Return a delay in ms to poll again after a successful fetch, or null to stop. */
  pollInterval?: (data: T) => number | null;
  enabled?: boolean;
  /**
   * Keep the last good result in localStorage and show it at once on the next mount or visit, while it refreshes.
   * Public data only (menu, store): never anything user-specific, which would outlive a sign-out.
   */
  persist?: boolean;
}

interface Resource<T> extends ResourceState<T> {
  reload: () => void;
  mutate: (updater: (previous: T) => T) => void;
}

// Bump when a persisted response shape changes, so an old cached shape is never rendered by new code.
const CACHE_PREFIX = 'fp_cache:v1:';
// Keys whose storage failure was already logged: writeCache runs on every successful poll.
const reportedKeys = new Set<string>();

function reportStorageFailure(key: string): void {
  if (reportedKeys.has(key)) return;
  reportedKeys.add(key);
  logger.debug('Resource cache unavailable', { key });
}

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    reportStorageFailure(key);
    return null;
  }
}

function writeCache(key: string, data: unknown): void {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data));
  } catch {
    // Storage full or blocked (private mode): the cache is only a head start, so carry on without it.
    reportStorageFailure(key);
  }
}

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError(0, 'UNKNOWN', 'Something went wrong.');
}

/**
 * Loads a resource, exposes loading / error / retry, and optionally polls.
 * Polling pauses while the tab is hidden and resumes (with an immediate fetch) when it is visible again.
 * With `persist`, the cached copy renders immediately (stale-while-revalidate) and the fetch replaces it.
 */
export function useResource<T>(
  fetcher: () => Promise<T>,
  { key, initialData = null, pollInterval, enabled = true, persist = false }: UseResourceOptions<T>,
): Resource<T> {
  const [state, setState] = useState<ResourceState<T>>(() => {
    const data = initialData ?? (persist ? readCache<T>(key) : null);
    return { data, isLoading: data === null, error: null, updatedAt: null };
  });
  const [nonce, setNonce] = useState(0);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const pollRef = useRef(pollInterval);
  pollRef.current = pollInterval;
  const dataRef = useRef<T | null>(state.data);
  const lastKey = useRef(key);
  // Bumped by mutate(): a fetch that started before the latest local change must not overwrite it.
  const version = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    if (lastKey.current !== key) {
      lastKey.current = key;
      const cached = persist ? readCache<T>(key) : null;
      dataRef.current = cached;
      setState({ data: cached, isLoading: cached === null, error: null, updatedAt: null });
    }

    let cancelled = false;
    let timer: number | undefined;

    const schedule = () => {
      const data = dataRef.current;
      if (data === null || !pollRef.current || document.hidden) return;
      const delay = pollRef.current(data);
      if (delay === null) return;
      timer = window.setTimeout(run, delay);
    };

    const run = async () => {
      window.clearTimeout(timer);
      const startedAt = version.current;
      try {
        const data = await fetcherRef.current();
        if (cancelled) return;
        if (startedAt === version.current) {
          dataRef.current = data;
          if (persist) writeCache(key, data);
          setState({ data, isLoading: false, error: null, updatedAt: Date.now() });
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState((s) => ({ ...s, isLoading: false, error: toApiError(err) }));
      }
      schedule();
    };

    const onVisibility = () => {
      window.clearTimeout(timer);
      if (!document.hidden && dataRef.current !== null && pollRef.current) void run();
    };

    document.addEventListener('visibilitychange', onVisibility);
    void run();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [key, nonce, enabled, persist]);

  const reload = useCallback(() => {
    setState((s) => ({ ...s, isLoading: s.data === null, error: null }));
    setNonce((n) => n + 1);
  }, []);

  const mutate = useCallback((updater: (previous: T) => T) => {
    if (dataRef.current === null) return;
    version.current += 1;
    setState((s) => {
      if (s.data === null) return s;
      const data = updater(s.data);
      dataRef.current = data;
      return { ...s, data };
    });
  }, []);

  return { ...state, reload, mutate };
}
