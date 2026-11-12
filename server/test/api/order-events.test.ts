// Destructive (local only): places and moves orders, and consumes q_notifications with an in-process runner.
import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notifyHandler } from '../../src/jobs/notify';
import { runQueue } from '../../src/jobs/runner';
import { supabaseAdmin } from '../../src/utils/supabase';
import {
  createTestUser,
  deleteTestUser,
  localSql,
  resetDemoData,
  type TestUser,
} from '../setup/helpers';
import { api } from '../setup/api';
import { resolveTestTarget } from '../setup/target';

let customer: TestUser;
let staff: TestUser;
let storeId: string;
let untracked: string; // Cold Coffee: no stock count
let tracked: string; // Blueberry Muffin: stock-counted

beforeAll(async () => {
  resetDemoData();
  const { data: rows } = await supabaseAdmin
    .from('menu_items')
    .select('id, name, store_id')
    .in('name', ['Cold Coffee', 'Blueberry Muffin'])
    .throwOnError();
  const byName = new Map(rows.map((row) => [row.name, row]));
  untracked = byName.get('Cold Coffee')?.id ?? '';
  tracked = byName.get('Blueberry Muffin')?.id ?? '';
  storeId = byName.get('Cold Coffee')?.store_id ?? '';
  [customer, staff] = await Promise.all([createTestUser('CUSTOMER'), createTestUser('STAFF')]);
}, 30_000);

afterAll(async () => {
  // Orders reference profiles, so they go before the users (orders.test.ts explains the order and the guard).
  if (resolveTestTarget() !== 'local') return;
  await supabaseAdmin.rpc('reset_demo_orders').throwOnError();
  await Promise.all([customer, staff].map((user) => deleteTestUser(user)));
  resetDemoData();
});

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });

function place(requestId: string, body: object = {}) {
  return api()
    .post('/api/orders')
    .set(auth(customer))
    .set('x-request-id', requestId)
    .send({ storeId, items: [{ menuItemId: untracked, quantity: 1 }], ...body });
}

function move(orderId: string, status: string, requestId = randomUUID()) {
  return api()
    .patch(`/api/stores/${storeId}/orders/${orderId}/status`)
    .set(auth(staff))
    .set('x-request-id', requestId)
    .send({ status });
}

async function eventsFor(orderId: string) {
  const { data } = await supabaseAdmin
    .from('domain_events')
    .select('type, aggregate_type, store_id, payload, actor, request_id')
    .eq('aggregate_id', orderId)
    .order('occurred_at')
    .throwOnError();
  return data;
}

async function eventCountForRequest(requestId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('domain_events')
    .select('id', { count: 'exact', head: true })
    .eq('request_id', requestId)
    .throwOnError();
  return count ?? 0;
}

/** Messages still waiting in q_notifications for a request (pgmq keeps each queue in its own table). */
function queuedForRequest(requestId: string): number {
  const [row] = localSql<{ n: number }>(
    `select count(*)::int as n from pgmq.q_q_notifications where message->>'requestId' = '${requestId}'`,
  );
  return row?.n ?? 0;
}

const userActor = (user: TestUser, role: string) => ({ type: 'USER', id: user.id, role });

