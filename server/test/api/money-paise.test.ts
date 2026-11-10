// Money in paise (ADR-004). Destructive (local only): places an order through place_order directly and writes
// amounts behind the API's back.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MENU } from '../../scripts/seed-data';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createTestUser,
  deleteTestUser,
  localSql,
  resetDemoData,
  type TestUser,
} from '../setup/helpers';
import { resolveTestTarget } from '../setup/target';

let customer: TestUser;
let item: { id: string; store_id: string; name: string; price_paise: number };
let orderId: string;

beforeAll(async () => {
  // The seeded menu and an open store, whatever an earlier suite left behind (a closed store or an unavailable item
  // turns the POST /orders cases below into a 400).
  resetDemoData();
  customer = await createTestUser('CUSTOMER');
  // An available item without a stock count, so the order moves no stock.
  ({ data: item } = await supabaseAdmin
    .from('menu_items')
    .select('id, store_id, name, price_paise')
    .is('stock_quantity', null)
    .eq('is_available', true)
    .order('id')
    .limit(1)
    .single()
    .throwOnError());
  // A real order at the stored price, so the whole-rupee CHECK cases below have rows to try to break.
  const { data: placed } = await supabaseAdmin
    .rpc('place_order', {
      p_user_id: customer.id,
      p_store_id: item.store_id,
      p_customer_name: 'Money Test',
      p_payment_status: 'PAID',
      p_lines: [{ menu_item_id: item.id, quantity: 2, unit_price_paise: item.price_paise }],
    })
    .throwOnError();
  orderId = placed ?? '';
}, 30_000);

afterAll(async () => {
  // Orders reference profiles, so they go before the user (orders.test.ts explains the order and the guard).
  if (resolveTestTarget() !== 'local') return;
  await supabaseAdmin.rpc('reset_demo_orders').throwOnError();
  await deleteTestUser(customer);
});

it('a call without unit_price_paise is refused with PRICE_CHANGED and places nothing', async () => {
  const orders = async () =>
    (
      await supabaseAdmin
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', customer.id)
        .throwOnError()
    ).count;
  const before = await orders();
  const placed = await supabaseAdmin.rpc('place_order', {
    p_user_id: customer.id,
    p_store_id: item.store_id,
    p_customer_name: 'Money Test',
    p_payment_status: 'PAID',
    // The pre-paise API's shape: with no price to check against, the contract refuses it rather than trusting it.
    p_lines: [{ menu_item_id: item.id, name: 'x', unit_price: 1, quantity: 2 }],
  });
  expect(placed.error?.message).toBe('PRICE_CHANGED');
  expect(await orders()).toBe(before);
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
      // Status and body together, so a failure shows which error came back instead of a bare status.
      expect({ status: res.status, body: res.body }).toEqual({
        status: 409,
        body: {
          error: {
            code: 'PRICE_CHANGED',
            message: `The price of ${item.name} just changed to ₹${item.price_paise / 100}. Please review your order.`,
          },
        },
      });
    } finally {
      vi.restoreAllMocks();
    }
  });
});

it('the rupee columns and the trigger that synced them are gone (PR 16)', () => {
  // Counts, so the query returns a row either way and an empty answer cannot pass for "gone".
  expect(
    localSql<{ columns: number; functions: number }>(
      `select (select count(*) from information_schema.columns
                where table_schema = 'public'
                  and (table_name, column_name) in (('menu_items', 'price'), ('orders', 'total'),
                                                    ('order_items', 'unit_price'), ('order_items', 'line_total'))
              )::int as columns,
              (select count(*) from pg_proc where proname = 'menu_items_sync_price')::int as functions`,
    ),
  ).toEqual([{ columns: 0, functions: 0 }]);
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

    // The stored paise agree with the rupees the API answered, on every line and on the order.
    const { data: db } = await supabaseAdmin
      .from('orders')
      .select('total_paise, order_items (line_number, unit_price_paise, line_total_paise)')
      .eq('id', order.id)
      .single()
      .throwOnError();
    expect(db.total_paise).toBe(sum * 100);
    expect(db.total_paise).toBe(db.order_items.reduce((acc, l) => acc + l.line_total_paise, 0));
    expect(
      [...db.order_items]
        .sort((x, y) => x.line_number - y.line_number)
        .map((l) => ({ unitPrice: l.unit_price_paise / 100, lineTotal: l.line_total_paise / 100 })),
    ).toEqual(expected);

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

describe('every read path derives rupees from paise (PR 16)', () => {
  type Line = { unitPrice: number; lineTotal: number };
  type Ord = { id: string; total: number; items: Line[] };
  let staff: TestUser;
  let placed: Ord;
  let expectedTotal: number;

  beforeAll(async () => {
    staff = await createTestUser('STAFF');
    const { data: row } = await supabaseAdmin
      .from('menu_items')
      .select('id, price_paise')
      .eq('store_id', item.store_id)
      .eq('is_available', true)
      .is('stock_quantity', null)
      .order('price_paise', { ascending: false })
      .limit(1)
      .single()
      .throwOnError();
    const res = await api()
      .post('/api/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ idempotencyKey: randomUUID(), items: [{ menuItemId: row.id, quantity: 3 }] });
    expect(res.status).toBe(201);
    placed = res.body.order;
    expectedTotal = (row.price_paise * 3) / 100;
  }, 30_000);

  afterAll(async () => {
    if (resolveTestTarget() === 'local') await deleteTestUser(staff);
  });

  it('GET /orders/:id, the customer list and the staff board agree on the rupee amounts', async () => {
    const detail = await api()
      .get(`/api/orders/${placed.id}`)
      .set('Authorization', `Bearer ${customer.token}`);
    const list = await api().get('/api/orders').set('Authorization', `Bearer ${customer.token}`);
    const board = await api().get('/api/orders').set('Authorization', `Bearer ${staff.token}`);
    expect(detail.status).toBe(200);
    expect(list.status).toBe(200);
    expect(board.status).toBe(200);
    const found = [
      detail.body.order,
      list.body.orders.find((o: Ord) => o.id === placed.id),
      board.body.orders.find((o: Ord) => o.id === placed.id),
    ];
    for (const o of found) {
      expect(o.total).toBe(expectedTotal);
      expect(o.items[0].lineTotal).toBe(expectedTotal);
      expect(o.items[0].unitPrice * 3).toBe(expectedTotal);
    }
  });
});

describe('the seed and the API agree on prices (PR 16)', () => {
  it('every seeded item the menu returns carries its seed-data rupee price', async () => {
    const res = await api().get('/api/menu');
    const items: { name: string; price: number }[] = res.body.categories.flatMap(
      (c: { items: { name: string; price: number }[] }) => c.items,
    );
    // Every seeded item comes back, so a seed that skips some or a read that drops some cannot pass on the rest.
    expect(items.map((i) => i.name).sort()).toEqual(MENU.map((m) => m.name).sort());
    const byName = new Map(MENU.map((m) => [m.name, m.pricePaise / 100]));
    for (const i of items) expect(i.price, i.name).toBe(byName.get(i.name));
  });
});
