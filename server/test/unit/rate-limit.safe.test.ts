import express from 'express';
import { pino, type Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { accessLevel } from '../../src/app';
import { errorHandler } from '../../src/middleware/errorHandler';
import { createRateLimiter, type RateLimitOptions } from '../../src/middleware/rateLimit';
import { logger } from '../../src/utils/logger';

/** A tiny app: the limiter under test between a fake sign-in (X-Test-User) and the real error handler. */
function app(options: RateLimitOptions, log: Logger = logger) {
  const server = express();
  server.set('trust proxy', 1);
  server.use(pinoHttp({ logger: log, customLogLevel: accessLevel }));
  server.use((req, _res, next) => {
    const id = req.header('x-test-user');
    if (id) req.user = { id, role: 'CUSTOMER', memberships: [], ownedBrandIds: [] };
    next();
  });
  server.post('/write', createRateLimiter(options), (_req, res) => {
    res.json({ ok: true });
  });
  server.use(errorHandler);
  return request(server);
}

/** A debug-level logger that keeps every line it writes. */
function capturingLogger() {
  const lines: Record<string, unknown>[] = [];
  const log = pino({ level: 'debug' }, { write: (line: string) => lines.push(JSON.parse(line)) });
  return { log, lines };
}

describe('createRateLimiter', () => {
  it('answers 429 RATE_LIMITED in the envelope, with Retry-After and RateLimit headers, past the limit', async () => {
    const http = app({ name: 'test', windowMs: 60_000, limit: 2, keyBy: 'user' });
    const first = await http.post('/write').set('X-Test-User', 'a');
    expect(first.status).toBe(200);
    expect(first.headers['ratelimit-policy']).toBe('2;w=60');
    expect(first.headers['ratelimit']).toMatch(/^limit=2, remaining=1, reset=\d+$/);
    expect(first.headers['x-ratelimit-limit']).toBeUndefined();

    await http.post('/write').set('X-Test-User', 'a');
    const third = await http.post('/write').set('X-Test-User', 'a');
    expect(third.status).toBe(429);
    expect(third.body).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please wait a minute and try again.',
        details: { kind: 'rateLimit', retryAfterSeconds: 60 },
      },
    });
    expect(third.headers['retry-after']).toBe('60');
  });

  it('counts per user: one account at its limit does not block another from the same address', async () => {
    const http = app({ name: 'test', windowMs: 60_000, limit: 1, keyBy: 'user' });
    expect((await http.post('/write').set('X-Test-User', 'a')).status).toBe(200);
    expect((await http.post('/write').set('X-Test-User', 'a')).status).toBe(429);
    expect((await http.post('/write').set('X-Test-User', 'b')).status).toBe(200);
  });

  it('falls back to the address for a request without a user, and keyBy ip ignores the user', async () => {
    const byUser = app({ name: 'test', windowMs: 60_000, limit: 1, keyBy: 'user' });
    expect((await byUser.post('/write')).status).toBe(200);
    expect((await byUser.post('/write')).status).toBe(429);

    const byIp = app({ name: 'test', windowMs: 60_000, limit: 1, keyBy: 'ip' });
    expect((await byIp.post('/write').set('X-Test-User', 'a')).status).toBe(200);
    expect((await byIp.post('/write').set('X-Test-User', 'b')).status).toBe(429);
  });

  it('keys a proxied request by X-Forwarded-For when the proxy is trusted', async () => {
    const http = app({ name: 'test', windowMs: 60_000, limit: 1, keyBy: 'ip' });
    expect((await http.post('/write').set('X-Forwarded-For', '203.0.113.1')).status).toBe(200);
    expect((await http.post('/write').set('X-Forwarded-For', '203.0.113.2')).status).toBe(200);
    expect((await http.post('/write').set('X-Forwarded-For', '203.0.113.1')).status).toBe(429);
  });

  it('Retry-After is the time left in the window, not the whole window', async () => {
    const http = app({ name: 'test', windowMs: 2_000, limit: 1, keyBy: 'user' });
    expect((await http.post('/write').set('X-Test-User', 'a')).status).toBe(200);
    expect((await http.post('/write').set('X-Test-User', 'a')).headers['retry-after']).toBe('2');
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const later = await http.post('/write').set('X-Test-User', 'a');
    expect(later.status).toBe(429);
    expect(later.headers['retry-after']).toBe('1');
  });

  it('the body says as many seconds as Retry-After does', async () => {
    const http = app({ name: 'test', windowMs: 5_000, limit: 1, keyBy: 'user' });
    await http.post('/write').set('X-Test-User', 'a');
    const refused = await http.post('/write').set('X-Test-User', 'a');
    expect(refused.body.error.details.retryAfterSeconds).toBe(
      Number(refused.headers['retry-after']),
    );
  });

  it('logs a burst at warn once per key per window, then at debug', async () => {
    const { log, lines } = capturingLogger();
    const http = app({ name: 'test', windowMs: 60_000, limit: 1, keyBy: 'user' }, log);
    await http.post('/write').set('X-Test-User', 'a');
    for (let i = 0; i < 10; i += 1) {
      expect((await http.post('/write').set('X-Test-User', 'a')).status).toBe(429);
    }
    expect((await http.post('/write').set('X-Test-User', 'b')).status).toBe(200);
    expect((await http.post('/write').set('X-Test-User', 'b')).status).toBe(429);

    // pino levels: 40 warn, 30 info, 20 debug. Only the error handler's 429 lines carry `limiter`; the access line for
    // a repeat follows it down, so a client hammering the limit writes nothing above debug.
    const refusals = lines.filter((line) => line.limiter === 'test').map((line) => line.level);
    expect(refusals).toEqual([40, ...Array<number>(9).fill(20), 40]);
    const access = lines
      .filter(
        (line) =>
          !('limiter' in line) &&
          (line.res as { statusCode?: number } | undefined)?.statusCode === 429,
      )
      .map((line) => line.level);
    expect(access).toEqual([30, ...Array<number>(9).fill(20), 30]);
  });

  it('a limit of 0 turns the limiter off', async () => {
    const http = app({ name: 'test', windowMs: 60_000, limit: 0, keyBy: 'user' });
    for (let i = 0; i < 5; i += 1) expect((await http.post('/write')).status).toBe(200);
  });
});
