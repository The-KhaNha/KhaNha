// Destructive (local only): the order lifecycle and stock as a state machine (docs/TESTING.md "The order state
// machine"). Two stores of its own: every transition and refusal with its side effects (status, stock, events,
// audit), the races, the replays, then a fast-check model run that checks every invariant after every command.
import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALLOWED_TRANSITIONS } from '../../src/services/order.service';
import type { OrderStatus } from '../../src/types/enums';
import { invalidate } from '../../src/utils/cache';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createStoreMember,
  createTestUser,
  deleteTestStores,
  expectError,
  localExec,
  localSql,
  type TestUser,
} from '../setup/helpers';

// The transitions this suite expects, written out: "the table is the service's" below holds the service to it, and
// client orderStatus.test.ts holds the staff board's buttons to the same copy.
const NEXT: Record<OrderStatus, OrderStatus[]> = {
  PLACED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COLLECTED'],
  COLLECTED: [],
  CANCELLED: [],
};
const ALL = Object.keys(NEXT) as OrderStatus[];
// The moves that reach each status from PLACED.
const PATH: Record<OrderStatus, OrderStatus[]> = {
  PLACED: [],
  PREPARING: ['PREPARING'],
  READY: ['PREPARING', 'READY'],
  COLLECTED: ['PREPARING', 'READY', 'COLLECTED'],
  CANCELLED: ['CANCELLED'],
};
type Outcome = 'CHANGED' | 'REPEAT' | 'INVALID';
/** A listed move changes; a repeat of a status some move leads to is 200 and changes nothing; anything else is 409. */
const outcome = (from: OrderStatus, to: OrderStatus): Outcome =>
  NEXT[from].includes(to) ? 'CHANGED' : from === to && from !== 'PLACED' ? 'REPEAT' : 'INVALID';

const PRICE_PAISE = { T: 12_000, T2: 9_000, U: 8_000 };
const brandIds: string[] = [];
const store = { a: '', b: '' };
const item = { T: '', T2: '', U: '' };
const customers = [] as unknown as [TestUser, TestUser];
let staff: TestUser;
let staff2: TestUser;
let manager: TestUser;
let admin: TestUser;
let staffB: TestUser;

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
const lines = (t: number, u = 0, t2 = 0) => [
  ...(t > 0 ? [{ menuItemId: item.T, quantity: t }] : []),
  ...(u > 0 ? [{ menuItemId: item.U, quantity: u }] : []),
  ...(t2 > 0 ? [{ menuItemId: item.T2, quantity: t2 }] : []),
];
const orderBody = (t: number, u = 0, t2 = 0) => ({
  storeId: store.a,
  idempotencyKey: randomUUID(),
  items: lines(t, u, t2),
});
const place = (user: TestUser, body: object) =>
  api().post('/api/orders').set(auth(user)).send(body);
const move = (
  orderId: string,
  status: OrderStatus,
  user: TestUser = staff,
  storeId = store.a,
  requestId = randomUUID(),
) =>
  api()
    .patch(`/api/stores/${storeId}/orders/${orderId}/status`)
    .set(auth(user))
    .set('x-request-id', requestId)
    .send({ status });
const adjust = (body: object) =>
  api().patch(`/api/stores/${store.a}/menu-items/${item.T}/stock`).set(auth(manager)).send(body);

async function setStock(id: string, quantity: number | null): Promise<void> {
  await supabaseAdmin
    .from('menu_items')
    .update({ stock_quantity: quantity })
    .eq('id', id)
    .throwOnError();
  invalidate();
}
async function stockOf(id: string): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from('menu_items')
    .select('stock_quantity')
    .eq('id', id)
    .single()
    .throwOnError();
  return data.stock_quantity;
}
async function statusOf(orderId: string): Promise<OrderStatus> {
  const { data } = await supabaseAdmin
    .from('orders')
    .select('status')
    .eq('id', orderId)
    .single()
    .throwOnError();
  return data.status;
}
async function countFor(table: 'domain_events' | 'audit_log', column: string, value: string) {
  const { count } = await supabaseAdmin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(column, value)
    .throwOnError();
  return count ?? 0;
}
/** Places T×qty and walks it to `status` through the staff route; returns the order id. */
async function orderAt(status: OrderStatus, qty = 2): Promise<string> {
  const placed = await place(customers[0], orderBody(qty));
  expect(placed.status).toBe(201);
  const id: string = placed.body.order.id;
  for (const step of PATH[status]) expect((await move(id, step)).status).toBe(200);
  return id;
}

