import 'dotenv/config';
import { createApp } from './app';
import { env } from './utils/env';
import { logger } from './utils/logger';

const server = createApp().listen(env.PORT, () => {
  logger.info({ port: env.PORT, logLevel: env.LOG_LEVEL }, 'Food Pickup API listening');
});

// supabase-js talks HTTP, so there is no database connection to close.
function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, 'Shutting down');
  server.close();
  // Let the pretty-print worker flush the last line before the process goes.
  logger.flush(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
