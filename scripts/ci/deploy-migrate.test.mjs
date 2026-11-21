// scripts/ci/deploy-migrate.sh with a fake `supabase` first on the PATH, so nothing here reaches a database. The fake
// answers `migration list` with FAKE_LIST, records each `db push` (its arguments, directory and whether the
// credentials reached it through the environment) and exits FAKE_PUSH_EXIT.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('deploy-migrate.sh', import.meta.url));
const TOKEN = 'sbp_fake_token_0123456789';
const PASSWORD = 'fake-db-password-9876';

const fake = `#!/bin/sh
echo "supabase $*" >&2
case "$1 $2" in
  "migration list") printf '%s\\n' "$FAKE_LIST" ;;
  "db push")
    echo "$* | $(pwd) | token=\${SUPABASE_ACCESS_TOKEN:+set} password=\${SUPABASE_DB_PASSWORD:+set}" > "$STATE/push"
    exit "\${FAKE_PUSH_EXIT:-0}" ;;
  *) echo "unexpected supabase $*" >&2; exit 2 ;;
esac`;

const list = (rows) => JSON.stringify({ migrations: rows, message: 'Migrations listed' });
const row = (local, remote) => ({ local, remote, time: '2026-11-21 00:00:00' });

function run(args, { rows = [], output, pushExit = 0, token = TOKEN, password = PASSWORD } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-migrate-'));
  writeFileSync(join(dir, 'supabase'), fake);
  chmodSync(join(dir, 'supabase'), 0o755);
  const summary = join(dir, 'summary');
  const r = spawnSync('bash', [script, ...args.map((a) => (a === '$DIR' ? dir : a))], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      STATE: dir,
      GITHUB_STEP_SUMMARY: summary,
      FAKE_LIST: output ?? list(rows),
      FAKE_PUSH_EXIT: String(pushExit),
      SUPABASE_ACCESS_TOKEN: token,
      SUPABASE_DB_PASSWORD: password,
    },
  });
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
  return {
    status: r.status,
    out: r.stdout + r.stderr,
    push: read('push'),
    summary: read('summary'),
    dir,
  };
}

const migrate = (opts) => run(['abcdefghijklmnopqrst', '$DIR'], opts);

test('pushes the migrations the database lacks, without a prompt, from the release directory', () => {
  const r = migrate({ rows: [row('20261101000000', '20261101000000'), row('20261120000000', '')] });
  assert.equal(r.status, 0, r.out);
  assert.match(r.push, /^db push --remote=abcdefghijklmnopqrst --yes \| /);
  assert.ok(r.push.includes(`| ${r.dir} |`), r.push);
  assert.match(r.push, /token=set password=set/);
  assert.match(r.summary, /Migrations: 1 new, pushed to abcdefghijklmnopqrst\./);
});

test('nothing new: succeeds and reports nothing to apply', () => {
  const r = migrate({ rows: [row('20261101000000', '20261101000000')] });
  assert.equal(r.status, 0, r.out);
  assert.match(r.summary, /Migrations: 0 new/);
});

test('a rollback (the database is ahead of the release) skips without pushing or reverting', () => {
  const r = migrate({ rows: [row('20261101000000', '20261101000000'), row('', '20261120000000')] });
  assert.equal(r.status, 0, r.out);
  assert.equal(r.push, '', 'nothing pushed');
  assert.doesNotMatch(r.out, /repair|reset/);
  assert.match(
    r.summary,
    /Migrations skipped: the database is ahead of this release \(20261120000000\)/,
  );
});

test('a mixed state (the database is ahead and the release has pending migrations) stops the run', () => {
  const r = migrate({
    rows: [
      row('20261101000000', '20261101000000'),
      row('', '20261120000000'),
      row('20261115000000', ''),
    ],
  });
  assert.equal(r.status, 1, r.out);
  assert.equal(r.push, '', 'nothing pushed');
  assert.match(r.out, /::error::.*20261120000000.*20261115000000/);
  assert.match(r.summary, /Migrations stopped: .*20261120000000.*20261115000000/);
});

test('a failed push fails the step, so the host deploy never starts', () => {
  const r = migrate({ rows: [row('20261120000000', '')], pushExit: 1 });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.summary, /pushed to/);
});

test('output the script cannot read stops it before any push', () => {
  const r = migrate({ output: 'Local | Remote | Time (UTC)' });
  assert.notEqual(r.status, 0);
  assert.equal(r.push, '');
});

test('--check fails on a missing secret before anything runs, naming it', () => {
  for (const [opts, name] of [
    [{ token: '' }, 'SUPABASE_ACCESS_TOKEN'],
    [{ password: '' }, 'SUPABASE_DB_PASSWORD'],
  ]) {
    const r = run(['--check'], opts);
    assert.equal(r.status, 1, name);
    assert.match(
      r.out,
      new RegExp(`Missing ${name}: add them as secrets of the production Environment`),
    );
    assert.doesNotMatch(r.out, /^supabase /m, 'the CLI never ran');
  }
  const ok = run(['--check']);
  assert.equal(ok.status, 0, ok.out);
  assert.doesNotMatch(ok.out, /^supabase /m);
  const full = migrate({ password: '' });
  assert.equal(full.status, 1, 'the full run checks too');
  assert.equal(full.push, '');
});

test('never prints a secret, nor passes one on a command line', () => {
  for (const opts of [
    { rows: [row('20261120000000', '')] },
    { rows: [row('', '20261120000000')] },
    { rows: [row('20261120000000', '')], pushExit: 1 },
  ]) {
    const r = migrate(opts);
    for (const secret of [TOKEN, PASSWORD]) {
      assert.ok(!r.out.includes(secret), 'output');
      assert.ok(!r.summary.includes(secret), 'summary');
      assert.ok(!r.push.includes(secret), 'arguments');
    }
  }
  assert.doesNotMatch(
    readFileSync(script, 'utf8'),
    /^[^#\n]*(set -[a-z]*x|set -o xtrace|printenv|\benv\s*$)/m,
    'no tracing, no dumping the environment',
  );
});
