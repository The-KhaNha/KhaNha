import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { invalidate } from '../../src/utils/cache';
import { supabaseAdmin } from '../../src/utils/supabase';
import {
  customer1,
  customer2,
  menuItem,
  placeOrder,
  useOrdersFixture,
  type MenuItemRow,
} from '../setup/orders';
import { expectError } from '../setup/helpers';

useOrdersFixture();

describe('concurrency', () => {
  it('two customers racing the last unit: exactly one 201, the other 400 INSUFFICIENT_STOCK; final stock is 0', async () => {
    const item = menuItem('Chocolate Brownie');
    await supabaseAdmin
      .from('menu_items')
      .update({ stock_quantity: 1 })
      .eq('id', item.id)
      .throwOnError();
    try {
      const [res1, res2] = await Promise.all([
        placeOrder(customer1, { items: [{ menuItemId: item.id, quantity: 1 }] }),
        placeOrder(customer2, { items: [{ menuItemId: item.id, quantity: 1 }] }),
      ]);
      expect([res1.status, res2.status].sort()).toEqual([201, 400]);
      const loser = res1.status === 400 ? res1 : res2;
      expect(loser.body.error.code).toBe('INSUFFICIENT_STOCK');

      const { data: stock } = await supabaseAdmin
        .from('menu_items')
        .select('stock_quantity')
        .eq('id', item.id)
        .single()
        .throwOnError();
      expect(stock.stock_quantity).toBe(0);

      const { count } = await supabaseAdmin
        .from('order_items')
        .select('id', { count: 'exact', head: true })
        .eq('menu_item_id', item.id);
      expect(count).toBe(1);
    } finally {
      await supabaseAdmin
        .from('menu_items')
        .update({ stock_quantity: 2 })
        .eq('id', item.id)
        .throwOnError();
    }
  });
});

describe('idempotencyKey', () => {
  /** A seeded item that tracks stock, so a double reservation would show; stock is topped up before each case. */
  function stockedItem(): MenuItemRow {
    return menuItem('Cheese Toast');
  }
  beforeEach(async () => {
    await supabaseAdmin
      .from('menu_items')
      .update({ stock_quantity: 5 })
      .eq('id', stockedItem().id)
      .throwOnError();
    invalidate('menu');
  });
  afterAll(async () => {
    await supabaseAdmin
      .from('menu_items')
      .update({ stock_quantity: stockedItem().stock_quantity })
      .eq('id', stockedItem().id)
      .throwOnError();
    invalidate('menu');
  });
  async function stockOf(id: string): Promise<number | null> {
    const { data } = await supabaseAdmin
      .from('menu_items')
      .select('stock_quantity')
      .eq('id', id)
      .single()
      .throwOnError();
    return data.stock_quantity;
  }

  it('the same key twice answers the same order once and reserves stock once', async () => {
    const item = stockedItem();
    const before = await stockOf(item.id);
    const body = { items: [{ menuItemId: item.id, quantity: 1 }], idempotencyKey: randomUUID() };

    const first = await placeOrder(customer1, body);
    const second = await placeOrder(customer1, body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.order.id).toBe(first.body.order.id);
    expect(await stockOf(item.id)).toBe((before ?? 0) - 1);
  });

  it('two simultaneous requests with one key place exactly one order', async () => {
    const item = stockedItem();
    const before = await stockOf(item.id);
    const body = { items: [{ menuItemId: item.id, quantity: 1 }], idempotencyKey: randomUUID() };

    const [a, b] = await Promise.all([placeOrder(customer1, body), placeOrder(customer1, body)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.order.id).toBe(b.body.order.id);
    expect(await stockOf(item.id)).toBe((before ?? 0) - 1);
  });

  it('the same key from two users, or no key at all, places two orders', async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([
      placeOrder(customer1, { idempotencyKey: key }),
      placeOrder(customer2, { idempotencyKey: key }),
    ]);
    expect(a.body.order.id).not.toBe(b.body.order.id);

    const [c, d] = await Promise.all([placeOrder(customer1), placeOrder(customer1)]);
    expect(c.body.order.id).not.toBe(d.body.order.id);
  });

  it('the same key with a different cart -> 409 IDEMPOTENCY_KEY_REUSED naming the placed order; nothing else changes', async () => {
    const item = stockedItem();
    const before = await stockOf(item.id);
    const key = randomUUID();
    const first = await placeOrder(customer1, {
      items: [{ menuItemId: item.id, quantity: 1 }],
      idempotencyKey: key,
    });
    expect(first.status).toBe(201);

    const changed = await placeOrder(customer1, {
      items: [{ menuItemId: item.id, quantity: 2 }],
      idempotencyKey: key,
    });
    expect(changed.status).toBe(409);
    expect(changed.body.error).toEqual({
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: `Your earlier order #${first.body.order.orderNumber} already went through. Pay again to order what is in your cart now.`,
      details: { orderId: first.body.order.id, orderNumber: first.body.order.orderNumber },
    });
    expect(await stockOf(item.id)).toBe((before ?? 0) - 1);
  });

  it('the same key with the same cart but a different note or name -> 409', async () => {
    const key = randomUUID();
    const first = await placeOrder(customer1, { idempotencyKey: key, note: 'Less spicy' });
    expect(first.status).toBe(201);
    const note = await placeOrder(customer1, { idempotencyKey: key, note: 'Extra spicy' });
    expectError(note, 409, 'IDEMPOTENCY_KEY_REUSED');
    const name = await placeOrder(customer1, {
      idempotencyKey: key,
      note: 'Less spicy',
      customerName: 'Someone Else',
    });
    expectError(name, 409, 'IDEMPOTENCY_KEY_REUSED');
    const same = await placeOrder(customer1, { idempotencyKey: key, note: 'Less spicy' });
    expect(same.status).toBe(201);
    expect(same.body.order.id).toBe(first.body.order.id);
  });

  it('two simultaneous requests with one key and different carts -> one order and one 409', async () => {
    const item = stockedItem();
    const before = await stockOf(item.id);
    const key = randomUUID();
    const results = await Promise.all([
      placeOrder(customer1, { items: [{ menuItemId: item.id, quantity: 1 }], idempotencyKey: key }),
      placeOrder(customer1, { items: [{ menuItemId: item.id, quantity: 2 }], idempotencyKey: key }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const placed = results.find((r) => r.status === 201);
    const stock = await stockOf(item.id);
    expect(stock).toBe((before ?? 0) - (placed?.body.order.items[0].quantity as number));
  });

  it('a key that is not a UUID -> 400 VALIDATION_ERROR; the key never appears in the response', async () => {
    const res = await placeOrder(customer1, { idempotencyKey: 'attempt-1' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');

    const key = randomUUID();
    const ok = await placeOrder(customer1, { idempotencyKey: key });
    expect(JSON.stringify(ok.body)).not.toContain(key);
  });
});
