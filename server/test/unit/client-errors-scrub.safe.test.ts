// The scrub runs on unauthenticated input, so a crafted report must not make it quadratic. Linear takes a few ms here;
// the unbounded email pattern it replaced took ~80 ms on the dotted run below, and a slower machine scales both alike.
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { clientErrorsSchema } from '../../src/schemas/clientErrors.schema';

const at = new Date().toISOString();
const batch = (text: string) => ({
  reports: Array.from({ length: 5 }, () => ({
    kind: 'error' as const,
    message: text.slice(0, 500),
    stack: text.slice(0, 3500),
    route: `/${text}`.slice(0, 4000),
    at,
  })),
});

describe('clientErrorsSchema scrub', () => {
  it.each([
    ['a long dotted run with no @', 'a.'.repeat(1750)],
    ['a run of digits', '1'.repeat(3500)],
    ['eyJ followed by dots', `eyJ${'a.'.repeat(1748)}`],
  ])('parses a worst-case batch (%s) in linear time', (_label, text) => {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      clientErrorsSchema.parse(batch(text));
      best = Math.min(best, performance.now() - start);
    }
    expect(best).toBeLessThan(50);
  });
});
