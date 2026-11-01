// Destructive: a throwaway queue and dead letters (local only). The runner runs in-process against the real RPCs.
import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  runQueue,
  type JobHandler,
  type QueueMessage,
  type RunOptions,
} from '../../src/jobs/runner';
import { PermanentError, RetryableError } from '../../src/utils/errors';
import { supabaseAdmin } from '../../src/utils/supabase';
import { localSql } from '../setup/helpers';

const Q = 'q_test_runner';

beforeAll(() => {
  localSql(`select pgmq.create('${Q}')`);
});

afterEach(() => {
  vi.restoreAllMocks();
  localSql(`select pgmq.purge_queue('${Q}')`);
});

afterAll(async () => {
  await supabaseAdmin.from('job_failures').delete().eq('queue_name', Q).throwOnError();
  localSql(`select pgmq.drop_queue('${Q}')`);
});

function send(message: object): void {
  localSql(`select * from pgmq.send('${Q}', '${JSON.stringify(message)}'::jsonb)`);
}

function event(n: number) {
  return {
    eventId: randomUUID(),
    type: 'test.ping',
    aggregateId: randomUUID(),
    storeId: null,
    payload: { n },
    actor: null,
    requestId: null,
    occurredAt: new Date().toISOString(),
  };
}

/** A debug logger that keeps its lines, so a test can count them by level (pino: 20 debug, 30 info, 40 warn, 50 error). */
function capture() {
  const lines: Record<string, unknown>[] = [];
  const log = pino({ level: 'debug' }, { write: (line: string) => lines.push(JSON.parse(line)) });
  return { log, lines, at: (msg: string) => lines.filter((l) => l.msg === msg) };
}

function handler(
  handle: JobHandler<{ n: number }>['handle'],
  overrides: Partial<JobHandler<{ n: number }>> = {},
): JobHandler<{ n: number }> {
  return {
    queue: Q,
    concurrency: 1,
    visibilityTimeoutSec: 30,
    maxAttempts: 3,
    backoff: { baseSec: 1, maxSec: 1 },
    handle,
    ...overrides,
  };
}

