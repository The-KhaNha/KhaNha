// Order integrity (P1 PR 20, from the final P1 break). Destructive (local only): switches items off, closes the store
// and writes prices behind the API's back.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { simulatePayment } from '../../src/services/payment.service';
import { AppError } from '../../src/utils/errors';
import type { MenuResponse } from '../../src/types/api';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import { createTestUser, deleteTestUser, resetDemoData, type TestUser } from '../setup/helpers';
import { resolveTestTarget } from '../setup/target';

let customer: TestUser;
let item: { id: string; store_id: string; name: string; price_paise: number };

beforeAll(async () => {
  resetDemoData();
  customer = await createTestUser('CUSTOMER');
  ({ data: item } = await supabaseAdmin
    .from('menu_items')
    .select('id, store_id, name, price_paise')
    .is('stock_quantity', null)
    .eq('is_available', true)
    .order('id')
    .limit(1)
    .single()
    .throwOnError());
}, 30_000);

afterAll(async () => {
  if (resolveTestTarget() !== 'local') return;
  await supabaseAdmin.rpc('reset_demo_orders').throwOnError();
  await deleteTestUser(customer);
});

const price = () => item.price_paise / 100;

const place = (items: object[], idempotencyKey = randomUUID()) =>
  api()
    .post('/api/orders')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({ idempotencyKey, items });

async function ordersWithKey(key: string) {
  const { data } = await supabaseAdmin
    .from('orders')
    .select('id')
    .eq('idempotency_key', key)
    .throwOnError();
  return data;
}

