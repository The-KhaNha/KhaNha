// Local only: the brand template (P3.1, ADR-001 as amended). A brand keeps one never-public store whose menu new
// branches copy, with lineage; only the brand's owner reaches it, and only for what a copy inherits.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createBrandOwner,
  createStoreMember,
  createTestUser,
  deleteTestStores,
  type TestUser,
} from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
const COPIED = [
  'category',
  'name',
  'description',
  'price_paise',
  'image_url',
  'is_popular',
  'sort_order',
] as const;
let brandId = '';
let sourceId = '';
let templateId = '';
let branchId = '';
const storeIds: string[] = [];
let owner: TestUser;
let manager: TestUser;
let admin: TestUser;
let customer: TestUser;
const users: TestUser[] = [];

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
const itemsOf = async (storeId: string) =>
  (
    await supabaseAdmin
      .from('menu_items')
      .select('*')
      .eq('store_id', storeId)
      .order('sort_order')
      .throwOnError()
  ).data;
const openBranch = (slug: string) =>
  supabaseAdmin.rpc('create_store_from_template', {
    p_brand_id: brandId,
    p_name: 'Branch',
    p_slug: slug,
    p_area: 'North',
    p_address_line: '1 Road',
  });

beforeAll(async () => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'Template test', slug: `template-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandId = brand.id;
  const { data: source } = await supabaseAdmin
    .from('stores')
    .insert({
      name: 'Source',
      slug: `template-src-${tag}`,
      brand_id: brandId,
      status: 'ACTIVE',
      tagline: 'Test',
      description: 'The template source',
      max_quantity_per_item: 7,
      staff_order_list_limit: 40,
    })
    .select('id')
    .single()
    .throwOnError();
  sourceId = source.id;
  storeIds.push(sourceId);
  // Every key in every row: PostgREST's bulk insert sends a key missing from one row as NULL, not its default.
  const base = {
    store_id: sourceId,
    description: 'Test',
    image_url: '/images/x.jpg',
    is_popular: false,
    stock_quantity: null,
    archived_at: null,
  };
  await supabaseAdmin
    .from('menu_items')
    .insert([
      {
        ...base,
        name: 'Tea',
        category: 'Drinks',
        price_paise: 2000,
        sort_order: 1,
        is_popular: true,
      },
      {
        ...base,
        name: 'Bun',
        category: 'Bakery',
        price_paise: 3000,
        sort_order: 2,
        stock_quantity: 4,
      },
      {
        ...base,
        name: 'Gone',
        category: 'Bakery',
        price_paise: 1000,
        sort_order: 3,
        archived_at: new Date().toISOString(),
      },
    ])
    .throwOnError();

  const { data: id } = await supabaseAdmin
    .rpc('ensure_brand_template', { p_brand_id: brandId })
    .throwOnError();
  templateId = id;
  storeIds.push(templateId);

  owner = await createBrandOwner(brandId);
  manager = await createStoreMember(sourceId, 'MANAGER');
  admin = await createTestUser('ADMIN');
  customer = await createTestUser();
  users.push(owner, manager, admin, customer);
});

afterAll(async () => {
  await supabaseAdmin.from('orders').delete().in('store_id', storeIds);
  await supabaseAdmin.from('menu_items').delete().in('store_id', storeIds);
  await deleteTestStores(storeIds, [brandId], users);
});

describe('the template', () => {
  it('is a DRAFT store of the brand, made once from its oldest store', async () => {
    const { data: template } = await supabaseAdmin
      .from('stores')
      .select('status, is_template, brand_id, max_quantity_per_item, staff_order_list_limit')
      .eq('id', templateId)
      .single()
      .throwOnError();
    expect(template).toEqual({
      status: 'DRAFT',
      is_template: true,
      brand_id: brandId,
      max_quantity_per_item: 7,
      staff_order_list_limit: 40,
    });
    const { data: again } = await supabaseAdmin
      .rpc('ensure_brand_template', { p_brand_id: brandId })
      .throwOnError();
    expect(again).toBe(templateId);
  });

  it('copies the unarchived menu without stock, and the source items point at their copies', async () => {
    const template = await itemsOf(templateId);
    const source = (await itemsOf(sourceId)).filter((item) => item.archived_at === null);
    expect(template.map((item) => item.name)).toEqual(['Tea', 'Bun']);
    expect(template.every((item) => item.stock_quantity === null && item.is_available)).toBe(true);
    for (const [index, item] of source.entries()) {
      for (const key of COPIED) expect(template[index]?.[key]).toEqual(item[key]);
      expect(item.template_item_id).toBe(template[index]?.id);
    }
  });

  it('is the only template of its brand (unique index)', async () => {
    const { error } = await supabaseAdmin.from('stores').insert({
      name: 'Second template',
      slug: `template-second-${tag}`,
      brand_id: brandId,
      status: 'DRAFT',
      is_template: true,
      tagline: '',
      description: '',
    });
    expect(error?.code).toBe('23505');
  });

  it('takes a suffixed slug when <brand>-template is already a store', async () => {
    const { data: other } = await supabaseAdmin
      .from('brands')
      .insert({ name: 'Taken slug', slug: `taken-${tag}`, status: 'ACTIVE' })
      .select('id')
      .single()
      .throwOnError();
    const { data: squatter } = await supabaseAdmin
      .from('stores')
      .insert({
        name: 'Squatter',
        slug: `taken-${tag}-template`,
        brand_id: brandId,
        tagline: '',
        description: '',
      })
      .select('id')
      .single()
      .throwOnError();
    storeIds.push(squatter.id);
    const { data: id } = await supabaseAdmin
      .rpc('ensure_brand_template', { p_brand_id: other.id })
      .throwOnError();
    const { data: made } = await supabaseAdmin
      .from('stores')
      .select('slug')
      .eq('id', id)
      .single()
      .throwOnError();
    expect(made.slug).toMatch(new RegExp(`^taken-${tag}-template-[0-9a-f]{8}$`));
    // Deleting a brand's template store unlinks the brand (on delete set null), so no cleanup order is needed.
    await supabaseAdmin.from('domain_events').delete().eq('store_id', id).throwOnError();
    await supabaseAdmin.from('stores').delete().eq('id', id).throwOnError();
    await supabaseAdmin.from('brands').delete().eq('id', other.id).throwOnError();
  });

  it('can never be ACTIVE (check constraint)', async () => {
    const { error } = await supabaseAdmin
      .from('stores')
      .update({ status: 'ACTIVE' })
      .eq('id', templateId);
    expect(error?.code).toBe('23514');
  });

  it('never shows publicly, and cannot be ordered from', async () => {
    const { data: template } = await supabaseAdmin
      .from('stores')
      .select('slug')
      .eq('id', templateId)
      .single();
    const list = await api().get('/api/stores');
    expect(list.body.stores.map((store: { id: string }) => store.id)).not.toContain(templateId);
    expect((await api().get(`/api/stores/${template?.slug}`)).status).toBe(404);
    expect((await api().get(`/api/stores/${templateId}/menu`)).status).toBe(404);

    const [item] = await itemsOf(templateId);
    const res = await api()
      .post('/api/orders')
      .set(auth(customer))
      .send({ storeId: templateId, items: [{ menuItemId: item?.id, quantity: 1 }] });
    expect(res.status).toBe(404);
  });
});

describe('who reaches the template through a store route', () => {
  it('its owner, for settings and the audit trail', async () => {
    expect((await api().get(`/api/stores/${templateId}/settings`).set(auth(owner))).status).toBe(
      200,
    );
    expect((await api().get(`/api/stores/${templateId}/audit`).set(auth(owner))).status).toBe(200);
  });

  it('not its owner for a kitchen or team route: a template has neither', async () => {
    for (const path of ['orders', 'members']) {
      expect((await api().get(`/api/stores/${templateId}/${path}`).set(auth(owner))).status).toBe(
        404,
      );
    }
  });

  it('nobody else: a manager of a branch and a platform admin get 404', async () => {
    expect((await api().get(`/api/stores/${templateId}/settings`).set(auth(manager))).status).toBe(
      404,
    );
    expect((await api().get(`/api/stores/${templateId}/audit`).set(auth(admin))).status).toBe(404);
    expect((await api().get(`/api/stores/${templateId}/members`).set(auth(admin))).status).toBe(
      404,
    );
  });
});

describe('create_store_from_template', () => {
  beforeAll(async () => {
    // Changed after the template was made: a branch copies the template as it is now.
    await supabaseAdmin
      .from('stores')
      .update({ low_stock_threshold: 9 })
      .eq('id', templateId)
      .throwOnError();
    const [tea] = await itemsOf(templateId);
    await supabaseAdmin
      .from('menu_items')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', tea?.id ?? '')
      .throwOnError();
    const { data } = await openBranch(`template-branch-${tag}`).throwOnError();
    branchId = data;
    storeIds.push(branchId);
  });

  it('opens a DRAFT branch with the template settings and its unarchived items, each with lineage', async () => {
    const { data: branch } = await supabaseAdmin
      .from('stores')
      .select('status, is_template, area, address_line, max_quantity_per_item, low_stock_threshold')
      .eq('id', branchId)
      .single()
      .throwOnError();
    expect(branch).toEqual({
      status: 'DRAFT',
      is_template: false,
      area: 'North',
      address_line: '1 Road',
      max_quantity_per_item: 7,
      low_stock_threshold: 9,
    });
    const template = (await itemsOf(templateId)).filter((item) => item.archived_at === null);
    const copies = await itemsOf(branchId);
    expect(copies).toHaveLength(template.length);
    for (const [index, item] of template.entries()) {
      for (const key of COPIED) expect(copies[index]?.[key]).toEqual(item[key]);
      expect(copies[index]?.template_item_id).toBe(item.id);
    }
  });

  it('emits store.created for the branch', async () => {
    const { data } = await supabaseAdmin
      .from('domain_events')
      .select('type')
      .eq('aggregate_id', branchId)
      .throwOnError();
    expect(data.map((event) => event.type)).toEqual(['store.created']);
  });

  it('refuses a taken slug and leaves nothing behind', async () => {
    const before = (
      await supabaseAdmin.from('stores').select('id').eq('brand_id', brandId).throwOnError()
    ).data;
    const { error } = await openBranch(`template-branch-${tag}`);
    expect(error?.code).toBe('23505');
    const after = (
      await supabaseAdmin.from('stores').select('id').eq('brand_id', brandId).throwOnError()
    ).data;
    expect(after).toHaveLength(before.length);
  });
});
