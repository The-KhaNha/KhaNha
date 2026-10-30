// Destructive: creates a throwaway queue and writes dead letters (local only).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabaseAdmin } from '../../src/utils/supabase';
import { localSql } from '../setup/helpers';

const Q = 'q_test_wrappers';

beforeAll(() => {
  localSql(`select pgmq.create('${Q}')`);
});

afterAll(async () => {
  await supabaseAdmin.from('job_failures').delete().eq('queue_name', Q).throwOnError();
  localSql(`select pgmq.drop_queue('${Q}')`);
});

function send(message: object): void {
  localSql(`select * from pgmq.send('${Q}', '${JSON.stringify(message)}')`);
}

async function read(pollSeconds = 0) {
  const { data } = await supabaseAdmin
    .rpc('queue_read', { p_queue: Q, p_vt_seconds: 30, p_qty: 10, p_poll_seconds: pollSeconds })
    .throwOnError();
  return data;
}

async function depth(): Promise<number> {
  const { data } = await supabaseAdmin.rpc('queue_metrics', { p_queue: Q }).single().throwOnError();
  return data.queue_length;
}

describe('queue wrappers', () => {
  // 0 takes pgmq.read, 1 pgmq.read_with_poll, which with 0 would never read anything.
  it.each([0, 1])('a %i s poll reads a waiting message and hides it', async (poll) => {
    send({ poll });
    const messages = await read(poll);
    expect(messages).toEqual([
      {
        msg_id: expect.any(Number),
        read_ct: 1,
        enqueued_at: expect.any(String),
        message: { poll },
      },
    ]);
    expect(await read()).toEqual([]); // hidden for its 30 s visibility timeout

    await supabaseAdmin
      .rpc('queue_delete', { p_queue: Q, p_msg_id: messages[0]!.msg_id })
      .throwOnError();
    expect(await depth()).toBe(0);
  });

  it('a retry brings a message back with one more read; a dead letter records it and empties the queue', async () => {
    send({ job: 'retry' });
    const first = (await read())[0]!;
    await supabaseAdmin
      .rpc('queue_retry', { p_queue: Q, p_msg_id: first.msg_id, p_delay_seconds: 0 })
      .throwOnError();
    const second = (await read())[0]!;
    expect(second).toMatchObject({ msg_id: first.msg_id, read_ct: 2 });
    expect(await depth()).toBe(1);

    const { data: recorded } = await supabaseAdmin
      .rpc('queue_dead_letter', {
        p_queue: Q,
        p_msg_id: second.msg_id,
        p_message: second.message,
        p_attempts: second.read_ct,
        p_error: 'handler gave up',
      })
      .throwOnError();
    expect(recorded).toBe(true);
    expect(await depth()).toBe(0);
    const { data } = await supabaseAdmin
      .from('job_failures')
      .select('queue_name, message, attempts, last_error, resolved_at')
      .eq('queue_name', Q)
      .throwOnError();
    expect(data).toEqual([
      {
        queue_name: Q,
        message: { job: 'retry' },
        attempts: 2,
        last_error: 'handler gave up',
        resolved_at: null,
      },
    ]);
  });

  it('does not dead-letter a message another reader already handled and deleted', async () => {
    send({ job: 'raced' });
    const msg = (await read())[0]!;
    await supabaseAdmin.rpc('queue_delete', { p_queue: Q, p_msg_id: msg.msg_id }).throwOnError();
    const args = { p_queue: Q, p_msg_id: msg.msg_id, p_message: msg.message, p_attempts: 1 };
    const { data: recorded } = await supabaseAdmin
      .rpc('queue_dead_letter', { ...args, p_error: 'late' })
      .throwOnError();
    expect(recorded).toBe(false);
    const { data } = await supabaseAdmin.from('job_failures').select('id').eq('last_error', 'late');
    expect(data).toEqual([]);
  });

  it('p_qty limits a read, and queue_delete reports false for a missing message', async () => {
    send({ n: 1 });
    send({ n: 2 });
    send({ n: 3 });
    const { data } = await supabaseAdmin
      .rpc('queue_read', { p_queue: Q, p_vt_seconds: 30, p_qty: 2, p_poll_seconds: 0 })
      .throwOnError();
    expect(data).toHaveLength(2);
    expect(await depth()).toBe(3); // hidden messages still count as queued

    const { data: gone } = await supabaseAdmin
      .rpc('queue_delete', { p_queue: Q, p_msg_id: data[0]!.msg_id })
      .throwOnError();
    expect(gone).toBe(true);
    const { data: again } = await supabaseAdmin
      .rpc('queue_delete', { p_queue: Q, p_msg_id: data[0]!.msg_id })
      .throwOnError();
    expect(again).toBe(false);

    const rest = (await read())[0]!; // the third, still visible
    for (const id of [data[1]!.msg_id, rest.msg_id]) {
      await supabaseAdmin.rpc('queue_delete', { p_queue: Q, p_msg_id: id }).throwOnError();
    }
    expect(await depth()).toBe(0);
  });

  it('queue_metrics reports the oldest message age', async () => {
    send({ job: 'age' });
    await new Promise((r) => setTimeout(r, 2100));
    const { data } = await supabaseAdmin
      .rpc('queue_metrics', { p_queue: Q })
      .single()
      .throwOnError();
    expect(data.queue_length).toBe(1);
    expect(data.oldest_msg_age_sec).toBeGreaterThanOrEqual(2);
    const msg = (await read())[0]!;
    await supabaseAdmin.rpc('queue_delete', { p_queue: Q, p_msg_id: msg.msg_id }).throwOnError();
  });
});
