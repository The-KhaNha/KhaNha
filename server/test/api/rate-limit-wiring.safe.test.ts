import { once } from 'node:events';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The suites run with the limits off (vitest.config.mts). This file loads its own copy of the app with a small
// per-address limit, to check where the limiter sits in the pipeline, not how it counts (rate-limit.safe.test.ts).
const IP_MAX = 3;
let server: Server;

beforeAll(async () => {
  vi.resetModules();
  process.env.RATE_LIMIT_IP_MAX = String(IP_MAX);
  const { createApp } = await import('../../src/app.js');
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
});

afterAll(async () => {
  process.env.RATE_LIMIT_IP_MAX = '0';
  vi.resetModules();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('the per-address limit covers every /api request', () => {
  // cors() answers a preflight itself, so a limiter mounted after it never saw one: a scripted flood of OPTIONS
  // requests went uncounted.
  it('counts CORS preflights', async () => {
    const preflight = () =>
      request(server)
        .options('/api/orders')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'POST');
    for (let i = 0; i < IP_MAX; i += 1) expect((await preflight()).status).toBe(204);
    const over = await preflight();
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe('RATE_LIMITED');
  });
});
