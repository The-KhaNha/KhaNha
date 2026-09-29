import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import cors from 'cors';
import express, { type Express } from 'express';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { readClientVersion } from './middleware/clientVersion';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { ipLimiter } from './middleware/rateLimit';
import { securityHeaders } from './middleware/securityHeaders';
import { payloadTooLarge } from './utils/errors';
import { apiRouter } from './routes/index';
import { env } from './utils/env';
import { LOG_SERIALIZERS, logger } from './utils/logger';

// A caller-supplied id is kept only if it is short and plain, so it cannot forge log content.
const REQUEST_ID = /^[\w.-]{1,64}$/;

/** Largest JSON body accepted (docs/API.md "Headers and limits"); the web image's nginx enforces the same. */
export const JSON_BODY_LIMIT_BYTES = 100 * 1024;

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
  // req.ip from X-Forwarded-For only through the proxies we run (TRUST_PROXY_HOPS; compose's nginx is one).
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  // First, so a 404, a CORS preflight and every error response carry them too.
  app.use(securityHeaders);

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
      // Unwrapped: pino-http would otherwise run the standard err serializer first, which drops err.cause before
      // errWithCause (LOG_SERIALIZERS) sees it. req/res are then named explicitly.
      wrapSerializers: false,
      serializers: {
        ...LOG_SERIALIZERS,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res,
      },
      customLogLevel: accessLevel,
      // Which client build made the request: tells a stale tab from a current one when reading logs.
      customProps: (req) => ({ clientVersion: readClientVersion(req) ?? 'none' }),
    }),
  );
  // Preflights are counted here, before cors() answers them itself and ends the request: a limiter mounted only after
  // it never saw one, so a scripted flood of OPTIONS went uncounted. Every other request is counted below.
  app.use('/api', (req, res, next) =>
    req.method === 'OPTIONS' ? ipLimiter(req, res, next) : next(),
  );
  app.use(cors({ origin: env.CLIENT_ORIGIN }));
  // After the access log (a refused request still gets its line) and before the body is parsed (a flood is refused
  // before it costs anything). The probes in routes/index.ts count too: they are only cheaper, not exempt.
  app.use('/api', ipLimiter);
  // body-parser reads an oversized body to its end before answering 413. Refusing on the declared length instead
  // tells a phone on a slow link at once, and Connection: close drops the rest of the upload unread.
  app.use('/api', (req, res, next) => {
    if (Number(req.headers['content-length']) > JSON_BODY_LIMIT_BYTES) {
      res.set('Connection', 'close');
      next(payloadTooLarge());
      return;
    }
    next();
  });
  app.use(express.json({ limit: JSON_BODY_LIMIT_BYTES }));
  app.use('/api', apiRouter);

  // Express 5 no longer accepts "*" paths; a bare app.use() is the catch-all.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
