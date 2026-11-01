import { setTimeout as sleep } from 'node:timers/promises';
import type { Logger } from 'pino';
import { IntegrationError, InvariantError, RetryableError } from '../utils/errors';
import { supabaseAdmin } from '../utils/supabase';

/** What emit_event sends to a queue (docs/JOBS.md "The outbox"). */
export interface DomainEvent<T> {
  eventId: string;
  type: string;
  aggregateId: string;
  storeId: string | null;
  payload: T;
  actor: { type: string; id?: string } | null;
  requestId: string | null;
  occurredAt: string;
}

export interface QueueMessage<T> {
  msgId: number;
  /** 1 on the first delivery: pgmq's read count. */
  attempt: number;
  enqueuedAt: string;
  event: DomainEvent<T>;
}

export interface JobContext {
  /** Carries queue, jobId, eventId, eventType and attempt. */
  log: Logger;
  /** Aborted when the worker shuts down; a long handler may stop early and throw RetryableError. */
  signal: AbortSignal;
}

export interface Backoff {
  baseSec: number;
  maxSec: number;
}

/**
 * One queue's consumer (docs/JOBS.md "Handlers"). `handle` resolves when the work is done, throws RetryableError (or a
 * retryable IntegrationError) to try again later, and anything else to give up. Delivery is at least once, so a
 * handler is idempotent by a natural key.
 */
export interface JobHandler<T> {
  /** A pgmq queue, created by the migration that adds its first consumer. */
  queue: string;
  /** Messages handled at once. */
  concurrency: number;
  /** How long a read message stays hidden: longer than the slowest run, or a second reader takes it too. */
  visibilityTimeoutSec: number;
  /** Deliveries before a retryable failure is dead-lettered. */
  maxAttempts: number;
  backoff: Backoff;
  handle(message: QueueMessage<T>, ctx: JobContext): Promise<void>;
}

/** min(max, base × 2^(attempt−1)), ±20% so failures that started together do not retry together. Whole seconds. */
export function backoffSeconds(
  attempt: number,
  { baseSec, maxSec }: Backoff,
  random: () => number = Math.random,
): number {
  const delay = Math.min(maxSec, baseSec * 2 ** (attempt - 1));
  return Math.max(1, Math.round(delay * (0.8 + 0.4 * random())));
}

/** How long an empty queue waits before it is read again: the most a new job waits to start. */
export const POLL_SECONDS = 2;

// Bounds on the runner's own calls, so a connection that dies without closing cannot stall a queue, or the shutdown,
// until Node's 5-minute HTTP default. Both return in milliseconds when the database is well.
const READ_TIMEOUT_SECONDS = 5;
const OUTCOME_TIMEOUT_SECONDS = 10;
const outcomeDeadline = () => AbortSignal.timeout(OUTCOME_TIMEOUT_SECONDS * 1000);

export interface RunOptions {
  /** Aborting stops reading; runQueue resolves once the handlers in flight have finished. */
  signal: AbortSignal;
  log: Logger;
  pollSeconds?: number;
  now?: () => number;
  random?: () => number;
  /**
   * Called after every read that returned, a failed one too. The worker's health check counts on it (jobs/health.ts);
   * a loop that stops calling it is stuck, or has every slot busy for longer than a job may run.
   */
  onActive?: () => void;
}

/** Consumes one queue until `signal` aborts (docs/JOBS.md "Handlers and the runner"). */
export async function runQueue<T>(handler: JobHandler<T>, options: RunOptions): Promise<void> {
  const { signal, log, onActive = () => {} } = options;
  // At least 1: a loop that never waited would spin against the database.
  const pollSeconds = Math.max(1, options.pollSeconds ?? POLL_SECONDS);
  const inFlight = new Set<Promise<void>>();
  let failedReads = 0;

  while (!signal.aborted) {
    if (inFlight.size >= handler.concurrency) {
      await Promise.race(inFlight);
      continue;
    }
    let rows: Row[];
    try {
      rows = await read(handler, handler.concurrency - inFlight.size);
    } catch (err) {
      onActive();
      // A read that timed out as the worker stops is not an outage worth reporting.
      if (signal.aborted) break;
      // Once per outage: every read fails the same way until the database is back.
      if (failedReads === 0) log.warn({ err, queue: handler.queue }, 'Queue read failed');
      failedReads += 1;
      await sleep(Math.min(5, failedReads) * 1000, undefined, { signal }).catch(() => {});
      continue;
    }
    onActive();
    if (failedReads > 0) log.info({ queue: handler.queue, failedReads }, 'Queue reachable again');
    failedReads = 0;
    // Read just as the worker stops: not started, so they come back after their visibility timeout.
    if (signal.aborted) break;
    for (const row of rows) {
      const job = handleOne(handler, row, options).finally(() => inFlight.delete(job));
      inFlight.add(job);
    }
    // An empty queue is read again after the poll; one that had work at once, as more may be waiting. The wait is here,
    // not in the database: a long-poll held a pooled connection per queue the whole time, from the pool the API shares
    // (docs/JOBS.md "Capacity").
    if (rows.length === 0) await sleep(pollSeconds * 1000, undefined, { signal }).catch(() => {});
  }
  await Promise.all(inFlight);
}

