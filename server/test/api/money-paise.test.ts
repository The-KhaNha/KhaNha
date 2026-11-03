// Money in paise (ADR-004). Destructive (local only): places an order through place_order directly, as the API
// deployed during the migration does, and writes amounts behind the API's back.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import { createTestUser, deleteTestUser, localSql, type TestUser } from '../setup/helpers';
import { resolveTestTarget } from '../setup/target';

let customer: TestUser;
let item: { id: string; store_id: string; name: string; price_paise: number };
let orderId: string;

beforeAll(async () => {
  customer = await createTestUser('CUSTOMER');
  // An item without a stock count, so the order moves no stock.
  ({ data: item } = await supabaseAdmin
    .from('menu_items')
    .select('id, store_id, name, price_paise')
    .is('stock_quantity', null)
    .order('id')
    .limit(1)
    .single()
    .throwOnError());
}, 30_000);

afterAll(async () => {
  // Orders reference profiles, so they go before the user (orders.test.ts explains the order and the guard).
  if (resolveTestTarget() !== 'local') return;
  await supabaseAdmin.rpc('reset_demo_orders').throwOnError();
  await deleteTestUser(customer);
});

it("a call in the deployed API's shape (rupees in unit_price, no unit_price_paise) places at the menu price", async () => {
  const placed = await supabaseAdmin.rpc('place_order', {
    p_user_id: customer.id,
    p_store_id: item.store_id,
    p_customer_name: 'Money Test',
    p_payment_status: 'PAID',
    // The deployed API's shape, with a wrong rupee price: it is ignored, and without unit_price_paise nothing is checked.
    p_lines: [{ menu_item_id: item.id, name: 'x', unit_price: 1, quantity: 2 }],
  });
  expect(placed.error).toBeNull();
  orderId = placed.data ?? '';

  const { data: order } = await supabaseAdmin
    .from('orders')
    .select(
      'total, total_paise, order_items (unit_price, unit_price_paise, line_total, line_total_paise)',
    )
    .eq('id', orderId)
    .single()
    .throwOnError();
  // The rupee columns are written beside the paise ones until PR 16, for the API deployed before the move.
  expect(order).toEqual({
    total_paise: item.price_paise * 2,
    total: (item.price_paise * 2) / 100,
    order_items: [
      {
        unit_price_paise: item.price_paise,
        unit_price: item.price_paise / 100,
        line_total_paise: item.price_paise * 2,
        line_total: (item.price_paise * 2) / 100,
      },
    ],
  });
});