beforeAll(async () => {
  const tag = randomUUID().slice(0, 8);
  const { data: brands } = await supabaseAdmin
    .from('brands')
    .insert(
      ['a', 'b'].map((k) => ({
        name: `Fsm ${k}`,
        slug: `fsm-${k}-${tag}`,
        status: 'ACTIVE' as const,
      })),
    )
    .select('id, slug')
    .throwOnError();
  brandIds.push(...brands.map((b) => b.id));
  const { data: stores } = await supabaseAdmin
    .from('stores')
    .insert(
      brands.map((b) => ({
        name: `Fsm ${b.slug}`,
        slug: `store-${b.slug}`,
        brand_id: b.id,
        status: 'ACTIVE' as const,
        tagline: 'Test',
        description: 'order-fsm.test.ts',
      })),
    )
    .select('id, slug')
    .throwOnError();
  store.a = stores.find((s) => s.slug === `store-fsm-a-${tag}`)?.id ?? '';
  store.b = stores.find((s) => s.slug === `store-fsm-b-${tag}`)?.id ?? '';
  const names = { T: 'Tracked bun', T2: 'Tracked roll', U: 'Untracked tea' } as const;
  const { data: rows } = await supabaseAdmin
    .from('menu_items')
    .insert(
      (['T', 'T2', 'U'] as const).map((key, i) => ({
        store_id: store.a,
        category: 'Fsm',
        name: names[key],
        description: '',
        price_paise: PRICE_PAISE[key],
        stock_quantity: key === 'U' ? null : 100,
        sort_order: i,
      })),
    )
    .select('id, name')
    .throwOnError();
  for (const key of ['T', 'T2', 'U'] as const)
    item[key] = rows.find((row) => row.name === names[key])?.id ?? '';
  [customers[0], customers[1], staff, staff2, manager, admin, staffB] = await Promise.all([
    createTestUser(),
    createTestUser(),
    createStoreMember(store.a, 'STAFF'),
    createStoreMember(store.a, 'STAFF'),
    createStoreMember(store.a, 'MANAGER'),
    createTestUser('ADMIN'),
    createStoreMember(store.b, 'STAFF'),
  ]);
}, 60_000);

afterAll(async () => {
  // Nothing consumes q_notifications here; drop these stores' messages so other suites count only their own.
  localExec(
    `delete from pgmq.q_q_notifications where message->>'storeId' in ('${store.a}', '${store.b}')`,
  );
  await deleteTestStores([store.a, store.b], brandIds, [
    ...customers,
    staff,
    staff2,
    manager,
    admin,
    staffB,
  ]);
});

describe('the transition table', () => {
  it("the table is the service's: ALLOWED_TRANSITIONS is exactly what this suite and the staff board expect", () => {
    expect(ALLOWED_TRANSITIONS).toEqual(NEXT);
  });
});

