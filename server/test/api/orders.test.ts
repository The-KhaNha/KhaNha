import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OrderStatus } from '../../src/types/enums';
import { invalidate } from '../../src/utils/cache';
import { paiseToRupees } from '../../src/utils/money';
import { supabaseAdmin } from '../../src/utils/supabase';
import {
  createTestUser,
  deleteTestUser,
  oldestStoreId,
  resetDemoData,
  testAuthMatrix,
  type TestUser,
} from '../setup/helpers';
import { api } from '../setup/api';
import { resolveTestTarget } from '../setup/target';

interface MenuItemRow {
  id: string;
  name: string;
  price: number;
  stock_quantity: number | null;
  is_available: boolean;
}

interface OrderBodyOverrides {
  items?: Record<string, unknown>[];
  [key: string]: unknown;
}

let customer1: TestUser;
let customer2: TestUser;
let staff: TestUser;
let storeId: string;
let items: Record<string, MenuItemRow>;

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
  const { data: rows } = await supabaseAdmin
    .from('menu_items')
    .select('id, name, price_paise, stock_quantity, is_available')
    .eq('store_id', storeId)
    .throwOnError();
  // Rupees, as the API speaks them.
  items = Object.fromEntries(
    rows.map(({ price_paise, ...row }) => [
      row.name,
      { ...row, price: paiseToRupees(price_paise) },
    ]),
  );

  [customer1, customer2, staff] = await Promise.all([
    createTestUser('CUSTOMER'),
    createTestUser('CUSTOMER'),
    createTestUser('STAFF'),
  ]);
}, 30_000);

afterAll(async () => {
  // Orders reference profiles without ON DELETE CASCADE, so wipe orders before deleting the users who placed
  // them, or deleteTestUser fails with a foreign-key violation. resetDemoData() also removes every non-seed
  // account (including ours), so it cannot run first either: it would delete customer1/2/staff out from under
  // deleteTestUser ("User not found"). reset_demo_orders alone only truncates orders/order_items.
  // Guarded separately from resetDemoData()'s own check: afterAll still runs after a beforeAll failure (e.g. a
  // non-local target), and this RPC would otherwise truncate orders on whatever target that was.
  if (resolveTestTarget() !== 'local') return;
  await supabaseAdmin.rpc('reset_demo_orders').throwOnError();
  await Promise.all([customer1, customer2, staff].map((user) => deleteTestUser(user)));
  resetDemoData();
});

