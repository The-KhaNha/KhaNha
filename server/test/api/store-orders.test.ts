// Local only: the store-scoped order routes (P2.3) on their own brand and stores, the tenant matrix on each, and the
// old routes scoped to the caller's stores (the cross-store read P2 PR 04 closed).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_ITEM_LINES_HARD } from '../../src/schemas/order.schema';
import type { OrderStatus } from '../../src/types/enums';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createBrandOwner,
  createStoreMember,
  createTestUser,
  deleteTestStores,
  oldestStoreId,
  testStoreIsolation,
  type TestUser,
} from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
const store = { x: '', y: '', draft: '' };
let brandId = '';
const users: TestUser[] = [];
let customer: TestUser;
let staffX: TestUser;
let managerX: TestUser;
let staffBoth: TestUser;
let legacyStaff: TestUser;
let owner: TestUser;

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });

/** An order at `storeId` in `status`, written directly: these suites test who may see and move it, not placing it. */
async function insertOrder(storeId: string, status: OrderStatus = 'PLACED'): Promise<string> {
  const { data } = await supabaseAdmin
    .from('orders')
    .insert({
      user_id: customer.id,
      store_id: storeId,
      store_name: 'Store orders test',
      customer_name: 'Test',
      total_paise: 10_000,
      estimated_ready_at: new Date().toISOString(),
      status,
    })
    .select('id')
    .single()
    .throwOnError();
  return data.id;
}

const listIds = async (user: TestUser, storeId: string, query = '') => {
  const res = await api().get(`/api/stores/${storeId}/orders${query}`).set(auth(user));
  expect(res.status).toBe(200);
  return (res.body.orders as { id: string }[]).map((order) => order.id);
};

