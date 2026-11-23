import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/api', () => ({ ApiError: class ApiError extends Error {} }));

const { clearPersistedCache, dropOldCacheVersions, useResource } = await import('./useResource');

const CACHE = 'fp_cache:v2:menu';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Fake timers: runs timers and microtasks inside act, so no test waits on the wall clock.
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useResource persist', () => {
  afterEach(() => localStorage.clear());

  it('renders the cached copy at once, then replaces and re-caches it with the fetch', async () => {
    localStorage.setItem(CACHE, JSON.stringify({ items: ['old'] }));
    let resolve!: (value: { items: string[] }) => void;
    const fetcher = () => new Promise<{ items: string[] }>((r) => (resolve = r));

    const { result } = renderHook(() => useResource(fetcher, { key: 'menu', persist: true }));
    expect(result.current).toMatchObject({ data: { items: ['old'] }, isLoading: false });

    resolve({ items: ['new'] });
    await waitFor(() => expect(result.current.data).toEqual({ items: ['new'] }));
    expect(JSON.parse(localStorage.getItem(CACHE)!)).toEqual({ items: ['new'] });
  });

  it('ignores a corrupt cache entry and loads normally', async () => {
    localStorage.setItem(CACHE, '{not json');
    const { result } = renderHook(() =>
      useResource(async () => ({ items: ['fresh'] }), { key: 'menu', persist: true }),
    );
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual({ items: ['fresh'] }));
  });

  it('never touches storage without persist', async () => {
    localStorage.setItem(CACHE, JSON.stringify({ items: ['old'] }));
    const { result } = renderHook(() =>
      useResource(async () => ({ items: ['fresh'] }), { key: 'menu' }),
    );
    expect(result.current).toMatchObject({ data: null, isLoading: true });
    await waitFor(() => expect(result.current.data).toEqual({ items: ['fresh'] }));
    expect(JSON.parse(localStorage.getItem(CACHE)!)).toEqual({ items: ['old'] });
  });
});

describe('useResource polling', () => {
  afterEach(() => {
    delete (document as { hidden?: boolean }).hidden; // restore jsdom's own getter
    vi.useRealTimers();
  });

  it('pauses while the tab is hidden and resumes with an immediate fetch once visible again', async () => {
    vi.useFakeTimers();
    const resolvers: ((value: { n: number }) => void)[] = [];
    const fetcher = vi.fn(() => new Promise<{ n: number }>((r) => resolvers.push(r)));
    const { result } = renderHook(() =>
      useResource(fetcher, { key: 'poll', pollInterval: () => 100 }),
    );

    resolvers[0]!({ n: 1 });
    await advance(0);
    expect(result.current.data).toEqual({ n: 1 });

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange')); // cancels the pending 100ms poll timer

    await advance(350); // well past when the cancelled poll would otherwise have fired
    expect(fetcher).toHaveBeenCalledTimes(1); // no poll was scheduled while hidden

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange')); // fetcher() runs synchronously inside
    resolvers[1]!({ n: 2 });
    await advance(0);
    expect(result.current.data).toEqual({ n: 2 }); // resumed at once
  });
});

describe('useResource mutate vs. an in-flight fetch', () => {
  it('a local mutate wins over a fetch that was already in flight', async () => {
    const resolvers: ((value: { n: number }) => void)[] = [];
    const fetcher = vi.fn(() => new Promise<{ n: number }>((r) => resolvers.push(r)));
    const { result } = renderHook(() => useResource(fetcher, { key: 'race' }));

    resolvers[0]!({ n: 1 });
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));

    act(() => result.current.reload());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    act(() => result.current.mutate((previous) => ({ n: previous.n + 100 })));
    expect(result.current.data).toEqual({ n: 101 });

    // The in-flight fetch resolves after the mutate: it must not overwrite the local change.
    act(() => resolvers[1]!({ n: 2 }));
    await flush();
    expect(result.current.data).toEqual({ n: 101 });
  });
});

describe('useResource AbortError handling', () => {
  it('ignores an AbortError from the fetcher and leaves the previous state alone', async () => {
    const fetcher = vi
      .fn<() => Promise<{ n: number }>>()
      .mockResolvedValueOnce({ n: 1 })
      .mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'));
    const { result } = renderHook(() => useResource(fetcher, { key: 'abort' }));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));

    act(() => result.current.reload());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await flush();

    expect(result.current.data).toEqual({ n: 1 });
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});

describe('useResource key change', () => {
  it('resets state and refetches when the key changes', async () => {
    const fetcher = vi
      .fn<() => Promise<{ n: number }>>()
      .mockResolvedValueOnce({ n: 1 })
      .mockResolvedValueOnce({ n: 2 });
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useResource(fetcher, { key }),
      {
        initialProps: { key: 'a' },
      },
    );
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));

    rerender({ key: 'b' });
    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
  });
});

