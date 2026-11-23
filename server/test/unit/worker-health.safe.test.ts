import { Writable } from 'node:stream';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { healthReport, queueFields, staleAfterSec, type QueueState } from '../../src/jobs/health';
import { PROCESS_METRICS_MSG, logProcessMetrics } from '../../src/utils/processMetrics';
import { notifyHandler } from '../../src/jobs/notify';
import { POLL_SECONDS } from '../../src/jobs/runner';

const T0 = Date.parse('2026-11-01T10:00:00Z');

function queue(
  name: string,
  lastActiveAt: number,
  metrics: QueueState['metrics'] = null,
): QueueState {
  return { handler: { queue: name, visibilityTimeoutSec: 30 }, lastActiveAt, metrics };
}

describe('the worker health report', () => {
  it('waits three polls, or the visibility timeout when longer, before a quiet loop counts as stuck', () => {
    expect(staleAfterSec({ queue: 'q', visibilityTimeoutSec: 1 })).toBe(3 * POLL_SECONDS);
    expect(staleAfterSec({ queue: 'q', visibilityTimeoutSec: 60 })).toBe(60);
    expect(staleAfterSec(notifyHandler)).toBe(30);
  });

  it('is 200 while every loop is active, and 503 once one stays quiet past its limit', () => {
    const atLimit = healthReport([queue('q_a', T0, { depth: 2, oldestAgeSec: 4 })], T0 + 30_000);
    expect(atLimit).toEqual({
      status: 200,
      body: {
        ok: true,
        queues: [
          {
            queue: 'q_a',
            lastActiveAt: '2026-11-01T10:00:00.000Z',
            stale: false,
            depth: 2,
            oldestAgeSec: 4,
          },
        ],
      },
    });

    const oneStuck = healthReport([queue('q_a', T0 + 30_000), queue('q_b', T0)], T0 + 30_001);
    expect(oneStuck.status).toBe(503);
    expect(oneStuck.body.ok).toBe(false);
    expect(oneStuck.body.queues.map(({ queue: q, stale }) => [q, stale])).toEqual([
      ['q_a', false],
      ['q_b', true],
    ]);
  });

  it('shows null depth and age when the database did not answer, and stays 200: liveness only', () => {
    const { status, body } = healthReport([queue('q_a', T0)], T0 + 1000);
    expect(status).toBe(200);
    expect(body.queues[0]).toMatchObject({ depth: null, oldestAgeSec: null });
  });
});

describe('the worker metrics line fields', () => {
  it('lists each queue and adds the total depth and the oldest message across them', () => {
    expect(
      queueFields(
        ['q_a', 'q_b'],
        [
          { depth: 2, oldestAgeSec: 40 },
          { depth: 0, oldestAgeSec: null },
        ],
      ),
    ).toEqual({
      queues: [
        { queue: 'q_a', depth: 2, oldestAgeSec: 40 },
        { queue: 'q_b', depth: 0, oldestAgeSec: null },
      ],
      queueDepth: 2,
      oldestAgeSec: 40,
    });
  });

  it('reports an all-empty set of queues as 0 seconds old', () => {
    expect(queueFields(['q_a'], [{ depth: 0, oldestAgeSec: null }])).toMatchObject({
      queueDepth: 0,
      oldestAgeSec: 0,
    });
  });

  it('leaves the totals out when a queue did not answer: a gap in the alarm metric, not a false zero', () => {
    const fields = queueFields(['q_a', 'q_b'], [{ depth: 5, oldestAgeSec: 900 }, null]);
    expect(fields).not.toHaveProperty('queueDepth');
    expect(fields).not.toHaveProperty('oldestAgeSec');
  });
});

describe('the process metrics timer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function capture() {
    const lines: Record<string, unknown>[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
        done();
      },
    });
    return { lines, log: pino(stream) };
  }

  it('logs one info line per period with the memory and the fields, and stops when told', async () => {
    vi.useFakeTimers();
    const { lines, log } = capture();
    const stop = logProcessMetrics(log, 1000, () => ({ queueDepth: 3 }));

    await vi.advanceTimersByTimeAsync(999);
    expect(lines).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 30, msg: PROCESS_METRICS_MSG, queueDepth: 3 });
    expect(lines[0]!.rssMb).toEqual(expect.any(Number));
    expect(lines[0]!.heapUsedMb).toEqual(expect.any(Number));

    await vi.advanceTimersByTimeAsync(2000);
    expect(lines).toHaveLength(3);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(lines).toHaveLength(3);
  });

  it('warns instead of crashing the process when the fields fail', async () => {
    vi.useFakeTimers();
    const { lines, log } = capture();
    const stop = logProcessMetrics(log, 1000, () => Promise.reject(new Error('boom')));
    await vi.advanceTimersByTimeAsync(1000);
    stop();
    expect(lines).toEqual([expect.objectContaining({ level: 40, msg: 'Process metrics failed' })]);
  });
});
