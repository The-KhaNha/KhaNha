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
    ['a long run of percent escapes with no @', '%2B'.repeat(1166)],
    ['a long run of apostrophes and letters with no @', "o'".repeat(1750)],
    ['a long run of encoded token names with no value', 'token%3D&'.repeat(388)],
    ['a long run of percent signs and letters with no @', '%a'.repeat(1750)],
    ['a long run of letters after apostrophes with no @', "'a".repeat(1750)],
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

// Shapes the first scrub let through (a /break run): a percent-encoded `=`, a `%` or `'` in an email's local part, and a
// password in a URL parameter. Each `leak` must be gone from every field.
describe('clientErrorsSchema scrub: encoded and unusual shapes', () => {
  it.each([
    [
      'an encoded refresh token',
      'next=%2Fauth%23refresh_token%3Dr3fr35hT0k3n%26type%3Dsignup',
      'r3fr35hT0k3n',
    ],
    ['an encoded access token, upper-case %3D', 'access_token%3DaCcE55T0k3n', 'aCcE55T0k3n'],
    ['an encoded OAuth code', '/auth/callback?code%3Dc0d3V4lu3', 'c0d3V4lu3'],
    ['a password parameter', 'POST /login?password=hunter2hunter2', 'hunter2hunter2'],
    ['an encoded password parameter', 'password%3Dhunter2hunter2', 'hunter2hunter2'],
    ['an encoded +-address', 'user breaker%2Bx%40example.com failed', 'breaker'],
    ['an apostrophe in the local part', "user o'brien.smith@example.com failed", 'brien.smith'],
    // A match may start inside a `%`- or `'`-joined run: the run before an encoded email can be far over 64 characters.
    [
      'an encoded email deep in an encoded redirect URL',
      'Failed to fetch https://x.supabase.co/auth/v1/verify?type=signup&redirect_to=https%3A%2F%2Fapp.example.com%2Fauth%2Fcallback%3Femail%3Djohn.doe%40example.com',
      'john.doe',
    ],
    [
      'an encoded email deep in an encoded URL, with no email parameter',
      'next%3Dhttps%3A%2F%2Fapp.example.com%2Fauth%2Fcallback%2Fjohn.doe%40example.com',
      'john.doe',
    ],
    [
      'an email after an apostrophe that ends a long word',
      `${'a'.repeat(65)}'john@example.com`,
      'john@',
    ],
  ])('redacts %s', (_label, text, leak) => {
    const [parsed] = clientErrorsSchema.parse(batch(text)).reports;
    expect(JSON.stringify(parsed)).not.toContain(leak);
    expect(parsed?.message).toContain('[Redacted]');
  });

  it('leaves ordinary text alone', () => {
    const text = "TypeError: can't read 'price' of undefined at 50% width";
    expect(clientErrorsSchema.parse(batch(text)).reports[0]?.message).toBe(text);
  });
});

// Phone numbers written with wider separators slipped past the first pattern (up to two of space, dash, dot or
// parenthesis). Ordinary short numbers in an error message must survive: they are what makes a report readable.
describe('clientErrorsSchema scrub: phone numbers', () => {
  it.each([
    ['spaced dashes', '+91 - 98765 - 43210', '43210'],
    ['a slash', '98765/43210', '43210'],
    ['brackets and a dash', '(987) 654-3210', '3210'],
    ['a space', '98765 43210', '43210'],
    ['dots', '+91.98765.43210', '43210'],
  ])('redacts a phone with %s', (_label, phone, leak) => {
    const [parsed] = clientErrorsSchema.parse(batch(`call ${phone} failed`)).reports;
    expect(JSON.stringify(parsed)).not.toContain(leak);
    expect(parsed?.message).toBe('call [Redacted] failed');
  });

  it.each([
    ['an order number', 'Order #1002 not found'],
    ['a price', 'Total ₹270 does not match'],
    ['a time', 'Pickup at 12:30 is closed'],
    ['an ISO date', 'No slots on 2026-11-09'],
    ['an ISO timestamp', 'Stale at 2026-11-09T12:30:00.000Z'],
    ['a quantity and a stack position', 'Only 3 left at checkout.js:120:7'],
  ])('leaves %s alone', (_label, text) => {
    expect(clientErrorsSchema.parse(batch(text)).reports[0]?.message).toBe(text);
  });

  it.each([
    ['digits split by three separators', '1 - '.repeat(875)],
    ['nine-digit runs that never reach ten', `${'1/'.repeat(9)}x`.repeat(175)],
    ['separators with no digits', '( -/'.repeat(875)],
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
