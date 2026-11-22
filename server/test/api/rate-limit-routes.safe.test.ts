import { once } from 'node:events';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestUser, deleteTestUser, oldestStoreId, type TestUser } from '../setup/helpers';

// Loads its own copy of the app with small write and register limits, to check which routes carry which limiter
// (rate-limit.safe.test.ts checks how counting works). Every request below is refused by validation or lookup, so
// no account, order or status change is ever made.
const WRITE_MAX = 2;
const REGISTER_MAX = 2;
const INVITE_ACCEPT_MAX = 2;
let server: Server;
let staff: TestUser;
let staffTwo: TestUser;
let customer: TestUser;

beforeAll(async () => {
  [staff, staffTwo, customer] = await Promise.all([
    createTestUser('STAFF'),
    createTestUser('STAFF'),
    createTestUser('CUSTOMER'),
  ]);
  vi.resetModules();
  process.env.RATE_LIMIT_WRITE_MAX = String(WRITE_MAX);
  process.env.RATE_LIMIT_REGISTER_MAX = String(REGISTER_MAX);
  process.env.RATE_LIMIT_INVITE_ACCEPT_MAX = String(INVITE_ACCEPT_MAX);
  const { createApp } = await import('../../src/app.js');
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
});

afterAll(async () => {
  process.env.RATE_LIMIT_WRITE_MAX = '0';
  process.env.RATE_LIMIT_REGISTER_MAX = '0';
  delete process.env.RATE_LIMIT_INVITE_ACCEPT_MAX;
  vi.resetModules();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.all([staff, staffTwo, customer].map((u) => deleteTestUser(u)));
});

const bearer = (u: TestUser) => `Bearer ${u.token}`;

function expectRateLimited(res: request.Response) {
  expect(res.status).toBe(429);
  const retryAfter = Number(res.headers['retry-after']);
  expect(res.body).toEqual({
    error: {
      code: 'RATE_LIMITED',
      message: expect.any(String),
      details: { kind: 'rateLimit', retryAfterSeconds: retryAfter },
    },
  });
  expect(retryAfter).toBeGreaterThanOrEqual(1);
  expect(res.headers['x-content-type-options']).toBe('nosniff');
}

describe('POST /api/auth/register limiter', () => {
  it('counts refused attempts too, and answers 429 past the limit', async () => {
    for (let i = 0; i < REGISTER_MAX; i += 1) {
      const res = await request(server).post('/api/auth/register').send({});
      expect(res.status).toBe(400);
    }
    expectRateLimited(await request(server).post('/api/auth/register').send({}));
  });

  it('does not touch other routes (health still answers)', async () => {
    expect((await request(server).get('/api/health')).status).toBe(200);
  });
});

describe('write limiter is per signed-in account', () => {
  it('POST /api/orders: the account past its limit gets 429, another account does not', async () => {
    for (let i = 0; i < WRITE_MAX; i += 1) {
      const res = await request(server)
        .post('/api/orders')
        .set('Authorization', bearer(customer))
        .send({});
      expect(res.status).toBe(400);
    }
    expectRateLimited(
      await request(server).post('/api/orders').set('Authorization', bearer(customer)).send({}),
    );
    const other = await request(server)
      .post('/api/orders')
      .set('Authorization', bearer(staffTwo))
      .send({});
    expect(other.status).toBe(400);
  });

  it('PATCH /api/stores/:storeId/orders/:id/status: staff past the limit get 429; a non-member is refused 403 before counting', async () => {
    const storeId = await oldestStoreId();
    const patch = (u: TestUser) =>
      request(server)
        .patch(`/api/stores/${storeId}/orders/${randomUUID()}/status`)
        .set('Authorization', bearer(u))
        .send({ status: 'PREPARING' });
    for (let i = 0; i < WRITE_MAX; i += 1) expect((await patch(staff)).status).toBe(404);
    expectRateLimited(await patch(staff));
    // customer's own bucket was spent on POST /orders above, so a 403 here proves requireStore runs first
    expect((await patch(customer)).status).toBe(403);
  });

  it('reads are not counted by the write limiter', async () => {
    for (let i = 0; i < WRITE_MAX + 2; i += 1) {
      const res = await request(server).get('/api/orders').set('Authorization', bearer(customer));
      expect(res.status).toBe(200);
    }
  });
});

describe('restaurant onboarding writes (P7.4a)', () => {
  it('create, invite and revoke share the write limit; every attempt here is refused, so nothing is made', async () => {
    const admin = await createTestUser('ADMIN');
    const id = randomUUID();
    const writes = [
      () => request(server).post('/api/admin/brands').set('Authorization', bearer(admin)).send({}),
      () =>
        request(server)
          .post(`/api/admin/brands/${id}/invites`)
          .set('Authorization', bearer(admin))
          .send({}),
      () =>
        request(server)
          .delete(`/api/admin/brands/${id}/invites/${id}`)
          .set('Authorization', bearer(admin)),
    ];
    try {
      for (const write of writes) {
        // A fresh window per route would hide a missing limiter, so the count runs across all three.
        const res = await write();
        expect([400, 404, 429]).toContain(res.status);
      }
      for (const write of writes) expectRateLimited(await write());
    } finally {
      await deleteTestUser(admin);
    }
  });
});

describe('invite accept limiter', () => {
  it('store and owner invite accepts count against one limit, so guesses cannot be split across them', async () => {
    const user = await createTestUser('CUSTOMER');
    const acceptAt = (path: string) =>
      request(server)
        .post(path)
        .set('Authorization', bearer(user))
        .send({ token: 'x'.repeat(43) });
    try {
      expect((await acceptAt('/api/me/invites/accept')).status).toBe(404);
      expect((await acceptAt('/api/me/brand-invites/accept')).status).toBe(404);
      expectRateLimited(await acceptAt('/api/me/brand-invites/accept'));
      expectRateLimited(await acceptAt('/api/me/invites/accept'));
    } finally {
      await deleteTestUser(user);
    }
  });
});
