import { once } from 'node:events';
import type { Server } from 'node:http';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as LoggerModule from '../../src/utils/logger';
import type * as SettingsModule from '../../src/services/settings.service';

// Loads its own copy of the app whose logger keeps every line, and whose site settings ask for client 9.0.0 or newer,
// so the version gate is live. Nothing here reads or writes the database: reports are only logged.
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJlLXZhbHVl';
const SECRET_KEY = 'sb_secret_N7UND0UgjKTVKUodkm0Hg';

/** `clientErrorsMax` undefined: the env default (a blank value means the default too, utils/env.ts). */
async function startApp(clientErrorsMax?: string) {
  vi.resetModules();
  if (clientErrorsMax === undefined) delete process.env.RATE_LIMIT_CLIENT_ERRORS_MAX;
  else process.env.RATE_LIMIT_CLIENT_ERRORS_MAX = clientErrorsMax;
  const lines: Record<string, unknown>[] = [];
  vi.doMock('../../src/utils/logger', async (importOriginal) => {
    const real = await importOriginal<typeof LoggerModule>();
    const logger = pino(
      {
        level: 'debug',
        redact: { paths: real.REDACT_PATHS, censor: '[Redacted]' },
        serializers: real.LOG_SERIALIZERS,
      },
      { write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>) },
    );
    return { ...real, logger };
  });
  vi.doMock('../../src/services/settings.service', async (importOriginal) => ({
    ...(await importOriginal<typeof SettingsModule>()),
    getSettings: () => Promise.resolve({ min_client_version: '9.0.0' }),
  }));
  const { createApp } = await import('../../src/app.js');
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, lines };
}

const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

const report = (overrides: Record<string, unknown> = {}) => ({
  kind: 'error',
  message: 'Cannot read properties of undefined',
  stack: 'TypeError: Cannot read properties of undefined\n    at Menu (menu.js:1:1)',
  route: '/menu',
  at: '2026-11-02T10:00:00.000Z',
  ...overrides,
});

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  app = await startApp('0');
});

afterAll(async () => {
  await close(app.server);
  vi.doUnmock('../../src/utils/logger');
  vi.doUnmock('../../src/services/settings.service');
  delete process.env.RATE_LIMIT_CLIENT_ERRORS_MAX;
  vi.resetModules();
});

const post = (body: object, version = '9.1.0') =>
  request(app.server).post('/api/client-errors').set('X-Client-Version', version).send(body);

const clientErrorLines = () => app.lines.filter((line) => line.msg === 'Client error');

