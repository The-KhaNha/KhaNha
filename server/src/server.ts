import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRouter } from './routes/index';
import { env } from './utils/env';

const app = express();

app.disable('x-powered-by');
app.use(cors({ origin: env.CLIENT_ORIGIN }));
app.use(express.json());

app.use('/api', apiRouter);

// Express 5 no longer accepts "*" paths; a bare app.use() is the catch-all.
app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  console.log(`Food Pickup API (${env.APP_ENV}) running at http://localhost:${env.PORT}/api`);
});

// supabase-js talks HTTP, so there is no database connection to close.
function shutdown(signal: NodeJS.Signals): void {
  console.log(`\n${signal} received, shutting down.`);
  server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
