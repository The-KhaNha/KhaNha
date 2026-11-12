// Local only: a brand's owner opens a branch, edits its profile, publishes and unpublishes it (P3.1, D6).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/schemas/limits';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createBrandOwner,
  createStoreMember,
  createTestUser,
  deleteTestStores,
  testAuthMatrix,
  testStoreIsolation,
  type TestUser,
} from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
let brandId = '';
let otherBrandId = '';
let sourceId = '';
let templateId = '';
let branchId = '';
const storeIds: string[] = [];
let owner: TestUser;
let otherOwner: TestUser;
let manager: TestUser;
let branchManager: TestUser;
let branchStaff: TestUser;
let admin: TestUser;
let customer: TestUser;
const users: TestUser[] = [];

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
const create = (user: TestUser, body: object, brand = brandId) =>
  api().post(`/api/brands/${brand}/stores`).set(auth(user)).send(body);
const publish = (user: TestUser, id = branchId) =>
  api().post(`/api/stores/${id}/publish`).set(auth(user)).send({});
const unpublish = (user: TestUser, id = branchId) =>
  api().post(`/api/stores/${id}/unpublish`).set(auth(user)).send({});
const profile = (user: TestUser, body: object, id = branchId) =>
  api().patch(`/api/stores/${id}/profile`).set(auth(user)).send(body);
const changes = async (storeId = branchId) =>
  (
    await supabaseAdmin
      .from('domain_events')
      .select('payload, actor')
      .eq('store_id', storeId)
      .eq('type', 'store.changed')
      .order('occurred_at')
      .throwOnError()
  ).data;
const statusOf = async (id: string) =>
  (await supabaseAdmin.from('stores').select('status').eq('id', id).single().throwOnError()).data
    .status;
const listedIds = async () =>
  ((await api().get('/api/stores')).body.stores as { id: string }[]).map((store) => store.id);
const WEEK = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
  day_of_week: day,
  opens_at: '09:00',
  closes_at: '17:00',
}));
const setHours = async (storeId: string, rows = WEEK) => {
  await supabaseAdmin.from('store_hours').delete().eq('store_id', storeId).throwOnError();
  if (rows.length > 0)
    await supabaseAdmin
      .from('store_hours')
      .insert(rows.map((row) => ({ ...row, store_id: storeId })))
      .throwOnError();
};

beforeAll(async () => {
  const { data: brands } = await supabaseAdmin
    .from('brands')
    .insert([
      { name: 'Lifecycle', slug: `lifecycle-${tag}`, status: 'ACTIVE' as const },
      { name: 'Lifecycle other', slug: `lifecycle-other-${tag}`, status: 'ACTIVE' as const },
    ])
    .select('id, slug')
    .throwOnError();
  brandId = brands.find((brand) => brand.slug === `lifecycle-${tag}`)?.id ?? '';
  otherBrandId = brands.find((brand) => brand.slug !== `lifecycle-${tag}`)?.id ?? '';
  const { data: source } = await supabaseAdmin
    .from('stores')
    .insert({
      name: 'Lifecycle source',
      slug: `lifecycle-src-${tag}`,
      brand_id: brandId,
      status: 'ACTIVE',
      tagline: 'Test',
      description: 'The template source',
    })
    .select('id')
    .single()
    .throwOnError();
  sourceId = source.id;
  storeIds.push(sourceId);
  await supabaseAdmin
    .from('menu_items')
    .insert(
      ['Tea', 'Toast'].map((name, index) => ({
        store_id: sourceId,
        name,
        category: 'Menu',
        description: '',
        price_paise: 5000,
        image_url: null,
        sort_order: index,
      })),
    )
    .throwOnError();
  const { data: template } = await supabaseAdmin
    .rpc('ensure_brand_template', { p_brand_id: brandId })
    .throwOnError();
  templateId = template;
  storeIds.push(templateId);

  [owner, otherOwner, manager, admin, customer] = await Promise.all([
    createBrandOwner(brandId),
    createBrandOwner(otherBrandId),
    createStoreMember(sourceId, 'MANAGER'),
    createTestUser('ADMIN'),
    createTestUser(),
  ]);
  users.push(owner, otherOwner, manager, admin, customer);

  const res = await create(owner, {
    name: 'Lifecycle North',
    slug: `lifecycle-north-${tag}`,
    area: 'North',
    addressLine: '1 Road',
  });
  expect(res.status).toBe(201);
  branchId = res.body.store.id;
  storeIds.push(branchId);
  [branchManager, branchStaff] = await Promise.all([
    createStoreMember(branchId, 'MANAGER'),
    createStoreMember(branchId, 'STAFF'),
  ]);
  users.push(branchManager, branchStaff);
}, 60_000);

