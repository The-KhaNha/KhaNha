// Local only: admin MFA (P7.4a PR 04). Loads its own copy of the app with ADMIN_MFA_REQUIRED on (the other suites run
// with it off): an ADMIN signed in with a password only is a customer everywhere and admin routes answer
// MFA_REQUIRED; after a TOTP code (an aal2 token) the same account is an admin again.
import request from 'supertest';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createTestUser,
  deleteTestUser,
  oldestStoreId,
  signInAgain,
  signInWithSecondFactor,
  type TestUser,
} from '../setup/helpers';

let app: Express;
let admin: TestUser;
let customer: TestUser;
let aal2 = '';
/** The admin signed in with a password only, after enrolling: Supabase ends older sessions when a factor is added. */
let aal1 = '';
const before = process.env.ADMIN_MFA_REQUIRED;

beforeAll(async () => {
  vi.resetModules();
  process.env.ADMIN_MFA_REQUIRED = 'true';
  const { createApp } = await import('../../src/app.js');
  app = createApp();
  [admin, customer] = await Promise.all([createTestUser('ADMIN'), createTestUser()]);
  aal2 = (await signInWithSecondFactor(admin)).token;
  aal1 = (await signInAgain(admin)).token;
}, 60_000);

afterAll(async () => {
  process.env.ADMIN_MFA_REQUIRED = before;
  vi.resetModules();
  await Promise.all([deleteTestUser(admin), deleteTestUser(customer)]);
});

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('an admin without the second factor', () => {
  it.each([
    ['GET /api/admin/settings', (t: string) => request(app).get('/api/admin/settings').set(as(t))],
    ['GET /api/admin/brands', (t: string) => request(app).get('/api/admin/brands').set(as(t))],
    [
      'POST /api/admin/brands',
      (t: string) => request(app).post('/api/admin/brands').set(as(t)).send({ name: 'Nope' }),
    ],
    ['GET /api/admin/audit', (t: string) => request(app).get('/api/admin/audit').set(as(t))],
  ])('%s is 403 MFA_REQUIRED', async (_label, send) => {
    const res = await send(aal1);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MFA_REQUIRED');
  });

  it("holds no admin standing at a store either: reading a store's audit as support is refused like a customer's", async () => {
    const storeId = await oldestStoreId();
    const res = await request(app).get(`/api/stores/${storeId}/audit`).set(as(aal1));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    const asAdmin = await request(app).get(`/api/stores/${storeId}/audit`).set(as(aal2));
    expect(asAdmin.status).toBe(200);
  });

  it('still learns it is an admin from /auth/me, so the app can ask for the code', async () => {
    const res = await request(app).get('/api/auth/me').set(as(aal1));
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('ADMIN');
  });
});

describe('the same admin after a TOTP code (aal2)', () => {
  it('reaches the admin routes', async () => {
    expect((await request(app).get('/api/admin/settings').set(as(aal2))).status).toBe(200);
    expect((await request(app).get('/api/admin/brands').set(as(aal2))).status).toBe(200);
  });
});

describe('everyone else', () => {
  it('a customer is still 403 FORBIDDEN on admin routes, not asked for a code', async () => {
    const res = await request(app).get('/api/admin/settings').set(as(customer.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
