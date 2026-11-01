import type { JobHandler } from './runner';

/**
 * Order events (`order.*`). P6.3 sends the notifications from here; until then each event is one log line, which shows
 * the outbox working end to end: transition → event → queue → worker.
 */
export const notifyHandler: JobHandler<{ orderNumber?: number; status?: string }> = {
  queue: 'q_notifications',
  concurrency: 4,
  visibilityTimeoutSec: 30,
  maxAttempts: 5,
  backoff: { baseSec: 5, maxSec: 900 },
  async handle({ event }, { log }) {
    log.info({ orderId: event.aggregateId }, 'Order event');
  },
};
