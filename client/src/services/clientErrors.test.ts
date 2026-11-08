import { afterEach, expect, it, vi } from 'vitest';
import { sendClientErrors } from './clientErrors';

vi.mock('../lib/supabase', () => ({ getSupabase: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

const reports = [
  { kind: 'error' as const, message: 'Oops', route: '/menu', at: new Date().toISOString() },
];

it('sends reports without auth, with keepalive and the client version', async () => {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  await sendClientErrors(reports);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/client-errors',
    expect.objectContaining({
      method: 'POST',
      keepalive: true,
      body: JSON.stringify({ reports }),
      headers: expect.objectContaining({ 'X-Client-Version': expect.any(String) }),
    }),
  );
  expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Authorization');
});

it.each([0, 429, 500])('swallows a failed send (%s) without retries', async (status) => {
  const fetchMock = vi.fn(async () => {
    if (!status) throw new TypeError('offline');
    return new Response('{}', { status });
  });
  vi.stubGlobal('fetch', fetchMock);
  await expect(sendClientErrors(reports)).resolves.toBeUndefined();
  expect(fetchMock).toHaveBeenCalledOnce();
});
