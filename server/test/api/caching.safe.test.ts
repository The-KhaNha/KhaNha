import { describe, expect, it } from 'vitest';
import { api } from '../setup/api';

describe('HTTP caching', () => {
  it('marks API responses for revalidation and varies on the account', async () => {
    const res = await api().get('/api/menu');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers.vary).toMatch(/Authorization/);
    expect(res.headers.etag).toBeTruthy();
  });

  it('answers an unchanged resource with a bodiless 304', async () => {
    const first = await api().get('/api/store');
    const again = await api().get('/api/store').set('If-None-Match', first.headers.etag!);
    expect(again.status).toBe(304);
    expect(again.text).toBeFalsy();
  });

  it('sends the full body when the ETag does not match', async () => {
    const res = await api().get('/api/store').set('If-None-Match', 'W/"stale"');
    expect(res.status).toBe(200);
    expect(res.body.store).toBeTruthy();
  });
});