describe('every transition and refusal, with its side effects', () => {
  beforeAll(() => setStock(item.T, 100));

  const pairs = ALL.flatMap((from) => ALL.map((to) => [from, to, outcome(from, to)] as const));
  it.each(pairs)('%s → %s is %s', async (from, to, result) => {
    const id = await orderAt(from);
    const stockBefore = await stockOf(item.T);
    const requestId = randomUUID();
    const res = await move(id, to, staff, store.a, requestId);
    if (result === 'INVALID') {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    } else {
      expect(res.status).toBe(200);
      expect(res.body.order.status).toBe(to);
    }
    // A change moves the status and leaves exactly one event and one audit row; a repeat or a refusal leaves none,
    // and only a real cancellation gives the stock back (READY → CANCELLED and COLLECTED → CANCELLED must not).
    const changed = result === 'CHANGED';
    expect(await statusOf(id)).toBe(changed ? to : from);
    expect(await countFor('domain_events', 'request_id', requestId)).toBe(changed ? 1 : 0);
    expect(await countFor('audit_log', 'request_id', requestId)).toBe(changed ? 1 : 0);
    expect(await stockOf(item.T)).toBe(
      (stockBefore ?? 0) + (changed && to === 'CANCELLED' ? 2 : 0),
    );
    if (changed) {
      const { data: event } = await supabaseAdmin
        .from('domain_events')
        .select('type, payload')
        .eq('request_id', requestId)
        .single()
        .throwOnError();
      expect(event).toEqual({
        type: `order.${to.toLowerCase()}`,
        payload: { from, to, orderNumber: res.body.order.orderNumber },
      });
    }
  });
});

describe('cancelling', () => {
  beforeAll(() => setStock(item.T, 100));

  it('two cancels at once both answer 200, and the stock comes back once with one event', async () => {
    const before = await stockOf(item.T);
    const id = await orderAt('PLACED', 3);
    const res = await Promise.all([move(id, 'CANCELLED', staff), move(id, 'CANCELLED', staff2)]);
    expect(res.map((r) => r.status)).toEqual([200, 200]);
    expect(await stockOf(item.T)).toBe(before);
    const { count } = await supabaseAdmin
      .from('domain_events')
      .select('id', { count: 'exact', head: true })
      .eq('aggregate_id', id)
      .eq('type', 'order.cancelled')
      .throwOnError();
    expect(count).toBe(1);
    expect(await countFor('audit_log', 'entity_id', id)).toBe(1);
  });

  it('gives back what each line reserved: the tracked line its quantity, the untracked one nothing', async () => {
    const before = await stockOf(item.T);
    const placed = await place(customers[0], orderBody(2, 1));
    expect(placed.status).toBe(201);
    const id: string = placed.body.order.id;
    const { data: reserved } = await supabaseAdmin
      .from('order_items')
      .select('menu_item_id, reserved_quantity')
      .eq('order_id', id)
      .throwOnError();
    expect(new Map(reserved.map((l) => [l.menu_item_id, l.reserved_quantity]))).toEqual(
      new Map([
        [item.T, 2],
        [item.U, 0],
      ]),
    );
    expect((await move(id, 'CANCELLED')).status).toBe(200);
    expect(await stockOf(item.T)).toBe(before);
    expect(await stockOf(item.U)).toBeNull();
  });

  it('an item untracked since the order was placed stays untracked, and the cancel writes no movement', async () => {
    const id = await orderAt('PLACED', 2);
    expect((await adjust({ untracked: true })).status).toBe(200);
    const movements = async () => {
      const { count } = await supabaseAdmin
        .from('stock_movements')
        .select('id', { count: 'exact', head: true })
        .eq('menu_item_id', item.T)
        .throwOnError();
      return count ?? 0;
    };
    const before = await movements();
    expect((await move(id, 'CANCELLED')).status).toBe(200);
    expect(await stockOf(item.T)).toBeNull();
    expect(await movements()).toBe(before);
    expect((await adjust({ set: 100 })).status).toBe(200);
  });

  // Placement locks items in id order; a cancel's restock must not lock them in another order, or the two deadlock
  // (40P01, a 500). Lines are sent in both orders on purpose.
  it('cancels racing a placement of the same items never fail, and every unit is accounted for', async () => {
    await setStock(item.T, 1000);
    await setStock(item.T2, 1000);
    const live: { id: string; t: number; t2: number }[] = [];
    for (let round = 0; round < Number(process.env.RACE_ROUNDS ?? 10); round += 1) {
      const x = await place(customers[0], orderBody(1, 0, 1));
      const y = await place(customers[1], {
        ...orderBody(0),
        items: [...lines(0, 0, 1), ...lines(1)],
      });
      expect([x.status, y.status]).toEqual([201, 201]);
      const [cx, p, cy] = await Promise.all([
        move(x.body.order.id, 'CANCELLED'),
        place(customers[0], orderBody(1, 0, 1)),
        move(y.body.order.id, 'CANCELLED', staff2),
      ]);
      expect([cx.status, p.status, cy.status]).toEqual([200, 201, 200]);
      live.push({ id: p.body.order.id, t: 1, t2: 1 });
    }
    expect(await stockOf(item.T)).toBe(1000 - live.length);
    expect(await stockOf(item.T2)).toBe(1000 - live.length);
  }, 60_000);
});

