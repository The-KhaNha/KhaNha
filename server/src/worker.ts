import 'dotenv/config';
import { createServer } from 'node:http';
import { healthReport, readQueueMetrics } from './jobs/health';
import { notifyHandler } from './jobs/notify';
import { runQueue, type JobHandler } from './jobs/runner';
import { env } from './utils/env';
import { logger } from './utils/logger';
import { onShutdown } from './utils/shutdown';
import { APP_VERSION, GIT_COMMIT } from './utils/version';

// The worker process (ADR-005): one loop per queue consumer, a health endpoint, and a stop that lets jobs finish.
// A consumer is added to this list (docs/JOBS.md "Handlers and the runner").
const HANDLERS: JobHandler<unknown>[] = [notifyHandler];

const stop = new AbortController();
const lastActiveAt = new Map(HANDLERS.map((handler) => [handler.queue, Date.now()]));
const loops = Promise.all(
  HANDLERS.map((handler) =>
    runQueue(handler, {
      signal: stop.signal,
      log: logger,
      onActive: () => lastActiveAt.set(handler.queue, Date.now()),
    }),
  ),
);
// runQueue never throws by design; if it does anyway, a worker that consumes nothing must not look alive.
loops.catch((err: unknown) => {
  logger.error({ err }, 'Worker loop crashed');
  logger.flush(() => process.exit(1));
});

const health = createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/health') {
    res.writeHead(404).end();
    return;
  }
  void Promise.all(HANDLERS.map((handler) => readQueueMetrics(handler.queue))).then((metrics) => {
    const { status, body } = healthReport(
      HANDLERS.map((handler, i) => ({
        handler,
        lastActiveAt: lastActiveAt.get(handler.queue) ?? 0,
        metrics: metrics[i] ?? null,
      })),
      Date.now(),
    );
    res
      .writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      .end(JSON.stringify({ ...body, version: APP_VERSION, commit: GIT_COMMIT }));
  });
});
health.listen(env.WORKER_HEALTH_PORT, () => {
  logger.info(
    {
      healthPort: env.WORKER_HEALTH_PORT,
      queues: HANDLERS.map((handler) => handler.queue),
      logLevel: env.LOG_LEVEL,
      version: APP_VERSION,
      commit: GIT_COMMIT,
    },
    'Food Pickup worker running',
  );
});

onShutdown(async () => {
  // Reading stops at once; runQueue resolves when the jobs in flight have finished.
  stop.abort();
  await loops;
  await new Promise<void>((resolve) => health.close(() => resolve()));
});