/** Starts a runner; `stop()` aborts it and waits for it to finish. */
function start(
  h: JobHandler<{ n: number }>,
  opts: Partial<RunOptions> & { log: RunOptions['log'] },
) {
  const controller = new AbortController();
  const done = runQueue(h, {
    pollSeconds: 1,
    random: () => 0.5,
    signal: controller.signal,
    ...opts,
  });
  return {
    controller,
    stop: () => {
      controller.abort();
      return done;
    },
  };
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function depth(): Promise<number> {
  const { data } = await supabaseAdmin.rpc('queue_metrics', { p_queue: Q }).single().throwOnError();
  return data.queue_length;
}

async function failures() {
  const { data } = await supabaseAdmin
    .from('job_failures')
    .select('attempts, last_error, message')
    .eq('queue_name', Q)
    .throwOnError();
  return data;
}

describe('runQueue', () => {
  it('deletes a handled message and logs it at debug with its duration', async () => {
    const { log, at } = capture();
    const seen: QueueMessage<{ n: number }>[] = [];
    const ev = event(1);
    send(ev);
    const runner = start(
      handler(async (m) => {
        seen.push(m);
      }),
      { log },
    );
    await waitFor(async () => seen.length === 1 && (await depth()) === 0);
    await runner.stop();

    expect(seen[0]).toMatchObject({
      attempt: 1,
      event: { eventId: ev.eventId, payload: { n: 1 } },
    });
    expect(at('Job handled')).toEqual([
      expect.objectContaining({
        level: 20,
        queue: Q,
        eventId: ev.eventId,
        eventType: 'test.ping',
        attempt: 1,
      }),
    ]);
    expect(at('Job handled')[0]).toHaveProperty('durationMs');
  });

  it('retries a RetryableError after its backoff, and it succeeds on attempt 2', async () => {
    const { log, at } = capture();
    const attempts: number[] = [];
    send(event(2));
    const runner = start(
      handler(async (m) => {
        attempts.push(m.attempt);
        if (m.attempt === 1) throw new RetryableError('provider timed out');
      }),
      { log },
    );
    await waitFor(async () => attempts.length === 2 && (await depth()) === 0);
    await runner.stop();

    expect(attempts).toEqual([1, 2]);
    expect(at('Job failed, retrying')).toEqual([
      expect.objectContaining({ level: 40, attempt: 1, retryInSec: 1 }),
    ]);
    expect(await failures()).toEqual([]);
  });

  it('dead-letters a job that keeps failing after maxAttempts, with exactly one error line', async () => {
    const { log, lines, at } = capture();
    const ev = event(3);
    send(ev);
    const runner = start(
      handler(
        async () => {
          throw new RetryableError('still down');
        },
        { maxAttempts: 2 },
      ),
      { log },
    );
    await waitFor(async () => (await failures()).length === 1);
    await runner.stop();

    const [row] = await failures();
    expect(row).toMatchObject({ attempts: 2, last_error: 'RetryableError: still down' });
    expect(row!.message).toMatchObject({ eventId: ev.eventId });
    expect(lines.filter((l) => l.level === 50)).toEqual([
      expect.objectContaining({ msg: 'Job dead-lettered', attempt: 2 }),
    ]);
    expect(at('Job failed, retrying')).toHaveLength(1);
    expect(JSON.stringify(lines)).not.toContain('"n":3'); // the payload is never logged
    expect(await depth()).toBe(0);
    await supabaseAdmin.from('job_failures').delete().eq('queue_name', Q).throwOnError();
  });

  it('dead-letters a PermanentError at once, and a message that is not a domain event as an invariant', async () => {
    const { log, at } = capture();
    send(event(4));
    send({ hello: 'world' });
    const runner = start(
      handler(async () => {
        throw new PermanentError('order is gone');
      }),
      { log },
    );
    await waitFor(async () => (await failures()).length === 2);
    await runner.stop();

    const errors = (await failures()).map((f) => f.last_error);
    expect(errors).toHaveLength(2);
    expect(errors).toEqual(
      expect.arrayContaining([
        'PermanentError: order is gone',
        expect.stringMatching(/^InvariantError: message \d+ is not a domain event$/),
      ]),
    );
    const dead = at('Job dead-lettered');
    expect(dead).toHaveLength(2);
    expect(dead.filter((l) => l.invariant === true)).toHaveLength(1);
    expect(at('Job failed, retrying')).toHaveLength(0);
    await supabaseAdmin.from('job_failures').delete().eq('queue_name', Q).throwOnError();
  });

  it('a message whose worker died comes back after its visibility timeout and is handled once', async () => {
    const crashed = capture();
    let crashedSaw = 0;
    send(event(5));
    // Never settles, like a worker killed mid-message; with concurrency 1 it reads nothing else.
    const first = start(
      handler(
        () => {
          crashedSaw += 1;
          return new Promise<void>(() => {});
        },
        { visibilityTimeoutSec: 1 },
      ),
      { log: crashed.log },
    );
    await waitFor(() => crashedSaw === 1);
    first.controller.abort();

    const second = capture();
    const attempts: number[] = [];
    const replacement = start(
      handler(async (m) => {
        attempts.push(m.attempt);
      }),
      { log: second.log },
    );
    await waitFor(async () => attempts.length === 1 && (await depth()) === 0);
    await replacement.stop();
    expect(attempts).toEqual([2]);
    expect(crashedSaw).toBe(1);
  });

  it('an abort stops reading but waits for the handler in flight', async () => {
    const { log } = capture();
    let started = false;
    let finished = false;
    send(event(6));
    // concurrency 2: the loop is back in a read, not waiting on this handler, when the abort comes; the handler outlasts
    // that read, so a runner that did not wait for it would resolve first.
    const runner = start(
      handler(
        async () => {
          started = true;
          await new Promise((r) => setTimeout(r, 1500));
          finished = true;
        },
        { concurrency: 2 },
      ),
      { log },
    );
    await waitFor(() => started);
    await runner.stop();
    expect(finished).toBe(true);
    expect(await depth()).toBe(0);
  });

  it('a failing read logs one warn per outage, backs off, and says when the queue is back', async () => {
    const { log, at } = capture();
    const real = supabaseAdmin.rpc.bind(supabaseAdmin);
    let outages = 2;
    vi.spyOn(supabaseAdmin, 'rpc').mockImplementation(((fn: string, args: object) => {
      if (fn === 'queue_read' && outages > 0) {
        outages -= 1;
        return { throwOnError: () => Promise.reject(new TypeError('fetch failed')) };
      }
      return real(fn as 'queue_read', args as never);
    }) as unknown as typeof supabaseAdmin.rpc);
    const handled: number[] = [];
    send(event(7));
    const runner = start(
      handler(async (m) => {
        handled.push(m.attempt);
      }),
      { log },
    );
    await waitFor(() => handled.length === 1, 10_000);
    await runner.stop();

    expect(at('Queue read failed')).toHaveLength(1);
    expect(at('Queue reachable again')).toEqual([
      expect.objectContaining({ level: 30, failedReads: 2 }),
    ]);
  });
});
