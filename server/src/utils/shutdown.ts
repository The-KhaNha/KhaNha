import { logger } from './logger';

/** How long in-flight work gets after SIGTERM or SIGINT: within Docker's default 10 s stop timeout, before SIGKILL. */
export const SHUTDOWN_DEADLINE_MS = 10_000;

/**
 * Both entry points stop the same way: on SIGTERM or SIGINT, `stop` finishes what is in flight (the API's requests,
 * the worker's jobs), the log is flushed and the process exits 0. Still running at the deadline, it exits 1.
 * Repeats are ignored but stay caught: a terminal's Ctrl+C reaches pnpm, tsx and node together and tsx relays it again,
 * and an uncaught second signal would kill the process mid-stop.
 */
export function onShutdown(stop: () => Promise<void>): void {
  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Shutting down');
    setTimeout(() => process.exit(1), SHUTDOWN_DEADLINE_MS).unref();
    stop().then(
      () => logger.flush(() => process.exit(0)),
      (err: unknown) => {
        logger.error({ err }, 'Shutdown failed');
        logger.flush(() => process.exit(1));
      },
    );
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
