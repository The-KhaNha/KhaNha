import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import cors from 'cors';
import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import { readClientVersion } from './middleware/clientVersion';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRouter } from './routes/index';
import { env } from './utils/env';
import { logger } from './utils/logger';

// A caller-supplied id is kept only if it is short and plain, so it cannot forge log content.
const REQUEST_ID = /^[\w.-]{1,64}$/;

function requestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', id);
  return id;
}

/**
 * One access line per request. Successful reads are debug: the customer and staff screens poll, and at info they
 * would flood production logs. Writes and every failure are info; the error handler adds the detail.
 */
function accessLevel(req: IncomingMessage, res: ServerResponse): 'debug' | 'info' {
  const read = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
  return read && res.statusCode < 400 ? 'debug' : 'info';
}

/** The whole request pipeline, without `listen`, so tests can drive it with Supertest. */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');

  // Every API response is revalidated before reuse: the browser keeps its copy and sends If-None-Match, Express's
  // ETag check answers 304 with no body when nothing changed. That saves the whole payload on every poll on metered
  // data, and nothing stale is ever shown. Vary keeps one account's cached copy from answering another's request.
  // Installed before pino-http/cors/express.json so a CORS preflight or a malformed-JSON error response, which never
  // reach the routes below, still carry these headers.
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-cache');
    res.vary('Authorization');
    next();
  });
  app.use(
    pinoHttp({
      logger,
      genReqId: requestId,
      customLogLevel: accessLevel,
      // Which client build made the request: tells a stale tab from a current one when reading logs.
      customProps: (req) => ({ clientVersion: readClientVersion(req) ?? 'none' }),
    }),
  );
  app.use(cors({ origin: env.CLIENT_ORIGIN }));
  app.use(express.json());
  app.use('/api', apiRouter);

  // Express 5 no longer accepts "*" paths; a bare app.use() is the catch-all.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