type Row = Awaited<ReturnType<typeof read>>[number];

async function read(handler: JobHandler<unknown>, qty: number) {
  const { data } = await supabaseAdmin
    .rpc('queue_read', {
      p_queue: handler.queue,
      p_vt_seconds: handler.visibilityTimeoutSec,
      p_qty: qty,
      // 0: pgmq.read, which returns at once instead of waiting for a message.
      p_poll_seconds: 0,
    })
    // Not the stop signal: a read cancelled here may still take a message in the database, hidden for its whole
    // visibility timeout with nobody to handle it. Stopping waits for the read instead (milliseconds).
    .abortSignal(AbortSignal.timeout(READ_TIMEOUT_SECONDS * 1000))
    .throwOnError();
  return data;
}

/** Handles one message and records the outcome; never throws, so one job cannot stop the loop. */
async function handleOne<T>(
  handler: JobHandler<T>,
  row: Row,
  { signal, log, now = Date.now, random = Math.random }: RunOptions,
): Promise<void> {
  const event = isDomainEvent(row.message) ? (row.message as unknown as DomainEvent<T>) : undefined;
  const jobLog = log.child({
    queue: handler.queue,
    jobId: row.msg_id,
    eventId: event?.eventId,
    eventType: event?.type,
    attempt: row.read_ct,
  });
  const started = now();
  let failed = false;
  let failure: unknown;
  try {
    // Every read counts as a delivery, and every message comes from emit_event: anything else is a bug upstream.
    if (row.read_ct < 1)
      throw new InvariantError(`queue_read returned message ${row.msg_id} as never read`);
    if (!event) throw new InvariantError(`message ${row.msg_id} is not a domain event`);
    await handler.handle(
      { msgId: row.msg_id, attempt: row.read_ct, enqueuedAt: row.enqueued_at, event },
      { log: jobLog, signal },
    );
  } catch (err) {
    failed = true;
    failure = err;
  }
  const durationMs = now() - started;
  const ids = { p_queue: handler.queue, p_msg_id: row.msg_id };
  try {
    if (!failed) {
      await supabaseAdmin.rpc('queue_delete', ids).abortSignal(outcomeDeadline()).throwOnError();
      jobLog.debug({ durationMs }, 'Job handled');
    } else if (isRetryable(failure) && row.read_ct < handler.maxAttempts) {
      const retryInSec = backoffSeconds(row.read_ct, handler.backoff, random);
      await supabaseAdmin
        .rpc('queue_retry', { ...ids, p_delay_seconds: retryInSec })
        .abortSignal(outcomeDeadline())
        .throwOnError();
      jobLog.warn({ err: failure, durationMs, retryInSec }, 'Job failed, retrying');
    } else {
      const { data: recorded } = await supabaseAdmin
        .rpc('queue_dead_letter', {
          ...ids,
          p_message: row.message,
          p_attempts: row.read_ct,
          p_error: describe(failure),
        })
        .abortSignal(outcomeDeadline())
        .throwOnError();
      // false: another reader already handled it after this one's visibility timeout ran out.
      if (recorded) {
        const invariant = failure instanceof InvariantError || undefined;
        jobLog.error({ err: failure, durationMs, invariant }, 'Job dead-lettered');
      }
    }
  } catch (err) {
    // The message comes back after its visibility timeout and is tried again.
    jobLog.warn({ err, durationMs }, 'Job outcome not recorded');
  }
}

function isRetryable(err: unknown): boolean {
  return err instanceof RetryableError || (err instanceof IntegrationError && err.retryable);
}

function isDomainEvent(message: unknown): boolean {
  if (typeof message !== 'object' || message === null) return false;
  const { eventId, type } = message as { eventId?: unknown; type?: unknown };
  return typeof eventId === 'string' && typeof type === 'string';
}

/** For job_failures.last_error: what failed and why, never the payload. */
function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
