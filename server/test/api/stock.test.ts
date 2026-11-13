// Local only: stock by hand (P3.4, P3.5). Who may change it (staff only while the store lets them), the bounds, the
// trail each change leaves (a movement and one menu.changed; none for a change that changes nothing), and the race:
// adjustments and orders at once never take stock below zero, and every unit is accounted for.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/schemas/limits';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createBrandOwner,
  createStoreMember,
  createTestUser,
  deleteTestStores,
  localSql,
  testAuthMatrix,
  testStoreIsolation,
  type TestUser,
} from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
const brandIds: string[] = [];
const storeIds: string[] = [];
let storeId = '';
let templateId = '';
let itemId = '';
let archivedId = '';
let manager: TestUser;
let staff: TestUser;
let owner: TestUser;
const customers: TestUser[] = [];
const users: TestUser[] = [];

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
const patchStock = (body: object, user = manager, item = itemId, store = storeId) =>
  api().patch(`/api/stores/${store}/menu-items/${item}/stock`).set(auth(user)).send(body);
const movementsOf = (user = manager, query = '') =>
  api().get(`/api/stores/${storeId}/stock-movements${query}`).set(auth(user));
const setStaffStock = (on: boolean) =>
  api().patch(`/api/stores/${storeId}/settings`).set(auth(manager)).send({ staffCanEditStock: on });

const makeItem = async (store: string, name = 'Stock item') =>
  (
    await supabaseAdmin
      .from('menu_items')
      .insert({
        store_id: store,
        name,
        description: '',
        category: 'Test',
        price_paise: 1000,
        stock_quantity: 10,
      })
      .select('id')
      .single()
      .throwOnError()
  ).data.id;
const stockNow = async (id = itemId) =>
  (
    await supabaseAdmin
      .from('menu_items')
      .select('stock_quantity')
      .eq('id', id)
      .single()
      .throwOnError()
  ).data.stock_quantity;
const writeStock = (quantity: number | null) =>
  supabaseAdmin
    .from('menu_items')
    .update({ stock_quantity: quantity })
    .eq('id', itemId)
    .throwOnError();
const movements = async () =>
  (
    await supabaseAdmin
      .from('stock_movements')
      .select('id, delta, resulting_quantity, reason, actor_id')
      .eq('menu_item_id', itemId)
      .order('id')
      .throwOnError()
  ).data;
const menuEvents = async () =>
  (
    await supabaseAdmin
      .from('domain_events')
      .select('payload, actor, request_id')
      .eq('store_id', storeId)
      .eq('type', 'menu.changed')
      .order('occurred_at')
      .throwOnError()
  ).data;
const publicStock = async () => {
  const res = await api().get(`/api/stores/${storeId}/menu`);
  const items = res.body.categories.flatMap(
    (category: { items: { id: string; stockQuantity: number | null }[] }) => category.items,
  ) as { id: string; stockQuantity: number | null }[];
  return items.find((row) => row.id === itemId)?.stockQuantity;
};
const placeOrder = (customer: TestUser) =>
  api()
    .post('/api/orders')
    .set(auth(customer))
    .send({ storeId, items: [{ menuItemId: itemId, quantity: 1 }] });

