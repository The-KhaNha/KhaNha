import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// server/scripts/db-push.sh pushes migrations to a hosted project. A stub `pnpm` first on PATH records the CLI call,
// so nothing here reaches Supabase; only the staging path runs (production asks to type its name).
const SCRIPT = fileURLToPath(new URL('../../server/scripts/db-push.sh', import.meta.url));

function push(...args) {
  const bin = mkdtempSync(join(tmpdir(), 'db-push-'));
  writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nprintf "pnpm"; printf " [%s]" "$@"; echo\n');
  chmodSync(join(bin, 'pnpm'), 0o755);
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

test('names our environment, then pushes with --remote (CLI 3 pushes locally without it)', () => {
  const { status, out } = push('staging');
  assert.equal(status, 0);
  assert.match(out, /^Environment: staging \([a-z]{20}\)$/m);
  assert.match(out, /^pnpm \[exec\] \[supabase\] \[db\] \[push\] \[--remote=[a-z]{20}\]$/m);
});

test('passes extra flags through, with or without the -- that pnpm run forwards', () => {
  for (const args of [
    ['staging', '--dry-run'],
    ['staging', '--', '--dry-run'],
  ]) {
    const { status, out } = push(...args);
    assert.equal(status, 0);
    assert.match(
      out,
      /^pnpm \[exec\] \[supabase\] \[db\] \[push\] \[--remote=[a-z]{20}\] \[--dry-run\]$/m,
      args.join(' '),
    );
  }
});

test('an unknown environment prints the usage and runs nothing', () => {
  const { status, out } = push('prod');
  assert.equal(status, 1);
  assert.match(out, /^Usage: /);
  assert.doesNotMatch(out, /pnpm \[/);
});