describe('a cart line priced at what the customer saw (expectedUnitPrice)', () => {
  it('a stale price → 409 PRICE_CHANGED naming the current price, and nothing is placed', async () => {
    const key = randomUUID();
    const res = await place(
      [{ menuItemId: item.id, quantity: 1, expectedUnitPrice: price() - 10 }],
      key,
    );
    expect({ status: res.status, body: res.body }).toEqual({
      status: 409,
      body: {
        error: {
          code: 'PRICE_CHANGED',
          message: `The price of ${item.name} just changed to ₹${price()}. Please review your order.`,
        },
      },
    });
    expect(await ordersWithKey(key)).toEqual([]);
  });

  it('a duplicate line cannot hide a stale price behind a current one', async () => {
    const res = await place([
      { menuItemId: item.id, quantity: 1, expectedUnitPrice: price() },
      { menuItemId: item.id, quantity: 1, expectedUnitPrice: price() - 10 },
    ]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRICE_CHANGED');
  });

  it('the current price → 201, and a retry with the same key and cart replays the order', async () => {
    const key = randomUUID();
    const items = [{ menuItemId: item.id, quantity: 2, expectedUnitPrice: price() }];
    const res = await place(items, key);
    expect(res.status).toBe(201);
    expect(res.body.order.total).toBe(price() * 2);
    const replay = await place(items, key);
    expect(replay.status).toBe(201);
    expect(replay.body.order.id).toBe(res.body.order.id);
  });

  it('no expectedUnitPrice (the deployed client) → 201 at the current price', async () => {
    const res = await place([{ menuItemId: item.id, quantity: 1 }]);
    expect(res.status).toBe(201);
    expect(res.body.order.total).toBe(price());
  });

  it.each([0, -5, 1.5, '120'])('expectedUnitPrice %s → 400 VALIDATION_ERROR', async (bad) => {
    const res = await place([{ menuItemId: item.id, quantity: 1, expectedUnitPrice: bad }]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('switched off or closed after the API checked, before place_order ran', () => {
  // The race, made certain: the change lands between the API's read and the RPC (the break held the row lock).
  function changeBeforePlacing(change: () => PromiseLike<unknown>) {
    const real = supabaseAdmin.rpc.bind(supabaseAdmin);
    vi.spyOn(supabaseAdmin, 'rpc').mockImplementation(((fn: string, args: object) => {
      const call = () => real(fn as 'place_order', args as never);
      if (fn !== 'place_order') return call();
      // order.service calls .throwOnError() on the builder, so the change runs first inside that.
      return { throwOnError: async () => (await change(), call().throwOnError()) };
    }) as unknown as typeof supabaseAdmin.rpc);
  }

  async function stockOf(id: string) {
    const { data } = await supabaseAdmin
      .from('menu_items')
      .select('stock_quantity')
      .eq('id', id)
      .single()
      .throwOnError();
    return data.stock_quantity;
  }

  // Tracked for these tests, so a reservation the refusal failed to roll back would show.
  beforeAll(async () => {
    await supabaseAdmin
      .from('menu_items')
      .update({ stock_quantity: 5 })
      .eq('id', item.id)
      .throwOnError();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await supabaseAdmin
      .from('menu_items')
      .update({ stock_quantity: null, is_available: true })
      .eq('id', item.id)
      .throwOnError();
    await supabaseAdmin
      .from('stores')
      .update({ is_open: true })
      .eq('id', item.store_id)
      .throwOnError();
  });

  it('an item switched off → 400 ITEM_UNAVAILABLE, nothing placed, stock untouched', async () => {
    changeBeforePlacing(() =>
      supabaseAdmin.from('menu_items').update({ is_available: false }).eq('id', item.id),
    );
    const key = randomUUID();
    try {
      const res = await place([{ menuItemId: item.id, quantity: 2 }], key);
      expect({ status: res.status, body: res.body }).toEqual({
        status: 400,
        body: {
          error: {
            code: 'ITEM_UNAVAILABLE',
            message: `${item.name} is currently unavailable. Please remove it from your cart.`,
            details: { menuItemId: item.id, name: item.name, available: 0 },
          },
        },
      });
    } finally {
      vi.restoreAllMocks();
      await supabaseAdmin
        .from('menu_items')
        .update({ is_available: true })
        .eq('id', item.id)
        .throwOnError();
    }
    expect(await ordersWithKey(key)).toEqual([]);
    expect(await stockOf(item.id)).toBe(5);
  });

  it('the store closed → 400 STORE_CLOSED, nothing placed, stock untouched', async () => {
    const { data: store } = await supabaseAdmin
      .from('stores')
      .select('name')
      .eq('id', item.store_id)
      .single()
      .throwOnError();
    changeBeforePlacing(() =>
      supabaseAdmin.from('stores').update({ is_open: false }).eq('id', item.store_id),
    );
    const key = randomUUID();
    try {
      const res = await place([{ menuItemId: item.id, quantity: 2 }], key);
      expect({ status: res.status, body: res.body }).toEqual({
        status: 400,
        body: {
          error: {
            code: 'STORE_CLOSED',
            message: `${store.name} is closed right now. Please come back when it opens.`,
          },
        },
      });
    } finally {
      vi.restoreAllMocks();
      await supabaseAdmin
        .from('stores')
        .update({ is_open: true })
        .eq('id', item.store_id)
        .throwOnError();
    }
    expect(await ordersWithKey(key)).toEqual([]);
    expect(await stockOf(item.id)).toBe(5);
  });

  it('switched off AND short of stock → ITEM_UNAVAILABLE (not INSUFFICIENT_STOCK), stock untouched', async () => {
    changeBeforePlacing(() =>
      supabaseAdmin
        .from('menu_items')
        .update({ is_available: false, stock_quantity: 1 })
        .eq('id', item.id),
    );
    const key = randomUUID();
    try {
      const res = await place([{ menuItemId: item.id, quantity: 2 }], key);
      expect({
        status: res.status,
        code: res.body.error?.code,
        details: res.body.error?.details,
      }).toEqual({
        status: 400,
        code: 'ITEM_UNAVAILABLE',
        details: { menuItemId: item.id, name: item.name, available: 0 },
      });
      expect(await ordersWithKey(key)).toEqual([]);
      expect(await stockOf(item.id)).toBe(1);
    } finally {
      vi.restoreAllMocks();
      await supabaseAdmin
        .from('menu_items')
        .update({ is_available: true, stock_quantity: 5 })
        .eq('id', item.id)
        .throwOnError();
    }
  });
});

describe('nothing costs ₹0', () => {
  it('menu_items.price_paise = 0 is refused by its CHECK (23514)', async () => {
    try {
      const { error } = await supabaseAdmin
        .from('menu_items')
        .update({ price_paise: 0 })
        .eq('id', item.id);
      expect(error).toMatchObject({ code: '23514' });
      expect(error?.message).toContain('menu_items_price_paise_check');
    } finally {
      // Without the CHECK the update lands: put the price back so no later suite sees a free item.
      await supabaseAdmin
        .from('menu_items')
        .update({ price_paise: item.price_paise })
        .eq('id', item.id)
        .throwOnError();
    }
  });

  it('simulatePayment(0) is a 400 AppError, never a 500', async () => {
    const refused = await simulatePayment(0).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(AppError);
    expect(refused).toMatchObject({ status: 400, code: 'BAD_REQUEST' });
  });
});

describe('expectedUnitPrice edge matrix (which refusal wins, bounds, replay)', () => {
  let other: { id: string; name: string; price_paise: number };

  beforeAll(async () => {
    ({ data: other } = await supabaseAdmin
      .from('menu_items')
      .select('id, name, price_paise')
      .eq('is_available', true)
      .neq('id', item.id)
      .eq('store_id', item.store_id)
      .order('id')
      .limit(1)
      .single()
      .throwOnError());
  });

  afterAll(async () => {
    if (resolveTestTarget() !== 'local') return;
    await supabaseAdmin
      .from('menu_items')
      .update({ is_available: true, price_paise: other.price_paise })
      .eq('id', other.id)
      .throwOnError();
    await supabaseAdmin
      .from('menu_items')
      .update({ is_available: true, price_paise: item.price_paise })
      .eq('id', item.id)
      .throwOnError();
    await supabaseAdmin
      .from('stores')
      .update({ is_open: true })
      .eq('id', item.store_id)
      .throwOnError();
  });

  const otherPrice = () => other.price_paise / 100;

  it.each([
    ['null', null],
    ['1e20 (unsafe integer)', 1e20],
    ['a boolean', true],
    ['an object', {}],
  ])('expectedUnitPrice %s → 400 VALIDATION_ERROR', async (_label, bad) => {
    const res = await place([{ menuItemId: item.id, quantity: 1, expectedUnitPrice: bad }]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('the largest safe integer passes validation and is a stale price → 409', async () => {
    const res = await place([
      { menuItemId: item.id, quantity: 1, expectedUnitPrice: Number.MAX_SAFE_INTEGER },
    ]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRICE_CHANGED');
  });

  it('1 (the lower bound) validates: refused as stale, never as a validation error', async () => {
    const res = await place([{ menuItemId: item.id, quantity: 1, expectedUnitPrice: 1 }]);
    expect(res.status).toBe(409);
  });

  it('a matching line next to a stale one → 409 naming the stale item, nothing placed', async () => {
    const key = randomUUID();
    const res = await place(
      [
        { menuItemId: item.id, quantity: 1, expectedUnitPrice: price() },
        { menuItemId: other.id, quantity: 1, expectedUnitPrice: otherPrice() + 7 },
      ],
      key,
    );
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain(other.name);
    expect(res.body.error.message).toContain(`₹${otherPrice()}`);
    expect(await ordersWithKey(key)).toEqual([]);
  });

  it('all lines matching, or a mix of lines with and without a price → 201 at database prices', async () => {
    const res = await place([
      { menuItemId: item.id, quantity: 1, expectedUnitPrice: price() },
      { menuItemId: other.id, quantity: 2 },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.order.total).toBe(price() + otherPrice() * 2);
  });

  it('an unavailable item with a stale price → ITEM_UNAVAILABLE wins (docs/API.md order)', async () => {
    await supabaseAdmin
      .from('menu_items')
      .update({ is_available: false })
      .eq('id', other.id)
      .throwOnError();
    try {
      const res = await place([
        { menuItemId: other.id, quantity: 1, expectedUnitPrice: otherPrice() + 7 },
      ]);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ITEM_UNAVAILABLE');
      // Lines are checked in cart order: a stale first line is reported before an unavailable second one...
      const staleFirst = await place([
        { menuItemId: item.id, quantity: 1, expectedUnitPrice: price() + 7 },
        { menuItemId: other.id, quantity: 1 },
      ]);
      expect(staleFirst.body.error.code).toBe('PRICE_CHANGED');
      // ...and the other way round.
      const unavailableFirst = await place([
        { menuItemId: other.id, quantity: 1 },
        { menuItemId: item.id, quantity: 1, expectedUnitPrice: price() + 7 },
      ]);
      expect(unavailableFirst.body.error.code).toBe('ITEM_UNAVAILABLE');
    } finally {
      await supabaseAdmin
        .from('menu_items')
        .update({ is_available: true })
        .eq('id', other.id)
        .throwOnError();
    }
  });

  it('a quantity over the cap beats a stale price (VALIDATION_ERROR first)', async () => {
    const res = await place([
      { menuItemId: item.id, quantity: 11, expectedUnitPrice: price() + 7 },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('a closed store beats a stale price (STORE_CLOSED first)', async () => {
    await supabaseAdmin
      .from('stores')
      .update({ is_open: false })
      .eq('id', item.store_id)
      .throwOnError();
    try {
      const res = await place([
        { menuItemId: item.id, quantity: 1, expectedUnitPrice: price() + 7 },
      ]);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('STORE_CLOSED');
    } finally {
      await supabaseAdmin
        .from('stores')
        .update({ is_open: true })
        .eq('id', item.store_id)
        .throwOnError();
    }
  });

  it('a stale price is the same refusal as price_paise changing: new price accepted, old refused', async () => {
    const newPaise = item.price_paise + 500;
    await supabaseAdmin
      .from('menu_items')
      .update({ price_paise: newPaise })
      .eq('id', item.id)
      .throwOnError();
    try {
      const oldPrice = await place([
        { menuItemId: item.id, quantity: 1, expectedUnitPrice: price() },
      ]);
      expect(oldPrice.status).toBe(409);
      expect(oldPrice.body.error.message).toContain(`₹${newPaise / 100}`);
      const newPrice = await place([
        { menuItemId: item.id, quantity: 1, expectedUnitPrice: newPaise / 100 },
      ]);
      expect(newPrice.status).toBe(201);
      expect(newPrice.body.order.total).toBe(newPaise / 100);
    } finally {
      await supabaseAdmin
        .from('menu_items')
        .update({ price_paise: item.price_paise })
        .eq('id', item.id)
        .throwOnError();
    }
  });

  it('a replay after the price changed returns the original order (201, not 409)', async () => {
    const key = randomUUID();
    const items = [{ menuItemId: item.id, quantity: 1, expectedUnitPrice: price() }];
    const first = await place(items, key);
    expect(first.status).toBe(201);
    await supabaseAdmin
      .from('menu_items')
      .update({ price_paise: item.price_paise + 500 })
      .eq('id', item.id)
      .throwOnError();
    try {
      const replay = await place(items, key);
      expect(replay.status).toBe(201);
      expect(replay.body.order.id).toBe(first.body.order.id);
      expect(replay.body.order.total).toBe(price());
      expect(await ordersWithKey(key)).toHaveLength(1);
    } finally {
      await supabaseAdmin
        .from('menu_items')
        .update({ price_paise: item.price_paise })
        .eq('id', item.id)
        .throwOnError();
    }
  });
});

describe('a stale price refusal refreshes the cached menu', () => {
  const menuPrice = async () => {
    const res = await api().get('/api/menu');
    return (res.body as MenuResponse).categories
      .flatMap((c) => c.items)
      .find((i) => i.id === item.id)!.price;
  };

  it('after the 409, GET /api/menu shows the new price at once (not the cached old one)', async () => {
    expect(await menuPrice()).toBe(price()); // warms the cache
    const newPaise = item.price_paise + 700;
    // Written behind the API's back, so only the refusal can drop the cached menu.
    await supabaseAdmin
      .from('menu_items')
      .update({ price_paise: newPaise })
      .eq('id', item.id)
      .throwOnError();
    try {
      const res = await place([{ menuItemId: item.id, quantity: 1, expectedUnitPrice: price() }]);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PRICE_CHANGED');
      expect(await menuPrice()).toBe(newPaise / 100);
    } finally {
      await supabaseAdmin
        .from('menu_items')
        .update({ price_paise: item.price_paise })
        .eq('id', item.id)
        .throwOnError();
    }
  });
});
