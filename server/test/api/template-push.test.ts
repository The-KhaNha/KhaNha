// Local only: the template push (P3.1, D2). The brand's owner sends chosen fields of chosen template items to chosen
// branches; a copy is found by lineage (never by name), a branch without one gets a new copy, and nothing else moves.
// Anyone but the owner, and any item or store outside the brand, is refused whole.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createBrandOwner,
  createStoreMember,
  createTestUser,
  deleteTestStores,
  testAuthMatrix,
  type TestUser,
} from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
const brandIds: string[] = [];
const storeIds: string[] = [];
const users: TestUser[] = [];
let brandId = '';
let templateId = '';
let northId = '';
let southId = '';
let otherStoreId = '';
let otherTemplateItem = '';
let chai = ''; // on the template before the branches opened: both have a copy
let toast = ''; // added later: no branch has one
let owner: TestUser;
let manager: TestUser;
let admin: TestUser;

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
const push = (body: object, user = owner, brand = brandId) =>
  api().post(`/api/brands/${brand}/template/push`).set(auth(user)).send(body);
const copyOf = async (storeId: string, templateItemId: string) =>
  (
    await supabaseAdmin
      .from('menu_items')
      .select('*')
      .eq('store_id', storeId)
      .eq('template_item_id', templateItemId)
      .is('archived_at', null)
      .throwOnError()
  ).data;
const insertItem = async (store: string, name: string, pricePaise: number) =>
  (
    await supabaseAdmin
      .from('menu_items')
      .insert({
        store_id: store,
        name,
        description: `${name} from the template`,
        category: 'Hot',
        price_paise: pricePaise,
        diet: 'VEG',
        sort_order: 5,
      })
      .select('id')
      .single()
      .throwOnError()
  ).data.id;
const makeBrand = async (slug: string) => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: `Push ${slug}`, slug, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandIds.push(brand.id);
  const { data: template } = await supabaseAdmin
    .rpc('ensure_brand_template', { p_brand_id: brand.id })
    .throwOnError();
  storeIds.push(template);
  return { brand: brand.id as string, template: template as string };
};
const openBranch = async (brand: string, slug: string) => {
  const { data } = await supabaseAdmin
    .rpc('create_store_from_template', {
      p_brand_id: brand,
      p_name: `Branch ${slug}`,
      p_slug: slug,
      p_area: 'Campus',
      p_address_line: '1 Road',
    })
    .throwOnError();
  storeIds.push(data);
  return data as string;
};

beforeAll(async () => {
  ({ brand: brandId, template: templateId } = await makeBrand(`push-${tag}`));
  chai = await insertItem(templateId, 'Masala Chai', 3000);
  northId = await openBranch(brandId, `push-north-${tag}`);
  southId = await openBranch(brandId, `push-south-${tag}`);
  toast = await insertItem(templateId, 'Cheese Toast', 9000);
  const other = await makeBrand(`push-other-${tag}`);
  otherTemplateItem = await insertItem(other.template, 'Other chai', 2000);
  otherStoreId = await openBranch(other.brand, `push-other-br-${tag}`);
  owner = await createBrandOwner(brandId);
  manager = await createStoreMember(northId, 'MANAGER');
  admin = await createTestUser('ADMIN');
  users.push(owner, manager, admin);
}, 60_000);

afterAll(() => deleteTestStores(storeIds, brandIds, users));

testAuthMatrix('POST /api/brands/:brandId/template/push', (http) =>
  http
    .post(`/api/brands/${brandId}/template/push`)
    .send({ itemIds: [chai], storeIds: [northId], fields: ['price'] }),
);

describe('who may push', () => {
  it.each([
    ['a manager of a branch', () => manager],
    ['a platform admin', () => admin],
  ])('%s gets 404 and nothing changes', async (_label, who) => {
    const before = await copyOf(northId, chai);
    const res = await push({ itemIds: [chai], storeIds: [northId], fields: ['price'] }, who());
    expect(res.status).toBe(404);
    expect(await copyOf(northId, chai)).toEqual(before);
  });

  it('an unknown or malformed brand is 404', async () => {
    const body = { itemIds: [chai], storeIds: [northId], fields: ['price'] };
    expect((await push(body, owner, randomUUID())).status).toBe(404);
    expect((await push(body, owner, 'not-a-uuid')).status).toBe(404);
  });
});

