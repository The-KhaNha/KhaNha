import { once } from 'node:events';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestUser, deleteTestUser, type TestUser } from '../setup/helpers';

// The suites run with the limits off (vitest.config.mts). This file loads its own copy of the app with a small
// per-address limit, to check where the limiter sits in the pipeline, not how it counts (rate-limit.safe.test.ts).
const IP_MAX = 3;
let server: Server;

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  [alice, bob] = await Promise.all([createTestUser('CUSTOMER'), createTestUser('CUSTOMER')]);
  vi.resetModules();
  process.env.RATE_LIMIT_IP_MAX = String(IP_MAX);
  // One trusted hop, so each case below can stand at its own address (X-Forwarded-For) and start with a fresh count.
  process.env.TRUST_PROXY_HOPS = '1';
  const { createApp } = await import('../../src/app.js');
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
});

afterAll(async () => {
  process.env.RATE_LIMIT_IP_MAX = '0';
  delete process.env.TRUST_PROXY_HOPS;
  await Promise.all([alice, bob].map((u) => deleteTestUser(u)));
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
        .set('X-Forwarded-For', '198.51.100.1')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'POST');
    for (let i = 0; i < IP_MAX; i += 1) expect((await preflight()).status).toBe(204);
    const over = await preflight();
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe('RATE_LIMITED');
  });
});

// Campus Wi-Fi puts a whole cafe queue behind one public address: a signed-in customer is counted on their own, so
// their classmates' polling never locks them out, while anonymous and forged-token traffic still shares the address.
describe('the flood limit counts a signed-in caller on their own', () => {
  const from = (address: string, token?: string) => {
    const req = request(server).get('/api/health').set('X-Forwarded-For', address);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('two accounts behind one address each get the full budget', async () => {
    for (let i = 0; i < IP_MAX; i += 1)
      expect((await from('198.51.100.2', alice.token)).status).toBe(200);
    expect((await from('198.51.100.2', alice.token)).status).toBe(429);
    expect((await from('198.51.100.2', bob.token)).status).toBe(200);
  });

  it('anonymous requests and forged tokens share the address budget', async () => {
    for (let i = 0; i < IP_MAX - 1; i += 1) expect((await from('198.51.100.3')).status).toBe(200);
    expect((await from('198.51.100.3', 'not-a-real-token')).status).toBe(200);
    expect((await from('198.51.100.3', 'another-forged-token')).status).toBe(429);
  });
});
