import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The client scrubs a report before sending, the server again on receipt (the server's rootDir forbids importing the
// client, and neither regex is exported), so both sources are read as text. The phone alternative must stay identical:
// a wider one on one side only leaves a number the other half lets through.
const read = (path: string) => readFileSync(join(__dirname, '../../..', path), 'utf8');
const clientSource = read('client/src/lib/errorReporter.ts');
const serverSource = read('server/src/schemas/clientErrors.schema.ts');

const clientLiteral = /const SECRET =\s*\/(.+)\/gi;/.exec(clientSource)?.[1];
const serverLiteral = /String\.raw`(\\\+\?\\\(\?\\d\(.+)`,\s*\]\.join/.exec(serverSource)?.[1];
if (!clientLiteral || !serverLiteral) throw new Error('scrub pattern not found');

const phoneOf = (pattern: string) => pattern.slice(pattern.lastIndexOf('|') + 1);
const clientRe = new RegExp(clientLiteral, 'gi');
const serverRe = new RegExp(serverLiteral, 'gi');

describe('phone scrub parity (client errorReporter, server clientErrors.schema)', () => {
  it('keeps the trailing phone alternative identical on both sides', () => {
    expect(phoneOf(clientLiteral)).toBe(phoneOf(serverLiteral));
    expect(phoneOf(serverLiteral)).toMatch(/^\\\+\?.*\{9,14\}$/);
  });

  it.each(['+91 - 98765 - 43210', '98765/43210', '(987) 654-3210', 'call 9876543210 now'])(
    'both scrub %s',
    (text) => {
      expect(text.replace(clientRe, '[Redacted]')).toContain('[Redacted]');
      expect(text.replace(serverRe, '[Redacted]')).toContain('[Redacted]');
    },
  );

  it.each(['2026-11-10', '12:34', 'Order 1002', '₹270'])('neither touches %s', (text) => {
    expect(text.replace(clientRe, '[Redacted]')).toBe(text);
    expect(text.replace(serverRe, '[Redacted]')).toBe(text);
  });
});
