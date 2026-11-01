import { once } from 'node:events';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, JSON_BODY_LIMIT_BYTES } from '../../src/app';
import { api } from '../setup/api';

describe('JSON body limit', () => {
  it('a declared length over the limit -> 413 PAYLOAD_TOO_LARGE with Connection: close, before auth runs', async () => {
    const body = JSON.stringify({ note: 'x'.repeat(JSON_BODY_LIMIT_BYTES + 1) });
    const res = await api().post('/api/orders').set('Content-Type', 'application/json').send(body);
    expect(res.status).toBe(413);
    expect(res.headers.connection).toBe('close');
    expect(res.body).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' },
    });
  });

  it('a body just under the limit reaches the route (here: 401, no token)', async () => {
    const body = JSON.stringify({ note: 'x'.repeat(JSON_BODY_LIMIT_BYTES - 100) });
    const res = await api().post('/api/orders').set('Content-Type', 'application/json').send(body);
    expect(res.status).toBe(401);
  });
});

// A raw client, because the bug lives below supertest: the API answered an oversized upload and closed the connection
// with the rest unread, so the OS reset it, and a client still sending saw ECONNRESET instead of the 413 (seen as
// flaky 413 tests under load). `agent: false` makes the client ask for Connection: close, the harshest case.
let server: Server;
let port: number;

beforeAll(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

interface Outcome {
  status?: number;
  body: string;
  error?: string;
  /** Bytes the client had sent when the answer arrived. */
  sentAtAnswer?: number;
  /** When the answer arrived, from the first byte sent. */
  answeredAfterMs?: number;
}

/**
 * Declares `declared` bytes and sends `sendBytes` of them in `chunk`-sized writes `gapMs` apart, the way a slow phone
 * uploads, without stopping for the answer. A `sendBytes` below `declared` stalls the upload (it never ends).
 */
function upload(
  declared: number,
  { sendBytes = declared, chunk = 16 * 1024, gapMs = 10 } = {},
): Promise<Outcome> {
  return new Promise((resolve) => {
    const outcome: Outcome = { body: '' };
    const startedAt = Date.now();
    let sent = 0;
    const req = request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/api/auth/register',
      agent: false,
      headers: { 'content-type': 'application/json', 'content-length': declared },
    });
    req.on('response', (res) => {
      outcome.status = res.statusCode;
      outcome.sentAtAnswer = sent;
      outcome.answeredAfterMs = Date.now() - startedAt;
      res.setEncoding('utf8');
      res.on('data', (part: string) => (outcome.body += part));
    });
    req.on('error', (err: NodeJS.ErrnoException) => (outcome.error = err.code ?? err.message));
    req.on('close', () => resolve(outcome));
    const piece = Buffer.alloc(chunk, 'a');
    const next = () => {
      if (req.destroyed) return;
      if (sent >= sendBytes) {
        if (sendBytes >= declared) req.end();
        return;
      }
      const n = Math.min(piece.length, sendBytes - sent);
      sent += n;
      req.write(piece.subarray(0, n), () => setTimeout(next, gapMs));
    };
    next();
  });
}

const OVER = JSON_BODY_LIMIT_BYTES + 50 * 1024;

describe('an oversized upload', () => {
  it('is read to its end before the 413, so every client gets the answer and none sees a reset', async () => {
    // The whole body in one write, as supertest sends it, 40 at once: before the fix, 1-6 of 40 lost the 413 to the
    // reset on every run.
    const outcomes = await Promise.all(
      Array.from({ length: 40 }, () => upload(OVER, { chunk: OVER, gapMs: 0 })),
    );
    for (const outcome of outcomes) {
      expect(outcome.error).toBeUndefined();
      expect(outcome.status).toBe(413);
      expect(JSON.parse(outcome.body)).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    }
  });

  it('that stalls is answered after the drain time limit, not at once and not never', async () => {
    const outcome = await upload(OVER, { sendBytes: 16 * 1024 });
    expect(outcome.status).toBe(413);
    expect(outcome.answeredAfterMs).toBeGreaterThanOrEqual(1500);
    expect(outcome.answeredAfterMs).toBeLessThan(5000);
  });

  it('that is huge is cut once the drain byte limit is read, long before it all arrives', async () => {
    const declared = 10 * 1024 * 1024;
    const outcome = await upload(declared, { chunk: 64 * 1024, gapMs: 0 });
    // Past the cap the answer may lose to the reset; either way the server stopped reading early.
    expect(outcome.status === 413 || outcome.error !== undefined).toBe(true);
    if (outcome.sentAtAnswer !== undefined) expect(outcome.sentAtAnswer).toBeLessThan(declared);
  });
});
