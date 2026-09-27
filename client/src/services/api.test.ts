import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));
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
