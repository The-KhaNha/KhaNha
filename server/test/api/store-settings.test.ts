// Local only: a store's own limits (P2.3): bounds equal to the CHECK constraints, who may edit, what an edit changes
// (the menu's rules at once, the order line cap, the staff list length) and that the public store never shows them.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STORE_SETTING_BOUNDS } from '../../src/schemas/storeSettings.schema';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createStoreMember,
  createTestUser,
  deleteTestStores,
  localSql,
  testStoreIsolation,
  type TestUser,
} from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
const store = { a: '', b: '' };
const item = { a: '', b: '' };
let brandId = '';
let manager: TestUser;
let staff: TestUser;
let customer: TestUser;
const users: TestUser[] = [];

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
const patch = (storeId: string, body: object, user = manager) =>
  api().patch(`/api/stores/${storeId}/settings`).set(auth(user)).send(body);
const order = (storeId: string, menuItemId: string, quantity: number) =>
  api()
    .post('/api/orders')
    .set(auth(customer))
    .send({ storeId, items: [{ menuItemId, quantity }] });
const rulesOf = async (slug: string) =>
  (await api().get(`/api/stores/store-settings-${slug}-${tag}/menu`)).body.rules;

beforeAll(async () => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'Store settings', slug: `store-settings-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandId = brand.id;
  const { data: stores } = await supabaseAdmin
    .from('stores')
    .insert(
      (['a', 'b'] as const).map((key) => ({
        name: `Store settings ${key}`,
        slug: `store-settings-${key}-${tag}`,
        brand_id: brandId,
        status: 'ACTIVE' as const,
        is_open: true,
        tagline: 'Test',
        description: 'A store for store-settings.test.ts',
      })),
    )
    .select('id, slug')
    .throwOnError();
  for (const key of ['a', 'b'] as const) {
    store[key] = stores.find((s) => s.slug === `store-settings-${key}-${tag}`)?.id ?? '';
    const { data } = await supabaseAdmin
      .from('menu_items')
      .insert({
        store_id: store[key],
        name: `Item ${key}`,
        description: 'Test',
        category: 'Test',
        image_url: '/images/x.jpg',
        price_paise: 1000,
      })
      .select('id')
      .single()
      .throwOnError();
    item[key] = data.id;
  }
  manager = await createStoreMember(store.a, 'MANAGER');
  staff = await createStoreMember(store.a, 'STAFF');
  customer = await createTestUser();
  users.push(manager, staff, customer);
}, 60_000);

afterAll(async () => {
  await supabaseAdmin.from('orders').delete().in('store_id', Object.values(store));
  await supabaseAdmin.from('menu_items').delete().in('store_id', Object.values(store));
  await deleteTestStores(Object.values(store), [brandId], users);
});

describe('GET and PATCH /api/stores/:storeId/settings', () => {
  it('a new store starts at the defaults', async () => {
    const res = await api().get(`/api/stores/${store.a}/settings`).set(auth(manager));
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({
      maxQuantityPerItem: 10,
      lowStockThreshold: 5,
      staffOrderListLimit: 100,
      lastOrderMinutesBeforeClose: 0,
    });
  });

  it('staff cannot read or edit them (403), a manager can', async () => {
    expect((await api().get(`/api/stores/${store.a}/settings`).set(auth(staff))).status).toBe(403);
    expect((await patch(store.a, { lowStockThreshold: 3 }, staff)).status).toBe(403);
    const res = await patch(store.a, { lowStockThreshold: 3 });
    expect(res.status).toBe(200);
    expect(res.body.settings.lowStockThreshold).toBe(3);
    await patch(store.a, { lowStockThreshold: 5 });
  });

  it.each(Object.entries(STORE_SETTING_BOUNDS))('%s is held to its bounds', async (key, bounds) => {
    for (const bad of [bounds.min - 1, bounds.max + 1, 2.5, '3'])
      expect((await patch(store.a, { [key]: bad })).status).toBe(400);
    expect((await patch(store.a, { [key]: bounds.max })).status).toBe(200);
    expect((await patch(store.a, { [key]: bounds.min })).status).toBe(200);
    // The database enforces the same numbers.
    const row = localSql<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.stores'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%${key.replace(
        /[A-Z]/g,
        (c) => `_${c.toLowerCase()}`,
      )}%'`,
    )[0];
    expect(row?.def.match(/>= (\d+)/)?.[1]).toBe(String(bounds.min));
    expect(row?.def.match(/<= (\d+)/)?.[1]).toBe(String(bounds.max));
    await patch(store.a, {
      maxQuantityPerItem: 10,
      lowStockThreshold: 5,
      staffOrderListLimit: 100,
      lastOrderMinutesBeforeClose: 0,
    });
  });

  it('refuses an empty body', async () => {
    expect((await patch(store.a, {})).status).toBe(400);
  });

  it('is audited as store_settings.changed with the actor', async () => {
    await patch(store.a, { lastOrderMinutesBeforeClose: 15 });
    const { data } = await supabaseAdmin
      .from('audit_log')
      .select('actor_id, actor_role, store_id, changes')
      .eq('action', 'store_settings.changed')
      .eq('entity_id', store.a)
      .order('id', { ascending: false })
      .limit(1)
      .single()
      .throwOnError();
    expect(data.actor_id).toBe(manager.id);
    expect(data.actor_role).toBe('MANAGER');
    expect(data.store_id).toBe(store.a);
    expect(data.changes).toHaveProperty('last_order_minutes_before_close');
  });

  it('is not part of the public store', async () => {
    const res = await api().get(`/api/stores/store-settings-a-${tag}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(
      /maxQuantityPerItem|staffOrderListLimit|lastOrder/,
    );
  });
});

describe('what a store setting changes', () => {
  it("a write shows in the menu's rules at once, not after the cache expires", async () => {
    expect(await rulesOf('a')).toEqual({ maxQuantityPerItem: 10, lowStockThreshold: 5 });
    await patch(store.a, { maxQuantityPerItem: 4, lowStockThreshold: 2 });
    expect(await rulesOf('a')).toEqual({ maxQuantityPerItem: 4, lowStockThreshold: 2 });
    expect(await rulesOf('b')).toEqual({ maxQuantityPerItem: 10, lowStockThreshold: 5 });
    await patch(store.a, { maxQuantityPerItem: 10, lowStockThreshold: 5 });
  });

  it("an order over the store's cap is refused while the same order at a higher-cap store passes", async () => {
    await patch(store.a, { maxQuantityPerItem: 2 });
    const { data } = await supabaseAdmin
      .from('stores')
      .update({ max_quantity_per_item: 6 })
      .eq('id', store.b)
      .select('id')
      .throwOnError();
    expect(data).toHaveLength(1);
    const low = await order(store.a, item.a, 3);
    expect(low.status).toBe(400);
    expect(low.body.error.message).toContain('at most 2');
    expect((await order(store.b, item.b, 3)).status).toBe(201);
    expect((await order(store.a, item.a, 2)).status).toBe(201);
    await patch(store.a, { maxQuantityPerItem: 10 });
  });

  it("the staff board keeps the store's own number of finished orders", async () => {
    const rows = Array.from({ length: 4 }, () => ({
      user_id: customer.id,
      store_id: store.a,
      store_name: 'Store settings a',
      customer_name: 'Test',
      total_paise: 1000,
      estimated_ready_at: new Date().toISOString(),
      status: 'COLLECTED' as const,
    }));
    await supabaseAdmin.from('orders').insert(rows).throwOnError();
    await patch(store.a, { staffOrderListLimit: 2 });
    const list = async () =>
      (await api().get(`/api/stores/${store.a}/orders?status=COLLECTED`).set(auth(manager))).body
        .orders as unknown[];
    expect(await list()).toHaveLength(2);
    await patch(store.a, { staffOrderListLimit: 100 });
    expect((await list()).length).toBeGreaterThanOrEqual(4);
  });
});

testStoreIsolation(
  'GET /api/stores/:storeId/settings',
  (http, storeId) => http.get(`/api/stores/${storeId}/settings`),
  undefined,
  'MANAGER',
);
testStoreIsolation(
  'PATCH /api/stores/:storeId/settings',
  (http, storeId) => http.patch(`/api/stores/${storeId}/settings`).send({ lowStockThreshold: 5 }),
  undefined,
  'MANAGER',
);
