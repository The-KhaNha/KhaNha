import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { DURATION, findDurations } from './check-durations.mjs';

let root;
const write = (file, body) => {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), body);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'check-durations-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('the pattern matches thousands with an underscore only', () => {
  assert.ok(DURATION.test('const TIMEOUT = 10_000;'));
  assert.ok(DURATION.test('setTimeout(run, 60_000)'));
  assert.ok(!DURATION.test('const LIMIT = 10000;'));
  assert.ok(!DURATION.test('const PRICE = 1_500;'));
});

test('reports services, domain and *Rules.ts with file:line', () => {
  write('server/src/services/a.service.ts', 'ok\nconst RETRY = 30_000;\n');
  write('server/src/domain/b.ts', 'const X = 5_000;\n');
  write('client/src/features/cart/cartRules.ts', 'export const HOLD_MS = 120_000;\n');
  const hits = findDurations(root).map(({ file, line }) => `${file}:${line}`);
  assert.deepEqual(hits.sort(), [
    'client/src/features/cart/cartRules.ts:1',
    'server/src/domain/b.ts:1',
    'server/src/services/a.service.ts:2',
  ]);
});

test('ignores tests, other client files and other server folders', () => {
  write('server/src/services/a.service.test.ts', 'const X = 30_000;\n');
  write('server/src/utils/cache.ts', 'const TTL = 10_000;\n');
  write('client/src/features/cart/CartBar.tsx', 'const X = 30_000;\n');
  write('client/src/features/cart/cartRules.test.ts', 'const X = 30_000;\n');
  assert.deepEqual(findDurations(root), []);
});
