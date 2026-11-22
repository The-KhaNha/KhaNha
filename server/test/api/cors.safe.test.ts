import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Production's three hosts are three browser origins (P8 PR 05b): CORS must answer each listed one by name and none
// other. Loads its own copy of the app with a two-host CLIENT_ORIGIN; /api/health reads no database.
const [APEX, STAFF] = ['https://khanha.example', 'https://staff.khanha.example'];
const LISTED = [APEX, STAFF];
let app: Awaited<ReturnType<typeof load>>;
const before = process.env.CLIENT_ORIGIN;

async function load() {
  vi.resetModules();
  process.env.CLIENT_ORIGIN = LISTED.join(', ');
  const { createApp } = await import('../../src/app.js');
  return createApp();
}

beforeAll(async () => {
  app = await load();
});
afterAll(() => {
  if (before === undefined) delete process.env.CLIENT_ORIGIN;
  else process.env.CLIENT_ORIGIN = before;
  vi.resetModules();
});

describe('CORS with a list of client origins', () => {
  it.each(LISTED)('answers %s with its own origin', async (origin) => {
    const res = await request(app).get('/api/health').set('Origin', origin);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
  });

  it('preflights a listed origin', async () => {
    const res = await request(app)
      .options('/api/health')
      .set('Origin', STAFF)
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(STAFF);
  });

  it('gives an unlisted origin no CORS header', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
