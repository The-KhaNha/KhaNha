import { describe, expect, it } from 'vitest';
import { api } from '../setup/api';

const EXPECTED = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
};

describe('security headers', () => {
  it('are on a normal response, without HSTS over plain http and without X-Powered-By', async () => {
    const res = await api().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers).toMatchObject(EXPECTED);
    expect(res.headers['strict-transport-security']).toBeUndefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('are on a 404 and on an error response too', async () => {
    const missing = await api().get('/api/nope');
    expect(missing.status).toBe(404);
    expect(missing.headers).toMatchObject(EXPECTED);

    const denied = await api().get('/api/orders');
    expect(denied.status).toBe(401);
    expect(denied.headers).toMatchObject(EXPECTED);
  });
});
