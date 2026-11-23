// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSupabase = vi.hoisted(() =>
  vi.fn(async () => ({ auth: { getSession: async () => ({ data: { session: null } }) } })),
);
vi.mock('../lib/supabase', () => ({ getSupabase }));
const clearSession = vi.hoisted(() => vi.fn());
vi.mock('../features/auth/authStore', () => ({
  useAuthStore: { getState: () => ({ clearSession }) },
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
        text: () => stalledFetch('', init),
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

describe('a reply that is not the API’s', () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (body: BodyInit | null, status: number, type = 'text/html') =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status, headers: { 'Content-Type': type } })),
    );

  // Campus Wi-Fi: the portal redirects every request to its own 200 sign-in page. Resolving that as null crashed
  // the screen that read the result; it is the unreachable state, with its retry.
  it('a 200 whose body is not JSON (a captive portal’s sign-in page) is unreachable, never null', async () => {
    reply('<html><body>Sign in to Campus Wi-Fi</body></html>', 200);
    await expect(request('/menu')).rejects.toSatisfy(
      (err) => err instanceof ApiError && err.isUnreachable && err.code === 'UNREACHABLE',
    );
  });

  it.each([
    ['a 204', 204],
    ['a 200 a proxy emptied', 200],
  ])('%s with no body resolves null', async (_label, status) => {
    reply(null, status);
    await expect(request('/stores/s/menu/i', { method: 'DELETE' })).resolves.toBeNull();
  });

  it.each([
    [413, 'INTERNAL', false],
    [502, 'UNREACHABLE', true],
  ])('a %i HTML page from a proxy keeps its status', async (status, code, unreachable) => {
    reply('<html>nginx</html>', status);
    await expect(request('/menu')).rejects.toSatisfy(
      (err) =>
        err instanceof ApiError &&
        err.status === status &&
        err.code === code &&
        err.isUnreachable === unreachable,
    );
  });
});

describe('a 401 mid-session', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearSession.mockClear();
  });
  const unauthorized = { error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } };

  it('signs out a caller who sent a token, and still throws the server message', async () => {
    getSupabase.mockResolvedValueOnce({
      auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
    } as never);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(unauthorized), { status: 401 })),
    );
    await expect(request('/orders')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a public request', { auth: false }],
    ['a request sent without a token', {}],
  ])('leaves the session alone for %s', async (_label, options) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(unauthorized), { status: 401 })),
    );
    await expect(request('/orders', options)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(clearSession).not.toHaveBeenCalled();
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

describe('a body that errors mid-read', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearSession.mockClear();
  });
  const broken = (status: number) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(c) {
                c.error(new Error('reset'));
              },
            }),
            { status },
          ),
      ),
    );

  it('a 426 still marks the build outdated and keeps its status', async () => {
    const { useVersionStore } = await import('../features/version/versionStore');
    useVersionStore.setState({ outdated: false });
    broken(426);
    await expect(request('/menu')).rejects.toSatisfy(
      (err) => err instanceof ApiError && err.status === 426,
    );
    expect(useVersionStore.getState().outdated).toBe(true);
  });

  it('a 401 sent with a token still signs the caller out', async () => {
    getSupabase.mockResolvedValueOnce({
      auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
    } as never);
    broken(401);
    await expect(request('/orders')).rejects.toMatchObject({ status: 401 });
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it('a 2xx whose body errors is unreachable', async () => {
    broken(200);
    await expect(request('/menu')).rejects.toSatisfy(
      (err) => err instanceof ApiError && err.isUnreachable && err.status === 0,
    );
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

  // Chromium keeps a failed import() for the page's life: only a reload can load it, so the retry must become one.
  it('turns a failed load into CLIENT_RELOAD_REQUIRED', async () => {
    getSupabase.mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'));
    await expect(request('/orders')).rejects.toSatisfy(
      (err) =>
        err instanceof ApiError && err.isUnreachable && err.code === 'CLIENT_RELOAD_REQUIRED',
    );
  });

  // Every later call fails with the same kept rejection: one line per page life, the name only (the message is a URL).
  it('logs the failed load once, with the error name only', async () => {
    // A fresh module: an earlier test here already spent this page life's one log line.
    vi.resetModules();
    const fresh = await import('./api');
    const { logger } = await import('../lib/logger');
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => {});
    getSupabase.mockRejectedValue(new TypeError('Failed to fetch dynamically imported module'));
    try {
      await expect(fresh.request('/orders')).rejects.toBeInstanceOf(fresh.ApiError);
      await expect(fresh.request('/orders')).rejects.toBeInstanceOf(fresh.ApiError);
      const calls = logError.mock.calls.filter(
        ([message]) => message === 'Sign-in module failed to load',
      );
      expect(calls).toEqual([['Sign-in module failed to load', { name: 'TypeError' }]]);
    } finally {
      getSupabase.mockReset();
      getSupabase.mockImplementation(async () => ({
        auth: { getSession: async () => ({ data: { session: null } }) },
      }));
      logError.mockRestore();
    }
  });
});
