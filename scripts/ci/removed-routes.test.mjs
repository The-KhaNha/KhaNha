import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// The routes docs/API.md lists as removed ("**Removed in P2.** `GET /api/store`, … answer 404") must not be called by
// the scripts that probe a running API: start.sh once waited on GET /api/menu and would have reported every healthy
// start as an empty database.
const api = readFileSync('docs/API.md', 'utf8');
const removedSentence = /\*\*Removed in P2\.\*\*([^]*?)answer 404/.exec(api)?.[1] ?? '';
const removed = [...removedSentence.matchAll(/`[A-Z]+ (\/api\/[^`]+)`/g)].map((m) => m[1]);

const callers = [
  'start.sh',
  ...readdirSync('scripts', { recursive: true })
    .filter((f) => f.endsWith('.sh'))
    .map((f) => join('scripts', f)),
  ...readdirSync('.github/workflows').map((f) => join('.github/workflows', f)),
];

// `/api/menu` must not match `/api/menu-x` or `/api/menus`; `:id` stands for one path segment.
const pattern = (path) =>
  new RegExp(
    path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:\w+/g, '[^/\\s"\']+') + '(?![\\w/-])',
  );

test('docs/API.md names the removed routes', () => {
  assert.ok(removed.length >= 3, `found ${removed.join(', ')}`);
});

test('no script or workflow calls a removed route', () => {
  const hits = callers.flatMap((file) => {
    const body = readFileSync(file, 'utf8');
    return removed.filter((path) => pattern(path).test(body)).map((path) => `${file}: ${path}`);
  });
  assert.deepEqual(hits, []);
});