describe('the bounds', () => {
  it.each([
    ['an unknown field', { itemIds: [randomUUID()], storeIds: [randomUUID()], fields: ['stock'] }],
    ['no fields', { itemIds: [randomUUID()], storeIds: [randomUUID()], fields: [] }],
    ['no stores', { itemIds: [randomUUID()], storeIds: [], fields: ['name'] }],
    ['no items', { itemIds: [], storeIds: [randomUUID()], fields: ['name'] }],
    ['an extra key', { itemIds: [randomUUID()], storeIds: [randomUUID()], fields: ['name'], x: 1 }],
    [
      'more copies than one push may reach',
      {
        itemIds: Array.from({ length: 1000 }, () => randomUUID()),
        storeIds: Array.from({ length: 6 }, () => randomUUID()),
        fields: ['price'],
      },
    ],
  ])('%s is 400', async (_label, body) => {
    const res = await push(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('a push', () => {
  beforeEach(async () => {
    // North renamed its chai, counts it and switched it off: all of it is North's own.
    await supabaseAdmin
      .from('menu_items')
      .update({
        name: 'Cutting Chai',
        price_paise: 2500,
        stock_quantity: 4,
        is_available: false,
        sort_order: 9,
      })
      .eq('store_id', northId)
      .eq('template_item_id', chai)
      .throwOnError();
    await supabaseAdmin
      .from('menu_items')
      .update({ price_paise: 3500 })
      .eq('id', chai)
      .throwOnError();
  });

  it('overwrites only the chosen fields of the chosen stores, found by lineage after a rename', async () => {
    const southBefore = await copyOf(southId, chai);
    const res = await push({ itemIds: [chai], storeIds: [northId], fields: ['price'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 1 });
    const [north] = await copyOf(northId, chai);
    expect(north).toMatchObject({
      price_paise: 3500,
      name: 'Cutting Chai',
      stock_quantity: 4,
      is_available: false,
      sort_order: 9,
    });
    expect(await copyOf(southId, chai)).toEqual(southBefore);
  });

  it('pushes the name, description, category, diet and photo when chosen', async () => {
    await supabaseAdmin
      .from('menu_items')
      .update({ image_url: '/images/chai.jpg', category: 'Tea', diet: 'EGG' })
      .eq('id', chai)
      .throwOnError();
    const res = await push({
      itemIds: [chai],
      storeIds: [northId],
      fields: ['name', 'description', 'category', 'diet', 'photo'],
    });
    expect(res.status).toBe(200);
    const [north] = await copyOf(northId, chai);
    expect(north).toMatchObject({
      name: 'Masala Chai',
      description: 'Masala Chai from the template',
      category: 'Tea',
      diet: 'EGG',
      image_url: '/images/chai.jpg',
      price_paise: 2500,
    });
  });

  it('gives a branch without a copy a whole new one, untracked, at the end of its menu', async () => {
    expect(await copyOf(southId, toast)).toEqual([]);
    const res = await push({ itemIds: [toast], storeIds: [southId], fields: ['price'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 1 });
    const [copy] = await copyOf(southId, toast);
    expect(copy).toMatchObject({
      name: 'Cheese Toast',
      price_paise: 9000,
      category: 'Hot',
      stock_quantity: null,
      template_item_id: toast,
    });
    const { data: south } = await supabaseAdmin
      .from('menu_items')
      .select('sort_order')
      .eq('store_id', southId)
      .throwOnError();
    expect(copy!.sort_order).toBe(Math.max(...south.map((i) => i.sort_order)));
    // A second push finds that copy: no duplicate.
    await push({ itemIds: [toast], storeIds: [southId], fields: ['price'] });
    expect(await copyOf(southId, toast)).toHaveLength(1);
  });

  it('reaches the public menu at once, and leaves one menu.changed per store sharing one request id', async () => {
    // A DRAFT branch is not public: publish North for this check, before any read caches it as unseen.
    await supabaseAdmin
      .from('stores')
      .update({ status: 'ACTIVE' })
      .eq('id', northId)
      .throwOnError();
    await api().get(`/api/stores/${northId}/menu`); // fill the cache with the old price
    await supabaseAdmin
      .from('menu_items')
      .update({ price_paise: 4000 })
      .eq('id', chai)
      .throwOnError();
    const res = await push({ itemIds: [chai], storeIds: [northId, southId], fields: ['price'] });
    expect(res.status).toBe(200);
    const menu = await api().get(`/api/stores/${northId}/menu`);
    const prices = menu.body.categories.flatMap(
      (c: { items: { name: string; price: number }[] }) => c.items,
    );
    expect(prices.find((i: { name: string }) => i.name === 'Cutting Chai').price).toBe(40);

    const requestId = String(res.headers['x-request-id']);
    const { data: events } = await supabaseAdmin
      .from('domain_events')
      .select('store_id, actor')
      .eq('type', 'menu.changed')
      .eq('request_id', requestId)
      .throwOnError();
    expect(events.map((e) => e.store_id).sort()).toEqual([northId, southId].sort());
    expect(events.every((e) => (e.actor as { id?: string })?.id === owner.id)).toBe(true);
    const { data: audit } = await supabaseAdmin
      .from('audit_log')
      .select('store_id, request_id')
      .eq('request_id', requestId)
      .throwOnError();
    expect(audit.length).toBe(2);
    expect(new Set(audit.map((a) => a.store_id))).toEqual(new Set([northId, southId]));
    await supabaseAdmin.from('stores').update({ status: 'DRAFT' }).eq('id', northId).throwOnError();
  });

  it.each([
    [
      'a store of another brand',
      async () => ({ itemIds: [chai], storeIds: [northId, otherStoreId] }),
    ],
    ['the template itself', async () => ({ itemIds: [chai], storeIds: [northId, templateId] })],
    [
      'an item of another brand',
      async () => ({ itemIds: [chai, otherTemplateItem], storeIds: [northId] }),
    ],
    [
      "a branch's own copy, not a template item",
      async () => ({ itemIds: [chai, (await copyOf(southId, chai))[0]!.id], storeIds: [northId] }),
    ],
  ])('%s refuses the whole push (404) and changes nothing', async (_label, body) => {
    const before = await copyOf(northId, chai);
    const res = await push({ ...(await body()), fields: ['price'] });
    expect(res.status).toBe(404);
    expect(await copyOf(northId, chai)).toEqual(before);
  });

  it('an archived template item is refused', async () => {
    const archived = await insertItem(templateId, 'Old bun', 1000);
    await supabaseAdmin
      .from('menu_items')
      .update({ archived_at: new Date().toISOString(), is_available: false })
      .eq('id', archived)
      .throwOnError();
    const res = await push({ itemIds: [archived], storeIds: [northId], fields: ['price'] });
    expect(res.status).toBe(404);
    expect(await copyOf(northId, archived)).toEqual([]);
  });

  it('a repeat that changes nothing answers 0 and writes, audits and announces nothing', async () => {
    await push({ itemIds: [chai], storeIds: [northId], fields: ['price'] });
    const res = await push({ itemIds: [chai], storeIds: [northId], fields: ['price'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 0 });
    const requestId = String(res.headers['x-request-id']);
    const events = await supabaseAdmin
      .from('domain_events')
      .select('id')
      .eq('request_id', requestId)
      .throwOnError();
    const audit = await supabaseAdmin
      .from('audit_log')
      .select('id')
      .eq('request_id', requestId)
      .throwOnError();
    expect(events.data).toEqual([]);
    expect(audit.data).toEqual([]);
  });

  it('pushes of a new item at once leave one copy per branch, not several', async () => {
    for (let round = 0; round < 3; round++) {
      const bun = await insertItem(templateId, `Bun Maska ${round}`, 4000);
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          push({ itemIds: [bun], storeIds: [northId, southId], fields: ['name'] }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
      expect(await copyOf(northId, bun)).toHaveLength(1);
      expect(await copyOf(southId, bun)).toHaveLength(1);
    }
  });

  it('a suspended branch is not a target: the push is refused whole', async () => {
    await supabaseAdmin
      .from('stores')
      .update({ status: 'SUSPENDED' })
      .eq('id', southId)
      .throwOnError();
    try {
      const before = await copyOf(northId, chai);
      const res = await push({ itemIds: [chai], storeIds: [northId, southId], fields: ['price'] });
      expect(res.status).toBe(404);
      expect(await copyOf(northId, chai)).toEqual(before);
    } finally {
      await supabaseAdmin
        .from('stores')
        .update({ status: 'DRAFT' })
        .eq('id', southId)
        .throwOnError();
    }
  });
});
