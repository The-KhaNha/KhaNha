// Local only: pausing a store (P2.5). Who may pause, what a pause refuses (at the API and inside place_order, the
// race included), the events and audit rows it leaves, and place_order's other store checks re-created with it.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createStoreMember,
  createTestUser,
  deleteTestStores,
  testAuthMatrix,
  testStoreIsolation,
  type TestUser,
} from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
const store = { a: '', b: '' };
let itemA = '';
let itemB = '';
let brandId = '';
let staff: TestUser;
let customer: TestUser;
let admin: TestUser;
const users: TestUser[] = [];

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
const pause = (body: object, user: TestUser = staff, id = store.a) =>
  api().post(`/api/stores/${id}/pause`).set(auth(user)).send(body);
const resume = (user: TestUser = staff, id = store.a) =>
  api().post(`/api/stores/${id}/resume`).set(auth(user)).send({});
const order = (menuItemId = itemA) =>
  api()
    .post('/api/orders')
    .set(auth(customer))
    .send({ storeId: store.a, items: [{ menuItemId, quantity: 1 }] });
const events = async (type: string) =>
  (
    await supabaseAdmin
      .from('domain_events')
      .select('id')
      .eq('store_id', store.a)
      .eq('type', type)
      .throwOnError()
  ).data;
const stockOf = async (id: string) =>
  (
    await supabaseAdmin
      .from('menu_items')
      .select('stock_quantity')
      .eq('id', id)
      .single()
      .throwOnError()
  ).data.stock_quantity ?? 0;
const placeDirect = (storeId: string, menuItemId: string) =>
  supabaseAdmin.rpc('place_order', {
    p_user_id: customer.id,
    p_store_id: storeId,
    p_customer_name: 'Pause Test',
    p_payment_status: 'PAID',
    p_lines: [{ menu_item_id: menuItemId, name: 'x', quantity: 1, unit_price_paise: 1000 }],
  });