describe('who may move an order', () => {
  it('an admin may neither move an order nor read it, and nothing changes', async () => {
    const id = await orderAt('PLACED');
    const stock = await stockOf(item.T);
    const requestId = randomUUID();
    const res = await move(id, 'PREPARING', admin, store.a, requestId);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    const read = await api().get(`/api/orders/${id}`).set(auth(admin));
    expectError(read, 404, 'NOT_FOUND');
    expect(await statusOf(id)).toBe('PLACED');
    expect(await stockOf(item.T)).toBe(stock);
    expect(await countFor('domain_events', 'request_id', requestId)).toBe(0);
  });
});

describe('replaying a key', () => {
  beforeAll(() => setStock(item.T, 6));

  it('after the order was cancelled answers that order, cancelled, and takes no stock', async () => {
    const body = orderBody(2);
    const placed = await place(customers[0], body);
    expect((await move(placed.body.order.id, 'CANCELLED')).status).toBe(200);
    const stock = await stockOf(item.T);
    const replay = await place(customers[0], body);
    expect(replay.status).toBe(201);
    expect(replay.body.order).toMatchObject({ id: placed.body.order.id, status: 'CANCELLED' });
    expect(await stockOf(item.T)).toBe(stock);
  });

  it('after a refused order places the corrected cart under the same key, once', async () => {
    const key = randomUUID();
    const stock = (await stockOf(item.T)) ?? 0;
    const refused = await place(customers[0], { ...orderBody(stock + 1), idempotencyKey: key });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: { available: stock },
    });
    const body = { ...orderBody(1), idempotencyKey: key };
    const placed = await place(customers[0], body);
    expect(placed.status).toBe(201);
    const replay = await place(customers[0], body);
    expect(replay.body.order.id).toBe(placed.body.order.id);
    expect(await stockOf(item.T)).toBe(stock - 1);
    const { count } = await supabaseAdmin
      .from('domain_events')
      .select('id', { count: 'exact', head: true })
      .eq('aggregate_id', placed.body.order.id)
      .eq('type', 'order.placed')
      .throwOnError();
    expect(count).toBe(1);
  });

  it('after the store paused answers the placed order instead of refusing it', async () => {
    const body = orderBody(1);
    const placed = await place(customers[0], body);
    expect(placed.status).toBe(201);
    const pause = await api()
      .post(`/api/stores/${store.a}/pause`)
      .set(auth(manager))
      .send({ minutes: 30, reason: 'Replay' });
    expect(pause.status).toBe(200);
    try {
      const replay = await place(customers[0], body);
      expect(replay.status).toBe(201);
      expect(replay.body.order.id).toBe(placed.body.order.id);
      const fresh = await place(customers[0], orderBody(1));
      expect(fresh.status).toBe(409);
      expect(fresh.body.error.code).toBe('STORE_PAUSED');
    } finally {
      expect(
        (await api().post(`/api/stores/${store.a}/resume`).set(auth(manager)).send({})).status,
      ).toBe(200);
    }
  });
});

