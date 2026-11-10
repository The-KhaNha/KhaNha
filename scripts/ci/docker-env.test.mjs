import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// scripts/docker-env.sh guards build.sh and run.sh: a staging stack must never start against the wrong project or
// with placeholder secrets, and a refusal must never print an env value. Every case here stops before `docker info`.
const SCRIPT =
  process.env.DOCKER_ENV_SCRIPT ?? fileURLToPath(new URL('../docker-env.sh', import.meta.url));
const SECRET = 'sb_secret_do_not_print_me';
const URL_STAGING = 'https://example-ref.supabase.co';

function run({ server, client }) {
  const dir = mkdtempSync(join(tmpdir(), 'docker-env-'));
  mkdirSync(join(dir, 'server'));
  mkdirSync(join(dir, 'client'));
  writeFileSync(join(dir, 'server/.env.staging'), server);
  writeFileSync(join(dir, 'client/.env.staging'), client);
  const r = spawnSync('bash', ['-c', `source "${SCRIPT}" staging`], { cwd: dir, encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
}

const server = (lines) =>
  [
    'APP_ENV=staging',
    `SUPABASE_URL=${URL_STAGING}`,
    `SUPABASE_SECRET_KEY=${SECRET}`,
    ...lines,
  ].join('\n');
const client = (url, key = 'sb_publishable_ok') =>
  `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_PUBLISHABLE_KEY=${key}\n`;

const cases = [
  {
    name: 'an empty SUPABASE_URL on both sides (would fall back to the local stack)',
    files: { server: 'APP_ENV=staging\nSUPABASE_URL=\n', client: client('') },
    message: /has no SUPABASE_URL/,
  },
  {
    name: 'a placeholder publishable key',
    files: { server: server([]), client: client(URL_STAGING, 'sb_publishable_REPLACE_ME') },
    message: /placeholder VITE_SUPABASE_PUBLISHABLE_KEY/,
  },
  {
    name: 'a placeholder in the API env file',
    files: {
      server: server(['SEED_ADMIN_PASSWORD=REPLACE_ME_12_CHARS_MIN']),
      client: client(URL_STAGING),
    },
    message: /SEED_ADMIN_PASSWORD[\s\S]*placeholder values/,
  },
  {
    name: 'an API and web on different projects',
    files: { server: server([]), client: client('https://other-ref.supabase.co') },
    message: /different Supabase projects/,
  },
  {
    name: 'the wrong APP_ENV',
    files: {
      server: server([]).replace('APP_ENV=staging', 'APP_ENV=local'),
      client: client(URL_STAGING),
    },
    message: /must set APP_ENV=staging/,
  },
];

for (const { name, files, message } of cases) {
  test(`docker-env.sh refuses ${name}`, () => {
    const { status, out } = run(files);
    assert.notEqual(status, 0, out);
    assert.match(out, message);
    assert.doesNotMatch(out, new RegExp(SECRET), 'a refusal printed the secret key');
    assert.doesNotMatch(out, /REPLACE_ME_12/, 'a refusal printed a placeholder value');
  });
}
