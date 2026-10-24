// Destructive: creates two throwaway queues and purges domain_events (local only).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabaseAdmin } from '../../src/utils/supabase';
import { localSql } from '../setup/helpers';

const EXACT = 'q_test_exact';
const FAMILY = 'q_test_family';
const DAY_MS = 24 * 60 * 60 * 1000;
let storeId: string;

beforeAll(async () => {
  localSql(`select pgmq.create('${EXACT}'), pgmq.create('${FAMILY}')`);
  // FAMILY is subscribed to the exact type as well, so it proves an overlap still delivers once.
  await supabaseAdmin
    .from('event_subscriptions')
    .insert([
      { event_type: 'outboxtest.ping', queue_name: EXACT },
      { event_type: 'outboxtest.ping', queue_name: FAMILY },
      { event_type: 'outboxtest.*', queue_name: FAMILY },
    ])
    .throwOnError();
  const { data } = await supabaseAdmin.from('stores').select('id').limit(1).single().throwOnError();
  storeId = data.id;
});

afterAll(async () => {
  await supabaseAdmin
    .from('event_subscriptions')
    .delete()
    .like('event_type', 'outboxtest.%')
    .throwOnError();
  await supabaseAdmin
    .from('domain_events')
    .delete()
    .eq('aggregate_type', 'outboxtest')
    .throwOnError();
  localSql(`select pgmq.drop_queue('${EXACT}'), pgmq.drop_queue('${FAMILY}')`);
});

async function emit(type: string): Promise<{ eventId: string; aggregateId: string }> {
  const aggregateId = randomUUID();
  const { data } = await supabaseAdmin
    .rpc('emit_event', {
      p_type: type,
      p_aggregate_type: 'outboxtest',
      p_aggregate_id: aggregateId,
      p_store_id: storeId,
      p_payload: { status: 'READY' },
      p_actor: { type: 'SYSTEM' },
      p_request_id: 'req-outbox-test',
    })
    .throwOnError();
  return { eventId: data, aggregateId };
}

/** Takes every message waiting in a queue, straight from pgmq's table (one statement, one CLI call). */
function drain(queue: string): unknown[] {
  return localSql<{ message: unknown }>(`delete from pgmq.q_${queue} returning message`).map(
    (row) => row.message,
  );
}

describe('emit_event', () => {
  it('sends an event once to each queue subscribed to its type or its family', async () => {
    const { eventId, aggregateId } = await emit('outboxtest.ping');

    const exact = drain(EXACT);
    expect(exact).toEqual([
      {
        eventId,
        type: 'outboxtest.ping',
        aggregateId,
        storeId,
        payload: { status: 'READY' },
        actor: { type: 'SYSTEM' },
        requestId: 'req-outbox-test',
        occurredAt: expect.any(String),
      },
    ]);
    expect(drain(FAMILY)).toEqual(exact);
  });

  it('sends another type of the family to the family subscriber only', async () => {
    await emit('outboxtest.other');
    expect(drain(EXACT)).toHaveLength(0);
    expect(drain(FAMILY)).toHaveLength(1);
  });

  it('records an event nobody subscribes to without sending it anywhere', async () => {
    const { eventId, aggregateId } = await emit('outboxnobody.ping');
    expect(drain(EXACT)).toHaveLength(0);
    expect(drain(FAMILY)).toHaveLength(0);

    const { data } = await supabaseAdmin
      .from('domain_events')
      .select('id, type, aggregate_id, store_id, actor, request_id')
      .eq('id', eventId)
      .single()
      .throwOnError();
    expect(data).toEqual({
      id: eventId,
      type: 'outboxnobody.ping',
      aggregate_id: aggregateId,
      store_id: storeId,
      actor: { type: 'SYSTEM' },
      request_id: 'req-outbox-test',
    });
    await supabaseAdmin.from('domain_events').delete().eq('id', eventId).throwOnError();
  });
});

describe('domain_events retention', () => {
  it('purge_domain_events keeps 30 days', async () => {
    const { eventId } = await emit('outboxnobody.ping');
    const exists = async () =>
      (await supabaseAdmin.from('domain_events').select('id').eq('id', eventId).throwOnError()).data
        .length === 1;

    // Purging "29 days from now" keeps it; "31 days from now" deletes every event, this one included.
    const at = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();
    await supabaseAdmin.rpc('purge_domain_events', { p_now: at(29) }).throwOnError();
    expect(await exists()).toBe(true);
    const { data: deleted } = await supabaseAdmin
      .rpc('purge_domain_events', { p_now: at(31) })
      .throwOnError();
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await exists()).toBe(false);
  });

  it('pg_cron runs the purge nightly', () => {
    expect(
      localSql(`select schedule, command from cron.job where jobname = 'purge-domain-events'`),
    ).toEqual([{ schedule: '17 21 * * *', command: 'select public.purge_domain_events()' }]);
  });
});
