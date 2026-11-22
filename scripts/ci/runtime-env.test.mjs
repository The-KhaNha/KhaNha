// client/nginx/runtime-env.sh, the web image's start step that writes /runtime-env.js (P8 PR 05b for the hosts). Run
// with its output folder moved into a temp dir, so nothing outside it is written.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../../client/nginx/runtime-env.sh', import.meta.url)),
  'utf8',
);
const required = {
  API_UPSTREAM: 'http://api:8000',
  MEDIA_UPSTREAM: 'http://media:9000',
  SUPABASE_URL: 'https://ref.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
};

function run(extra) {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-env-'));
  writeFileSync(join(dir, 'run.sh'), source.replaceAll('/tmp/runtime-env', dir));
  const r = spawnSync('sh', [join(dir, 'run.sh')], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...required, ...extra },
  });
  let written = '';
  try {
    written = readFileSync(join(dir, 'runtime-env.js'), 'utf8');
  } catch {
    // Refused before writing.
  }
  return { status: r.status, err: r.stderr, written };
}

test('writes the three hosts for the client', () => {
  const r = run({
    CUSTOMER_HOST: 'khanha.in',
    STAFF_HOST: 'staff.khanha.in',
    ADMIN_HOST: 'localhost:8080',
  });
  assert.equal(r.status, 0, r.err);
  assert.match(
    r.written,
    /"CUSTOMER_HOST":"khanha\.in","STAFF_HOST":"staff\.khanha\.in","ADMIN_HOST":"localhost:8080"/,
  );
});

test('unset hosts are written empty (one origin, sections by path)', () => {
  const r = run({});
  assert.equal(r.status, 0, r.err);
  assert.match(r.written, /"STAFF_HOST":""/);
});

test('a host that is a URL or has capitals is refused, so it never misses location.host', () => {
  for (const value of ['https://staff.khanha.in', 'Staff.khanha.in', 'staff.khanha.in/x']) {
    const r = run({ STAFF_HOST: value });
    assert.equal(r.status, 1, value);
    assert.match(r.err, /STAFF_HOST must be a host/);
    assert.equal(r.written, '');
  }
});
