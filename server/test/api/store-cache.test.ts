// Destructive: places and cancels a real order, so it reseeds before and after (local only). Proves the three public
// store keys are served from cache and that stock changes drop menu:<storeId>.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MenuResponse } from '../../src/types/api';
import { invalidate } from '../../src/utils/cache';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createTestUser,
  deleteTestUser,
  oldestStoreId,
  resetDemoData,
  type TestUser,
} from '../setup/helpers';

let customer: TestUser;
let staff: TestUser;
let storeId: string;
let slug: string;

const menuOf = async () => (await api().get(`/api/stores/${slug}/menu`)).body as MenuResponse;
const stockOf = async (name: string) =>
  (await menuOf()).categories.flatMap((c) => c.items).find((i) => i.name === name)!.stockQuantity;

beforeAll(async () => {
  resetDemoData();
  customer = await createTestUser('CUSTOMER');
  staff = await createTestUser('STAFF');
  storeId = await oldestStoreId();
  const { data } = await supabaseAdmin.from('stores').select('slug').eq('id', storeId).single();
  slug = data!.slug;
});

afterAll(async () => {
  await supabaseAdmin.rpc('reset_demo_orders').throwOnError();
  await deleteTestUser(customer);
  await deleteTestUser(staff);
  resetDemoData();
});

describe('each public store key is served from cache', () => {
  it('stores:list, store:<id> and menu:<id> ignore a change made behind the API until invalidated', async () => {
    const { data: original } = await supabaseAdmin
      .from('stores')
      .select('tagline')
      .eq('id', storeId)
      .single();
    invalidate();
    await api().get('/api/stores');
    await api().get(`/api/stores/${slug}`);
    await api().get(`/api/stores/${slug}/menu`);

    await supabaseAdmin.from('stores').update({ tagline: 'Changed' }).eq('id', storeId);
    await supabaseAdmin
      .from('menu_items')
      .update({ stock_quantity: 99 })
      .eq('name', 'Blueberry Muffin')
      .eq('store_id', storeId);
    try {
      const listed = (await api().get('/api/stores')).body.stores as {
        id: string;
        tagline: string;
      }[];
      expect(listed.find((s) => s.id === storeId)!.tagline).not.toBe('Changed');
      expect((await api().get(`/api/stores/${slug}`)).body.store.tagline).not.toBe('Changed');
      expect(await stockOf('Blueberry Muffin')).not.toBe(99);

      invalidate();
      const fresh = (await api().get('/api/stores')).body.stores as typeof listed;
      expect(fresh.find((s) => s.id === storeId)!.tagline).toBe('Changed');
      expect((await api().get(`/api/stores/${slug}`)).body.store.tagline).toBe('Changed');
      expect(await stockOf('Blueberry Muffin')).toBe(99);
    } finally {
      await supabaseAdmin
        .from('stores')
        .update({ tagline: original!.tagline })
        .eq('id', storeId)
        .throwOnError();
      await supabaseAdmin
        .from('menu_items')
        .update({ stock_quantity: 5 })
        .eq('name', 'Blueberry Muffin')
        .eq('store_id', storeId)
        .throwOnError();
      invalidate();
    }
  });

  it('a repeat request answers 304 with If-None-Match', async () => {
    const first = await api().get(`/api/stores/${slug}/menu`);
    const second = await api()
      .get(`/api/stores/${slug}/menu`)
      .set('If-None-Match', first.headers.etag!);
    expect(second.status).toBe(304);
  });
});

describe('menu:<storeId> stays in step with orders', () => {
  it('an order that takes the last unit, then a cancel, show at once on the store menu', async () => {
    expect(await stockOf('Blueberry Muffin')).toBe(5); // warms menu:<id>
    const muffin = (await menuOf()).categories
      .flatMap((c) => c.items)
      .find((i) => i.name === 'Blueberry Muffin')!;

    const placed = await api()
      .post('/api/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ items: [{ menuItemId: muffin.id, quantity: 5 }] });
    expect(placed.status).toBe(201);
    const afterOrder = (await menuOf()).categories
      .flatMap((c) => c.items)
      .find((i) => i.name === 'Blueberry Muffin')!;
    expect(afterOrder.stockQuantity).toBe(0);
    expect(afterOrder.isAvailable).toBe(false);

    const cancelled = await api()
      .patch(`/api/orders/${placed.body.order.id}/status`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ status: 'CANCELLED' });
    expect(cancelled.status).toBe(200);
    expect(await stockOf('Blueberry Muffin')).toBe(5);
  });

  it('a cancel whose re-read fails still refreshes the store menu', async () => {
    const muffin = (await menuOf()).categories
      .flatMap((c) => c.items)
      .find((i) => i.name === 'Blueberry Muffin')!;
    const placed = await api()
      .post('/api/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ items: [{ menuItemId: muffin.id, quantity: 5 }] });
    expect(placed.status).toBe(201);
    expect(await stockOf('Blueberry Muffin')).toBe(0); // menu:<id> now holds the sold-out copy

    // The cancel commits, then the only `orders` read on that path (the re-read) fails once.
    // `from` is an overloaded generic; the fake only needs the table name, hence the casts through unknown.
    const realFrom = supabaseAdmin.from.bind(supabaseAdmin) as unknown as (
      table: string,
    ) => unknown;
    let failed = false;
    const fake = (table: string) => {
      if (table === 'orders' && !failed) {
        failed = true;
        throw new Error('re-read failed');
      }
      return realFrom(table);
    };
    const spy = vi
      .spyOn(supabaseAdmin, 'from')
      .mockImplementation(fake as unknown as typeof supabaseAdmin.from);
    try {
      const cancelled = await api()
        .patch(`/api/orders/${placed.body.order.id}/status`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ status: 'CANCELLED' });
      expect(cancelled.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await stockOf('Blueberry Muffin')).toBe(5);
  });
});
