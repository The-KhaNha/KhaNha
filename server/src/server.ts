import 'dotenv/config';
import { createApp } from './app';
import { env, refuseUnsafeProduction } from './utils/env';
import { logger } from './utils/logger';
import { logProcessMetrics, takeRequestStats } from './utils/processMetrics';
import { onShutdown } from './utils/shutdown';
import { APP_VERSION, GIT_COMMIT } from './utils/version';

refuseUnsafeProduction();

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

logProcessMetrics(logger, env.PROCESS_METRICS_LOG_MS, takeRequestStats);

// supabase-js talks HTTP, so there is no database connection to close. Stop accepting, let in-flight requests finish
// (utils/shutdown.ts gives them SHUTDOWN_DEADLINE_MS), then the log is flushed.
onShutdown(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    }),
);