describe('order transitions emit their events', () => {
  it('placing an order writes one order.placed with the customer and the request id, and the worker consumes it', async () => {
    const requestId = randomUUID();
    const res = await place(requestId);
    expect(res.status).toBe(201);
    const order = res.body.order as { id: string; orderNumber: number };

    expect(await eventsFor(order.id)).toEqual([
      {
        type: 'order.placed',
        aggregate_type: 'order',
        store_id: storeId,
        payload: { orderNumber: order.orderNumber },
        actor: userActor(customer, 'CUSTOMER'),
        request_id: requestId,
      },
    ]);
    expect(queuedForRequest(requestId)).toBe(1);

    // The real consumer, in process: it logs one line per event and acknowledges the message.
    const lines: Record<string, unknown>[] = [];
    const log = pino({ level: 'info' }, { write: (line: string) => lines.push(JSON.parse(line)) });
    const stop = new AbortController();
    const done = runQueue(notifyHandler, { signal: stop.signal, log, pollSeconds: 1 });
    const deadline = Date.now() + 10_000;
    while (!lines.some((l) => l.msg === 'Order event' && l.orderId === order.id)) {
      if (Date.now() > deadline) throw new Error('the worker never logged the order event');
      await new Promise((r) => setTimeout(r, 50));
    }
    stop.abort();
    await done;
    expect(lines.find((l) => l.orderId === order.id)).toMatchObject({
      queue: 'q_notifications',
      eventType: 'order.placed',
      attempt: 1,
    });
    expect(queuedForRequest(requestId)).toBe(0);
  });

  it('a stock refusal leaves no event and no message behind: the transaction that raises takes its event with it', async () => {
    await supabaseAdmin
      .from('menu_items')
      .update({ stock_quantity: 0 })
      .eq('id', tracked)
      .throwOnError();
    try {
      const requestId = randomUUID();
      const res = await place(requestId, { items: [{ menuItemId: tracked, quantity: 1 }] });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
      expect(await eventCountForRequest(requestId)).toBe(0);
      expect(queuedForRequest(requestId)).toBe(0);
    } finally {
      await supabaseAdmin
        .from('menu_items')
        .update({ stock_quantity: 5 })
        .eq('id', tracked)
        .throwOnError();
    }
  });

  it('an idempotent replay emits nothing: the order was placed once', async () => {
    const idempotencyKey = randomUUID();
    const first = await place(randomUUID(), { idempotencyKey });
    const replayId = randomUUID();
    const replay = await place(replayId, { idempotencyKey });
    expect(replay.status).toBe(201);
    expect(replay.body.order.id).toBe(first.body.order.id);
    expect((await eventsFor(first.body.order.id as string)).map((e) => e.type)).toEqual([
      'order.placed',
    ]);
    expect(await eventCountForRequest(replayId)).toBe(0);
  });

  it('two simultaneous placements with one idempotencyKey give one order and one order.placed', async () => {
    const idempotencyKey = randomUUID();
    const [a, b] = await Promise.all([
      place(randomUUID(), { idempotencyKey }),
      place(randomUUID(), { idempotencyKey }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.order.id).toBe(b.body.order.id);
    expect((await eventsFor(a.body.order.id as string)).map((e) => e.type)).toEqual([
      'order.placed',
    ]);
  });

  it('two staff moving the same order to READY at once both get 200 and one order.ready is written', async () => {
    const placed = await place(randomUUID());
    const id = placed.body.order.id as string;
    await move(id, 'PREPARING');
    const [a, b] = await Promise.all([move(id, 'READY'), move(id, 'READY')]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await eventsFor(id)).map((e) => e.type)).toEqual([
      'order.placed',
      'order.preparing',
      'order.ready',
    ]);
  });

  it('every staff transition emits order.<status> with the staff actor, its request and where it came from', async () => {
    const placed = await place(randomUUID());
    const { id, orderNumber } = placed.body.order as { id: string; orderNumber: number };
    const steps = ['PREPARING', 'READY', 'COLLECTED'];
    const requestIds = steps.map(() => randomUUID());
    for (const [i, status] of steps.entries()) {
      expect((await move(id, status, requestIds[i])).status).toBe(200);
    }

    const [, ...transitions] = await eventsFor(id);
    expect(transitions).toEqual(
      steps.map((to, i) => ({
        type: `order.${to.toLowerCase()}`,
        aggregate_type: 'order',
        store_id: storeId,
        payload: { orderNumber, from: i === 0 ? 'PLACED' : steps[i - 1], to },
        // The caller's standing at the order's store rides with the actor (P2 PR 04), as on the store routes.
        actor: { ...userActor(staff, 'CUSTOMER'), storeRole: 'STAFF' },
        request_id: requestIds[i],
      })),
    );

    const other = await place(randomUUID());
    expect((await move(other.body.order.id as string, 'CANCELLED')).status).toBe(200);
    expect((await eventsFor(other.body.order.id as string)).map((e) => e.type)).toEqual([
      'order.placed',
      'order.cancelled',
    ]);
  });

  it('a repeated READY answers 200 with the order and emits nothing; so does a second cancel', async () => {
    const placed = await place(randomUUID());
    const id = placed.body.order.id as string;
    await move(id, 'PREPARING');
    await move(id, 'READY');

    const repeatId = randomUUID();
    const repeat = await move(id, 'READY', repeatId);
    expect(repeat.status).toBe(200);
    expect(repeat.body.order.status).toBe('READY');
    expect(await eventCountForRequest(repeatId)).toBe(0);

    // The function says which it was, so the API logs a repeat apart from a change ('Order status repeated').
    const transition = (
      p_next_status: 'READY' | 'COLLECTED',
      p_from_statuses: ('PREPARING' | 'READY')[],
    ) =>
      supabaseAdmin
        .rpc('update_order_status', { p_order_id: id, p_next_status, p_from_statuses })
        .throwOnError()
        .then(({ data }) => data);
    expect(await transition('READY', ['PREPARING'])).toBe(false);
    expect(await transition('COLLECTED', ['READY'])).toBe(true);

    const other = await place(randomUUID());
    const otherId = other.body.order.id as string;
    await move(otherId, 'CANCELLED');
    const again = await move(otherId, 'CANCELLED');
    expect(again.status).toBe(200);
    expect((await eventsFor(otherId)).map((e) => e.type)).toEqual([
      'order.placed',
      'order.cancelled',
    ]);
  });
});
