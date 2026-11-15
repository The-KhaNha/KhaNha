// The class guard for ADR-004: money changes unit in utils/money.ts and nowhere else. A `* 100` or `/ 100` anywhere
// else in the server's code is a second converter, which is how the units drift apart.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const CONVERTER = 'src/utils/money.ts';
// `* 100` or `/ 100`, but not `* 1000`, `/ 100_000` or `* 100.5`.
const CONVERSION = /[*/]\s*100(?![\d_.])/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)));
}

it('only utils/money.ts converts between paise and rupees', () => {
  const offenders = ['src', 'scripts']
    .flatMap((dir) => sourceFiles(join(ROOT, dir)))
    .filter((file) => file !== CONVERTER)
    .flatMap((file) =>
      readFileSync(join(ROOT, file), 'utf8')
        .split('\n')
        .flatMap((line, i) => (CONVERSION.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
    );
  expect(offenders).toEqual([]);
});

it('the scan sees the server code (a wrong root would pass with nothing scanned)', () => {
  expect(sourceFiles(join(ROOT, 'src'))).toContain(CONVERTER);
});
