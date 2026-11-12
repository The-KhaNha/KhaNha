import { describe, expect, it } from 'vitest';
import { api } from '../setup/api';

describe('HTTP caching', () => {
  it('marks API responses for revalidation and varies on the account', async () => {
    const res = await api().get('/api/stores');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers.vary).toMatch(/Authorization/);
    expect(res.headers.etag).toBeTruthy();
  });

  it('answers an unchanged resource with a bodiless 304', async () => {
    const first = await api().get('/api/stores');
    const again = await api().get('/api/stores').set('If-None-Match', first.headers.etag!);
    expect(again.status).toBe(304);
    expect(again.text).toBeFalsy();
  });

  it('sends the full body when the ETag does not match', async () => {
    const res = await api().get('/api/stores').set('If-None-Match', 'W/"stale"');
    expect(res.status).toBe(200);
    expect(res.body.stores).toBeTruthy();
  });

  it('carries the revalidation headers on a CORS preflight, which never reaches the routes', async () => {
    const res = await api()
      .options('/api/stores')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers.vary).toMatch(/Authorization/);
  });

  it('carries the revalidation headers on a malformed-JSON 400, which never reaches the routes', async () => {
    const res = await api()
      .post('/api/orders')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers.vary).toMatch(/Authorization/);
  });
});
