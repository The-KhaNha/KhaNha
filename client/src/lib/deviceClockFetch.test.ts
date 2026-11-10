import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceClockFetch } from './deviceClockFetch';

const TOKEN_URL = 'http://127.0.0.1:54321/auth/v1/token?grant_type=refresh_token';
// The server's clock, five and a half hours behind this device's (a phone set wrong).
const SERVER_NOW = Math.floor(Date.now() / 1000) - 5.5 * 3600;

function answer(body: unknown, init: ResponseInit = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { headers: { 'x-a': '1' }, ...init })),
  );
}

describe('deviceClockFetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('restates a token’s expires_at on the device clock, keeping status, headers and the rest', async () => {
    answer({ access_token: 'a', expires_in: 3600, expires_at: SERVER_NOW + 3600 });
    const response = await deviceClockFetch(TOKEN_URL, { method: 'POST' });
    const body = (await response.json()) as { access_token: string; expires_at: number };
    expect(body.access_token).toBe('a');
    expect(body.expires_at).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000) + 3599);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-a')).toBe('1');
  });

  it('leaves a refused token request, another endpoint and a non-JSON body untouched', async () => {
    const refused = { error: 'invalid_grant', expires_in: 3600 };
    answer(refused, { status: 400 });
    expect(await (await deviceClockFetch(TOKEN_URL)).json()).toEqual(refused);

    const user = { expires_in: 3600, expires_at: SERVER_NOW };
    answer(user);
    expect(await (await deviceClockFetch('http://127.0.0.1:54321/auth/v1/user')).json()).toEqual(
      user,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json')),
    );
    expect(await (await deviceClockFetch(TOKEN_URL)).text()).toBe('not json');
  });

  it('leaves a token response with a missing or non-numeric expires_in untouched', async () => {
    const noField = { access_token: 'a', expires_at: SERVER_NOW };
    answer(noField);
    expect(await (await deviceClockFetch(TOKEN_URL)).json()).toEqual(noField);

    const stringy = { access_token: 'a', expires_in: '3600', expires_at: SERVER_NOW };
    answer(stringy);
    expect(await (await deviceClockFetch(TOKEN_URL)).json()).toEqual(stringy);
  });

  it('passes every non-2xx token response through with its status', async () => {
    for (const status of [401, 429, 500]) {
      answer({ expires_in: 3600 }, { status });
      const response = await deviceClockFetch(TOKEN_URL);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ expires_in: 3600 });
    }
  });

  it('leaves a JSON null or array body untouched', async () => {
    answer(null);
    expect(await (await deviceClockFetch(TOKEN_URL)).json()).toBeNull();
    answer([1]);
    expect(await (await deviceClockFetch(TOKEN_URL)).json()).toEqual([1]);
  });
});
