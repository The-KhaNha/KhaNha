// Destructive: a throwaway queue (local only). readQueueMetrics against the real queue_metrics RPC.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readQueueMetrics } from '../../src/jobs/health';
import { localSql } from '../setup/helpers';

const Q = 'q_test_metrics';

beforeAll(() => {
  localSql(`select pgmq.create('${Q}')`);
});

afterAll(() => {
  localSql(`select pgmq.drop_queue('${Q}')`);
});

describe('readQueueMetrics', () => {
  it('reports an empty queue as depth 0 with no age', async () => {
    expect(await readQueueMetrics(Q)).toEqual({ depth: 0, oldestAgeSec: null });
  });

  it('reports the depth and the age of the oldest message', async () => {
    localSql(`select * from pgmq.send('${Q}', '{"n":1}'::jsonb)`);
    localSql(`select * from pgmq.send('${Q}', '{"n":2}'::jsonb)`);
    const metrics = await readQueueMetrics(Q);
    expect(metrics?.depth).toBe(2);
    expect(metrics?.oldestAgeSec).toBeGreaterThanOrEqual(0);
  });

  it('is null for a queue that does not exist', async () => {
    expect(await readQueueMetrics('q_test_metrics_missing')).toBeNull();
  });
});
