// Local only: modifiers on the public menu (P3.2 PR 13a). Groups are listed once at the top level and items name them
// by id, in order; archived groups and options are left out, unavailable options stay (shown as sold out). While the
// store's `modifiers` flag is off the menu carries none, whatever is configured. A 60-item menu sharing three groups
// grows by under 9 KB and goes out under 8 KB gzipped.
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidate } from '../../src/utils/cache';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import { createTestUser, deleteTestStores, type TestUser } from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
const brandIds: string[] = [];
const storeIds: string[] = [];
const users: TestUser[] = [];
let slug = '';
let storeId = '';
const groupIds: Record<string, string> = {};

async function setFlag(enabled: boolean, stores: string[] = []) {
  await supabaseAdmin
    .from('feature_flags')
    .update({ enabled, rules: stores.length ? { storeIds: stores } : {} })
    .eq('key', 'modifiers')
    .throwOnError();
  invalidate('feature_flags');
}

interface OptionRow {
  name: string;
  price_delta_paise: number;
  is_default?: boolean;
  is_available?: boolean;
  archived_at?: string;
}

async function group(
  name: string,
  min: number,
  max: number,
  options: OptionRow[],
  archived = false,
) {
  const { data } = await supabaseAdmin
    .from('modifier_groups')
    .insert({
      store_id: storeId,
      name,
      min_select: min,
      max_select: max,
      archived_at: archived ? new Date().toISOString() : null,
    })
    .select('id')
    .single()
    .throwOnError();
  await supabaseAdmin
    .from('modifier_options')
    // Every column on every row: a bulk insert fills a key missing from one row with null, not its default.
    .insert(
      options.map((o, i) => ({
        group_id: data.id,
        sort_order: i,
        is_default: false,
        is_available: true,
        archived_at: null,
        ...o,
      })),
    )
    .throwOnError();
  groupIds[name] = data.id;
  return data.id;
}

