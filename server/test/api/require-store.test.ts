// Local only: requireStore's 404-or-403 rule on throwaway routes, against its own brands and stores (A, B, DRAFT D).
import { randomUUID } from 'node:crypto';
import express, { type RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Capability } from '../../src/domain/permissions';
import { requestContext, requireAuth, requireStore } from '../../src/middleware/auth';
import { errorHandler } from '../../src/middleware/errorHandler';
import { invalidate } from '../../src/utils/cache';
import { logger } from '../../src/utils/logger';
import { supabaseAdmin } from '../../src/utils/supabase';
import {
  createBrandOwner,
  createStoreMember,
  createTestUser,
  deleteTestUser,
  type TestUser,
  expectError,
} from '../setup/helpers';

const CAPABILITIES: Capability[] = ['orders.view', 'store.pause', 'team.manageManagers'];

const echo: RequestHandler = (req, res) => {
  res.json({ store: req.store, access: req.storeAccess, actor: requestContext(req).actor });
};

function app() {
  const server = express();
  server.use(pinoHttp({ logger }));
  for (const capability of CAPABILITIES)
    server.get(`/stores/:storeId/${capability}`, requireAuth, requireStore(capability), echo);
  server.use(errorHandler);
  return request(server);
}

const tag = randomUUID().slice(0, 8);
const brandIds: string[] = [];
const storeIds: Record<'a' | 'b' | 'd', string> = { a: '', b: '', d: '' };
const users: TestUser[] = [];
let staffA: TestUser;
let managerB: TestUser;
let ownerD: TestUser;
let customer: TestUser;
let admin: TestUser;

beforeAll(async () => {
  const { data: brands } = await supabaseAdmin
    .from('brands')
    .insert([
      { name: 'Chain', slug: `chain-${tag}`, status: 'ACTIVE' },
      { name: 'Draft', slug: `draft-${tag}`, status: 'DRAFT' },
    ])
    .select('id, name')
    .throwOnError();
  brandIds.push(...brands.map((brand) => brand.id));
  const brandId = (name: string) => brands.find((brand) => brand.name === name)?.id ?? '';
  const slug = (key: string) => `require-store-${key}-${tag}`;
  const store = (key: string, brand: string, status: 'ACTIVE' | 'DRAFT') => ({
    name: `Require Store ${key}`,
    slug: slug(key),
    brand_id: brandId(brand),
    status,
    tagline: 'Test',
    description: 'A store for require-store.test.ts',
  });
  const { data: stores } = await supabaseAdmin
    .from('stores')
    .insert([
      store('a', 'Chain', 'ACTIVE'),
      store('b', 'Chain', 'ACTIVE'),
      store('d', 'Draft', 'DRAFT'),
    ])
    .select('id, slug')
    .throwOnError();
  for (const key of ['a', 'b', 'd'] as const)
    storeIds[key] = stores.find((row) => row.slug === slug(key))?.id ?? '';
  staffA = await createStoreMember(storeIds.a, 'STAFF');
  managerB = await createStoreMember(storeIds.b, 'MANAGER');
  ownerD = await createBrandOwner(brandId('Draft'));
  customer = await createTestUser();
  admin = await createTestUser('ADMIN');
  users.push(staffA, managerB, ownerD, customer, admin);
}, 60_000);

afterAll(async () => {
  await Promise.all(users.map(deleteTestUser));
  await supabaseAdmin.from('stores').delete().in('id', Object.values(storeIds));
  await supabaseAdmin.from('brands').delete().in('id', brandIds);
  invalidate();
});

const as = (user: TestUser | undefined, storeId: string, capability: Capability) => {
  const call = app().get(`/stores/${storeId}/${capability}`);
  return user ? call.set('Authorization', `Bearer ${user.token}`) : call;
};

describe('requireStore', () => {
  it('a member with the capability is admitted, with the store and their capacity on the request', async () => {
    const res = await as(staffA, storeIds.a, 'orders.view').expect(200);
    expect(res.body).toMatchObject({
      store: { id: storeIds.a, status: 'ACTIVE', timezone: 'Asia/Kolkata' },
      access: 'STAFF',
      actor: { type: 'USER', id: staffA.id, role: 'CUSTOMER', storeRole: 'STAFF' },
    });
  });

  it('a member without the capability is 403', async () => {
    expectError(await as(staffA, storeIds.a, 'team.manageManagers'), 403, 'FORBIDDEN');
  });

  it('a member of another store of the same brand is 403 at this one', async () => {
    expectError(await as(managerB, storeIds.a, 'orders.view'), 403, 'FORBIDDEN');
    expectError(await as(staffA, storeIds.b, 'orders.view'), 403, 'FORBIDDEN');
  });

  // 403, not 404: an ACTIVE store is public, so its existence is no secret (only a DRAFT store hides behind 404, below).
  it('a customer is 403 at an active store and anonymous is 401', async () => {
    expectError(await as(customer, storeIds.a, 'orders.view'), 403, 'FORBIDDEN');
    expectError(await as(undefined, storeIds.a, 'orders.view'), 401, 'UNAUTHORIZED');
  });

  it('a DRAFT store is 404 to a stranger and to a member elsewhere, and open to its owner', async () => {
    expectError(await as(customer, storeIds.d, 'orders.view'), 404, 'NOT_FOUND');
    expectError(await as(staffA, storeIds.d, 'orders.view'), 404, 'NOT_FOUND');
    const res = await as(ownerD, storeIds.d, 'team.manageManagers').expect(200);
    expect(res.body.access).toBe('OWNER');
  });

  it('ADMIN may pause any store, including a DRAFT one, but may not view its orders', async () => {
    expect((await as(admin, storeIds.a, 'store.pause').expect(200)).body.access).toBe('ADMIN');
    await as(admin, storeIds.d, 'store.pause').expect(200);
    expectError(await as(admin, storeIds.a, 'orders.view'), 403, 'FORBIDDEN');
  });

  it('an unknown store id and a malformed one are 404', async () => {
    expectError(await as(staffA, randomUUID(), 'orders.view'), 404, 'NOT_FOUND');
    expectError(await as(staffA, 'not-a-uuid', 'orders.view'), 404, 'NOT_FOUND');
  });

  it('a deleted membership stops working on the next request', async () => {
    const leaver = await createStoreMember(storeIds.a, 'STAFF');
    users.push(leaver);
    await as(leaver, storeIds.a, 'orders.view').expect(200);
    await supabaseAdmin.from('store_memberships').delete().eq('user_id', leaver.id).throwOnError();
    expectError(await as(leaver, storeIds.a, 'orders.view'), 403, 'FORBIDDEN');
  });
});
