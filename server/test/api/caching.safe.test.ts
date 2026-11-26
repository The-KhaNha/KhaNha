import { describe, expect, it } from 'vitest';
import { api } from '../setup/api';
import { menuPath, expectError } from '../setup/helpers';

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
    expectError(res, 400, 'VALIDATION_ERROR');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers.vary).toMatch(/Authorization/);
  });

  // A menu or board at its cap is ~270 KB of JSON; gzipped it is a tenth of that on a metered phone (P3 close).
  it('gzips a large JSON body for a client that accepts it, and keeps the ETag and the bodiless 304', async () => {
    const path = await menuPath();
    const res = await api().get(path).set('Accept-Encoding', 'gzip');
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers.vary).toMatch(/Accept-Encoding/);
    expect(res.body.categories).toBeTruthy();
    const again = await api()
      .get(path)
      .set('Accept-Encoding', 'gzip')
      .set('If-None-Match', res.headers.etag!);
    expect(again.status).toBe(304);
    expect(again.text).toBeFalsy();
  });

  it('sends a small body as it is', async () => {
    const res = await api().get('/api/health').set('Accept-Encoding', 'gzip');
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
  });
});
