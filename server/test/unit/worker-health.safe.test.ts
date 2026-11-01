import { describe, expect, it } from 'vitest';
import { healthReport, staleAfterSec, type QueueState } from '../../src/jobs/health';
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
