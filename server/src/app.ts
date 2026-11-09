import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import cors from 'cors';
import express, { type Express } from 'express';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { readClientVersion } from './middleware/clientVersion';
import { errorHandler, loggedAtDebug, notFoundHandler } from './middleware/errorHandler';
import { floodLimiter } from './middleware/rateLimit';
import { securityHeaders } from './middleware/securityHeaders';
import { payloadTooLarge } from './utils/errors';
import { apiRouter } from './routes/index';
import { env } from './utils/env';
import { LOG_SERIALIZERS, logger } from './utils/logger';

// A caller-supplied id is kept only if it is short and plain, so it cannot forge log content.
const REQUEST_ID = /^[\w.-]{1,64}$/;

/** Largest JSON body accepted (docs/API.md "Headers and limits"); the web image's nginx enforces the same. */
export const JSON_BODY_LIMIT_BYTES = 100 * 1024;

// An upload refused for its declared size is read and thrown away before the 413, up to these bounds. Answering with it
// unread made the OS reset the connection, and a client still sending could lose the 413 to the reset (nginx in front
// drains the same way: its lingering close). Past either bound the 413 goes out anyway and the connection closes.
const REFUSED_UPLOAD_DRAIN_BYTES = 1024 * 1024;
const REFUSED_UPLOAD_DRAIN_MS = 2000;

/** Reads the rest of a refused upload and throws it away, then calls `answer` once, within the drain bounds. */
function drainThen(req: IncomingMessage, answer: () => void): void {
  let read = 0;
  let answered = false;
  const finish = () => {
    if (answered) return;
    answered = true;
    clearTimeout(timer);
    answer();
  };
  const timer = setTimeout(finish, REFUSED_UPLOAD_DRAIN_MS);
  req.on('data', (chunk: Buffer) => {
    read += chunk.length;
    if (read > REFUSED_UPLOAD_DRAIN_BYTES) finish();
  });
  req.once('end', finish);
  req.once('close', finish);
}

function requestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', id);
  return id;
}

/**
 * One access line per request. Successful reads are debug: the customer and staff screens poll, and at info they
 * would flood production logs. Writes and every failure are info, and the error handler adds the detail, except a
 * failure it logged at debug (an expected repeat): that access line goes down with it.
 */
export function accessLevel(req: IncomingMessage, res: ServerResponse): 'debug' | 'info' {
  const read = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
  return (read && res.statusCode < 400) || loggedAtDebug.has(res) ? 'debug' : 'info';
}

const QUERY_AND_HASH = /[?#][\s\S]*$/;

/**
 * The access line's request, as a path only. A query string can carry an email, a phone or a token, and REDACT_PATHS
 * blanks keys, never the inside of a URL; the parsed `query` the standard serializer adds is dropped for the same
 * reason (`req.query.email` sits deeper than `*.email` reaches). The `Referer` header is the page's full URL (same
 * origin, so the browser sends its query), and is cut the same way; the headers are copied, never edited in place.
 */
function pathOnly(req: IncomingMessage) {
  const { query: _query, ...rest } = pino.stdSerializers.req(req);
  const { referer } = rest.headers;
  return {
    ...rest,
    url: rest.url.replace(QUERY_AND_HASH, ''),
    headers: referer
      ? { ...rest.headers, referer: referer.replace(QUERY_AND_HASH, '') }
      : rest.headers,
  };
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
        req: pathOnly,
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
    req.method === 'OPTIONS' ? floodLimiter(req, res, next) : next(),
  );
  app.use(cors({ origin: env.CLIENT_ORIGIN }));
  // After the access log (a refused request still gets its line) and before the body is parsed (a flood is refused
  // before it costs anything). The probes in routes/index.ts count too: they are only cheaper, not exempt.
  app.use('/api', floodLimiter);
  // body-parser reads an oversized body to its end, however long, before answering 413. Refusing on the declared
  // length reads at most the drain bounds instead, then answers and closes the connection.
  app.use('/api', (req, res, next) => {
    if (Number(req.headers['content-length']) > JSON_BODY_LIMIT_BYTES) {
      res.set('Connection', 'close');
      drainThen(req, () => next(payloadTooLarge()));
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
