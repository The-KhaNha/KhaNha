// Destructive (local only): places an order, then edits the seeded menu item and store behind the API's back.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { supabaseAdmin } from '../../src/utils/supabase';
import { createTestUser, deleteTestUser, resetDemoData, type TestUser } from '../setup/helpers';
import { api } from '../setup/api';
import { resolveTestTarget } from '../setup/target';

let customer: TestUser;

beforeAll(async () => {
  resetDemoData();
  customer = await createTestUser('CUSTOMER');
}, 30_000);

afterAll(async () => {
  // Orders reference profiles, so they go before the user (orders.test.ts explains the order and the guard).
  if (resolveTestTarget() !== 'local') return;
  await supabaseAdmin.rpc('reset_demo_orders').throwOnError();
  await deleteTestUser(customer);
  resetDemoData();
});

it('an order reads the same after its item and store are edited (P1.5 snapshots)', async () => {
  const { data: item } = await supabaseAdmin
    .from('menu_items')
    .select('id, store_id, category')
    .eq('name', 'Cold Coffee')
    .single()
    .throwOnError();
  const auth = { Authorization: `Bearer ${customer.token}` };

  const placed = await api()
    .post('/api/orders')
    .set(auth)
    .send({ items: [{ menuItemId: item.id, quantity: 1 }] });
  expect(placed.status).toBe(201);
  const before = await api().get(`/api/orders/${placed.body.order.id}`).set(auth);
  expect(before.status).toBe(200);

  await supabaseAdmin
    .from('menu_items')
    .update({
      name: 'Renamed',
      price_paise: 99900,
      image_url: '/images/elsewhere.jpg',
      category: 'Moved',
    })
    .eq('id', item.id)
    .throwOnError();
  await supabaseAdmin
    .from('stores')
    .update({ name: 'Renamed Store' })
    .eq('id', item.store_id)
    .throwOnError();

  const after = await api().get(`/api/orders/${placed.body.order.id}`).set(auth);
  expect(after.status).toBe(200);
  expect(after.body).toEqual(before.body);

  // Not sent by the API (analytics, P7.1), so checked in the row.
  const { data: line } = await supabaseAdmin
    .from('order_items')
    .select('category')
    .eq('order_id', placed.body.order.id)
    .single()
    .throwOnError();
  expect(line.category).toBe(item.category);
});

it('the customer list and the staff list read the snapshots too, even after the item is unavailable', async () => {
  const staff = await createTestUser('STAFF');
  try {
    const { data: item } = await supabaseAdmin
      .from('menu_items')
      .select('id, store_id')
      .is('stock_quantity', null)
      .eq('is_available', true)
      .limit(1)
      .single()
      .throwOnError();
    const auth = { Authorization: `Bearer ${customer.token}` };
    const staffAuth = { Authorization: `Bearer ${staff.token}` };

    const placed = await api()
      .post('/api/orders')
      .set(auth)
      .send({ items: [{ menuItemId: item.id, quantity: 2 }] });
    expect(placed.status).toBe(201);
    const id: string = placed.body.order.id;
    const pick = (body: { orders: { id: string }[] }) => body.orders.find((o) => o.id === id);

    const mine = await api().get('/api/orders').set(auth);
    const board = await api().get('/api/orders').set(staffAuth);
    expect(pick(mine.body)).toBeDefined();
    expect(pick(board.body)).toBeDefined();

    await supabaseAdmin
      .from('menu_items')
      .update({
        name: 'Gone',
        price_paise: 100,
        image_url: '/images/gone.jpg',
        is_available: false,
      })
      .eq('id', item.id)
      .throwOnError();
    await supabaseAdmin
      .from('stores')
      .update({ name: 'Another Name' })
      .eq('id', item.store_id)
      .throwOnError();

    const mineAfter = await api().get('/api/orders').set(auth);
    const boardAfter = await api().get('/api/orders').set(staffAuth);
    expect(pick(mineAfter.body)).toEqual(pick(mine.body));
    expect(pick(boardAfter.body)).toEqual(pick(board.body));
  } finally {
    await deleteTestUser(staff);
  }
});

it("stores the menu item's own name, never the name a caller sends in p_lines", async () => {
  // Any available item without a stock count: the tests above rename Cold Coffee, so it is not looked up by name.
  // place_order refuses an unavailable item, and the seed has some.
  const { data: item } = await supabaseAdmin
    .from('menu_items')
    .select('id, store_id, name, price_paise')
    .is('stock_quantity', null)
    .eq('is_available', true)
    .order('id')
    .limit(1)
    .single()
    .throwOnError();
  const { data: orderId } = await supabaseAdmin
    .rpc('place_order', {
      p_user_id: customer.id,
      p_store_id: item.store_id,
      p_customer_name: 'Snapshot Test',
      p_payment_status: 'PAID',
      p_lines: [
        {
          menu_item_id: item.id,
          name: 'Tampered',
          quantity: 1,
          unit_price_paise: item.price_paise,
        },
      ],
    })
    .throwOnError();
  const { data: lines } = await supabaseAdmin
    .from('order_items')
    .select('name')
    .eq('order_id', orderId)
    .throwOnError();
  expect(lines).toEqual([{ name: item.name }]);
});
