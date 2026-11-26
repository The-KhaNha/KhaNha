import { afterAll, describe, expect, it } from 'vitest';
import type { OrderStatus } from '../../src/types/enums';
import { invalidate } from '../../src/utils/cache';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import { oldestStoreId } from '../setup/helpers';
import {
  auth,
  customer1,
  menuItem,
  patchStatus,
  placeOrder,
  staff,
  storeId,
  useOrdersFixture,
} from '../setup/orders';

useOrdersFixture();

// ---------------------------------------------------------------------------
// 2. Role
// ---------------------------------------------------------------------------

describe('role', () => {
  it('403 FORBIDDEN for a customer on PATCH .../status; 200 for staff on the same call', async () => {
    const placed = await placeOrder(customer1);
    expect(placed.status).toBe(201);
    const orderId = placed.body.order.id as string;

    const asCustomer = await patchStatus(orderId, 'PREPARING', customer1.token);
    expect(asCustomer.status).toBe(403);
    expect(asCustomer.body.error.code).toBe('FORBIDDEN');

    const asStaff = await patchStatus(orderId, 'PREPARING');
    expect(asStaff.status).toBe(200);
    expect(asStaff.body.order.status).toBe('PREPARING');
  });
});

describe('cancelling restores stock', () => {
  it('restores tracked stock exactly once; a second cancel is a repeat (200) and stock is unchanged', async () => {
    const item = menuItem('Blueberry Muffin');
    await supabaseAdmin
      .from('menu_items')
      .update({ stock_quantity: 5 })
      .eq('id', item.id)
      .throwOnError();
    try {
      const placed = await placeOrder(customer1, {
        items: [{ menuItemId: item.id, quantity: 2 }],
      });
      expect(placed.status).toBe(201);
      const orderId = placed.body.order.id as string;

      const { data: afterOrder } = await supabaseAdmin
        .from('menu_items')
        .select('stock_quantity')
        .eq('id', item.id)
        .single()
        .throwOnError();
      expect(afterOrder.stock_quantity).toBe(3);

      const cancelled = await patchStatus(orderId, 'CANCELLED');
      expect(cancelled.status).toBe(200);

      const { data: afterCancel } = await supabaseAdmin
        .from('menu_items')
        .select('stock_quantity')
        .eq('id', item.id)
        .single()
        .throwOnError();
      expect(afterCancel.stock_quantity).toBe(5);

      const secondCancel = await patchStatus(orderId, 'CANCELLED');
      expect(secondCancel.status).toBe(200);
      expect(secondCancel.body.order.status).toBe('CANCELLED');

      const { data: afterSecond } = await supabaseAdmin
        .from('menu_items')
        .select('stock_quantity')
        .eq('id', item.id)
        .single()
        .throwOnError();
      expect(afterSecond.stock_quantity).toBe(5);
    } finally {
      await supabaseAdmin
        .from('menu_items')
        .update({ stock_quantity: 5 })
        .eq('id', item.id)
        .throwOnError();
    }
  });

  it('leaves untracked (null) stock untouched', async () => {
    const item = menuItem('Cold Coffee');
    const placed = await placeOrder(customer1, { items: [{ menuItemId: item.id, quantity: 1 }] });
    const orderId = placed.body.order.id as string;
    const cancelled = await patchStatus(orderId, 'CANCELLED');
    expect(cancelled.status).toBe(200);
    const { data } = await supabaseAdmin
      .from('menu_items')
      .select('stock_quantity')
      .eq('id', item.id)
      .single()
      .throwOnError();
    expect(data.stock_quantity).toBeNull();
  });

  // A cancel gives back only what its order took: an item that was untracked when ordered and is tracked (here:
  // sold out) by the time the order is cancelled must not gain stock it never lost.
  it('does not restock an item that was untracked when the order was placed', async () => {
    const item = menuItem('Cold Coffee');
    try {
      const placed = await placeOrder(customer1, {
        items: [{ menuItemId: item.id, quantity: 2 }],
      });
      expect(placed.status).toBe(201);
      await supabaseAdmin
        .from('menu_items')
        .update({ stock_quantity: 0 })
        .eq('id', item.id)
        .throwOnError();

      const cancelled = await patchStatus(placed.body.order.id as string, 'CANCELLED');
      expect(cancelled.status).toBe(200);
      const { data } = await supabaseAdmin
        .from('menu_items')
        .select('stock_quantity')
        .eq('id', item.id)
        .single()
        .throwOnError();
      expect(data.stock_quantity).toBe(0);
    } finally {
      await supabaseAdmin
        .from('menu_items')
        .update({ stock_quantity: null })
        .eq('id', item.id)
        .throwOnError();
    }
  });
});

