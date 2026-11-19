// compose.yaml (local) and infra/host/compose.prod.yml (the AWS host) must agree on each service's command and health
// check and on where web reaches the API (P8 PR 04), or production runs something no local stack or CI ever ran.
// Both files are resolved by `docker compose config`, so anchors and merges count exactly as compose reads them.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const root = new URL('../..', import.meta.url).pathname;
const envDir = mkdtempSync(join(tmpdir(), 'compose-parity-'));
for (const file of ['params.env', 'secret.env', 'api.env']) writeFileSync(join(envDir, file), '');

function services(file) {
  const json = execFileSync(
    'docker',
    ['compose', '-f', join(root, file), 'config', '--format', 'json'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        API_ENV_FILE: join(envDir, 'api.env'),
        ENV_DIR: envDir,
        IMAGE_PREFIX: 'registry.example/khanha',
        WEB_TAG: 'web',
        SERVER_TAG: 'server',
      },
    },
  );
  return JSON.parse(json).services;
}

const local = services('compose.yaml');
const prod = services('infra/host/compose.prod.yml');

for (const name of ['api', 'web', 'worker']) {
  test(`${name}: same command and health check`, () => {
    assert.ok(prod[name], `compose.prod.yml has no ${name} service`);
    assert.deepEqual(prod[name].command, local[name].command);
    assert.deepEqual(prod[name].healthcheck?.test, local[name].healthcheck?.test);
  });
}

test('web reaches the API at the same address', () => {
  assert.equal(prod.web.environment.API_UPSTREAM, local.web.environment.API_UPSTREAM);
});