beforeAll(async () => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'Pause', slug: `pause-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandId = brand.id;
  const { data: stores } = await supabaseAdmin
    .from('stores')
    .insert(
      (['a', 'b'] as const).map((key) => ({
        name: `Pause ${key}`,
        slug: `pause-${key}-${tag}`,
        brand_id: brandId,
        status: 'ACTIVE' as const,
        is_open: true,
        timezone: 'UTC',
        tagline: 'Test',
        description: 'A store for store-pause.test.ts',
      })),
    )
    .select('id, slug')
    .throwOnError();
  for (const key of ['a', 'b'] as const)
    store[key] = stores.find((s) => s.slug === `pause-${key}-${tag}`)?.id ?? '';
  const item = async (storeId: string) =>
    (
      await supabaseAdmin
        .from('menu_items')
        .insert({
          store_id: storeId,
          name: 'Bun',
          description: 'Test',
          category: 'Test',
          image_url: '/images/x.jpg',
          price_paise: 1000,
          stock_quantity: 1000,
        })
        .select('id')
        .single()
        .throwOnError()
    ).data.id;
  itemA = await item(store.a);
  itemB = await item(store.b);
  staff = await createStoreMember(store.a, 'STAFF');
  customer = await createTestUser();
  admin = await createTestUser('ADMIN');
  users.push(staff, customer, admin);
}, 60_000);

afterAll(async () => {
  await supabaseAdmin.from('orders').delete().in('store_id', Object.values(store));
  await supabaseAdmin.from('menu_items').delete().in('store_id', Object.values(store));
  await deleteTestStores(Object.values(store), [brandId], users);
});

const sample = randomUUID();
testAuthMatrix('POST /api/stores/:storeId/pause', (http) =>
  http.post(`/api/stores/${sample}/pause`).send({}),
);
testAuthMatrix('POST /api/stores/:storeId/resume', (http) =>
  http.post(`/api/stores/${sample}/resume`).send({}),
);
testStoreIsolation('POST /api/stores/:storeId/pause', (http, id) =>
  http.post(`/api/stores/${id}/pause`).send({ minutes: 5 }),
);
testStoreIsolation('POST /api/stores/:storeId/resume', (http, id) =>
  http.post(`/api/stores/${id}/resume`).send({}),
);

describe('pause and resume', () => {
  it('a pause refuses orders with 409 STORE_PAUSED and when it ends; a resume lets them through', async () => {
    const paused = await pause({ minutes: 30, reason: 'Restocking' });
    expect(paused.status).toBe(200);
    expect(paused.body.store).toMatchObject({ openState: 'PAUSED', isOpen: false });
    const refused = await order();
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('STORE_PAUSED');
    expect(refused.body.error.message).toMatch(/^Pause a has paused new orders\. Back at /);
    expect(Date.parse(refused.body.error.details.pausedUntil)).toBeGreaterThan(Date.now());
    expect((await api().get(`/api/stores/pause-a-${tag}`)).body.store.openState).toBe('PAUSED');

    expect((await resume()).body.store.openState).toBe('OPEN');
    expect((await order()).status).toBe(201);
  });

  it('a repeated pause is 200 and leaves one event; the audit row names the actor', async () => {
    const before = (await events('store.paused')).length;
    expect((await pause({}, staff)).status).toBe(200);
    expect((await pause({}, staff)).status).toBe(200);
    expect((await events('store.paused')).length).toBe(before + 1);
    const { data: audit } = await supabaseAdmin
      .from('audit_log')
      .select('actor_id, changes')
      .eq('entity_id', store.a)
      .eq('action', 'store.changed')
      .order('id', { ascending: false })
      .limit(1)
      .single()
      .throwOnError();
    expect(audit.actor_id).toBe(staff.id);
    expect(audit.changes).toMatchObject({ accepting_orders: [true, false] });
    // Paused until resumed: no end in the answer.
    expect((await order()).body.error.details).toEqual({ kind: 'storePaused', pausedUntil: null });
    const resumedBefore = (await events('store.resumed')).length;
    await resume();
    await resume();
    expect((await events('store.resumed')).length).toBe(resumedBefore + 1);
  });

  it('a pause whose end has passed no longer refuses', async () => {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await supabaseAdmin
      .rpc('pause_store', {
        p_store_id: store.a,
        p_until: new Date(hourAgo.getTime() + 60 * 1000).toISOString(),
        p_now: hourAgo.toISOString(),
      })
      .throwOnError();
    expect((await order()).status).toBe(201);
    await resume();
  });

  it('an admin may pause as support', async () => {
    expect((await pause({ minutes: 1 }, admin)).status).toBe(200);
    expect((await resume(admin)).status).toBe(200);
  });

  it.each([
    [{ minutes: 0 }],
    [{ minutes: 721 }],
    [{ minutes: 1.5 }],
    [{ minutes: 5, until: new Date(Date.now() + 60_000).toISOString() }],
    [{ until: new Date(Date.now() - 60_000).toISOString() }],
    [{ until: 'tomorrow' }],
    [{ reason: 'x'.repeat(121) }],
  ])('%j → 400', async (body) => {
    expect((await pause(body)).status).toBe(400);
  });
});

describe('place_order under the store lock', () => {
  it('a pause racing ten orders: each is placed or refused STORE_PAUSED, and stock matches the placed ones', async () => {
    const stockBefore = await stockOf(itemA);
    const results = await Promise.all([
      pause({ minutes: 10 }),
      ...Array.from({ length: 10 }, () => order()),
    ]);
    const orders = results.slice(1);
    for (const res of orders) {
      expect([201, 409]).toContain(res.status);
      if (res.status === 409) expect(res.body.error.code).toBe('STORE_PAUSED');
    }
    const placed = orders.filter((res) => res.status === 201).length;
    expect(await stockOf(itemA)).toBe(stockBefore - placed);
    await resume();
  });

  it('refuses a paused store itself, whatever the API checked (STORE_PAUSED)', async () => {
    await pause({ minutes: 10 });
    try {
      const { error } = await placeDirect(store.a, itemA);
      expect(error?.message).toBe('STORE_PAUSED');
    } finally {
      await resume();
    }
  });

  it("refuses another store's item, and leaves its stock alone", async () => {
    const before = await stockOf(itemB);
    const { error } = await placeDirect(store.a, itemB);
    expect(error?.message).toBe('INSUFFICIENT_STOCK');
    expect(await stockOf(itemB)).toBe(before);
  });

  it('refuses a store that stopped trading after the API checked it (NOT_FOUND)', async () => {
    await supabaseAdmin
      .from('stores')
      .update({ status: 'SUSPENDED' })
      .eq('id', store.a)
      .throwOnError();
    try {
      const { error } = await placeDirect(store.a, itemA);
      expect(error?.message).toBe('NOT_FOUND');
    } finally {
      await supabaseAdmin
        .from('stores')
        .update({ status: 'ACTIVE' })
        .eq('id', store.a)
        .throwOnError();
    }
  });
});