describe('the money every stored order carries', () => {
  // Over every order in the database, not only this file's: a price path that drifts anywhere shows up here.
  it('total = Σ lines, line = unit × qty, unit = base + Σ its modifier deltas', () => {
    const broken = localSql<{ id: string }>(`
      select o.id from public.orders o
       where o.total_paise <> (select coalesce(sum(i.line_total_paise), 0) from public.order_items i where i.order_id = o.id)
      union all
      select i.id from public.order_items i where i.line_total_paise <> i.unit_price_paise * i.quantity
      union all
      select i.id from public.order_items i
       where i.base_unit_price_paise is not null
         and i.unit_price_paise <> i.base_unit_price_paise
           + (select coalesce(sum(m.price_delta_paise), 0) from public.order_item_modifiers m where m.order_item_id = i.id)`);
    expect(broken).toEqual([]);
  });
});

// ---- The model run: random sequences of commands, every invariant read back from the database after each one. ----

const START_STOCK = 6;
interface ModelOrder {
  id: string;
  status: OrderStatus;
  qtyT: number;
  body: ReturnType<typeof orderBody>;
  user: TestUser;
  entered: OrderStatus[]; // statuses entered after PLACED, in order
}
interface Model {
  stock: number;
  orders: ModelOrder[];
}
type Real = object;

const pick = (m: Readonly<Model>, i: number): ModelOrder => {
  const order = m.orders[i % m.orders.length];
  if (!order) throw new Error('no order to pick');
  return order;
};

async function checkInvariants(m: Model): Promise<void> {
  const ids = m.orders.map((o) => o.id);
  const [{ data: items }, { data: orders }, { data: events }, { data: moves }, { data: audit }] =
    await Promise.all([
      supabaseAdmin
        .from('menu_items')
        .select('id, stock_quantity')
        .in('id', [item.T, item.U])
        .throwOnError(),
      supabaseAdmin
        .from('orders')
        .select(
          'id, status, total_paise, order_items (menu_item_id, quantity, reserved_quantity, unit_price_paise, line_total_paise)',
        )
        .eq('store_id', store.a)
        .throwOnError(),
      supabaseAdmin
        .from('domain_events')
        .select('aggregate_id, type, payload')
        .eq('store_id', store.a)
        .eq('aggregate_type', 'order')
        .throwOnError(),
      supabaseAdmin
        .from('stock_movements')
        .select('delta')
        .eq('menu_item_id', item.T)
        .throwOnError(),
      supabaseAdmin
        .from('audit_log')
        .select('entity_id')
        .eq('action', 'order.status_changed')
        .in('entity_id', ids.length ? ids : [randomUUID()])
        .throwOnError(),
    ]);
  const stock = new Map(items.map((row) => [row.id, row.stock_quantity]));
  expect(stock.get(item.T)).toBe(m.stock);
  expect(stock.get(item.U)).toBeNull();
  // Conservation from the database alone: start + manual moves − what live orders hold = now.
  const held = orders
    .filter((o) => o.status !== 'CANCELLED')
    .flatMap((o) => o.order_items)
    .filter((line) => line.menu_item_id === item.T)
    .reduce((sum, line) => sum + line.reserved_quantity, 0);
  const manual = moves.reduce((sum, mv) => sum + (mv.delta ?? 0), 0);
  expect(START_STOCK + manual - held).toBe(stock.get(item.T));
  // Exactly the orders the model placed: a replay or a refusal never adds one.
  expect(orders.map((o) => o.id).sort()).toEqual([...ids].sort());
  for (const mo of m.orders) {
    const row = orders.find((o) => o.id === mo.id);
    expect(row?.status).toBe(mo.status);
    for (const line of row?.order_items ?? []) {
      expect(line.unit_price_paise).toBe(
        line.menu_item_id === item.T ? PRICE_PAISE.T : PRICE_PAISE.U,
      );
      expect(line.line_total_paise).toBe(line.unit_price_paise * line.quantity);
      expect(line.reserved_quantity).toBe(line.menu_item_id === item.T ? line.quantity : 0);
    }
    expect(row?.total_paise).toBe(
      (row?.order_items ?? []).reduce((s, l) => s + l.line_total_paise, 0),
    );
    // One order.placed, then one event per real change, chained from → to (never ordered by occurred_at, which is
    // the transaction start and can invert under contention).
    const mine = events.filter((e) => e.aggregate_id === mo.id);
    expect(mine.filter((e) => e.type === 'order.placed')).toHaveLength(1);
    expect(mine).toHaveLength(1 + mo.entered.length);
    const next = new Map(
      mine
        .filter((e) => e.type !== 'order.placed')
        .map((e) => {
          const p = e.payload as { from: OrderStatus; to: OrderStatus };
          expect(e.type).toBe(`order.${p.to.toLowerCase()}`);
          return [p.from, p.to] as const;
        }),
    );
    const chain: OrderStatus[] = [];
    for (let s = next.get('PLACED'); s; s = next.get(s)) chain.push(s);
    expect(chain).toEqual(mo.entered);
    expect(audit.filter((a) => a.entity_id === mo.id)).toHaveLength(mo.entered.length);
  }
}

