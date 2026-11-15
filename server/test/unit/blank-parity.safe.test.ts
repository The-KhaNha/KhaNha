import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trimBlank, visibleLength } from '../../src/schemas/common';

// The client's copy of the blank-character patterns (features/auth/validation.ts) is read and run, not imported: it is
// outside the server's rootDir. Its type annotations are stripped so the source runs as plain JS.
const source = readFileSync(
  join(__dirname, '../../../client/src/features/auth/validation.ts'),
  'utf8',
);
const start = source.indexOf('\nconst INVISIBLE');
const end = source.indexOf('\nexport function validateName');
if (start < 0 || end < start) throw new Error('client blank-character block not found');
const body = source
  .slice(start, end)
  .replace('(value: string): string', '(value)')
  .replace('function trimBlank', 'function clientTrimBlank');
const client = new Function(
  `${body}; return { trimBlank: clientTrimBlank, visibleLength: (v) => v.replace(DRAWS_NOTHING, '').length };`,
)() as { trimBlank: (v: string) => string; visibleLength: (v: string) => number };

const CORPUS = [
  'Asha',
  '  Asha  ',
  '​​',
  '⁠‍',
  '⠀⠀',
  'ㅤᅟᅠﾠ',
  '​Asha​',
  '️️',
  'A️',
  '❤️',
  '❤️️ ',
  '\u{1F468}‍\u{1F469}‍\u{1F467}',
  'Ra‍j',
  '‍\u{1F468}‍\u{1F469}‍',
  '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
  '​\u{1F3F4}\u{E0067}\u{E007F}​',
  'a͏b឴឵',
  '͏឴',
  '\u{E0001}x\u{E0001}',
  '\uD800',
  'a\uDC00',
  '\u{1F600}',
  '​\u{1F600}​',
  '',
  ' \t\n ',
];

describe('blank-character parity (server schemas/common.ts vs client features/auth/validation.ts)', () => {
  it.each(CORPUS)('trimBlank and the visible length agree on %j', (value) => {
    expect(client.trimBlank(value)).toBe(trimBlank(value));
    expect(client.visibleLength(client.trimBlank(value))).toBe(visibleLength(trimBlank(value)));
  });
});
