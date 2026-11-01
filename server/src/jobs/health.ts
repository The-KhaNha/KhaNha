import { supabaseAdmin } from '../utils/supabase';
import { POLL_SECONDS, type JobHandler } from './runner';

const METRICS_TIMEOUT_MS = 1000;

interface QueueMetrics {
  depth: number;
  /** null when the queue is empty. */
  oldestAgeSec: number | null;
}

export interface QueueState {
  handler: Pick<JobHandler<unknown>, 'queue' | 'visibilityTimeoutSec'>;
  /** When its loop last made progress (runQueue's onActive), in ms. */
  lastActiveAt: number;
  /** null when the database did not answer in time. */
  metrics: QueueMetrics | null;
}

/**
 * How long a queue's loop may go without a read returning or a job finishing before the worker is unhealthy: three
 * polls, or the visibility timeout when that is longer (a job may run that long, and with every slot busy the loop
 * does not read).
 */
export function staleAfterSec(handler: QueueState['handler']): number {
  return Math.max(3 * POLL_SECONDS, handler.visibilityTimeoutSec);
}

/**
 * The worker's GET /health: 200 while every queue's loop is alive, else 503. Liveness only: a database outage keeps
 * the loops turning (each failed read counts), so it never restarts a healthy worker; depth and age are for people.
 */
export function healthReport(queues: QueueState[], now: number) {
  const lines = queues.map(({ handler, lastActiveAt, metrics }) => ({
    queue: handler.queue,
    lastActiveAt: new Date(lastActiveAt).toISOString(),
    stale: now - lastActiveAt > staleAfterSec(handler) * 1000,
    depth: metrics?.depth ?? null,
    oldestAgeSec: metrics?.oldestAgeSec ?? null,
  }));
  const ok = lines.every((line) => !line.stale);
  return { status: ok ? 200 : 503, body: { ok, queues: lines } };
}

/** A queue's depth and oldest message age. A database that does not answer within a second is the answer: null. */
export async function readQueueMetrics(queue: string): Promise<QueueMetrics | null> {
  try {
    const { data } = await supabaseAdmin
      .rpc('queue_metrics', { p_queue: queue })
      .abortSignal(AbortSignal.timeout(METRICS_TIMEOUT_MS))
      .single()
      .throwOnError();
    return { depth: data.queue_length, oldestAgeSec: data.oldest_msg_age_sec };
  } catch {
    return null;
  }
}