describe('a price that changed after the API charged for it', () => {
  const stalePaise = () => item.price_paise + 100;

  it('place_order refuses the order with PRICE_CHANGED, places nothing and moves no stock', async () => {
    const key = randomUUID();
    // Tracked for this test, so a reservation the refusal failed to roll back would show.
    await supabaseAdmin
      .from('menu_items')
      .update({ stock_quantity: 5 })
      .eq('id', item.id)
      .throwOnError();
    try {
      const { error } = await supabaseAdmin.rpc('place_order', {
        p_user_id: customer.id,
        p_store_id: item.store_id,
        p_customer_name: 'Money Test',
        p_payment_status: 'PAID',
        p_lines: [
          { menu_item_id: item.id, name: 'x', unit_price_paise: stalePaise(), quantity: 2 },
        ],
        p_idempotency_key: key,
      });
      expect(error).toMatchObject({ code: 'P0001', message: 'PRICE_CHANGED' });
      expect(JSON.parse(error?.details ?? '')).toEqual({
        menuItemId: item.id,
        name: item.name,
        price: item.price_paise / 100,
      });

      const { data: placed } = await supabaseAdmin
        .from('orders')
        .select('id')
        .eq('idempotency_key', key)
        .throwOnError();
      expect(placed).toEqual([]);
      const { data: row } = await supabaseAdmin
        .from('menu_items')
        .select('stock_quantity')
        .eq('id', item.id)
        .single()
        .throwOnError();
      expect(row.stock_quantity).toBe(5);
    } finally {
      await supabaseAdmin
        .from('menu_items')
        .update({ stock_quantity: null })
        .eq('id', item.id)
        .throwOnError();
    }
  });

  it('POST /orders answers 409 PRICE_CHANGED naming the item and its price', async () => {
    // The race, made certain: the price the API charged for is stale by the time place_order reads the menu.
    const real = supabaseAdmin.rpc.bind(supabaseAdmin);
    vi.spyOn(supabaseAdmin, 'rpc').mockImplementation(((fn: string, args: object) => {
      if (fn !== 'place_order') return real(fn as 'place_order', args as never);
      const placeArgs = args as { p_lines: { unit_price_paise: number }[] };
      // Shifted, not set: an API that stopped sending unit_price_paise would send NaN (null), go unchecked and 201.
      for (const line of placeArgs.p_lines) line.unit_price_paise += 100;
      return real('place_order', placeArgs as never);
    }) as unknown as typeof supabaseAdmin.rpc);
    try {
      const res = await api()
        .post('/api/orders')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({ idempotencyKey: randomUUID(), items: [{ menuItemId: item.id, quantity: 1 }] });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: {
          code: 'PRICE_CHANGED',
          message: `The price of ${item.name} just changed to ₹${item.price_paise / 100}. Please review your order.`,
        },
      });
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('menu_items.price and price_paise stay in step until PR 16 drops price', () => {
  let rowId: string | undefined;

  afterAll(async () => {
    if (rowId) await supabaseAdmin.from('menu_items').delete().eq('id', rowId).throwOnError();
  });

  it('an insert that sets only price (the deployed API, the old seed) fills price_paise', () => {
    const [row] = localSql<{ id: string; price: number; price_paise: number }>(
      `insert into public.menu_items (store_id, category, name, description, image_url, price)
       values ('${item.store_id}', 'Test', 'Paise sync test', 'x', '/x.webp', 60)
       returning id, price, price_paise`,
    );
    rowId = row?.id;
    expect(row).toMatchObject({ price: 60, price_paise: 6000 });
  });

  it('an update of only one column derives the other', async () => {
    const read = async () =>
      (
        await supabaseAdmin
          .from('menu_items')
          .select('price, price_paise')
          .eq('id', rowId ?? '')
          .single()
          .throwOnError()
      ).data;
    await supabaseAdmin
      .from('menu_items')
      .update({ price_paise: 7000 })
      .eq('id', rowId ?? '')
      .throwOnError();
    expect(await read()).toEqual({ price: 70, price_paise: 7000 });
    await supabaseAdmin
      .from('menu_items')
      .update({ price: 80 })
      .eq('id', rowId ?? '')
      .throwOnError();
    expect(await read()).toEqual({ price: 80, price_paise: 8000 });
  });

  it('a write of both that disagree is refused', async () => {
    const { error } = await supabaseAdmin
      .from('menu_items')
      .update({ price: 90, price_paise: 5000 })
      .eq('id', rowId ?? '');
    expect(error).toMatchObject({ message: expect.stringContaining('disagree') });
  });
});

describe('every paise column refuses a part of a rupee while the API sends rupees', () => {
  const refused = (result: { error: { code: string; message: string } | null }, check: string) => {
    expect(result.error).toMatchObject({ code: '23514' });
    expect(result.error?.message).toContain(check);
  };

  it('menu_items.price_paise', async () => {
    refused(
      await supabaseAdmin.from('menu_items').update({ price_paise: 4950 }).eq('id', item.id),
      'menu_items_price_paise_whole_rupees',
    );
  });

  it('orders.total_paise', async () => {
    refused(
      await supabaseAdmin.from('orders').update({ total_paise: 4950 }).eq('id', orderId),
      'orders_total_paise_whole_rupees',
    );
  });

  it('order_items.unit_price_paise and line_total_paise', async () => {
    refused(
      await supabaseAdmin
        .from('order_items')
        .update({ unit_price_paise: 4950 })
        .eq('order_id', orderId),
      'order_items_unit_price_paise_whole_rupees',
    );
    refused(
      await supabaseAdmin
        .from('order_items')
        .update({ line_total_paise: 4950 })
        .eq('order_id', orderId),
      'order_items_line_total_paise_whole_rupees',
    );
  });
});

describe('the API still speaks whole rupees', () => {
  it('a multi-line order: rupee prices, total = sum of lines, rupee = paise / 100, replay is identical', async () => {
    const { data: rows } = await supabaseAdmin
      .from('menu_items')
      .select('id, price_paise')
      .eq('store_id', item.store_id)
      .eq('is_available', true)
      .is('stock_quantity', null)
      .order('id')
      .limit(3)
      .throwOnError();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const quantityOf = (i: number) => 2 * i + 1;
    const body = {
      idempotencyKey: randomUUID(),
      items: rows.map((row, i) => ({ menuItemId: row.id, quantity: quantityOf(i) })),
    };
    const place = () =>
      api().post('/api/orders').set('Authorization', `Bearer ${customer.token}`).send(body);

    const res = await place();
    expect(res.status).toBe(201);
    const order = res.body.order;
    const expected = rows.map((row, i) => ({
      unitPrice: row.price_paise / 100,
      lineTotal: (row.price_paise * quantityOf(i)) / 100,
    }));
    expect(order.items.map((l: { unitPrice: number }) => l.unitPrice)).toEqual(
      expected.map((e) => e.unitPrice),
    );
    expect(order.items.map((l: { lineTotal: number }) => l.lineTotal)).toEqual(
      expected.map((e) => e.lineTotal),
    );
    const sum = expected.reduce((acc, e) => acc + e.lineTotal, 0);
    expect(order.total).toBe(sum);
    for (const n of [
      order.total,
      ...order.items.flatMap((l: { unitPrice: number; lineTotal: number }) => [
        l.unitPrice,
        l.lineTotal,
      ]),
    ]) {
      expect(Number.isInteger(n)).toBe(true);
    }

    // The rupee and paise columns agree on every line and on the order.
    const { data: db } = await supabaseAdmin
      .from('orders')
      .select(
        'total, total_paise, order_items (unit_price, unit_price_paise, line_total, line_total_paise)',
      )
      .eq('id', order.id)
      .single()
      .throwOnError();
    expect(db.total).toBe(db.total_paise / 100);
    expect(db.total_paise).toBe(db.order_items.reduce((acc, l) => acc + l.line_total_paise, 0));
    for (const l of db.order_items) {
      expect(l.unit_price).toBe(l.unit_price_paise / 100);
      expect(l.line_total).toBe(l.line_total_paise / 100);
    }

    // A replay answers the same order and the same rupee total.
    const replay = await place();
    expect(replay.body.order.id).toBe(order.id);
    expect(replay.body.order.total).toBe(sum);

    // The menu keeps whole rupees too.
    const menu = await api().get('/api/menu');
    const menuItems = menu.body.categories.flatMap(
      (c: { items: { id: string; price: number }[] }) => c.items,
    );
    for (const row of rows) {
      expect(menuItems.find((m: { id: string }) => m.id === row.id)?.price).toBe(
        row.price_paise / 100,
      );
    }
  });
});
