// Local only: the menu editor's quick edits (P3.4). Switching many items on or off at once and reordering the whole
// menu: who may, the bounds, that a list naming another store's item is refused whole, that two reorders at once
// leave one complete order, and the one menu.changed event (none for a repeat) each leaves.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MANAGED_ITEMS_MAX } from '../../src/schemas/limits';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createBrandOwner,
  createStoreMember,
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
let otherStoreId = '';
let templateId = '';
let manager: TestUser;
let staff: TestUser;
let owner: TestUser;
const users: TestUser[] = [];
// This store's items by name; the other store has a Juices item too.
const item: Record<string, string> = {};
let otherJuice = '';
let archived = '';

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
const base = (store = storeId) => `/api/stores/${store}/menu-items`;
const bulk = (body: object, user = manager, store = storeId) =>
  api()
    .post(`${base(store)}/bulk`)
    .set(auth(user))
    .send(body);
const reorder = (itemIds: string[], user = manager, store = storeId) =>
  api()
    .put(`${base(store)}/order`)
    .set(auth(user))
    .send({ itemIds });

const makeItem = async (store: string, name = 'Iso item', category = 'Test') =>
  (
    await supabaseAdmin
      .from('menu_items')
      .insert({ store_id: store, name, description: '', category, price_paise: 1000 })
      .select('id')
      .single()
      .throwOnError()
  ).data.id;

const rows = async (store = storeId) =>
  (
    await supabaseAdmin
      .from('menu_items')
      .select('id, is_available, sort_order, archived_at')
      .eq('store_id', store)
      .order('sort_order')
      .order('id')
      .throwOnError()
  ).data;
const liveOrder = async () =>
  (await rows()).filter((row) => row.archived_at === null).map((row) => row.id);
const menuEvents = async (store = storeId) =>
  (
    await supabaseAdmin
      .from('domain_events')
      .select('id, payload, actor, request_id')
      .eq('store_id', store)
      .eq('type', 'menu.changed')
      .order('occurred_at')
      .throwOnError()
  ).data;
const publicItems = async () => {
  const res = await api().get(`/api/stores/${storeId}/menu`);
  return res.body.categories.flatMap(
    (category: { items: { id: string; isAvailable: boolean }[] }) => category.items,
  ) as { id: string; isAvailable: boolean }[];
};
const setAll = (isAvailable: boolean) =>
  supabaseAdmin
    .from('menu_items')
    .update({ is_available: isAvailable })
    .in('store_id', [storeId, otherStoreId])
    .is('archived_at', null)
    .throwOnError();

beforeAll(async () => {
  const { data: brands } = await supabaseAdmin
    .from('brands')
    .insert(
      ['a', 'b'].map((key) => ({
        name: `Quick edits ${key}`,
        slug: `quick-${key}-${tag}`,
        status: 'ACTIVE' as const,
      })),
    )
    .select('id, slug')
    .throwOnError();
  brandIds.push(...brands.map((brand) => brand.id));
  const { data: stores } = await supabaseAdmin
    .from('stores')
    .insert(
      brands.map((brand) => ({
        name: `Quick edits ${brand.slug}`,
        slug: `store-${brand.slug}`,
        brand_id: brand.id,
        status: 'ACTIVE' as const,
        is_open: true,
        tagline: 'Test',
        description: 'A store for menu-quick-edits.test.ts',
      })),
    )
    .select('id, slug')
    .throwOnError();
  storeId = stores.find((row) => row.slug === `store-quick-a-${tag}`)?.id ?? '';
  otherStoreId = stores.find((row) => row.slug === `store-quick-b-${tag}`)?.id ?? '';
  storeIds.push(storeId, otherStoreId);
  for (const [name, category] of [
    ['Tea', 'Drinks'],
    ['Coffee', 'Drinks'],
    ['Lassi', 'Drinks'],
    ['Orange', 'Juices'],
    ['Mango', 'Juices'],
  ] as const)
    item[name] = await makeItem(storeId, name, category);
  archived = await makeItem(storeId, 'Old juice', 'Juices');
  await supabaseAdmin
    .from('menu_items')
    .update({ archived_at: new Date().toISOString(), is_available: false })
    .eq('id', archived)
    .throwOnError();
  otherJuice = await makeItem(otherStoreId, 'Apple', 'Juices');
  const { data: template } = await supabaseAdmin
    .rpc('ensure_brand_template', { p_brand_id: brandIds[0] ?? '' })
    .throwOnError();
  templateId = template;
  storeIds.push(templateId);
  manager = await createStoreMember(storeId, 'MANAGER');
  staff = await createStoreMember(storeId, 'STAFF');
  owner = await createBrandOwner(brandIds[0] ?? '');
  users.push(manager, staff, owner);
}, 60_000);

