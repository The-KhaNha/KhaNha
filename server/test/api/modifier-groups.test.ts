// Local only: the modifier editor (P3.2, PR 14). A group is saved whole with its options; an item's groups are set in
// order; archiving takes a group off the menu. Every change drops the store's cached menu and leaves one menu.changed
// with the caller as actor; a repeat changes nothing and leaves none. Another store's group or item is 404.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MODIFIER_LIMITS } from '../../src/schemas/limits';
import { loadItemModifiers } from '../../src/services/modifier.service';
import { cached, invalidate } from '../../src/utils/cache';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createStoreMember,
  deleteTestStores,
  testStoreIsolation,
  type TestUser,
} from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
const brandIds: string[] = [];
const storeIds: string[] = [];
const users: TestUser[] = [];
let storeId = '';
let otherStoreId = '';
let itemId = '';
let manager: TestUser;
let staff: TestUser;

const base = (store = storeId) => `/api/stores/${store}/modifier-groups`;
const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
const size = {
  name: 'Size',
  minSelect: 1,
  maxSelect: 1,
  options: [
    { name: 'Small', priceDelta: 0, isDefault: true, isAvailable: true },
    { name: 'Large', priceDelta: 20, isDefault: false, isAvailable: true },
  ],
};
const create = (body: object, user = manager, store = storeId) =>
  api().post(base(store)).set(auth(user)).send(body);
const patch = (groupId: string, body: object) =>
  api().patch(`${base()}/${groupId}`).set(auth(manager)).send(body);
const setGroups = (groupIds: string[], item = itemId, store = storeId) =>
  api()
    .put(`/api/stores/${store}/menu-items/${item}/modifier-groups`)
    .set(auth(manager))
    .send({ groupIds });
const events = async (requestId: string) =>
  (
    await supabaseAdmin
      .from('domain_events')
      .select('type, store_id, actor, payload')
      .eq('request_id', requestId)
      .throwOnError()
  ).data;
const requestIdOf = (res: { headers: Record<string, string> }) =>
  String(res.headers['x-request-id']);