function auth(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/** Looks up a seeded menu item by name; throws (rather than returning undefined) if the seed ever changes. */
function menuItem(name: string): MenuItemRow {
  const item = items[name];
  if (!item) throw new Error(`Seeded menu item not found: ${name}`);
  return item;
}

function orderBody(overrides: OrderBodyOverrides = {}): OrderBodyOverrides {
  return {
    items: [{ menuItemId: menuItem('Cold Coffee').id, quantity: 1 }],
    ...overrides,
  };
}

function placeOrder(user: TestUser, overrides: OrderBodyOverrides = {}) {
  return api().post('/api/orders').set(auth(user.token)).send(orderBody(overrides));
}

function patchStatus(orderId: string, status: string, token = staff.token) {
  return api().patch(`/api/orders/${orderId}/status`).set(auth(token)).send({ status });
}

const NO_STACK_TRACE = /\bat .*\.(ts|js)|stack|PGRST|SQLSTATE|select |insert |update /i;

// ---------------------------------------------------------------------------
// 1. Auth matrix
// ---------------------------------------------------------------------------

testAuthMatrix('POST /api/orders', (http) => http.post('/api/orders').send(orderBody()));
testAuthMatrix('GET /api/orders', (http) => http.get('/api/orders'));
testAuthMatrix('GET /api/orders/:id', (http) => http.get(`/api/orders/${randomUUID()}`));
testAuthMatrix('PATCH /api/orders/:id/status', (http) =>
  http.patch(`/api/orders/${randomUUID()}/status`).send({ status: 'PREPARING' }),
);

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

// ---------------------------------------------------------------------------
// 3. Validation
// ---------------------------------------------------------------------------

describe('validation', () => {
  describe('items count', () => {
    it('0 items -> 400 VALIDATION_ERROR', async () => {
      const res = await placeOrder(customer1, { items: [] });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('31 items -> 400 VALIDATION_ERROR naming the site setting (max_lines_per_order, default 30)', async () => {
      const fake = Array.from({ length: 31 }, () => ({ menuItemId: randomUUID(), quantity: 1 }));
      const res = await placeOrder(customer1, { items: fake });
      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'An order can have at most 30 items.',
      });
    });

    it('counts lines as sent, before duplicates merge', async () => {
      const id = randomUUID();
      const same = Array.from({ length: 31 }, () => ({ menuItemId: id, quantity: 1 }));
      const res = await placeOrder(customer1, { items: same });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('An order can have at most 30 items.');
    });

    it('a lowered limit applies to the next order', async () => {
      await supabaseAdmin
        .from('site_settings')
        .update({ max_lines_per_order: 2 })
        .eq('id', true)
        .throwOnError();
      invalidate('site_settings');
      try {
        const fake = Array.from({ length: 3 }, () => ({ menuItemId: randomUUID(), quantity: 1 }));
        const res = await placeOrder(customer1, { items: fake });
        expect(res.status).toBe(400);
        expect(res.body.error.message).toBe('An order can have at most 2 items.');
      } finally {
        await supabaseAdmin
          .from('site_settings')
          .update({ max_lines_per_order: 30 })
          .eq('id', true)
          .throwOnError();
        invalidate('site_settings');
      }
    });

    it('101 items -> 400 from the schema hard cap, before the service runs', async () => {
      const fake = Array.from({ length: 101 }, () => ({ menuItemId: randomUUID(), quantity: 1 }));
      const res = await placeOrder(customer1, { items: fake });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('An order can have at most 100 items.');
    });

    it('30 items passes the count check (fails downstream as ITEM_NOT_FOUND for unknown ids)', async () => {
      const fake = Array.from({ length: 30 }, () => ({ menuItemId: randomUUID(), quantity: 1 }));
      const res = await placeOrder(customer1, { items: fake });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ITEM_NOT_FOUND');
    });
  });

  describe('quantity', () => {
    it.each([
      ['0', 0],
      ['1.5 (not an integer)', 1.5],
      ['"2" (string, not a number)', '2'],
    ])('%s -> 400 VALIDATION_ERROR', async (_label, quantity) => {
      const res = await placeOrder(customer1, {
        items: [{ menuItemId: menuItem('Cold Coffee').id, quantity }],
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  it('the same menuItemId twice (10 + 11) merges into 21 and is refused over the 20 cap', async () => {
    const id = menuItem('Cold Coffee').id;
    const res = await placeOrder(customer1, {
      items: [
        { menuItemId: id, quantity: 10 },
        { menuItemId: id, quantity: 11 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('Cold Coffee');
    expect(res.body.error.message).toContain('10');
  });

  describe('per-item cap boundary (the default, 10)', () => {
    it('a single line at exactly 10 passes', async () => {
      const res = await placeOrder(customer1, {
        items: [{ menuItemId: menuItem('Cold Coffee').id, quantity: 10 }],
      });
      expect(res.status).toBe(201);
    });

    it('a single line at 11 is refused', async () => {
      const res = await placeOrder(customer1, {
        items: [{ menuItemId: menuItem('Cold Coffee').id, quantity: 11 }],
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('Cold Coffee');
      expect(res.body.error.message).toContain('10');
    });

    it('duplicate lines of 5 and 6 merge to 11 and are refused', async () => {
      const id = menuItem('Cold Coffee').id;
      const res = await placeOrder(customer1, {
        items: [
          { menuItemId: id, quantity: 5 },
          { menuItemId: id, quantity: 6 },
        ],
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('note bounds', () => {
    it('200 chars passes', async () => {
      const res = await placeOrder(customer1, { note: 'a'.repeat(200) });
      expect(res.status).toBe(201);
    });

    it('201 chars is rejected', async () => {
      const res = await placeOrder(customer1, { note: 'a'.repeat(201) });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('customerName bounds', () => {
    it('60 chars passes', async () => {
      const res = await placeOrder(customer1, { customerName: 'a'.repeat(60) });
      expect(res.status).toBe(201);
    });

    it('61 chars is rejected', async () => {
      const res = await placeOrder(customer1, { customerName: 'a'.repeat(61) });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  it('a NUL byte in note is stripped, not rejected', async () => {
    const res = await placeOrder(customer1, { note: 'Extra\u0000 napkins' });
    expect(res.status).toBe(201);
    expect(res.body.order.note).toBe('Extra napkins');
  });

  it('wrong types are rejected outright: items as a string, quantity: null', async () => {
    const res1 = await placeOrder(customer1, {
      items: 'x' as unknown as Record<string, unknown>[],
    });
    expect(res1.status).toBe(400);
    expect(res1.body.error.code).toBe('VALIDATION_ERROR');

    const res2 = await placeOrder(customer1, {
      items: [{ menuItemId: menuItem('Cold Coffee').id, quantity: null }],
    });
    expect(res2.status).toBe(400);
    expect(res2.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('an empty body -> 400 VALIDATION_ERROR', async () => {
    const res = await api().post('/api/orders').set(auth(customer1.token)).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('malformed JSON -> 400 VALIDATION_ERROR', async () => {
    const res = await api()
      .post('/api/orders')
      .set(auth(customer1.token))
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('a body over the express.json() 100 kB default -> 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await placeOrder(customer1, { note: 'a'.repeat(150_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('status outside the enum is rejected on the PATCH body', async () => {
    const placed = await placeOrder(customer1);
    const res = await patchStatus(placed.body.order.id as string, 'BOGUS');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('status outside the enum is rejected on ?status=', async () => {
    const res = await api().get('/api/orders?status=BOGUS').set(auth(customer1.token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('extra fields (price, unitPrice, total) are stripped, not rejected, and change nothing', async () => {
    const coffee = menuItem('Cold Coffee');
    const espresso = menuItem('Espresso');
    const res = await placeOrder(customer1, {
      items: [
        { menuItemId: coffee.id, quantity: 2, price: 1, unitPrice: 1, total: 999_999 },
        { menuItemId: espresso.id, quantity: 3 },
      ],
      price: 1,
      unitPrice: 1,
      total: 999_999,
    });
    expect(res.status).toBe(201);
    expect(res.body.order.total).toBe(coffee.price * 2 + espresso.price * 3);
  });
});

// ---------------------------------------------------------------------------
// 4. Not found
// ---------------------------------------------------------------------------

describe('not found', () => {
  it('a random uuid on GET /orders/:id -> 404 NOT_FOUND', async () => {
    const res = await api().get(`/api/orders/${randomUUID()}`).set(auth(customer1.token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('"not-a-uuid" on GET /orders/:id -> 404 NOT_FOUND', async () => {
    const res = await api().get('/api/orders/not-a-uuid').set(auth(customer1.token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it("another customer's order is 404, never 403 (ids do not leak)", async () => {
    const placed = await placeOrder(customer1);
    const res = await api().get(`/api/orders/${placed.body.order.id}`).set(auth(customer2.token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('a staff PATCH on a missing id -> 404 NOT_FOUND', async () => {
    const res = await patchStatus(randomUUID(), 'PREPARING');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it("another store's item -> 400 ITEM_NOT_FOUND, and that store's stock is untouched", async () => {
    const { data: foreign } = await supabaseAdmin
      .from('menu_items')
      .select('id, stock_quantity')
      .neq('store_id', storeId)
      .order('id')
      .limit(1)
      .single()
      .throwOnError();
    // A real stock count, so a decrement would show (the seed leaves the other stores' items uncounted).
    await supabaseAdmin
      .from('menu_items')
      .update({ stock_quantity: 5 })
      .eq('id', foreign.id)
      .throwOnError();
    try {
      const res = await placeOrder(customer1, { items: [{ menuItemId: foreign.id, quantity: 1 }] });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ITEM_NOT_FOUND');
      const { data: after } = await supabaseAdmin
        .from('menu_items')
        .select('stock_quantity')
        .eq('id', foreign.id)
        .single()
        .throwOnError();
      expect(after.stock_quantity).toBe(5);
    } finally {
      await supabaseAdmin
        .from('menu_items')
        .update({ stock_quantity: foreign.stock_quantity })
        .eq('id', foreign.id)
        .throwOnError();
    }
  });

  it('/api/orders/%E0 -> 400 BAD_REQUEST (bad percent-encoding)', async () => {
    const res = await api().get('/api/orders/%E0').set(auth(customer1.token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });
});

// ---------------------------------------------------------------------------
// 5. Business rules
// ---------------------------------------------------------------------------

describe('business rules', () => {
  it('INSUFFICIENT_STOCK names the item; details equals { menuItemId, name, available }', async () => {
    const item = menuItem('Cheese Toast');
    await supabaseAdmin
      .from('menu_items')
      .update({ stock_quantity: 1 })
      .eq('id', item.id)
      .throwOnError();
    try {
      const res = await placeOrder(customer1, {
        items: [{ menuItemId: item.id, quantity: 2 }],
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
      expect(res.body.error.message).toContain('Cheese Toast');
      expect(res.body.error.details).toEqual({
        menuItemId: item.id,
        name: 'Cheese Toast',
        available: 1,
      });
    } finally {
      await supabaseAdmin
        .from('menu_items')
        .update({ stock_quantity: 1 })
        .eq('id', item.id)
        .throwOnError();
    }
  });

  it('ITEM_UNAVAILABLE when the item is switched off', async () => {
    const item = menuItem('Berry Smoothie');
    await supabaseAdmin
      .from('menu_items')
      .update({ is_available: false })
      .eq('id', item.id)
      .throwOnError();
    try {
      const res = await placeOrder(customer1, { items: [{ menuItemId: item.id, quantity: 1 }] });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ITEM_UNAVAILABLE');
      expect(res.body.error.details).toEqual({
        menuItemId: item.id,
        name: 'Berry Smoothie',
        available: 0,
      });
    } finally {
      await supabaseAdmin
        .from('menu_items')
        .update({ is_available: false })
        .eq('id', item.id)
        .throwOnError();
    }
  });

  it('STORE_CLOSED when the store is closed', async () => {
    await supabaseAdmin.from('stores').update({ is_open: false }).eq('id', storeId).throwOnError();
    try {
      const res = await placeOrder(customer1);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('STORE_CLOSED');
    } finally {
      await supabaseAdmin.from('stores').update({ is_open: true }).eq('id', storeId).throwOnError();
    }
  });

  it('the order total is the sum of database price × quantity', async () => {
    const coffee = menuItem('Cold Coffee');
    const cappuccino = menuItem('Cappuccino');
    const res = await placeOrder(customer1, {
      items: [
        { menuItemId: coffee.id, quantity: 2 },
        { menuItemId: cappuccino.id, quantity: 1 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.order.total).toBe(coffee.price * 2 + cappuccino.price * 1);
  });

  describe('the full 5x5 status transition matrix', () => {
    const ALL_STATUSES: OrderStatus[] = ['PLACED', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED'];
    const ALLOWED: [OrderStatus, OrderStatus][] = [
      ['PLACED', 'PREPARING'],
      ['PLACED', 'CANCELLED'],
      ['PREPARING', 'READY'],
      ['PREPARING', 'CANCELLED'],
      ['READY', 'COLLECTED'],
    ];
    const PATH_TO: Record<OrderStatus, OrderStatus[]> = {
      PLACED: [],
      PREPARING: ['PREPARING'],
      READY: ['PREPARING', 'READY'],
      COLLECTED: ['PREPARING', 'READY', 'COLLECTED'],
      CANCELLED: ['CANCELLED'],
    };

    function isAllowed(from: OrderStatus, to: OrderStatus): boolean {
      return ALLOWED.some(([f, t]) => f === from && t === to);
    }

    // A repeat of a transition that already happened answers 200 with the order unchanged: every status some
    // transition leads to, so all but PLACED (PLACED -> PLACED is not a transition, and stays 409).
    function isRepeat(from: OrderStatus, to: OrderStatus): boolean {
      return from === to && ALLOWED.some(([, t]) => t === to);
    }

    async function createOrderInStatus(from: OrderStatus): Promise<string> {
      const placed = await placeOrder(customer1);
      const orderId = placed.body.order.id as string;
      for (const step of PATH_TO[from]) {
        const res = await patchStatus(orderId, step);
        if (res.status !== 200) {
          throw new Error(`setup: could not move order to ${step}: ${JSON.stringify(res.body)}`);
        }
      }
      return orderId;
    }

    const pairs: [OrderStatus, OrderStatus][] = ALL_STATUSES.flatMap((from) =>
      ALL_STATUSES.map((to): [OrderStatus, OrderStatus] => [from, to]),
    );

    it.each(pairs)('%s -> %s', async (from, to) => {
      const orderId = await createOrderInStatus(from);
      const res = await patchStatus(orderId, to);
      if (isAllowed(from, to) || isRepeat(from, to)) {
        expect(res.status).toBe(200);
        expect(res.body.order.status).toBe(to);
      } else {
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
      }
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
});

// ---------------------------------------------------------------------------
// 6. Concurrency
// ---------------------------------------------------------------------------

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

  // PREPARING is raced against CANCELLED starting from PREPARING (not PLACED): from PLACED, the two are not
  // truly mutually exclusive, because PREPARING→CANCELLED is itself an allowed transition, so PLACED→PREPARING
  // winning the race first does not stop a PLACED→CANCELLED request from then succeeding as PREPARING→CANCELLED
  // (both would return 200 — confirmed by running it, and consistent with the transition matrix above). Racing
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

// ---------------------------------------------------------------------------
// 7. Envelope and DTO keys
// ---------------------------------------------------------------------------

describe('envelope and DTO keys', () => {
  it('a success body carries exactly the OrderDto keys, and each item exactly the OrderItemDto keys', async () => {
    const res = await placeOrder(customer1);
    expect(res.status).toBe(201);
    expect(Object.keys(res.body.order).sort()).toEqual(
      [
        'id',
        'orderNumber',
        'status',
        'paymentStatus',
        'total',
        'customerName',
        'customerPhone',
        'note',
        'estimatedReadyAt',
        'createdAt',
        'updatedAt',
        'store',
        'items',
      ].sort(),
    );
    for (const item of res.body.order.items as Record<string, unknown>[]) {
      expect(Object.keys(item).sort()).toEqual(
        ['id', 'menuItemId', 'name', 'unitPrice', 'quantity', 'lineTotal', 'imageUrl'].sort(),
      );
    }
  });

  it('every error body matches { error: { code, message, details? } }, details in a documented shape only', async () => {
    // A validation error names its field and nothing else.
    const validationRes = await placeOrder(customer1, { items: [] });
    expect(validationRes.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String), details: { field: 'items' } },
    });
    // A service-level rule with no single field carries no details.
    const tooMany = await placeOrder(customer1, {
      items: Array.from({ length: 31 }, () => ({ menuItemId: randomUUID(), quantity: 1 })),
    });
    expect(tooMany.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });

    const item = menuItem('Cheese Toast');
    await supabaseAdmin
      .from('menu_items')
      .update({ stock_quantity: 0 })
      .eq('id', item.id)
      .throwOnError();
    try {
      const stockRes = await placeOrder(customer1, {
        items: [{ menuItemId: item.id, quantity: 1 }],
      });
      expect(stockRes.body).toEqual({
        error: {
          code: expect.any(String),
          message: expect.any(String),
          details: { menuItemId: item.id, name: 'Cheese Toast', available: 0 },
        },
      });
    } finally {
      await supabaseAdmin
        .from('menu_items')
        .update({ stock_quantity: 1 })
        .eq('id', item.id)
        .throwOnError();
    }
  });

  it('never leaks a stack trace or SQL text in a success or an error body', async () => {
    const success = await placeOrder(customer1);
    expect(JSON.stringify(success.body)).not.toMatch(NO_STACK_TRACE);
    const failure = await placeOrder(customer1, { items: [] });
    expect(JSON.stringify(failure.body)).not.toMatch(NO_STACK_TRACE);
  });
});

// ---------------------------------------------------------------------------
// 8. Idempotency (place_order + the service's fast path)
// ---------------------------------------------------------------------------

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

    const res = await api().get('/api/orders').set(auth(staff.token));
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
    const res = await api().get('/api/orders').set(auth(staff.token));
    expect(res.body.orders).toHaveLength(FINISHED_LIMIT + 2);
    const placed = await api().get('/api/orders?status=PLACED').set(auth(staff.token));
    expect(placed.body.orders).toHaveLength(FINISHED_LIMIT + 2);
  });
});

describe('field details on a validation error', () => {
  it('names the request field at fault, so the form can show the message on it', async () => {
    const phone = await placeOrder(customer1, { customerPhone: '12' });
    expect(phone.status).toBe(400);
    expect(phone.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { field: 'customerPhone' },
    });
    const note = await placeOrder(customer1, { note: 'x'.repeat(201) });
    expect(note.body.error.details).toEqual({ field: 'note' });
    // A nested issue is named by its top-level field.
    const qty = await placeOrder(customer1, { items: [{ menuItemId: 'x', quantity: 0 }] });
    expect(qty.body.error.details).toEqual({ field: 'items' });
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
    expect(note.status).toBe(409);
    const name = await placeOrder(customer1, {
      idempotencyKey: key,
      note: 'Less spicy',
      customerName: 'Someone Else',
    });
    expect(name.status).toBe(409);
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
