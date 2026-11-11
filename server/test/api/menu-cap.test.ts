import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MENU_ITEMS_MAX } from '../../src/services/menu.service';
import { invalidate } from '../../src/utils/cache';
import { logger } from '../../src/utils/logger';
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
    .order('created_at')
    .order('id')
    .limit(1)
    .single()
    .throwOnError();
  storeId = store.id;
  const rows = Array.from({ length: EXTRA_ITEMS }, (_, i) => ({
    store_id: storeId,
    category: CATEGORY,
    name: `Cap item ${i}`,
    description: '',
    price_paise: 1000,
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

describe('GET /api/menu when the cap bites', () => {
  it('logs a warning naming how many items were cut', async () => {
    const warn = vi.spyOn(logger, 'warn');
    invalidate('menu');
    await api().get('/api/menu');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ total: MENU.length + EXTRA_ITEMS, shown: MENU_ITEMS_MAX }),
      'Menu truncated',
    );
    warn.mockRestore();
  });

  it('cuts in the same order every time when many items share a sort order', async () => {
    await supabaseAdmin
      .from('menu_items')
      .update({ sort_order: 0 })
      .eq('category', CATEGORY)
      .throwOnError();
    const ids = async () => {
      invalidate('menu');
      const res = await api().get('/api/menu');
      return (res.body.categories as { items: { id: string }[] }[]).flatMap((c) =>
        c.items.map((i) => i.id),
      );
    };
    const first = await ids();
    expect(await ids()).toEqual(first);
    // Ties are broken by id, so the rows that share sort order 0 come back id-ascending.
    const tied = first.slice(0, 50);
    expect(tied).toEqual([...tied].sort());
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
