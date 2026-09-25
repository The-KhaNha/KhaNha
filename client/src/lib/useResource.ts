import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../services/api';

export interface ResourceState<T> {
  data: T | null;
  /** True only while there is no data yet. */
  isLoading: boolean;
  error: ApiError | null;
  /** Timestamp of the last successful fetch. */
  updatedAt: number | null;
}

export interface UseResourceOptions<T> {
  /** Identity of the resource; changing it resets the state and refetches. */
  key: string;
  /** Data to show immediately (e.g. passed through router state). */
  initialData?: T | null;
  /** Return a delay in ms to poll again after a successful fetch, or null to stop. */
  pollInterval?: (data: T) => number | null;
  enabled?: boolean;
}

export interface Resource<T> extends ResourceState<T> {
  reload: () => void;
  mutate: (updater: (previous: T) => T) => void;
}

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError(0, 'UNKNOWN', 'Something went wrong.');
}

/**
 * Loads a resource, exposes loading / error / retry, and optionally polls.
 * Polling pauses while the tab is hidden and resumes (with an immediate fetch) when it is visible again.
 */
export function useResource<T>(
  fetcher: () => Promise<T>,
  { key, initialData = null, pollInterval, enabled = true }: UseResourceOptions<T>,
): Resource<T> {
  const [state, setState] = useState<ResourceState<T>>({
    data: initialData,
    isLoading: initialData === null,
    error: null,
    updatedAt: null,
  });
  const [nonce, setNonce] = useState(0);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const pollRef = useRef(pollInterval);
  pollRef.current = pollInterval;
  const dataRef = useRef<T | null>(initialData);
  const lastKey = useRef(key);
  // Bumped by mutate(): a fetch that started before the latest local change must not overwrite it.
  const version = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    if (lastKey.current !== key) {
      lastKey.current = key;
      dataRef.current = null;
      setState({ data: null, isLoading: true, error: null, updatedAt: null });
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
  }, [key, nonce, enabled]);

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
