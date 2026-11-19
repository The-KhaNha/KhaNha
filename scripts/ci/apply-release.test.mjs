// infra/host/apply-release.sh with fake aws, docker and curl on the PATH (P8 PR 04): what it starts, in what order,
// and how it exits. The release parameter is FAKE_RELEASE; a tag pair listed in NEVER_READY never answers /api/ready.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const script = new URL('../../infra/host/apply-release.sh', import.meta.url).pathname;

const fakes = {
  aws: `#!/bin/sh
case "$1 $2" in
  "ssm get-parameter") [ -n "$FAKE_RELEASE" ] || exit 254; echo "$FAKE_RELEASE" ;;
  "ecr get-login-password") echo password ;;
  *) echo "unexpected aws $*" >&2; exit 2 ;;
esac`,
  docker: `#!/bin/sh
# Reads the password like the real one: exiting unread would SIGPIPE the piped aws, which pipefail turns into a failure.
[ "$1" = login ] && { cat > /dev/null; exit 0; }
echo "$WEB_TAG $SERVER_TAG" >> "$STATE/ups"
echo "$WEB_TAG $SERVER_TAG" > "$STATE/current"`,
  curl: `#!/bin/sh
case ",$NEVER_READY," in *",$(cat "$STATE/current"),"*) exit 22 ;; esac`,
};

function run(args, { release = '', neverReady = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'apply-release-'));
  for (const [name, body] of Object.entries(fakes)) {
    writeFileSync(join(dir, name), body);
    chmodSync(join(dir, name), 0o755);
  }
  const result = spawnSync('bash', [script, 'production', 'registry.example/khanha', ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      STATE: dir,
      FAKE_RELEASE: release,
      NEVER_READY: neverReady,
      RENDER_ENV: 'true',
      READY_TRIES: '2',
      READY_PAUSE: '0',
    },
  });
  const ups = existsSync(join(dir, 'ups'))
    ? readFileSync(join(dir, 'ups'), 'utf8').trim().split('\n')
    : [];
  return { status: result.status, ups, output: result.stdout + result.stderr };
}

test('applies the candidate tags', () => {
  const { status, ups } = run(['w1', 's1'], { release: 'w0 s0' });
  assert.equal(status, 0);
  assert.deepEqual(ups, ['w1 s1']);
});

test("with no candidate, applies the release parameter's tags", () => {
  const { status, ups } = run([], { release: 'w0 s0' });
  assert.equal(status, 0);
  assert.deepEqual(ups, ['w0 s0']);
});

test('with no candidate and no release yet (the first host), exits cleanly having started nothing', () => {
  const { status, ups, output } = run([]);
  assert.equal(status, 0);
  assert.deepEqual(ups, []);
  assert.match(output, /nothing to apply/);
});

test("a candidate that never becomes ready ends on the parameter's tags, with a non-zero exit", () => {
  const { status, ups } = run(['w2', 's2'], { release: 'w0 s0', neverReady: 'w2 s2' });
  assert.notEqual(status, 0);
  assert.deepEqual(ups, ['w2 s2', 'w0 s0']);
});