describe('POST /api/client-errors', () => {
  it('answers 204 and logs one warn per report, with the client version', async () => {
    app.lines.length = 0;
    const res = await post({ reports: [report(), report({ kind: 'render', stack: undefined })] });
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    const logged = clientErrorLines();
    expect(logged).toHaveLength(2);
    expect(logged[0]).toMatchObject({
      level: 40,
      clientVersion: '9.1.0',
      kind: 'error',
      route: '/menu',
      message: 'Cannot read properties of undefined',
      stack: expect.stringContaining('at Menu'),
      at: '2026-11-02T10:00:00.000Z',
    });
    expect(logged[1]).toMatchObject({ kind: 'render' });
  });

  it.each([
    ['no reports', { reports: [] }],
    ['six reports', { reports: Array.from({ length: 6 }, () => report()) }],
    ['an oversized stack', { reports: [report({ stack: 'x'.repeat(3501) })] }],
    ['an oversized message', { reports: [report({ message: 'x'.repeat(501) })] }],
    ['an unknown field in a report', { reports: [report({ userAgent: 'x' })] }],
    ['an unknown top-level field', { reports: [report()], extra: true }],
    ['an unknown kind', { reports: [report({ kind: 'warning' })] }],
    ['a malformed time', { reports: [report({ at: 'yesterday' })] }],
  ])('refuses %s with 400 VALIDATION_ERROR', async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    ['five reports', { reports: Array.from({ length: 5 }, () => report()) }],
    ['a stack of exactly 3500 characters', { reports: [report({ stack: 'x'.repeat(3500) })] }],
    ['a message of exactly 500 characters', { reports: [report({ message: 'x'.repeat(500) })] }],
    ['a route of exactly 200 characters', { reports: [report({ route: `/${'a'.repeat(199)}` })] }],
    ['a time with an offset', { reports: [report({ at: '2026-11-02T15:30:00+05:30' })] }],
    [
      'every kind',
      { reports: ['error', 'unhandledrejection', 'render'].map((kind) => report({ kind })) },
    ],
  ])('accepts %s with 204', async (_name, body) => {
    expect((await post(body)).status).toBe(204);
  });

  it.each([
    ['a route over 4000 characters', { reports: [report({ route: `/${'a'.repeat(4000)}` })] }],
    ['a missing route', { reports: [report({ route: undefined })] }],
    ['a missing message', { reports: [report({ message: undefined })] }],
    ['reports that is not an array', { reports: report() }],
    ['an empty body', {}],
  ])('refuses %s with 400', async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a body that is not JSON with 400 and the error envelope, logging nothing', async () => {
    app.lines.length = 0;
    const res = await request(app.server)
      .post('/api/client-errors')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: expect.any(String), message: expect.any(String) },
    });
    expect(clientErrorLines()).toHaveLength(0);
  });

  // 10 KB nested 5,000 deep overflowed the stack in validate.ts's NUL-byte strip: a 500 logged at error, unauthenticated.
  it('refuses a body nested 5,000 deep with 400 VALIDATION_ERROR, logging nothing at error', async () => {
    app.lines.length = 0;
    const res = await request(app.server)
      .post('/api/client-errors')
      .set('X-Client-Version', '9.1.0')
      .set('Content-Type', 'application/json')
      .send(`{"reports":${'['.repeat(5000)}${']'.repeat(5000)}}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'The request body is nested too deeply.' },
    });
    expect(app.lines.filter((line) => Number(line.level) >= 50)).toEqual([]);
  });

  it('takes reports from an outdated client, which every gated route refuses', async () => {
    const gated = await request(app.server)
      .post('/api/auth/register')
      .set('X-Client-Version', '1.0.0')
      .send({});
    expect(gated.status).toBe(426);
    expect((await post({ reports: [report()] }, '1.0.0')).status).toBe(204);
  });

  it('needs no sign-in', async () => {
    const res = await request(app.server)
      .post('/api/client-errors')
      .send({ reports: [report()] });
    expect(res.status).toBe(204);
  });

  it('never lets a token-shaped string reach the log', async () => {
    app.lines.length = 0;
    const res = await post({
      reports: [
        report({
          message: `Request failed: Authorization: Bearer ${TOKEN}`,
          stack: `Error: key ${SECRET_KEY} rejected\n    at ${TOKEN}\n    at bearer abc.def-ghi`,
        }),
      ],
    });
    expect(res.status).toBe(204);
    const written = JSON.stringify(app.lines);
    expect(written).not.toContain(TOKEN);
    expect(written).not.toContain('eyJ');
    expect(written).not.toContain(SECRET_KEY);
    expect(written).not.toContain('abc.def-ghi');
    expect(clientErrorLines()[0]).toMatchObject({
      message: 'Request failed: Authorization: [Redacted]',
      stack: expect.stringContaining('key [Redacted] rejected'),
    });
  });

  it('never lets an email address or a phone number reach the log', async () => {
    app.lines.length = 0;
    const res = await post({
      reports: [
        report({
          message: 'Order failed for jane.doe+test@campus.example.edu',
          stack: 'Error: phone +91 98765-43210 rejected\n    at submit (checkout.js:120:7)',
        }),
      ],
    });
    expect(res.status).toBe(204);
    const written = JSON.stringify(app.lines);
    expect(written).not.toContain('jane.doe');
    expect(written).not.toContain('98765');
    expect(clientErrorLines()[0]).toMatchObject({
      message: 'Order failed for [Redacted]',
      stack: expect.stringContaining('checkout.js:120:7'),
    });
  });

  it('scrubs a refresh token, a cut-short JWT, a URL-encoded email, a bracketed phone and a prefixed key', async () => {
    app.lines.length = 0;
    const cut = TOKEN.slice(0, TOKEN.lastIndexOf('.'));
    const res = await post({
      reports: [
        report({
          message: `at /auth/callback#access_token=${TOKEN}&refresh_token=r3fr35hT0k3n&type=signup`,
          stack: `Error: ${cut}\n    user jane%40campus.edu, phone (987) 654-3210, key x_${SECRET_KEY}`,
        }),
      ],
    });
    expect(res.status).toBe(204);
    const written = JSON.stringify(app.lines);
    for (const leak of ['r3fr35hT0k3n', 'eyJzdWIi', 'jane', '654-3210', 'N7UND0Ugj']) {
      expect(written).not.toContain(leak);
    }
  });

  it('takes a long auth-callback route: its hash is dropped before the length check', async () => {
    app.lines.length = 0;
    const res = await post({
      reports: [report({ route: `/auth/callback#access_token=${TOKEN.repeat(20)}` })],
    });
    expect(res.status).toBe(204);
    expect(clientErrorLines()[0]).toMatchObject({ route: '/auth/callback' });
  });

  it('logs the route as a path only: no query string or hash, which can carry a token', async () => {
    app.lines.length = 0;
    const res = await post({
      reports: [report({ route: `/auth/callback?next=/orders#access_token=${TOKEN}&type=signup` })],
    });
    expect(res.status).toBe(204);
    expect(JSON.stringify(app.lines)).not.toContain(TOKEN);
    expect(clientErrorLines()[0]).toMatchObject({ route: '/auth/callback' });
  });
});

describe('clientErrorLimiter', () => {
  it('refuses the 31st request in a window with 429, per address, at the default limit', async () => {
    const limited = await startApp();
    try {
      const send = () =>
        request(limited.server)
          .post('/api/client-errors')
          .send({ reports: [report()] });
      for (let i = 0; i < 30; i += 1) expect((await send()).status).toBe(204);
      const refused = await send();
      expect(refused.status).toBe(429);
      expect(refused.body.error.code).toBe('RATE_LIMITED');
      expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(refused.body.error.details).toMatchObject({ kind: 'rateLimit' });
    } finally {
      await close(limited.server);
    }
  });
});