afterAll(async () => {
  await supabaseAdmin.from('domain_events').delete().eq('store_id', templateId);
  await deleteTestStores(storeIds, brandIds, users);
});

testAuthMatrix('POST /api/stores/:storeId/menu-items/bulk', (http) =>
  http.post(`${base()}/bulk`).send({ category: 'Drinks', isAvailable: true }),
);
testAuthMatrix('PUT /api/stores/:storeId/menu-items/order', (http) =>
  http.put(`${base()}/order`).send({ itemIds: [randomUUID()] }),
);
testStoreIsolation(
  'POST /api/stores/:storeId/menu-items/bulk',
  (http, store, itemId) =>
    http.post(`${base(store)}/bulk`).send({ itemIds: [itemId], isAvailable: false }),
  makeItem,
  'MANAGER',
);
testStoreIsolation(
  'PUT /api/stores/:storeId/menu-items/order',
  (http, store, itemId) => http.put(`${base(store)}/order`).send({ itemIds: [itemId] }),
  makeItem,
  'MANAGER',
);

describe('who makes quick edits', () => {
  it('staff may not (403)', async () => {
    expect((await bulk({ category: 'Drinks', isAvailable: false }, staff)).status).toBe(403);
    expect((await reorder(await liveOrder(), staff)).status).toBe(403);
  });

  it("the brand's owner reorders and switches the template's menu", async () => {
    const templateItems = (await rows(templateId)).map((row) => row.id);
    expect((await reorder([...templateItems].reverse(), owner, templateId)).status).toBe(204);
    expect(
      (await bulk({ itemIds: templateItems, isAvailable: true }, owner, templateId)).status,
    ).toBe(200);
  });
});