beforeAll(async () => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'Mods', slug: `mods-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandIds.push(brand.id);
  slug = `store-mods-${tag}`;
  const { data: store } = await supabaseAdmin
    .from('stores')
    .insert({
      name: `Mods ${tag}`,
      slug,
      brand_id: brand.id,
      status: 'ACTIVE',
      tagline: 'Test',
      description: 'A store for menu-modifiers.test.ts',
    })
    .select('id')
    .single()
    .throwOnError();
  storeId = store.id;
  storeIds.push(storeId);

  await group('Size', 1, 1, [
    { name: 'Regular', price_delta_paise: 0, is_default: true },
    { name: 'Large', price_delta_paise: 3000 },
    { name: 'Gone', price_delta_paise: 100, archived_at: new Date().toISOString() },
  ]);
  await group('Milk', 0, 1, [
    { name: 'Oat', price_delta_paise: 2000 },
    { name: 'Soy', price_delta_paise: 1500, is_available: false },
  ]);
  await group('Add-ons', 0, 3, [
    { name: 'Extra shot', price_delta_paise: 4000 },
    { name: 'Cream', price_delta_paise: 2000 },
    { name: 'Syrup', price_delta_paise: 1000 },
  ]);
  await group('Old', 0, 1, [{ name: 'X', price_delta_paise: 0 }], true);

  // 60 items, each offering Size, Milk and Add-ons (and the archived group, which must not show).
  const { data: items } = await supabaseAdmin
    .from('menu_items')
    .insert(
      Array.from({ length: 60 }, (_, i) => ({
        store_id: storeId,
        category: `Category ${i % 6}`,
        name: `Coffee number ${i}`,
        description: 'A coffee with a description of an ordinary length for a menu card.',
        price_paise: 12000,
        sort_order: i,
        image_url: '/images/cold-coffee.jpg',
      })),
    )
    .select('id')
    .throwOnError();
  await supabaseAdmin
    .from('menu_item_modifier_groups')
    .insert(
      items.flatMap((item) =>
        ['Size', 'Milk', 'Add-ons', 'Old'].map((name, i) => ({
          menu_item_id: item.id,
          group_id: groupIds[name] ?? '',
          sort_order: i,
        })),
      ),
    )
    .throwOnError();
}, 60_000);

afterAll(async () => {
  await setFlag(false);
  await supabaseAdmin.from('modifier_groups').delete().eq('store_id', storeId).throwOnError();
  await deleteTestStores(storeIds, brandIds, users);
});

const menu = async () => {
  invalidate(`menu:${storeId}`);
  const res = await api().get(`/api/stores/${slug}/menu`);
  expect(res.status).toBe(200);
  return res;
};

describe('modifiers on the public menu', () => {
  it('while the flag is off, the menu carries none', async () => {
    await setFlag(false);
    const { body } = await menu();
    expect(body.modifierGroups).toEqual({});
    expect(body.categories[0].items[0].modifierGroupIds).toEqual([]);
  });

  it('on for this store: each group once, items name them in order, archived ones left out', async () => {
    await setFlag(true, [storeId]);
    const { body } = await menu();
    const item = body.categories[0].items[0];
    expect(item.modifierGroupIds).toEqual([groupIds.Size, groupIds.Milk, groupIds['Add-ons']]);
    expect(Object.keys(body.modifierGroups).sort()).toEqual(
      [groupIds.Size, groupIds.Milk, groupIds['Add-ons']].sort(),
    );
    expect(body.modifierGroups[groupIds.Size ?? '']).toEqual({
      id: groupIds.Size,
      name: 'Size',
      minSelect: 1,
      maxSelect: 1,
      options: [
        {
          id: expect.any(String),
          name: 'Regular',
          priceDelta: 0,
          isDefault: true,
          isAvailable: true,
        },
        {
          id: expect.any(String),
          name: 'Large',
          priceDelta: 30,
          isDefault: false,
          isAvailable: true,
        },
      ],
    });
    // A sold-out option stays, marked, so the picker can show it greyed out.
    expect(body.modifierGroups[groupIds.Milk ?? ''].options[1]).toMatchObject({
      name: 'Soy',
      isAvailable: false,
    });
  });

  it('on for another store only: this menu carries none', async () => {
    await setFlag(true, [randomUUID()]);
    const { body } = await menu();
    expect(body.modifierGroups).toEqual({});
  });

  it('60 items sharing three groups: the modifiers add under 9 KB, and the menu sent stays under 8 KB gzipped', async () => {
    await setFlag(true, [storeId]);
    const withModifiers = (await menu()).body;
    expect(Object.keys(withModifiers.modifierGroups)).toHaveLength(3);
    await setFlag(false);
    const plain = (await menu()).body;
    const bytes = (body: unknown) => Buffer.byteLength(JSON.stringify(body));
    // Each item names its groups by id (about 40 bytes each); each group is listed once.
    expect(bytes(withModifiers) - bytes(plain)).toBeLessThan(9 * 1024);
    // What a phone downloads: nginx gzips JSON at level 6.
    expect(gzipSync(JSON.stringify(withModifiers), { level: 6 }).length).toBeLessThan(8 * 1024);
  });

  it('the demo reset clears orders whose lines carry modifier snapshots', async () => {
    const customer = await createTestUser();
    users.push(customer);
    const { data: order } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: customer.id,
        store_id: storeId,
        store_name: 'Mods',
        customer_name: 'Test',
        total_paise: 15000,
        estimated_ready_at: new Date().toISOString(),
        status: 'COLLECTED',
      })
      .select('id')
      .single()
      .throwOnError();
    const { data: item } = await supabaseAdmin
      .from('menu_items')
      .select('id')
      .eq('store_id', storeId)
      .limit(1)
      .single()
      .throwOnError();
    const { data: line } = await supabaseAdmin
      .from('order_items')
      .insert({
        order_id: order.id,
        line_number: 1,
        menu_item_id: item.id,
        name: 'Coffee',
        category: 'Coffee',
        quantity: 1,
        reserved_quantity: 0,
        unit_price_paise: 15000,
        base_unit_price_paise: 12000,
        line_total_paise: 15000,
      })
      .select('id')
      .single()
      .throwOnError();
    await supabaseAdmin
      .from('order_item_modifiers')
      .insert({
        order_item_id: line.id,
        group_name: 'Size',
        option_name: 'Large',
        price_delta_paise: 3000,
      })
      .throwOnError();
    const { error } = await supabaseAdmin.rpc('reset_demo_orders');
    expect(error).toBeNull();
    const { data: left } = await supabaseAdmin
      .from('order_item_modifiers')
      .select('id')
      .throwOnError();
    expect(left).toEqual([]);
  });
});
