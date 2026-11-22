import type { RequestHandler } from 'express';
import type { Logger } from 'pino';

/**
 * The message of the line the production alarms read (infra/terraform/modules/observability/main.tf filters on it and
 * on the field names below; test/logging.safe.test.ts fails when the two drift apart).
 */
export const PROCESS_METRICS_MSG = 'Process metrics';

const MB = 1024 * 1024;
// ponytail: a window samples at most this many durations for its p95 (about 70 a second over five minutes); later
// requests still count, they just do not move the p95. A histogram if traffic outgrows it.
const MAX_SAMPLES = 20_000;

let requests = 0;
let serverErrors = 0;
let durations: number[] = [];

/**
 * Counts every API request and samples its duration. The access line cannot: a successful read is logged at debug
 * (docs/LOGGING.md), below production's level, so a rate or a p95 built on it would see almost none of the traffic.
 */
export const countRequests: RequestHandler = (_req, res, next) => {
  const started = performance.now();
  res.on('finish', () => {
    requests += 1;
    if (res.statusCode >= 500) serverErrors += 1;
    if (durations.length < MAX_SAMPLES) durations.push(performance.now() - started);
  });
  next();
};

/** The requests since the last call, then a fresh window. p95Ms is left out of a window with no requests. */
export function takeRequestStats(): { requests: number; serverErrors: number; p95Ms?: number } {
  const sorted = durations.sort((a, b) => a - b);
  const stats = {
    requests,
    serverErrors,
    ...(sorted.length > 0 && { p95Ms: Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]!) }),
  };
  requests = 0;
  serverErrors = 0;
  durations = [];
  return stats;
}

/**
 * One info line every `everyMs` with the process's memory and `fields()`. A timer, never a line per poll; unref'd, so
 * it never keeps a stopping process alive. Tells which process grew; the host's memory alarm reads /proc/meminfo.
 */
export function logProcessMetrics(
  log: Logger,
  everyMs: number,
  fields: () => Record<string, unknown> | Promise<Record<string, unknown>>,
): () => void {
  const timer = setInterval(() => {
    void Promise.resolve()
      .then(fields)
      .then((extra) => {
        const { rss, heapUsed } = process.memoryUsage();
        log.info(
          { rssMb: Math.round(rss / MB), heapUsedMb: Math.round(heapUsed / MB), ...extra },
          PROCESS_METRICS_MSG,
        );
      })
      .catch((err: unknown) => log.warn({ err }, 'Process metrics failed'));
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