async function makeStore(key: string) {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: `Mod ${key}`, slug: `mod-${key}-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandIds.push(brand.id);
  const { data: store } = await supabaseAdmin
    .from('stores')
    .insert({
      name: `Mod ${key}`,
      slug: `mod-store-${key}-${tag}`,
      brand_id: brand.id,
      status: 'ACTIVE',
      tagline: 'Test',
      description: 'Modifier editor tests',
    })
    .select('id')
    .single()
    .throwOnError();
  storeIds.push(store.id);
  return store.id as string;
}

async function makeItem(store: string) {
  const { data } = await supabaseAdmin
    .from('menu_items')
    .insert({
      store_id: store,
      name: `Chai ${randomUUID().slice(0, 4)}`,
      description: 'Tea',
      category: 'Hot',
      price_paise: 3000,
    })
    .select('id')
    .single()
    .throwOnError();
  return data.id as string;
}

async function makeGroup(store: string) {
  const res = await create(
    size,
    await createStoreMember(store, 'MANAGER').then((u) => (users.push(u), u)),
    store,
  );
  return res.body.group.id as string;
}

/** Plants a stale menu under the store's cache key; true once a write has dropped it. */
const menuKey = () => `menu:${storeId}`;
const plantMenu = async () => {
  invalidate(menuKey()); // an earlier check left 'fresh' there, which a plant would return instead
  expect(await cached(menuKey(), 60 * 60 * 1000, () => Promise.resolve('stale'))).toBe('stale');
};
const menuDropped = async () =>
  (await cached(menuKey(), 60 * 60 * 1000, () => Promise.resolve('fresh'))) === 'fresh';

beforeAll(async () => {
  storeId = await makeStore('a');
  otherStoreId = await makeStore('b');
  itemId = await makeItem(storeId);
  manager = await createStoreMember(storeId, 'MANAGER');
  staff = await createStoreMember(storeId, 'STAFF');
  users.push(manager, staff);
}, 60_000);

afterAll(() => deleteTestStores(storeIds, brandIds, users));

testStoreIsolation(
  'GET …/modifier-groups',
  (http, store) => http.get(base(store)),
  undefined,
  'MANAGER',
);
testStoreIsolation(
  'POST …/modifier-groups',
  (http, store) => http.post(base(store)).send(size),
  undefined,
  'MANAGER',
);
testStoreIsolation(
  'PATCH …/modifier-groups/:groupId',
  (http, store, group) => http.patch(`${base(store)}/${group}`).send(size),
  makeGroup,
  'MANAGER',
);
testStoreIsolation(
  'DELETE …/modifier-groups/:groupId',
  (http, store, group) => http.delete(`${base(store)}/${group}`),
  makeGroup,
  'MANAGER',
);
testStoreIsolation(
  'PUT …/menu-items/:itemId/modifier-groups',
  (http, store, item) =>
    http.put(`/api/stores/${store}/menu-items/${item}/modifier-groups`).send({ groupIds: [] }),
  makeItem,
  'MANAGER',
);

describe('the bounds', () => {
  const D = MODIFIER_LIMITS.deltaMax;
  const option = size.options[1]!;
  it.each([
    ['minSelect above maxSelect', { ...size, minSelect: 2 }, 'minSelect'],
    ['maxSelect 0', { ...size, minSelect: 0, maxSelect: 0 }, 'maxSelect'],
    ['no options', { ...size, options: [] }, 'options'],
    [
      'too many options',
      {
        ...size,
        options: Array.from({ length: MODIFIER_LIMITS.optionsPerGroup + 1 }, () => option),
      },
      'options',
    ],
    ['a delta past the bound', { ...size, options: [{ ...option, priceDelta: D + 1 }] }, 'options'],
    ['a fractional delta', { ...size, options: [{ ...option, priceDelta: 2.5 }] }, 'options'],
    ['a blank name', { ...size, name: '  ' }, 'name'],
    ['a name too long', { ...size, name: 'x'.repeat(MODIFIER_LIMITS.nameMax + 1) }, 'name'],
    [
      'one option id twice',
      {
        ...size,
        options: [
          { ...option, id: itemId },
          { ...option, id: itemId },
        ],
      },
      'options',
    ],
    ['an extra key', { ...size, colour: 'red' }, ''],
  ])('%s is 400', async (_label, body, field) => {
    const res = await create(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    if (field) expect(res.body.error.details.field).toBe(field);
  });

  it('a group of the same id twice on an item is 400', async () => {
    const id = randomUUID();
    expect((await setGroups([id, id])).status).toBe(400);
  });

  it('staff may not edit (403)', async () => {
    expect((await create(size, staff)).status).toBe(403);
  });
});

describe('a group', () => {
  let groupId = '';

  it('is created with its options in order, deltas in rupees, announced once', async () => {
    await plantMenu();
    const res = await create(size);
    expect(res.status).toBe(201);
    groupId = res.body.group.id;
    expect(res.body.group).toEqual({
      id: groupId,
      name: 'Size',
      minSelect: 1,
      maxSelect: 1,
      options: [
        {
          id: expect.any(String),
          name: 'Small',
          priceDelta: 0,
          isDefault: true,
          isAvailable: true,
        },
        {
          id: expect.any(String),
          name: 'Large',
          priceDelta: 20,
          isDefault: false,
          isAvailable: true,
        },
      ],
    });
    expect(await menuDropped()).toBe(true);
    const evs = await events(requestIdOf(res));
    expect(evs).toEqual([
      expect.objectContaining({
        type: 'menu.changed',
        store_id: storeId,
        payload: { groupIds: [groupId] },
      }),
    ]);
    expect((evs[0]!.actor as { id: string }).id).toBe(manager.id);
  });

  it('is saved whole: kept options by id, a new one added, a left-out one archived', async () => {
    const [small, large] = (await api().get(base()).set(auth(manager))).body.groups[0].options;
    await plantMenu();
    const res = await patch(groupId, {
      ...size,
      name: 'Cup',
      options: [
        { ...large, priceDelta: 25 },
        { name: 'Medium', priceDelta: 10, isDefault: true, isAvailable: true },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.group.name).toBe('Cup');
    expect(
      res.body.group.options.map((o: { name: string; priceDelta: number }) => [
        o.name,
        o.priceDelta,
      ]),
    ).toEqual([
      ['Large', 25],
      ['Medium', 10],
    ]);
    expect(res.body.group.options[0].id).toBe(large.id);
    expect(await menuDropped()).toBe(true);
    const { data: archived } = await supabaseAdmin
      .from('modifier_options')
      .select('archived_at')
      .eq('id', small.id)
      .single()
      .throwOnError();
    expect(archived.archived_at).not.toBeNull();
  });

  it('a repeat changes nothing and announces nothing', async () => {
    const group = (await api().get(base()).set(auth(manager))).body.groups[0];
    const { id: _id, ...body } = group;
    const res = await patch(groupId, body);
    expect(res.status).toBe(200);
    expect(await events(requestIdOf(res))).toEqual([]);
  });

  it('refuses a required choice it cannot fill, and more defaults than it allows', async () => {
    const group = (await api().get(base()).set(auth(manager))).body.groups[0];
    const off = group.options.map((o: object) => ({ ...o, isAvailable: false }));
    const tooFew = await patch(groupId, { name: 'Cup', minSelect: 1, maxSelect: 1, options: off });
    expect(tooFew.status).toBe(400);
    expect(tooFew.body.error.details.field).toBe('minSelect');
    const both = group.options.map((o: object) => ({ ...o, isDefault: true }));
    const defaults = await patch(groupId, {
      name: 'Cup',
      minSelect: 1,
      maxSelect: 1,
      options: both,
    });
    expect(defaults.status).toBe(400);
    expect(defaults.body.error.details.field).toBe('options');
    // Refused whole: nothing of either attempt stayed.
    const after = (await api().get(base()).set(auth(manager))).body.groups[0];
    expect(after).toEqual(group);
  });

  it("an option of another group, or another store's group, is 404", async () => {
    const other = await makeGroup(otherStoreId);
    const { data: foreign } = await supabaseAdmin
      .from('modifier_options')
      .select('id')
      .eq('group_id', other)
      .limit(1)
      .single()
      .throwOnError();
    const res = await patch(groupId, {
      ...size,
      options: [{ ...size.options[0], id: foreign.id }],
    });
    expect(res.status).toBe(404);
    expect((await patch(other, size)).status).toBe(404);
    expect((await api().patch(`${base()}/not-a-uuid`).set(auth(manager)).send(size)).status).toBe(
      404,
    );
  });

  it('is attached to an item in order, and a repeat announces nothing', async () => {
    const addOns = (
      await create({
        name: 'Add-ons',
        minSelect: 0,
        maxSelect: 2,
        options: [{ name: 'Honey', priceDelta: 10, isDefault: false, isAvailable: true }],
      })
    ).body.group.id;
    await plantMenu();
    const res = await setGroups([addOns, groupId]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ groupIds: [addOns, groupId] });
    expect(await menuDropped()).toBe(true);
    expect((await loadItemModifiers(storeId, [itemId])).groupIds.get(itemId)).toEqual([
      addOns,
      groupId,
    ]);
    expect(await events(requestIdOf(res))).toEqual([
      expect.objectContaining({ type: 'menu.changed', payload: { itemIds: [itemId] } }),
    ]);
    const list = (await api().get(base()).set(auth(manager))).body;
    expect(list.itemGroupIds[itemId]).toEqual([addOns, groupId]);

    const again = await setGroups([addOns, groupId]);
    expect(again.status).toBe(200);
    expect(await events(requestIdOf(again))).toEqual([]);
    expect((await setGroups([groupId])).status).toBe(200);
    expect((await loadItemModifiers(storeId, [itemId])).groupIds.get(itemId)).toEqual([groupId]);
  });

  it("another store's group cannot be attached, nor another store's item set (404)", async () => {
    const other = await makeGroup(otherStoreId);
    const res = await setGroups([groupId, other]);
    expect(res.status).toBe(404);
    expect((await loadItemModifiers(storeId, [itemId])).groupIds.get(itemId)).toEqual([groupId]);
    const otherItem = await makeItem(otherStoreId);
    expect((await setGroups([], otherItem)).status).toBe(404);
  });

  it('archived, leaves the menu and old orders, and a repeat is 204 with no event', async () => {
    await plantMenu();
    const res = await api().delete(`${base()}/${groupId}`).set(auth(manager));
    expect(res.status).toBe(204);
    expect(await menuDropped()).toBe(true);
    expect((await loadItemModifiers(storeId, [itemId])).groupIds.get(itemId)).toBeUndefined();
    expect(
      (await api().get(base()).set(auth(manager))).body.groups.map((g: { id: string }) => g.id),
    ).not.toContain(groupId);
    const again = await api().delete(`${base()}/${groupId}`).set(auth(manager));
    expect(again.status).toBe(204);
    expect(await events(requestIdOf(again))).toEqual([]);
    // An archived group can no longer be edited or attached.
    expect((await patch(groupId, size)).status).toBe(404);
    expect((await setGroups([groupId])).status).toBe(404);
  });

  it(`a store has at most ${MODIFIER_LIMITS.groupsPerStore} live groups`, async () => {
    const live = (await api().get(base()).set(auth(manager))).body.groups.length;
    for (let i = live; i < MODIFIER_LIMITS.groupsPerStore; i++)
      expect((await create(size)).status).toBe(201);
    const res = await create(size);
    expect(res.status).toBe(400);
    expect(res.body.error.details.field).toBe('name');
  });
});
