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

  it('gives the probe a signal that aborts after about a second', async () => {
    let signal: AbortSignal | undefined;
    await request(
      appWith(async (s) => {
        signal = s;
      }),
    ).get('/ready');
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });
});