class Place implements fc.AsyncCommand<Model, Real> {
  constructor(
    readonly who: 0 | 1,
    readonly qtyT: number,
    readonly qtyU: number,
  ) {}
  check = () => this.qtyT + this.qtyU > 0;
  async run(m: Model): Promise<void> {
    const user = customers[this.who];
    const body = orderBody(this.qtyT, this.qtyU);
    const res = await place(user, body);
    if (this.qtyT <= m.stock) {
      expect(res.status).toBe(201);
      m.stock -= this.qtyT;
      m.orders.push({
        id: res.body.order.id,
        status: 'PLACED',
        qtyT: this.qtyT,
        body,
        user,
        entered: [],
      });
    } else {
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({
        code: 'INSUFFICIENT_STOCK',
        details: { menuItemId: item.T, available: m.stock },
      });
    }
    await checkInvariants(m);
  }
  toString = () => `place(c${this.who}, T×${this.qtyT}, U×${this.qtyU})`;
}

/** Two customers at once: the answers must fit one of the two serial orders. */
class PlaceRace implements fc.AsyncCommand<Model, Real> {
  constructor(
    readonly a: number,
    readonly b: number,
  ) {}
  check = () => true;
  async run(m: Model): Promise<void> {
    const qty = [this.a, this.b];
    const bodies = qty.map((q) => orderBody(q));
    const res = await Promise.all(bodies.map((body, i) => place(customers[i as 0 | 1], body)));
    const serial = (first: number) => {
      let stock = m.stock;
      const codes: number[] = [];
      for (const i of [first, 1 - first]) {
        const fits = (qty[i] ?? 0) <= stock;
        codes[i] = fits ? 201 : 400;
        if (fits) stock -= qty[i] ?? 0;
      }
      return { codes, stock };
    };
    const seen = res.map((r) => r.status);
    const fit = [serial(0), serial(1)].find(
      (s) => s.codes[0] === seen[0] && s.codes[1] === seen[1],
    );
    if (!fit)
      throw new Error(`answers ${seen.join(',')} fit no serial order from stock ${m.stock}`);
    m.stock = fit.stock;
    res.forEach((r, i) => {
      const body = bodies[i];
      if (r.status === 201 && body)
        m.orders.push({
          id: r.body.order.id,
          status: 'PLACED',
          qtyT: qty[i] ?? 0,
          body,
          user: customers[i as 0 | 1],
          entered: [],
        });
    });
    await checkInvariants(m);
  }
  toString = () => `placeRace(T×${this.a} ‖ T×${this.b})`;
}