describe('useResource persist when storage is blocked', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps working and logs the failure once per key, not on every fetch', async () => {
    const { logger } = await import('./logger');
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    let n = 0;
    const { result } = renderHook(() =>
      useResource(async () => ({ n: ++n }), { key: 'blocked', persist: true }),
    );
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));

    const reports = debug.mock.calls.filter(
      ([message]) => message === 'Resource cache unavailable',
    );
    expect(reports).toEqual([['Resource cache unavailable', { key: 'blocked' }]]);
  });
});

describe('useResource after 426 CLIENT_OUTDATED', () => {
  afterEach(() => vi.useRealTimers());

  it('stops polling: every retry would be refused until the page reloads', async () => {
    vi.useFakeTimers();
    const { ApiError } = await import('../services/api');
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      if (calls === 1) return { n: 1 };
      throw Object.assign(new ApiError(426, 'CLIENT_OUTDATED', 'outdated'), { status: 426 });
    };
    const { result } = renderHook(() =>
      useResource(fetcher, { key: 'orders', pollInterval: () => 5 }),
    );
    await advance(10);
    expect(result.current.error).not.toBeNull();
    const after = calls;
    await advance(40);
    expect(calls).toBe(after);
    expect(result.current.data).toEqual({ n: 1 });
  });
});

describe('dropOldCacheVersions', () => {
  afterEach(() => localStorage.clear());

  it('drops entries an older prefix left behind and keeps the current ones and other keys', () => {
    localStorage.setItem('fp_cache:v1:menu', '{}');
    localStorage.setItem(CACHE, '{}');
    localStorage.setItem('fp_cart', '{"lines":[]}');
    dropOldCacheVersions();
    expect(localStorage.getItem('fp_cache:v1:menu')).toBeNull();
    expect(localStorage.getItem(CACHE)).toBe('{}');
    expect(localStorage.getItem('fp_cart')).toBe('{"lines":[]}');
  });

  it('drops every old entry even when the browser reorders keys after a removal', () => {
    // A storage whose key order changes on every removal: scanning while removing would skip entries.
    const items = new Map<string, string>();
    for (const n of [1, 2, 3, 4, 5]) items.set(`fp_cache:v1:k${String(n)}`, '{}');
    items.set('fp_cart', '[]');
    let order = [...items.keys()];
    const fake = {
      get length() {
        return order.length;
      },
      key: (i: number) => order[i] ?? null,
      removeItem: (key: string) => {
        items.delete(key);
        order = [...items.keys()].reverse();
      },
    };
    vi.stubGlobal('localStorage', fake);
    try {
      dropOldCacheVersions();
    } finally {
      vi.unstubAllGlobals();
    }
    expect([...items.keys()]).toEqual(['fp_cart']);
  });
});

describe('clearPersistedCache', () => {
  afterEach(() => localStorage.clear());

  it('drops every persisted response and nothing else', () => {
    localStorage.setItem(CACHE, '{}');
    localStorage.setItem('fp_cache:v2:config', '{}');
    localStorage.setItem('fp_cart', '{"lines":[]}');
    clearPersistedCache();
    expect(localStorage.getItem(CACHE)).toBeNull();
    expect(localStorage.getItem('fp_cache:v2:config')).toBeNull();
    expect(localStorage.getItem('fp_cart')).toBe('{"lines":[]}');
  });
});

describe('useResource races', () => {
  afterEach(() => vi.useRealTimers());

  it('a slow fetch of the old key never overwrites the new key', async () => {
    const resolvers: Record<string, (value: { k: string }) => void> = {};
    const { result, rerender } = renderHook(
      ({ k }: { k: string }) =>
        useResource(() => new Promise<{ k: string }>((r) => (resolvers[k] = r)), { key: k }),
      { initialProps: { k: 'one' } },
    );
    rerender({ k: 'two' });
    await waitFor(() => expect(resolvers.two).toBeDefined());

    resolvers.two!({ k: 'two' });
    await waitFor(() => expect(result.current.data).toEqual({ k: 'two' }));
    // The old key's request lands last: it must be dropped.
    await act(async () => {
      resolvers.one!({ k: 'one' });
      await flush();
    });
    expect(result.current.data).toEqual({ k: 'two' });
  });

  it('recovers from an error when reload() succeeds', async () => {
    let fail = true;
    const fetcher = vi.fn(async () => {
      if (fail) throw new Error('down');
      return { ok: true };
    });
    const { result } = renderHook(() => useResource(fetcher, { key: 'retry' }));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.data).toBeNull();

    fail = false;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toEqual({ ok: true }));
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  // The poll after a resolve is what the cancelled flag stops; result.current is frozen at unmount, so it proves nothing.
  it('unmounting mid-fetch stops polling once that fetch resolves', async () => {
    vi.useFakeTimers();
    let resolve!: (value: { n: number }) => void;
    const fetcher = vi.fn(() => new Promise<{ n: number }>((r) => (resolve = r)));
    const { unmount } = renderHook(() =>
      useResource(fetcher, { key: 'gone', pollInterval: () => 10 }),
    );
    unmount();
    resolve({ n: 1 });
    await advance(100);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