beforeAll(async () => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'Store orders', slug: `store-orders-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandId = brand.id;
  const row = (key: keyof typeof store) => ({
    name: `Store orders ${key}`,
    slug: `store-orders-${key}-${tag}`,
    brand_id: brandId,
    status: key === 'draft' ? ('DRAFT' as const) : ('ACTIVE' as const),
    tagline: 'Test',
    description: 'A store for store-orders.test.ts',
  });
  const { data: stores } = await supabaseAdmin
    .from('stores')
    .insert([row('x'), row('y'), row('draft')])
    .select('id, slug')
    .throwOnError();
  for (const key of ['x', 'y', 'draft'] as const)
    store[key] = stores.find((s) => s.slug === `store-orders-${key}-${tag}`)?.id ?? '';
  customer = await createTestUser();
  staffX = await createStoreMember(store.x, 'STAFF');
  managerX = await createStoreMember(store.x, 'MANAGER');
  staffBoth = await createStoreMember(store.x, 'STAFF');
  await supabaseAdmin
    .from('store_memberships')
    .insert({ user_id: staffBoth.id, store_id: store.y, role: 'STAFF' })
    .throwOnError();
  legacyStaff = await createTestUser('STAFF');
  owner = await createBrandOwner(brandId);
  users.push(customer, staffX, managerX, staffBoth, legacyStaff, owner);
}, 60_000);

afterAll(() => deleteTestStores(Object.values(store), [brandId], users));

describe('GET /api/stores/:storeId/orders', () => {
  it("lists only that store's orders, and a member of two stores sees each separately", async () => {
    const [atX, atY] = await Promise.all([insertOrder(store.x), insertOrder(store.y)]);
    const x = await listIds(staffX, store.x);
    expect(x).toContain(atX);
    expect(x).not.toContain(atY);
    const both = { x: await listIds(staffBoth, store.x), y: await listIds(staffBoth, store.y) };
    expect(both.x).toContain(atX);
    expect(both.x).not.toContain(atY);
    expect(both.y).toContain(atY);
    expect(both.y).not.toContain(atX);
  });

  it('narrows by ?status=, and refuses an unknown status with 400', async () => {
    const ready = await insertOrder(store.x, 'READY');
    const placed = await insertOrder(store.x);
    const readyIds = await listIds(owner, store.x, '?status=READY');
    expect(readyIds).toContain(ready);
    expect(readyIds).not.toContain(placed);
    const bad = await api().get(`/api/stores/${store.x}/orders?status=LOST`).set(auth(staffX));
    expect(bad.status).toBe(400);
  });

  it("carries the store's live slug on each order", async () => {
    const id = await insertOrder(store.x);
    const res = await api().get(`/api/stores/${store.x}/orders`).set(auth(staffX));
    const order = (res.body.orders as { id: string; store: object }[]).find((o) => o.id === id);
    expect(order?.store).toEqual({
      id: store.x,
      name: 'Store orders test',
      slug: `store-orders-x-${tag}`,
    });
  });
});

describe('PATCH /api/stores/:storeId/orders/:orderId/status', () => {
  const ALL: OrderStatus[] = ['PLACED', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED'];
  const NEXT: Record<OrderStatus, OrderStatus[]> = {
    PLACED: ['PREPARING', 'CANCELLED'],
    PREPARING: ['READY', 'CANCELLED'],
    READY: ['COLLECTED'],
    COLLECTED: [],
    CANCELLED: [],
  };
  // A repeat of a transition that already happened is 200 unchanged; PLACED → PLACED is not a transition.
  const ok = (from: OrderStatus, to: OrderStatus) =>
    NEXT[from].includes(to) || (from === to && from !== 'PLACED');
  const pairs = ALL.flatMap((from) => ALL.map((to): [OrderStatus, OrderStatus] => [from, to]));

  it.each(pairs)('%s → %s', async (from, to) => {
    const id = await insertOrder(store.x, from);
    const res = await api()
      .patch(`/api/stores/${store.x}/orders/${id}/status`)
      .set(auth(staffX))
      .send({ status: to });
    if (ok(from, to)) {
      expect(res.status).toBe(200);
      expect(res.body.order.status).toBe(to);
    } else {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    }
  });

  it("another store's order through this store's route is 404, even for a member of both", async () => {
    const atY = await insertOrder(store.y);
    const res = await api()
      .patch(`/api/stores/${store.x}/orders/${atY}/status`)
      .set(auth(staffBoth))
      .send({ status: 'PREPARING' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it("records the caller's store role as the audit row's actor_role", async () => {
    const id = await insertOrder(store.x);
    const res = await api()
      .patch(`/api/stores/${store.x}/orders/${id}/status`)
      .set(auth(managerX))
      .send({ status: 'PREPARING' });
    expect(res.status).toBe(200);
    const { data: rows } = await supabaseAdmin
      .from('audit_log')
      .select('actor_id, actor_role, store_id')
      .eq('entity_id', id)
      .eq('action', 'order.status_changed')
      .throwOnError();
    expect(rows).toEqual([{ actor_id: managerX.id, actor_role: 'MANAGER', store_id: store.x }]);
  });
});

testStoreIsolation('GET /api/stores/:storeId/orders', (http, storeId) =>
  http.get(`/api/stores/${storeId}/orders`),
);
testStoreIsolation(
  'PATCH /api/stores/:storeId/orders/:orderId/status',
  (http, storeId, orderId) =>
    http.patch(`/api/stores/${storeId}/orders/${orderId}/status`).send({ status: 'PREPARING' }),
  (storeId) => insertOrder(storeId),
);

describe('an order of a store the caller does not work at', () => {
  it("another store's order is 404 on GET /api/orders/:id and 403 on the store status route", async () => {
    const elsewhere = await insertOrder(store.y);
    const read = await api().get(`/api/orders/${elsewhere}`).set(auth(legacyStaff));
    expect(read.status).toBe(404);
    const move = await api()
      .patch(`/api/stores/${store.y}/orders/${elsewhere}/status`)
      .set(auth(legacyStaff))
      .send({ status: 'PREPARING' });
    expect(move.status).toBe(403);
    const { data } = await supabaseAdmin
      .from('orders')
      .select('status')
      .eq('id', elsewhere)
      .single()
      .throwOnError();
    expect(data.status).toBe('PLACED');
  });

  it("the brand's owner and the store's staff may read its order; the customer who placed it too", async () => {
    const id = await insertOrder(store.x);
    for (const user of [owner, staffX, customer]) {
      const res = await api().get(`/api/orders/${id}`).set(auth(user));
      expect(res.status).toBe(200);
    }
    const stranger = await api().get(`/api/orders/${id}`).set(auth(legacyStaff));
    expect(stranger.status).toBe(404);
  });
});

describe('POST /api/orders with a storeId', () => {
  let item: { id: string; price_paise: number };
  beforeAll(async () => {
    const { data } = await supabaseAdmin
      .from('menu_items')
      .select('id, price_paise')
      .eq('store_id', await oldestStoreId())
      .eq('is_available', true)
      .is('stock_quantity', null)
      .order('id')
      .limit(1)
      .single()
      .throwOnError();
    item = data;
  });
  const place = (storeId: unknown) =>
    api()
      .post('/api/orders')
      .set(auth(customer))
      .send({ storeId, items: [{ menuItemId: item.id, quantity: 1 }] });

  it("orders at the named store, with that store's slug", async () => {
    const oldest = await oldestStoreId();
    const res = await place(oldest);
    expect(res.status).toBe(201);
    expect(res.body.order.store.id).toBe(oldest);
    expect(res.body.order.store.slug).toEqual(expect.any(String));
  });

  it("another store's item is not on this store's menu: 400 ITEM_NOT_FOUND, never a cross-store order", async () => {
    const res = await place(store.x);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ITEM_NOT_FOUND');
  });

  it.each([
    ['a DRAFT store', () => store.draft],
    ['an unknown store', () => randomUUID()],
  ])('%s → 404', async (_label, storeId) => {
    const res = await place(storeId());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('the same idempotencyKey at another store is 409 IDEMPOTENCY_KEY_REUSED, never a replay', async () => {
    const idempotencyKey = randomUUID();
    const send = (storeId: string) =>
      api()
        .post('/api/orders')
        .set(auth(customer))
        .send({ storeId, idempotencyKey, items: [{ menuItemId: item.id, quantity: 1 }] });
    expect((await send(await oldestStoreId())).status).toBe(201);
    const again = await send(store.x);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('a DRAFT store answers like an unknown one whatever else is wrong (too many lines, a reused key)', async () => {
    // One line over the site setting (the schema's own cap is higher), so only createOrder can refuse it.
    const { data: settings } = await supabaseAdmin
      .from('site_settings')
      .select('max_lines_per_order')
      .single()
      .throwOnError();
    expect(settings.max_lines_per_order + 1).toBeLessThanOrEqual(MAX_ITEM_LINES_HARD);
    const lines = Array.from({ length: settings.max_lines_per_order + 1 }, () => ({
      menuItemId: randomUUID(),
      quantity: 1,
    }));
    const idempotencyKey = randomUUID();
    const reuse = (storeId: string) =>
      api()
        .post('/api/orders')
        .set(auth(customer))
        .send({ storeId, idempotencyKey, items: [{ menuItemId: item.id, quantity: 1 }] });
    expect((await reuse(await oldestStoreId())).status).toBe(201);
    const answer = async (storeId: string) => {
      const many = await api()
        .post('/api/orders')
        .set(auth(customer))
        .send({ storeId, items: lines });
      const key = await reuse(storeId);
      for (const res of [many, key]) {
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
      return [many.status, many.body, key.status, key.body];
    };
    expect(await answer(store.draft)).toEqual(await answer(randomUUID()));
  });

  it('a storeId that is not a uuid → 400 VALIDATION_ERROR', async () => {
    const res = await place('campus-cafe');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