/** Advance, cancel, collect, a repeat or an illegal move, through the staff route. */
class Move implements fc.AsyncCommand<Model, Real> {
  constructor(
    readonly i: number,
    readonly to: OrderStatus,
  ) {}
  check = (m: Readonly<Model>) => m.orders.length > 0;
  async run(m: Model): Promise<void> {
    const order = pick(m, this.i);
    const res = await move(order.id, this.to);
    const result = outcome(order.status, this.to);
    if (result === 'INVALID') {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    } else {
      expect(res.status).toBe(200);
      expect(res.body.order.status).toBe(this.to);
    }
    if (result === 'CHANGED') {
      order.status = this.to;
      order.entered.push(this.to);
      if (this.to === 'CANCELLED') m.stock += order.qtyT;
    }
    await checkInvariants(m);
  }
  toString = () => `move(#${this.i} → ${this.to})`;
}

/**
 * The next step on the happy path, chosen from the model when it runs: random targets alone rarely walk one order
 * deep enough to try READY → CANCELLED (a planted bug there went unseen in 30 runs without this).
 */
class Advance extends Move {
  constructor(i: number) {
    super(i, 'PLACED');
  }
  override async run(m: Model): Promise<void> {
    const order = pick(m, this.i);
    await new Move(this.i, NEXT[order.status][0] ?? order.status).run(m);
  }
  override toString = () => `advance(#${this.i})`;
}

/** Two staff devices at once on one order: the answers and the final status fit one of the two serial orders. */
class MoveRace implements fc.AsyncCommand<Model, Real> {
  constructor(
    readonly i: number,
    readonly a: OrderStatus,
    readonly b: OrderStatus,
  ) {}
  check = (m: Readonly<Model>) => m.orders.length > 0;
  async run(m: Model): Promise<void> {
    const order = pick(m, this.i);
    const res = await Promise.all([move(order.id, this.a, staff), move(order.id, this.b, staff2)]);
    const serial = (first: OrderStatus, second: OrderStatus) => {
      let status = order.status;
      const entered: OrderStatus[] = [];
      const codes = [first, second].map((to) => {
        const result = outcome(status, to);
        if (result === 'CHANGED') {
          status = to;
          entered.push(to);
        }
        return result === 'INVALID' ? 409 : 200;
      });
      return { status, entered, codes };
    };
    const ab = serial(this.a, this.b);
    const ba = serial(this.b, this.a);
    const now = await statusOf(order.id);
    const seen = res.map((r) => r.status);
    const fit = [
      { ...ab, matches: ab.codes[0] === seen[0] && ab.codes[1] === seen[1] },
      { ...ba, matches: ba.codes[1] === seen[0] && ba.codes[0] === seen[1] },
    ].find((s) => s.matches && s.status === now);
    if (!fit) throw new Error(`answers ${seen.join(',')} and ${now} fit no serial order`);
    order.status = fit.status;
    order.entered.push(...fit.entered);
    if (fit.entered.includes('CANCELLED')) m.stock += order.qtyT;
    await checkInvariants(m);
  }
  toString = () => `moveRace(#${this.i}: ${this.a} ‖ ${this.b})`;
}

/** The same key again: the same body is a replay, whatever happened since; another note is 409. */
class Replay implements fc.AsyncCommand<Model, Real> {
  constructor(
    readonly i: number,
    readonly same: boolean,
  ) {}
  check = (m: Readonly<Model>) => m.orders.length > 0;
  async run(m: Model): Promise<void> {
    const order = pick(m, this.i);
    const res = await place(
      order.user,
      this.same ? order.body : { ...order.body, note: 'Another cart' },
    );
    if (this.same) {
      expect(res.status).toBe(201);
      expect(res.body.order).toMatchObject({ id: order.id, status: order.status });
    } else {
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: 'IDEMPOTENCY_KEY_REUSED',
        details: { orderId: order.id },
      });
    }
    await checkInvariants(m);
  }
  toString = () => `replay(#${this.i}, ${this.same ? 'same' : 'other note'})`;
}

