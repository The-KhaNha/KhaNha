import { afterEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ request }));

const { fetchConfig } = await import('./config');

describe('fetchConfig', () => {
  afterEach(() => request.mockReset());

  it('asks without a token and shares one request between concurrent callers', async () => {
    let resolve!: (value: unknown) => void;
    request.mockReturnValue(new Promise((r) => (resolve = r)));
    const a = fetchConfig();
    const b = fetchConfig();
    resolve({ serverVersion: '0.1.0' });
    await Promise.all([a, b]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/config', { auth: false });
  });

  it('asks again once the previous request settled', async () => {
    request.mockResolvedValue({});
    await fetchConfig();
    await fetchConfig();
    expect(request).toHaveBeenCalledTimes(2);
  });
});
