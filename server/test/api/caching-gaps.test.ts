// Destructive: mutates shared stock and the store's is_open flag, and bulk-inserts orders for a test
// customer (removed in afterAll). Local only.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { MenuItemDto, MenuResponse } from '../../src/types/api';
import { invalidate } from '../../src/utils/cache';
import { supabaseAdmin } from '../../src/utils/supabase';
import { createTestUser, deleteTestUser, resetDemoData, type TestUser } from '../setup/helpers';
import { api } from '../setup/api';

let customer: TestUser;
let storeId: string;

beforeAll(async () => {
  resetDemoData();
  customer = await createTestUser('CUSTOMER');
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id')
    .limit(1)
    .single()
    .throwOnError();
  storeId = store.id;
});

afterAll(async () => {
  await deleteTestUser(customer);
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

describe('customer order list is capped at CUSTOMER_LIST_LIMIT', () => {
  const insertedIds: string[] = [];

  afterAll(async () => {
    if (insertedIds.length > 0) {
      await supabaseAdmin.from('orders').delete().in('id', insertedIds).throwOnError();
    }
  });

  it('returns only the newest 50 of 55 orders for that customer', async () => {
    const now = Date.now();
    const rows = Array.from({ length: 55 }, (_, i) => ({
      user_id: customer.id,
      store_id: storeId,
      customer_name: 'Bulk Test',
      total: 100,
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
    expect(res.body.orders).toHaveLength(50);

    const notes: string[] = res.body.orders.map((o: { note: string | null }) => o.note as string);
    // The 5 oldest (bulk-0..bulk-4) are cut; the 50 newest (bulk-5..bulk-54) survive, newest first.
    expect(notes.slice(0, 3)).toEqual(['bulk-54', 'bulk-53', 'bulk-52']);
    expect(notes).not.toContain('bulk-0');
    expect(notes).not.toContain('bulk-4');
    expect(notes).toContain('bulk-5');
  });
});
