import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSupabase = vi.hoisted(() =>
  vi.fn(async () => ({ auth: { getSession: async () => ({ data: { session: null } }) } })),
);
vi.mock('../lib/supabase', () => ({ getSupabase }));
vi.mock('../features/auth/authStore', () => ({
  useAuthStore: { getState: () => ({ clearSession: () => {} }) },
}));

const { ApiError, REQUEST_TIMEOUT_MS, request } = await import('./api');

/** A fetch that never answers until its signal aborts, like a stalled connection. */
function stalledFetch(_url: string, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const fail = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    if (init?.signal?.aborted) fail();
    init?.signal?.addEventListener('abort', fail);
  });
}

describe('request timeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('turns a stalled request into an unreachable ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(stalledFetch));
    const pending = request('/menu');
    const settled = expect(pending).rejects.toSatisfy(
      (err) => err instanceof ApiError && err.isUnreachable,
    );
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await settled;
  });

  it('still rethrows the caller’s own abort as an AbortError', async () => {
    vi.stubGlobal('fetch', vi.fn(stalledFetch));
    const controller = new AbortController();
    const pending = request('/menu', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('times out a response whose body never finishes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => stalledFetch('', init),
      })),
    );
    const pending = request('/menu');
    const settled = expect(pending).rejects.toSatisfy(
      (err) => err instanceof ApiError && err.isUnreachable,
    );
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await settled;
  });

  it('returns the payload of a normal response and leaves no timer behind', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    await expect(request('/health')).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('client version header', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends X-Client-Version on every request', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await request('/menu');
    const init = fetchMock.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>)['X-Client-Version']).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('426 CLIENT_OUTDATED', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('marks the build outdated and still throws the server message', async () => {
    const { useVersionStore } = await import('../features/version/versionStore');
    const envelope = { error: { code: 'CLIENT_OUTDATED', message: 'A new version is available.' } };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(envelope), { status: 426 })),
    );
    await expect(request('/menu')).rejects.toSatisfy(
      (err) => err instanceof ApiError && err.code === 'CLIENT_OUTDATED',
    );
    expect(useVersionStore.getState().outdated).toBe(true);
  });
});

describe('supabase-js loading', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    getSupabase.mockClear();
  });

  it('never loads it for a public request (auth: false)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 })),
    );
    await request('/menu', { auth: false });
    expect(getSupabase).not.toHaveBeenCalled();
  });

  it('turns a failed load into an unreachable ApiError', async () => {
    getSupabase.mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'));
    await expect(request('/orders')).rejects.toSatisfy(
      (err) => err instanceof ApiError && err.isUnreachable,
    );
  });
});