beforeAll(async () => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'Stock', slug: `stock-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandIds.push(brand.id);
  const { data: store } = await supabaseAdmin
    .from('stores')
    .insert({
      name: `Stock ${tag}`,
      slug: `store-stock-${tag}`,
      brand_id: brand.id,
      status: 'ACTIVE',
      is_open: true,
      tagline: 'Test',
      description: 'A store for stock.test.ts',
    })
    .select('id')
    .single()
    .throwOnError();
  storeId = store.id;
  storeIds.push(storeId);
  itemId = await makeItem(storeId, 'Samosa');
  archivedId = await makeItem(storeId, 'Old samosa');
  await supabaseAdmin
    .from('menu_items')
    .update({ archived_at: new Date().toISOString(), is_available: false })
    .eq('id', archivedId)
    .throwOnError();
  const { data: template } = await supabaseAdmin
    .rpc('ensure_brand_template', { p_brand_id: brand.id })
    .throwOnError();
  templateId = template;
  storeIds.push(templateId);
  manager = await createStoreMember(storeId, 'MANAGER');
  staff = await createStoreMember(storeId, 'STAFF');
  owner = await createBrandOwner(brand.id);
  for (let i = 0; i < 5; i++) customers.push(await createTestUser());
  users.push(manager, staff, owner, ...customers);
}, 60_000);

afterAll(async () => {
  await supabaseAdmin.from('domain_events').delete().eq('store_id', templateId);
  await deleteTestStores(storeIds, brandIds, users);
});

testAuthMatrix('PATCH /api/stores/:storeId/menu-items/:itemId/stock', (http) =>
  http.patch(`/api/stores/${storeId}/menu-items/${randomUUID()}/stock`).send({ set: 1 }),
);
testAuthMatrix('GET /api/stores/:storeId/stock-movements', (http) =>
  http.get(`/api/stores/${storeId}/stock-movements`),
);
testStoreIsolation(
  'PATCH /api/stores/:storeId/menu-items/:itemId/stock',
  (http, store, item) =>
    http.patch(`/api/stores/${store}/menu-items/${item}/stock`).send({ set: 3 }),
  makeItem,
);
testStoreIsolation('GET /api/stores/:storeId/stock-movements', (http, store) =>
  http.get(`/api/stores/${store}/stock-movements`),
);

describe('who changes stock', () => {
  beforeEach(() => writeStock(10));
  afterAll(() => setStaffStock(true));

  it('staff may while the store lets them (the default)', async () => {
    expect((await patchStock({ set: 9 }, staff)).status).toBe(200);
    expect((await movementsOf(staff)).status).toBe(200);
  });

  it('staff may not where the store turned it off (403), and nothing changes', async () => {
    const res = await setStaffStock(false);
    expect(res.status).toBe(200);
    expect(res.body.settings.staffCanEditStock).toBe(false);
    const refused = await patchStock({ set: 1 }, staff);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('FORBIDDEN');
    expect((await movementsOf(staff)).status).toBe(403);
    expect(await stockNow()).toBe(10);
    // Managers and the owner are not affected by the setting.
    expect((await patchStock({ set: 8 }, manager)).status).toBe(200);
    expect((await patchStock({ set: 7 }, owner)).status).toBe(200);
  });

  it('turning it back on lets staff in again, and the setting change is audited', async () => {
    await setStaffStock(false);
    const res = await setStaffStock(true);
    expect((await patchStock({ set: 6 }, staff)).status).toBe(200);
    const { data } = await supabaseAdmin
      .from('audit_log')
      .select('changes')
      .eq('store_id', storeId)
      .eq('action', 'store_settings.changed')
      .eq('request_id', String(res.headers['x-request-id']))
      .throwOnError();
    expect(data[0]?.changes).toEqual({ staff_can_edit_stock: [false, true] });
  });

  it('staff may not change the setting themselves (403)', async () => {
    const res = await api()
      .patch(`/api/stores/${storeId}/settings`)
      .set(auth(staff))
      .send({ staffCanEditStock: true });
    expect(res.status).toBe(403);
  });

  it('a brand template has no stock (404)', async () => {
    const templateItem = await makeItem(templateId, 'Template item');
    const res = await patchStock({ set: 1 }, owner, templateItem, templateId);
    expect(res.status).toBe(404);
  });
});

describe('the bounds', () => {
  const max = LIMITS.menuItem.stockMax;
  it.each([
    ['nothing to change', {}],
    ['both set and adjust', { set: 1, adjust: 1 }],
    ['set below zero', { set: -1 }],
    [`set above ${max}`, { set: max + 1 }],
    ['a fractional set', { set: 1.5 }],
    ['an adjustment of 0', { adjust: 0 }],
    [`an adjustment beyond ${max}`, { adjust: -(max + 1) }],
    ['untracked: false', { untracked: false }],
    ['WASTE on a set', { set: 1, reason: 'WASTE' }],
    ['WASTE that adds stock', { adjust: 2, reason: 'WASTE' }],
    ['MANUAL_SET on an adjustment', { adjust: -1, reason: 'MANUAL_SET' }],
    ['an unknown reason', { set: 1, reason: 'SALE' }],
    ['an unknown field', { set: 1, price: 1 }],
  ])('refuses %s (400)', async (_label, body) => {
    const res = await patchStock(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('an item id that is not a UUID, an unknown one or an archived one is 404', async () => {
    for (const id of ['nope', randomUUID(), archivedId]) {
      const res = await patchStock({ set: 1 }, manager, id);
      expect(res.status).toBe(404);
    }
  });

  it.each([
    ['not a UUID', '?itemId=nope'],
    ['an unknown filter', '?store=x'],
  ])('the movements list refuses %s (400)', async (_label, query) => {
    expect((await movementsOf(manager, query)).status).toBe(400);
  });
});

describe('each change and its trail', () => {
  it('"set to N" starts tracking, writes the movement and one event, and reaches the cached menu', async () => {
    await writeStock(null);
    await publicStock(); // warms the menu cache: the change must drop it
    const before = { moves: (await movements()).length, events: (await menuEvents()).length };
    const res = await patchStock({ set: 8 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ stockQuantity: 8 });
    expect(await publicStock()).toBe(8);
    const moves = (await movements()).slice(before.moves);
    expect(moves).toEqual([
      expect.objectContaining({
        delta: null,
        resulting_quantity: 8,
        reason: 'MANUAL_SET',
        actor_id: manager.id,
      }),
    ]);
    const events = (await menuEvents()).slice(before.events);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({ itemIds: [itemId] });
    expect(events[0]?.actor).toMatchObject({ type: 'USER', id: manager.id });
    expect(events[0]?.request_id).toBe(res.headers['x-request-id']);
  });

  it('setting the same number again writes nothing', async () => {
    const before = { moves: (await movements()).length, events: (await menuEvents()).length };
    expect((await patchStock({ set: 8 })).body).toEqual({ stockQuantity: 8 });
    expect(await movements()).toHaveLength(before.moves);
    expect(await menuEvents()).toHaveLength(before.events);
  });

  it('an adjustment and a waste record their deltas and reasons', async () => {
    expect((await patchStock({ adjust: -3 })).body).toEqual({ stockQuantity: 5 });
    expect((await patchStock({ adjust: -1, reason: 'WASTE' }, staff)).body).toEqual({
      stockQuantity: 4,
    });
    expect((await patchStock({ adjust: 6 })).body).toEqual({ stockQuantity: 10 });
    expect((await movements()).slice(-3)).toEqual([
      expect.objectContaining({ delta: -3, resulting_quantity: 5, reason: 'MANUAL_ADJUST' }),
      expect.objectContaining({
        delta: -1,
        resulting_quantity: 4,
        reason: 'WASTE',
        actor_id: staff.id,
      }),
      expect.objectContaining({ delta: 6, resulting_quantity: 10, reason: 'MANUAL_ADJUST' }),
    ]);
  });

  it('an adjustment below zero is INSUFFICIENT_STOCK and changes nothing', async () => {
    const before = (await movements()).length;
    const res = await patchStock({ adjust: -11 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: { menuItemId: itemId, name: 'Samosa', available: 10 },
    });
    expect(await stockNow()).toBe(10);
    expect(await movements()).toHaveLength(before);
  });

  it('untracked and back: no adjustment while untracked, then counting starts again', async () => {
    expect((await patchStock({ untracked: true })).body).toEqual({ stockQuantity: null });
    expect(await publicStock()).toBeNull();
    const res = await patchStock({ adjust: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { field: 'adjust' },
    });
    expect((await patchStock({ set: 3 })).body).toEqual({ stockQuantity: 3 });
    expect((await movements()).slice(-2)).toEqual([
      expect.objectContaining({ delta: null, resulting_quantity: null, reason: 'MANUAL_SET' }),
      expect.objectContaining({ delta: null, resulting_quantity: 3, reason: 'MANUAL_SET' }),
    ]);
  });

  it('an adjustment above the most a set allows is refused and changes nothing', async () => {
    const max = LIMITS.menuItem.stockMax;
    await writeStock(max);
    const res = await patchStock({ adjust: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { field: 'adjust' },
    });
    expect(await stockNow()).toBe(max);
    await writeStock(3);
  });

  it('a movement is timestamped when it is written, not when its transaction began (it may wait on the row lock)', () => {
    const [column] = localSql<{ column_default: string }>(
      "select column_default from information_schema.columns where table_name = 'stock_movements' and column_name = 'created_at'",
    );
    expect(column?.column_default).toBe('clock_timestamp()');
  });

  it('the movements list is newest first, filters by item and names who made each', async () => {
    const other = await makeItem(storeId, 'Vada');
    await patchStock({ set: 4 }, manager, other);
    const all = await movementsOf();
    expect(all.status).toBe(200);
    expect(all.body.movements[0]).toMatchObject({
      menuItemId: other,
      delta: -6,
      resultingQuantity: 4,
      reason: 'MANUAL_SET',
      actor: { id: manager.id, name: expect.any(String) },
      createdAt: expect.any(String),
    });
    const ids = all.body.movements.map((move: { id: number }) => move.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    const mine = await movementsOf(manager, `?itemId=${itemId}`);
    expect(mine.body.movements.length).toBeGreaterThan(0);
    expect(
      mine.body.movements.every((move: { menuItemId: string }) => move.menuItemId === itemId),
    ).toBe(true);
  });
});

describe('the race', () => {
  it('ten "adjust -1" and five orders at once on stock 8 never go below zero, and every unit is accounted for', async () => {
    await writeStock(8);
    const before = (await movements()).length;
    const results = await Promise.all([
      ...Array.from({ length: 10 }, (_, i) => patchStock({ adjust: -1 }, i % 2 ? staff : manager)),
      ...customers.map((customer) => placeOrder(customer)),
    ]);
    const adjusted = results.slice(0, 10);
    const ordered = results.slice(10);
    for (const res of adjusted)
      expect(res.status === 200 || res.body.error?.code === 'INSUFFICIENT_STOCK').toBe(true);
    for (const res of ordered)
      expect(res.status === 201 || res.body.error?.code === 'INSUFFICIENT_STOCK').toBe(true);

    const final = await stockNow();
    expect(final).toBe(0);
    const moves = (await movements()).slice(before);
    expect(moves).toHaveLength(adjusted.filter((res) => res.status === 200).length);
    const removedByHand = -moves.reduce((sum, move) => sum + (move.delta ?? 0), 0);
    const orderIds = ordered.filter((res) => res.status === 201).map((res) => res.body.order.id);
    const { data: lines } = await supabaseAdmin
      .from('order_items')
      .select('reserved_quantity')
      .in('order_id', orderIds.length ? orderIds : [randomUUID()])
      .throwOnError();
    const reserved = lines.reduce((sum, line) => sum + line.reserved_quantity, 0);
    expect(removedByHand + reserved).toBe(8);
  });

  it('"set to N" while orders are placed: the set lands whole and stock never goes below zero', async () => {
    await writeStock(1);
    const [set, ...ordered] = await Promise.all([
      patchStock({ set: 5 }),
      ...customers.slice(0, 3).map((customer) => placeOrder(customer)),
    ]);
    expect(set?.status).toBe(200);
    const placed = ordered.filter((res) => res.status === 201).length;
    const final = await stockNow();
    expect(final).not.toBeNull();
    // Orders before the set took from the old stock (at most 1); the rest from the 5 the set made available.
    expect(final).toBeGreaterThanOrEqual(5 - placed);
    expect(final).toBeLessThanOrEqual(5);
    const last = (await movements()).at(-1);
    expect(last).toMatchObject({ resulting_quantity: 5, reason: 'MANUAL_SET' });
    // From 1, or from 0 when an order took the last one first.
    expect([4, 5]).toContain(last?.delta);
  });
});
