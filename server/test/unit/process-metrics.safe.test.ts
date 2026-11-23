import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { countRequests, takeRequestStats } from '../../src/utils/processMetrics';

/** One request through the counter, answered with `status` after `durationMs`. */
function request(status: number, durationMs: number) {
  const res = Object.assign(new EventEmitter(), { statusCode: status });
  const now = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(durationMs);
  countRequests({} as Request, res as unknown as Response, () => {});
  res.emit('finish');
  now.mockRestore();
}

describe('the API request counter', () => {
  beforeEach(() => {
    takeRequestStats();
  });

  it('counts every request, the 5xx among them, and the p95 of their durations', () => {
    for (let ms = 1; ms <= 100; ms += 1) request(ms === 50 ? 503 : 200, ms);
    request(404, 7);
    expect(takeRequestStats()).toEqual({ requests: 101, serverErrors: 1, p95Ms: 95 });
  });

  it('starts a fresh window after each read, with no p95 in an empty one', () => {
    request(500, 1200);
    expect(takeRequestStats()).toEqual({ requests: 1, serverErrors: 1, p95Ms: 1200 });
    expect(takeRequestStats()).toEqual({ requests: 0, serverErrors: 0 });
  });

  it('keeps sampling past the cap, so a slowdown late in a busy window still moves the p95', () => {
    for (let i = 0; i < 20_000; i += 1) request(200, 10);
    for (let i = 0; i < 10_000; i += 1) request(200, 2000);
    const stats = takeRequestStats();
    expect(stats.requests).toBe(30_000);
    // A third of the traffic is slow, so the p95 is a slow request (sampled, so not an exact count).
    expect(stats.p95Ms).toBe(2000);
  });
});