afterAll(() => deleteTestStores(storeIds, [brandId, otherBrandId], users));

describe('POST /api/brands/:brandId/stores', () => {
  it("opens a DRAFT branch for the brand's owner, with the template's menu", async () => {
    const { body } = await api().get(`/api/stores/${branchId}/menu-items`).set(auth(owner));
    const names = (body.items as { name: string }[]).map((item) => item.name).sort();
    expect(names).toEqual(['Tea', 'Toast']);
    expect(await statusOf(branchId)).toBe('DRAFT');
    // A draft is nobody's to see but its own people.
    expect((await api().get(`/api/stores/${branchId}`)).status).toBe(404);
  });

  it('makes the slug from the name when none is sent', async () => {
    const res = await create(owner, { name: `Café Süd ${tag}` });
    expect(res.status).toBe(201);
    storeIds.push(res.body.store.id);
    expect(res.body.store).toMatchObject({
      slug: `cafe-sud-${tag}`,
      status: 'DRAFT',
      isTemplate: false,
      area: null,
      address: null,
    });
  });

  it.each([
    ["a manager of the brand's store", () => manager],
    ["another brand's owner", () => otherOwner],
    ['an admin', () => admin],
    ['a customer', () => customer],
  ])('%s → 404, and nothing is made', async (_who, who) => {
    const slug = `lifecycle-refused-${tag}`;
    const res = await create(who(), { name: 'Refused', slug });
    expect(res.status).toBe(404);
    const { data } = await supabaseAdmin.from('stores').select('id').eq('slug', slug);
    expect(data).toEqual([]);
  });

  it('an unknown or malformed brand id → 404', async () => {
    expect((await create(owner, { name: 'X branch' }, randomUUID())).status).toBe(404);
    expect((await create(owner, { name: 'X branch' }, 'not-a-uuid')).status).toBe(404);
  });

  it('a taken slug → 409 SLUG_TAKEN, and leaves nothing behind', async () => {
    const before = (
      await supabaseAdmin.from('stores').select('id').eq('brand_id', brandId).throwOnError()
    ).data.length;
    const res = await create(owner, { name: 'Again', slug: `lifecycle-north-${tag}` });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'SLUG_TAKEN', details: { field: 'slug' } });
    const after = (
      await supabaseAdmin.from('stores').select('id').eq('brand_id', brandId).throwOnError()
    ).data.length;
    expect(after).toBe(before);
  });

  it.each([
    ['a one-letter name', { name: 'A' }],
    ['a name over the bound', { name: 'x'.repeat(LIMITS.store.nameMax + 1) }],
    ['a slug too short', { name: 'Fine name', slug: 'ab' }],
    ['a slug with capitals', { name: 'Fine name', slug: 'Fine-Name' }],
    ['a slug ending in a dash', { name: 'Fine name', slug: 'fine-name-' }],
    ['a name that makes no slug', { name: '☕☕☕' }],
    ['an unknown field', { name: 'Fine name', status: 'ACTIVE' }],
  ])('%s → 400', async (_label, body) => {
    expect((await create(owner, body)).status).toBe(400);
  });
});

describe('GET /api/brands/mine', () => {
  it('lists the brand with its branches of every status and its template', async () => {
    const res = await api().get('/api/brands/mine').set(auth(owner));
    expect(res.status).toBe(200);
    const [brand] = res.body.brands;
    expect(brand).toMatchObject({ id: brandId, template: { id: templateId, isTemplate: true } });
    const ids = (brand.stores as { id: string }[]).map((store) => store.id);
    expect(ids).toEqual(expect.arrayContaining([sourceId, branchId]));
    expect(ids).not.toContain(templateId);
  });

  it.each([
    ['a manager', () => manager],
    ['an admin', () => admin],
    ['a customer', () => customer],
  ])('%s owns nothing → []', async (_who, who) => {
    const res = await api().get('/api/brands/mine').set(auth(who()));
    expect(res.body).toEqual({ brands: [] });
  });
});

