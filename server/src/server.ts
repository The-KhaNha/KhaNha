import 'dotenv/config';
import { createApp } from './app';
import { env } from './utils/env';
import { logger } from './utils/logger';
import { APP_VERSION, GIT_COMMIT } from './utils/version';

const SHUTDOWN_DEADLINE_MS = 10_000;

const server = createApp().listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, logLevel: env.LOG_LEVEL, version: APP_VERSION, commit: GIT_COMMIT },
    'Food Pickup API listening',
  );
});
// Idle keep-alive connections outlive the load balancer's; headersTimeout must stay above keepAliveTimeout or Node
// can drop a request that arrives just as the idle timer fires.
server.keepAliveTimeout = env.KEEP_ALIVE_TIMEOUT_MS;
server.headersTimeout = env.KEEP_ALIVE_TIMEOUT_MS + 1000;

// supabase-js talks HTTP, so there is no database connection to close.
function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, 'Shutting down');
  // In-flight requests get 10 s, well under Docker's SIGKILL after its stop timeout.
  setTimeout(() => process.exit(1), SHUTDOWN_DEADLINE_MS).unref();
  // Stop accepting, let in-flight requests finish, then let the pretty-print worker flush the last line.
  server.close(() => logger.flush(() => process.exit(0)));
  server.closeIdleConnections();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