describe('concurrency', () => {
  // PREPARING is raced against CANCELLED starting from PREPARING (not PLACED): from PLACED, the two are not
  // truly mutually exclusive, because PREPARING→CANCELLED is itself an allowed transition, so PLACED→PREPARING
  // winning the race first does not stop a PLACED→CANCELLED request from then succeeding as PREPARING→CANCELLED
  // (both would return 200 — confirmed by running it, and consistent with the transition matrix in order-fsm.test.ts). Racing
  // READY against CANCELLED from PREPARING keeps the two outcomes mutually exclusive regardless of who commits
  // first: neither READY nor CANCELLED is a valid predecessor of the other.
  it('two staff racing PREPARING→READY vs PREPARING→CANCELLED: exactly one 200, the other 409; stock restored only if CANCELLED won', async () => {
    const item = menuItem('Blueberry Muffin');
    await supabaseAdmin
      .from('menu_items')
      .update({ stock_quantity: 5 })
      .eq('id', item.id)
      .throwOnError();
    try {
      const placed = await placeOrder(customer1, {
        items: [{ menuItemId: item.id, quantity: 1 }],
      });
      expect(placed.status).toBe(201);
      const orderId = placed.body.order.id as string;
      const toPreparing = await patchStatus(orderId, 'PREPARING');
      expect(toPreparing.status).toBe(200);

      const [ready, cancel] = await Promise.all([
        patchStatus(orderId, 'READY'),
        patchStatus(orderId, 'CANCELLED'),
      ]);
      expect([ready.status, cancel.status].sort()).toEqual([200, 409]);

      const { data: stock } = await supabaseAdmin
        .from('menu_items')
        .select('stock_quantity')
        .eq('id', item.id)
        .single()
        .throwOnError();
      expect(stock.stock_quantity).toBe(cancel.status === 200 ? 5 : 4);
    } finally {
      await supabaseAdmin
        .from('menu_items')
        .update({ stock_quantity: 5 })
        .eq('id', item.id)
        .throwOnError();
    }
  });
});

describe('the staff board keeps every active order', () => {
  const FINISHED_LIMIT = 2;
  const setLimit = async (limit: number) => {
    // The board's length is the store's own setting (P2 PR 05); the staff here work at the oldest store.
    await supabaseAdmin
      .from('stores')
      .update({ staff_order_list_limit: limit })
      .eq('id', await oldestStoreId())
      .throwOnError();
    invalidate();
  };
  afterAll(() => setLimit(100));

  it('shows the order that has waited longest however many newer orders exist, and caps only finished ones', async () => {
    await supabaseAdmin.rpc('reset_demo_orders').throwOnError();
    await setLimit(FINISHED_LIMIT);
    const oldest = (await placeOrder(customer1)).body.order.id as string;
    const newer: string[] = [];
    for (let i = 0; i < FINISHED_LIMIT + 3; i += 1)
      newer.push((await placeOrder(customer1)).body.order.id);
    // All the newer ones are collected: before the fix they filled the limit and pushed the waiting one out.
    await supabaseAdmin
      .from('orders')
      .update({ status: 'COLLECTED' })
      .in('id', newer)
      .throwOnError();

    const res = await api().get(`/api/stores/${storeId}/orders`).set(auth(staff.token));
    expect(res.status).toBe(200);
    const ids = (res.body.orders as { id: string; status: OrderStatus }[]).map((o) => o.id);
    expect(ids).toContain(oldest);
    const finished = (res.body.orders as { status: OrderStatus }[]).filter(
      (o) => o.status === 'COLLECTED',
    );
    expect(finished).toHaveLength(FINISHED_LIMIT);
  });

  it('shows every active order even when there are more than the limit', async () => {
    await supabaseAdmin.rpc('reset_demo_orders').throwOnError();
    await setLimit(FINISHED_LIMIT);
    for (let i = 0; i < FINISHED_LIMIT + 2; i += 1) await placeOrder(customer1);
    const res = await api().get(`/api/stores/${storeId}/orders`).set(auth(staff.token));
    expect(res.body.orders).toHaveLength(FINISHED_LIMIT + 2);
    const placed = await api()
      .get(`/api/stores/${storeId}/orders?status=PLACED`)
      .set(auth(staff.token));
    expect(placed.body.orders).toHaveLength(FINISHED_LIMIT + 2);
  });
});