describe('PATCH /api/stores/:storeId/profile', () => {
  it('a manager edits the profile; one store.changed names the fields, and a repeat leaves none', async () => {
    const before = (await changes()).length;
    const res = await profile(branchManager, {
      tagline: 'Tea • Toast',
      contactPhone: '+91 98765-43210',
    });
    expect(res.status).toBe(200);
    expect(res.body.store).toMatchObject({ tagline: 'Tea • Toast', contactPhone: '+919876543210' });
    const after = await changes();
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)).toMatchObject({
      payload: { fields: ['contact_phone', 'tagline'], status: 'DRAFT' },
      actor: { id: branchManager.id },
    });
    expect((await profile(branchManager, { tagline: 'Tea • Toast' })).status).toBe(200);
    expect(await changes()).toHaveLength(before + 1);
  });

  it('a blank place field clears it', async () => {
    const res = await profile(owner, { contactPhone: '' });
    expect(res.body.store.contactPhone).toBeNull();
  });

  it.each([
    ['the slug', { slug: 'new-slug' }],
    ['the status', { status: 'ACTIVE' }],
    ['nothing', {}],
    ['an address over the bound', { addressLine: 'x'.repeat(LIMITS.store.addressMax + 1) }],
    ['a bad phone', { contactPhone: '12' }],
  ])('%s → 400', async (_label, body) => {
    expect((await profile(owner, body)).status).toBe(400);
  });

  it("the owner edits the template's profile, which new branches copy; a manager cannot reach it", async () => {
    expect((await profile(owner, { tagline: 'From the template' }, templateId)).status).toBe(200);
    expect((await profile(manager, { tagline: 'x' }, templateId)).status).toBe(404);
  });

  it('a bad phone keeps its own message', async () => {
    const res = await profile(owner, { contactPhone: '12ab' });
    expect(res.body.error.message).toBe('Enter a valid phone number.');
  });

  it('staff → 403', async () => {
    expect((await profile(branchStaff, { tagline: 'x' })).status).toBe(403);
  });

  it('the CHECK constraints hold the bounds the schema enforces', async () => {
    const write = (fields: object) =>
      supabaseAdmin.from('stores').update(fields).eq('id', branchId).select('id');
    const { nameMin, nameMax, addressMax } = LIMITS.store;
    expect((await write({ name: 'x'.repeat(nameMax) })).error).toBeNull();
    expect((await write({ name: 'x'.repeat(nameMax + 1) })).error?.code).toBe('23514');
    expect((await write({ name: 'x'.repeat(nameMin - 1) })).error?.code).toBe('23514');
    expect((await write({ address_line: 'x'.repeat(addressMax + 1) })).error?.code).toBe('23514');
    expect((await write({ contact_phone: '12' })).error?.code).toBe('23514');
    await write({ name: 'Lifecycle North', address_line: '1 Road' });
  });
});

