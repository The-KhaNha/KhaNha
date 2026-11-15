// Local only: the demo seed (`pnpm run seed`) wipes hand-made stock changes with the orders, so an item it drops from
// a seeded store can still be deleted. Its own file: the seed also removes accounts registered while testing.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { supabaseAdmin } from '../../src/utils/supabase';
import { oldestStoreId, resetDemoData } from '../setup/helpers';

describe('the demo seed', () => {
  it('still runs when an item it drops from a seeded store has hand-made stock changes', async () => {
    const store = await oldestStoreId();
    const { data: item } = await supabaseAdmin
      .from('menu_items')
      .insert({
        store_id: store,
        name: `Stray ${randomUUID().slice(0, 8)}`,
        description: '',
        category: 'Test',
        price_paise: 1000,
        stock_quantity: 10,
      })
      .select('id')
      .single()
      .throwOnError();
    await supabaseAdmin
      .from('stock_movements')
      .insert({
        store_id: store,
        menu_item_id: item.id,
        delta: -1,
        resulting_quantity: 9,
        reason: 'MANUAL_ADJUST',
      })
      .throwOnError();
    expect(() => resetDemoData()).not.toThrow();
    const { data } = await supabaseAdmin
      .from('menu_items')
      .select('id')
      .eq('id', item.id)
      .throwOnError();
    expect(data).toEqual([]);
  }, 60_000);
});
