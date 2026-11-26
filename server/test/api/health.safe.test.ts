import { describe, expect, it } from 'vitest';
import { api } from '../setup/api';

describe('GET /api/health', () => {
  it('answers ok with the version and commit', async () => {
    const res = await api().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, version: expect.any(String), commit: expect.any(String) });
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('GET /api/ready answers 200 while the database is up', async () => {
    const res = await api().get('/api/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ready: true });
  });

  it('returns the error envelope for an unknown route', async () => {
    const res = await api().get('/api/nope');
    expect(res).toMatchObject({ status: 404 });
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'No route matches GET /api/nope.' },
    });
  });
});
