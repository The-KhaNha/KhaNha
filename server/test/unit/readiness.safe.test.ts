import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { readinessHandler } from '../../src/controllers/health.controller';

function appWith(probe: (signal: AbortSignal) => Promise<unknown>) {
  const app = express();
  app.get('/ready', readinessHandler(probe));
  return app;
}

describe('readinessHandler', () => {
  it('answers 200 when the probe resolves', async () => {
    const res = await request(appWith(async () => undefined)).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ready: true });
  });

  it('answers 503 when the probe rejects', async () => {
    const res = await request(
      appWith(async () => {
        throw new Error('fetch failed');
      }),
    ).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ready: false });
  });

  it('gives the probe a signal that aborts after about a second, and answers 503 once it has', async () => {
    let signal: AbortSignal | undefined;
    // Monotonic: the wall clock can step backwards mid-test (WSL and NTP do), which once made this "elapsed" negative.
    const startedAt = performance.now();
    // A probe that hangs like a dead connection and settles only when its signal aborts.
    const res = await request(
      appWith(
        (s) =>
          new Promise((_, reject) => {
            signal = s;
            s.addEventListener('abort', () => reject(s.reason));
          }),
      ),
    ).get('/ready');
    const elapsed = performance.now() - startedAt;
    expect(signal).toBeInstanceOf(AbortSignal);
    // A timeout, not some other abort: the 503 came from the probe's own deadline.
    expect(signal?.reason).toMatchObject({ name: 'TimeoutError' });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ready: false });
    expect(elapsed).toBeGreaterThanOrEqual(900);
    // Generous: a loaded CI runner may be slow, but a probe that never times out would hang to the test timeout.
    expect(elapsed).toBeLessThan(5000);
  });
});
