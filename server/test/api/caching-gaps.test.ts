// Destructive: mutates shared stock, the store's is_open flag and the site_settings row, and bulk-inserts
// orders for a test customer (removed in afterAll). Local only.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { MenuItemDto, MenuResponse } from '../../src/types/api';
import { invalidate } from '../../src/utils/cache';
import { supabaseAdmin } from '../../src/utils/supabase';
import { createTestUser, deleteTestUser, resetDemoData, type TestUser } from '../setup/helpers';
import { api } from '../setup/api';

let customer: TestUser;
let admin: TestUser;
let storeId: string;

beforeAll(async () => {
  resetDemoData();
  [customer, admin] = await Promise.all([createTestUser('CUSTOMER'), createTestUser('ADMIN')]);
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id')
    .limit(1)
    .single()
    .throwOnError();
  storeId = store.id;
});

afterAll(async () => {
  await Promise.all([deleteTestUser(customer), deleteTestUser(admin)]);
  resetDemoData();
});

async function menuStockOf(name: string): Promise<number | null> {
  const res = await api().get('/api/menu');
  const items = (res.body as MenuResponse).categories.flatMap((c) => c.items);
  return items.find((item: MenuItemDto) => item.name === name)!.stockQuantity;
}

describe('menu cache invalidation on an insufficient-stock refusal', () => {
  it('drops the cached menu even when the order is refused for stock, not just when it succeeds', async () => {
    const menu = (await api().get('/api/menu')).body as MenuResponse;
    const muffin = menu.categories
      .flatMap((c) => c.items)
      .find((i) => i.name === 'Blueberry Muffin')!;

    await supabaseAdmin
      .from('menu_items')
      .update({ stock_quantity: 5 })
      .eq('id', muffin.id)
      .throwOnError();
    expect(await menuStockOf('Blueberry Muffin')).toBe(5); // warms the cache at 5

    // Bypasses the cache, the way a concurrent sale would: the cache still believes 5.
    await supabaseAdmin
      .from('menu_items')
      .update({ stock_quantity: 2 })
      .eq('id', muffin.id)
      .throwOnError();

    const refused = await api()
      .post('/api/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ items: [{ menuItemId: muffin.id, quantity: 3 }] });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('INSUFFICIENT_STOCK');

    // A fresh read, not the stale cached 5: the refusal must have invalidated the menu cache too.
    expect(await menuStockOf('Blueberry Muffin')).toBe(2);
  });
});

describe('cached store reflects an update once invalidated', () => {
  afterEach(async () => {
    await supabaseAdmin.from('stores').update({ is_open: true }).eq('id', storeId).throwOnError();
    invalidate('store');
  });

  it('keeps serving the cached value within the TTL, then serves the fresh one after invalidate()', async () => {
    const before = await api().get('/api/store');
    expect(before.body.store.isOpen).toBe(true); // warms the cache

    await supabaseAdmin.from('stores').update({ is_open: false }).eq('id', storeId).throwOnError();
    const stillCached = await api().get('/api/store');
    expect(stillCached.body.store.isOpen).toBe(true); // stale on purpose: within the TTL

    invalidate('store');
    const fresh = await api().get('/api/store');
    expect(fresh.body.store.isOpen).toBe(false);
  });
});

describe('site_settings cache reflects a direct DB change once invalidated', () => {
  afterEach(async () => {
    await supabaseAdmin
      .from('site_settings')
      .update({ staff_order_list_limit: 100 })
      .eq('id', true)
      .throwOnError();
    invalidate('site_settings');
  });

  it('keeps serving the cached row within the TTL, then serves the fresh one after invalidate()', async () => {
    const before = await api()
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(before.body.settings.staffOrderListLimit).toBe(100); // warms the cache

    // Bypasses the cache and the PATCH endpoint, the way a dashboard edit or another API instance would.
    await supabaseAdmin
      .from('site_settings')
      .update({ staff_order_list_limit: 42 })
      .eq('id', true)
      .throwOnError();
    const stillCached = await api()
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(stillCached.body.settings.staffOrderListLimit).toBe(100); // stale on purpose: within the TTL

    invalidate('site_settings');
    const fresh = await api()
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(fresh.body.settings.staffOrderListLimit).toBe(42);
  });

  it('a PATCH invalidates immediately: the next GET never serves the pre-PATCH value', async () => {
    await supabaseAdmin
      .from('site_settings')
      .update({ staff_order_list_limit: 7 })
      .eq('id', true)
      .throwOnError();
    invalidate('site_settings');
    const warm = await api()
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(warm.body.settings.staffOrderListLimit).toBe(7); // warms the cache at 7

    const patched = await api()
      .patch('/api/admin/settings')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ staffOrderListLimit: 55 });
    expect(patched.status).toBe(200);
    expect(patched.body.settings.staffOrderListLimit).toBe(55);

    const after = await api()
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(after.body.settings.staffOrderListLimit).toBe(55);
  });
});

describe('customer order list is capped by site_settings (default 20)', () => {
  const insertedIds: string[] = [];

  afterAll(async () => {
    if (insertedIds.length > 0) {
      await supabaseAdmin.from('orders').delete().in('id', insertedIds).throwOnError();
    }
  });

  it('returns only the newest 20 of 55 orders for that customer', async () => {
    const now = Date.now();
    const rows = Array.from({ length: 55 }, (_, i) => ({
      user_id: customer.id,
      store_id: storeId,
      store_name: 'Campus Cafe',
      customer_name: 'Bulk Test',
      total: 100,
      total_paise: 10000,
      note: `bulk-${i}`,
      estimated_ready_at: new Date(now + 600_000).toISOString(),
      created_at: new Date(now + i * 1000).toISOString(), // higher i = newer
    }));
    const { data: inserted } = await supabaseAdmin
      .from('orders')
      .insert(rows)
      .select('id')
      .throwOnError();
    insertedIds.push(...inserted.map((r) => r.id));

    const res = await api().get('/api/orders').set('Authorization', `Bearer ${customer.token}`);
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(20);

    const notes: string[] = res.body.orders.map((o: { note: string | null }) => o.note as string);
    // The 35 oldest (bulk-0..bulk-34) are cut; the 20 newest (bulk-35..bulk-54) survive, newest first.
    expect(notes.slice(0, 3)).toEqual(['bulk-54', 'bulk-53', 'bulk-52']);
    expect(notes).not.toContain('bulk-0');
    expect(notes).not.toContain('bulk-34');
    expect(notes).toContain('bulk-35');
  });
});