describe('publish and unpublish', () => {
  beforeAll(() => setHours(branchId));

  it.each([
    [
      'address',
      () => profile(owner, { addressLine: null }),
      () => profile(owner, { addressLine: '1 Road' }),
    ],
    ['hours', () => setHours(branchId, []), () => setHours(branchId)],
    [
      'menu',
      () =>
        supabaseAdmin.from('menu_items').update({ is_available: false }).eq('store_id', branchId),
      () =>
        supabaseAdmin.from('menu_items').update({ is_available: true }).eq('store_id', branchId),
    ],
  ])('a missing %s alone blocks publish and changes nothing', async (missing, take, restore) => {
    await take();
    const before = (await changes()).length;
    const res = await publish(owner);
    const status = await statusOf(branchId);
    const after = (await changes()).length;
    await restore();
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'STORE_NOT_READY',
      details: { kind: 'storeNotReady', missing: [missing] },
    });
    expect(status).toBe('DRAFT');
    expect(after).toBe(before);
  });

  it('a manager or an admin → 403; a template → 404', async () => {
    expect((await publish(branchManager)).status).toBe(403);
    expect((await publish(admin, sourceId)).status).toBe(403);
    expect((await publish(owner, templateId)).status).toBe(404);
  });

  it('publish lists the store at once, with one store.changed; a repeat leaves none', async () => {
    expect(await listedIds()).not.toContain(branchId); // primes stores:list
    const before = (await changes()).length;
    const res = await publish(owner);
    expect(res.status).toBe(200);
    expect(res.body.store.status).toBe('ACTIVE');
    expect(await listedIds()).toContain(branchId);
    const after = await changes();
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)?.payload).toEqual({ fields: ['status'], status: 'ACTIVE' });
    expect((await publish(owner)).status).toBe(200);
    expect(await changes()).toHaveLength(before + 1);
    // A public store keeps the address publishing needed.
    const cleared = await profile(branchManager, { addressLine: '' });
    expect(cleared.status).toBe(400);
    expect(cleared.body.error.details).toEqual({ field: 'addressLine' });
  });

  it('unpublish hides the store and refuses new orders; an order placed before is still served', async () => {
    // No hours: the store is open by its switch, whatever the time of the run.
    await setHours(branchId, []);
    const { body: menu } = await api().get(`/api/stores/${branchId}/menu`);
    const itemId = menu.categories[0].items[0].id as string;
    const order = (await api()
      .post('/api/orders')
      .set(auth(customer))
      .send({ storeId: branchId, items: [{ menuItemId: itemId, quantity: 1 }] })) as {
      status: number;
      body: { order: { id: string } };
    };
    expect(order.status).toBe(201);

    expect(await listedIds()).toContain(branchId); // primes stores:list
    const before = (await changes()).length;
    const res = await unpublish(owner);
    expect(res.status).toBe(200);
    expect(res.body.store.status).toBe('DRAFT');
    expect(await listedIds()).not.toContain(branchId);
    expect(await changes()).toHaveLength(before + 1);
    expect((await unpublish(owner)).status).toBe(200);
    expect(await changes()).toHaveLength(before + 1);

    const refused = await api()
      .post('/api/orders')
      .set(auth(customer))
      .send({ storeId: branchId, items: [{ menuItemId: itemId, quantity: 1 }] });
    expect(refused.status).toBe(404);

    for (const status of ['PREPARING', 'READY', 'COLLECTED']) {
      const moved = await api()
        .patch(`/api/stores/${branchId}/orders/${order.body.order.id}/status`)
        .set(auth(branchStaff))
        .send({ status });
      expect(moved.status).toBe(200);
    }
  });

  it('a suspended store → 409 INVALID_STATUS_TRANSITION, and stays suspended', async () => {
    await supabaseAdmin.from('stores').update({ status: 'SUSPENDED' }).eq('id', branchId);
    const res = await publish(owner);
    await supabaseAdmin.from('stores').update({ status: 'DRAFT' }).eq('id', branchId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });
});

testAuthMatrix('GET /api/brands/mine', (http) => http.get('/api/brands/mine'));
testAuthMatrix('POST /api/brands/:brandId/stores', (http) =>
  http.post(`/api/brands/${randomUUID()}/stores`).send({ name: 'Anon' }),
);
testAuthMatrix('PATCH /api/stores/:storeId/profile', (http) =>
  http.patch(`/api/stores/${randomUUID()}/profile`).send({ tagline: 'x' }),
);
testAuthMatrix('POST /api/stores/:storeId/publish', (http) =>
  http.post(`/api/stores/${randomUUID()}/publish`).send({}),
);
testAuthMatrix('POST /api/stores/:storeId/unpublish', (http) =>
  http.post(`/api/stores/${randomUUID()}/unpublish`).send({}),
);
testStoreIsolation(
  'PATCH /api/stores/:storeId/profile',
  (http, storeId) => http.patch(`/api/stores/${storeId}/profile`).send({ tagline: 'Isolated' }),
  undefined,
  'MANAGER',
);

// testStoreIsolation's permitted caller is a store member; publish and unpublish are owner-only.
describe.each([
  ['publish', publish],
  ['unpublish', unpublish],
])('%s — store isolation', (route, call) => {
  it('anonymous → 401', async () => {
    const path = `/api/stores/${branchId}/${route}`;
    expect((await api().post(path).send({})).status).toBe(401);
  });
  it.each([
    ['a customer', () => customer],
    ["the other brand's owner", () => otherOwner],
  ])('%s → 404 (a draft store is not theirs to see)', async (_who, who) => {
    const res = await call(who());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
  it("the store's own staff → 403", async () => {
    const res = await call(branchStaff);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
