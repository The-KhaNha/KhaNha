import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRouter } from './routes/index';
import { env } from './utils/env';
import { prisma } from './utils/prisma';

const app = express();

app.disable('x-powered-by');
app.use(cors({ origin: env.CLIENT_ORIGIN }));
app.use(express.json());

app.use('/api', apiRouter);

// Express 5 no longer accepts "*" paths; a bare app.use() is the catch-all.
app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  console.log(`Food Pickup API running at http://localhost:${env.PORT}/api`);
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`\n${signal} received, shutting down.`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', (signal) => void shutdown(signal));
process.on('SIGTERM', (signal) => void shutdown(signal));
