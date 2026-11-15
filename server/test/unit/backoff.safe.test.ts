import { describe, expect, it } from 'vitest';
import { backoffSeconds } from '../../src/jobs/runner';

const policy = { baseSec: 5, maxSec: 900 };
const mid = () => 0.5; // no jitter: 0.8 + 0.4 × 0.5 = 1

describe('backoffSeconds', () => {
  it('doubles from the base with each attempt', () => {
    expect([1, 2, 3, 4, 5].map((attempt) => backoffSeconds(attempt, policy, mid))).toEqual([
      5, 10, 20, 40, 80,
    ]);
  });

  it('stops growing at the cap', () => {
    expect(backoffSeconds(9, policy, mid)).toBe(900);
    expect(backoffSeconds(30, policy, mid)).toBe(900);
  });

  it('jitters by at most 20% either way', () => {
    expect(backoffSeconds(3, policy, () => 0)).toBe(16); // 20 × 0.8
    expect(backoffSeconds(3, policy, () => 0.999999)).toBe(24); // 20 × 1.2
    for (let i = 0; i < 200; i += 1) {
      const delay = backoffSeconds(3, policy);
      expect(delay).toBeGreaterThanOrEqual(16);
      expect(delay).toBeLessThanOrEqual(24);
    }
  });

  it('is whole seconds, never under 1', () => {
    expect(backoffSeconds(1, { baseSec: 1, maxSec: 1 }, () => 0)).toBe(1);
    expect(Number.isInteger(backoffSeconds(2, { baseSec: 3, maxSec: 60 }, () => 0.123))).toBe(true);
  });
});