/** Someone who may not move the order: its customer, an admin, another store's staff through their own route. */
class Forbidden implements fc.AsyncCommand<Model, Real> {
  constructor(
    readonly i: number,
    readonly who: 'customer' | 'admin' | 'otherStaff',
    readonly to: OrderStatus,
  ) {}
  check = (m: Readonly<Model>) => m.orders.length > 0;
  async run(m: Model): Promise<void> {
    const order = pick(m, this.i);
    const res =
      this.who === 'otherStaff'
        ? await move(order.id, this.to, staffB, store.b)
        : await move(order.id, this.to, this.who === 'admin' ? admin : order.user);
    expect(res.status).toBe(this.who === 'otherStaff' ? 404 : 403);
    const other = customers.find((c) => c.id !== order.user.id);
    if (other)
      expectError(await api().get(`/api/orders/${order.id}`).set(auth(other)), 404, 'NOT_FOUND');
    await checkInvariants(m);
  }
  toString = () => `forbidden(#${this.i}, ${this.who} → ${this.to})`;
}

/** A manager's count: stock moving outside orders, through adjust_stock and its trail. */
class Adjust implements fc.AsyncCommand<Model, Real> {
  constructor(readonly delta: number) {}
  check = () => true;
  async run(m: Model): Promise<void> {
    const res = await adjust({ adjust: this.delta });
    if (m.stock + this.delta >= 0) {
      expect(res.status).toBe(200);
      m.stock += this.delta;
    } else {
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    }
    await checkInvariants(m);
  }
  toString = () => `adjust(${this.delta})`;
}

const idx = fc.nat({ max: 20 });
const status = fc.constantFrom(...ALL);
const moveArb = fc.tuple(idx, status).map(([i, to]) => new Move(i, to));
const commands = [
  fc
    .tuple(
      fc.constantFrom(0 as const, 1 as const),
      fc.integer({ min: 0, max: 3 }),
      fc.integer({ min: 0, max: 2 }),
    )
    .map(([who, t, u]) => new Place(who, t, u)),
  fc
    .tuple(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 4 }))
    .map(([a, b]) => new PlaceRace(a, b)),
  moveArb,
  // Three times: commands are drawn evenly, and the deep states (READY, COLLECTED) are where most rules live.
  ...[1, 2, 3].map(() => idx.map((i) => new Advance(i))),
  idx.map((i) => new Move(i, 'CANCELLED')), // the move that gives stock back, from wherever the order is
  fc.tuple(idx, status, status).map(([i, a, b]) => new MoveRace(i, a, b)),
  fc.tuple(idx, fc.boolean()).map(([i, same]) => new Replay(i, same)),
  fc
    .tuple(
      idx,
      fc.constantFrom('customer' as const, 'admin' as const, 'otherStaff' as const),
      status,
    )
    .map(([i, who, to]) => new Forbidden(i, who, to)),
  fc
    .integer({ min: -3, max: 3 })
    .filter((d) => d !== 0)
    .map((d) => new Adjust(d)),
];

/** A clean store for each run: no orders, events or movements, T back at its starting stock. */
async function freshRun(): Promise<{ model: Model; real: Real }> {
  await supabaseAdmin.from('domain_events').delete().eq('store_id', store.a).throwOnError();
  await supabaseAdmin.from('orders').delete().eq('store_id', store.a).throwOnError();
  await supabaseAdmin.from('stock_movements').delete().eq('store_id', store.a).throwOnError();
  await setStock(item.T, START_STOCK);
  return { model: { stock: START_STOCK, orders: [] }, real: {} };
}

describe('the model', () => {
  // Replay a failure with FC_SEED and FC_PATH from the report; FC_RUNS raises the run count locally.
  it('the order lifecycle and stock follow the model under any sequence of moves, races, replays and refusals', async () => {
    await fc.assert(
      fc.asyncProperty(fc.commands(commands, { maxCommands: 15 }), (cmds) =>
        fc.asyncModelRun(freshRun, cmds),
      ),
      {
        numRuns: Number(process.env.FC_RUNS ?? 25),
        seed: process.env.FC_SEED ? Number(process.env.FC_SEED) : undefined,
        path: process.env.FC_PATH,
      },
    );
  }, 180_000);
});
