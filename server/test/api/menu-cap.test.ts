import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MENU_ITEMS_MAX } from '../../src/services/menu.service';
import { invalidate } from '../../src/utils/cache';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import { MENU } from '../../scripts/seed-data';
import { resetDemoData } from '../setup/helpers';

// Destructive: inserts a category of throwaway items past the menu cap, PostgREST's 1000-row response cap and the
// length a list of their ids can take in a URL, then checks the demo reset removes every one of them.
const EXTRA_ITEMS = 1100;
const CATEGORY = 'Cap test';
let storeId: string;

beforeAll(async () => {
  resetDemoData();
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id')
    .limit(1)
    .single()
    .throwOnError();
  storeId = store.id;
  const rows = Array.from({ length: EXTRA_ITEMS }, (_, i) => ({
    store_id: storeId,
    category: CATEGORY,
    name: `Cap item ${i}`,
    description: '',
    price: 10,
    image_url: '/images/cold-coffee.jpg',
    sort_order: 10_000 + i,
  }));
  await supabaseAdmin.from('menu_items').insert(rows).throwOnError();
  invalidate('menu');
}, 30_000);

afterAll(async () => {
  await supabaseAdmin.from('menu_items').delete().eq('category', CATEGORY).throwOnError();
  invalidate('menu');
  resetDemoData();
});

describe('GET /api/menu with a menu larger than the cap', () => {
  it(`returns at most ${MENU_ITEMS_MAX} items, the lowest sort orders first, and still answers fast`, async () => {
    const started = Date.now();
    const res = await api().get('/api/menu');
    expect(res.status).toBe(200);
    const items = (res.body.categories as { items: unknown[] }[]).flatMap((c) => c.items);
    expect(items.length).toBe(MENU_ITEMS_MAX);
    // The seeded menu (low sort orders) is never pushed out by the overflow.
    expect(res.body.categories[0].name).not.toBe(CATEGORY);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('the demo reset with a menu larger than one response', () => {
  it('leaves exactly the seeded menu, however many other items the store has', async () => {
    resetDemoData();
    const { count: extra } = await supabaseAdmin
      .from('menu_items')
      .select('id', { count: 'exact', head: true })
      .eq('category', CATEGORY)
      .throwOnError();
    const { count: total } = await supabaseAdmin
      .from('menu_items')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .throwOnError();
    expect(extra).toBe(0);
    expect(total).toBe(MENU.length);
  }, 60_000);
});