describe('the bounds', () => {
  it.each([
    ['neither itemIds nor a category', { isAvailable: false }],
    [
      'both itemIds and a category',
      { itemIds: [randomUUID()], category: 'Drinks', isAvailable: false },
    ],
    ['no isAvailable', { category: 'Drinks' }],
    ['an empty list', { itemIds: [], isAvailable: false }],
    ['an id that is not a UUID', { itemIds: ['nope'], isAvailable: false }],
    ['a blank category', { category: '  ', isAvailable: false }],
    ['an unknown field', { category: 'Drinks', isAvailable: false, price: 1 }],
    [
      `more than ${MANAGED_ITEMS_MAX} ids`,
      {
        itemIds: Array.from({ length: MANAGED_ITEMS_MAX + 1 }, () => randomUUID()),
        isAvailable: false,
      },
    ],
  ])('bulk refuses %s (400)', async (_label, body) => {
    const res = await bulk(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    ['an empty list', []],
    ['an id that is not a UUID', ['nope']],
    [
      `more than ${MANAGED_ITEMS_MAX} ids`,
      Array.from({ length: MANAGED_ITEMS_MAX + 1 }, () => randomUUID()),
    ],
  ])('reorder refuses %s (400)', async (_label, itemIds) => {
    const res = await reorder(itemIds);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('switching many items at once', () => {
  it('"sold out: all juices" switches off only this store\'s live juices, through the cached menu', async () => {
    await setAll(true);
    await publicItems(); // warms the menu cache: the edit must drop it
    const before = (await menuEvents()).length;
    const res = await bulk({ category: 'Juices', isAvailable: false });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 2 });
    const state = new Map((await rows()).map((row) => [row.id, row.is_available]));
    expect([state.get(item.Orange ?? ''), state.get(item.Mango ?? '')]).toEqual([false, false]);
    expect(state.get(item.Tea ?? '')).toBe(true);
    const other = await rows(otherStoreId);
    expect(other.find((row) => row.id === otherJuice)?.is_available).toBe(true);
    const shown = new Map((await publicItems()).map((row) => [row.id, row.isAvailable]));
    expect(shown.get(item.Orange ?? '')).toBe(false);
    const events = (await menuEvents()).slice(before);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({ itemIds: [item.Orange, item.Mango].sort() });
    expect(events[0]?.actor).toMatchObject({ type: 'USER', id: manager.id });
    expect(events[0]?.request_id).toBe(res.headers['x-request-id']);
  });

  it('a repeat covers the same items and emits nothing', async () => {
    const before = (await menuEvents()).length;
    const res = await bulk({ category: 'Juices', isAvailable: false });
    expect(res.body).toEqual({ updated: 2 });
    expect(await menuEvents()).toHaveLength(before);
  });

  it('a list switches exactly its items back on', async () => {
    const res = await bulk({ itemIds: [item.Orange, item.Tea], isAvailable: true });
    expect(res.body).toEqual({ updated: 2 });
    const state = new Map((await rows()).map((row) => [row.id, row.is_available]));
    expect(state.get(item.Orange ?? '')).toBe(true);
    expect(state.get(item.Mango ?? '')).toBe(false);
  });

  it('a category with no live items is 404 (a typo never looks like success)', async () => {
    const res = await bulk({ category: 'juices', isAvailable: false });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it.each([
    ["another store's item", () => otherJuice],
    ['an archived item', () => archived],
    ['an unknown id', () => randomUUID()],
  ])('a list naming %s is refused whole (404), nothing changes', async (_label, extra) => {
    await setAll(true);
    const before = (await menuEvents()).length;
    const res = await bulk({ itemIds: [item.Coffee, extra()], isAvailable: false });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect((await rows()).find((row) => row.id === item.Coffee)?.is_available).toBe(true);
    expect((await rows(otherStoreId))[0]?.is_available).toBe(true);
    expect(await menuEvents()).toHaveLength(before);
  });
});

describe('reordering the menu', () => {
  it("the editor's list puts live items first, so archived rows never push one past the cap", async () => {
    await supabaseAdmin
      .from('menu_items')
      .update({ sort_order: -1 })
      .eq('id', archived)
      .throwOnError();
    const res = await api().get(base()).set(auth(manager));
    const ids = res.body.items.map((row: { id: string }) => row.id);
    expect(ids.at(-1)).toBe(archived);
    expect(ids.slice(0, -1).sort()).toEqual((await liveOrder()).sort());
  });

  it('puts the menu in the new order, on the public menu at once, with one event', async () => {
    const order = [item.Mango, item.Orange, item.Lassi, item.Tea, item.Coffee] as string[];
    await publicItems();
    const before = (await menuEvents()).length;
    const res = await reorder(order);
    expect(res.status).toBe(204);
    expect(await liveOrder()).toEqual(order);
    // A category takes its first item's place, so Juices now comes before Drinks.
    expect((await publicItems()).map((row) => row.id)).toEqual([
      item.Mango,
      item.Orange,
      item.Lassi,
      item.Tea,
      item.Coffee,
    ]);
    expect((await menuEvents()).slice(before)).toHaveLength(1);
  });

  it('the same order again is 204 and emits nothing', async () => {
    const before = (await menuEvents()).length;
    expect((await reorder(await liveOrder())).status).toBe(204);
    expect(await menuEvents()).toHaveLength(before);
  });

  it.each([
    ['an item missing (a stale list)', (live: string[]) => live.slice(1)],
    ['an item twice', (live: string[]) => [...live, live[0] ?? '']],
    ['an archived item', (live: string[]) => [...live, archived]],
  ])('refuses %s (400), nothing changes', async (_label, makeList) => {
    const live = await liveOrder();
    const res = await reorder(makeList([...live].reverse()));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { field: 'itemIds' },
    });
    expect(await liveOrder()).toEqual(live);
  });

  it.each([
    ["another store's item", () => otherJuice],
    ['an unknown id', () => randomUUID()],
  ])('a list with %s is refused whole (404), nothing changes', async (_label, extra) => {
    const live = await liveOrder();
    const res = await reorder([...[...live].reverse(), extra()]);
    expect(res.status).toBe(404);
    expect(await liveOrder()).toEqual(live);
  });

  // A deadlock between a reorder and a bulk switch is down to timing, so a race test alone rarely sees one: check that
  // every quick edit takes the store's menu lock before it touches an item.
  it('every quick edit takes the store menu lock', () => {
    const rows = localSql<{ name: string; locks: boolean }>(
      "select proname as name, prosrc like '%lock_store_menu(p_store_id)%' as locks from pg_proc " +
        "where proname in ('reorder_menu', 'set_menu_availability') order by proname",
    );
    expect(rows).toEqual([
      { name: 'reorder_menu', locks: true },
      { name: 'set_menu_availability', locks: true },
    ]);
  });

  it('a reorder and a bulk switch at once both go through (they queue, never deadlock)', async () => {
    const live = await liveOrder();
    for (let round = 0; round < 5; round += 1) {
      const order = round % 2 ? [...live].reverse() : live;
      const results = await Promise.all([
        reorder(order),
        bulk({ itemIds: [...order].reverse(), isAvailable: round % 2 === 0 }),
        bulk({ category: 'Drinks', isAvailable: round % 2 === 1 }),
      ]);
      expect(results.map((res) => res.status)).toEqual([204, 200, 200]);
    }
  });

  it('two reorders at once leave one of the two orders whole, never a mix', async () => {
    const live = await liveOrder();
    const forward = [...live].sort();
    const backward = [...forward].reverse();
    for (let round = 0; round < 5; round += 1) {
      const results = await Promise.all([reorder(forward), reorder(backward)]);
      expect(results.map((res) => res.status)).toEqual([204, 204]);
      expect([forward, backward]).toContainEqual(await liveOrder());
    }
  });
});
