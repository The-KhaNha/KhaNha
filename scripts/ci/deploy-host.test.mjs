// scripts/ci/deploy-host.sh with a fake `aws` first on the PATH (P8 PR 07), so nothing reaches AWS. The fake answers
// get-command-invocation with the next line of STATUSES (the last one repeats); a line starting `!` is an error.
// What matters: the script returns only once the command can no longer change the host, so the undo never races it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('deploy-host.sh', import.meta.url));

const fake = `#!/bin/bash
echo "aws $*" >> "$STATE/calls"
case "$1 $2" in
  "ec2 describe-instances") echo i-0123456789abcdef0 ;;
  "ssm send-command") echo cmd-1 ;;
  "ssm get-command-invocation")
    case "$*" in *StandardOutputContent*) echo output; exit 0 ;; esac
    n=$(cat "$STATE/n" 2>/dev/null || echo 0); echo $((n + 1)) > "$STATE/n"
    line=$(sed -n "$((n + 1))p" "$STATE/statuses"); [ -n "$line" ] || line=$(tail -1 "$STATE/statuses")
    case $line in "!"*) echo "An error occurred (\${line#!}) when calling GetCommandInvocation" >&2; exit 254 ;; esac
    echo "$line" ;;
  *) echo "unexpected aws $*" >&2; exit 2 ;;
esac`;

function run(statuses, { wait = 2, args = ['0.2.3-abc1234', '0.3.1-abc1234'] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-host-'));
  writeFileSync(join(dir, 'aws'), fake);
  chmodSync(join(dir, 'aws'), 0o755);
  writeFileSync(join(dir, 'statuses'), statuses.join('\n') + '\n');
  const started = Date.now();
  const r = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      STATE: dir,
      DEPLOY_WAIT_SECONDS: String(wait),
      DEPLOY_POLL_SECONDS: '0',
    },
  });
  return {
    status: r.status,
    out: r.stdout + r.stderr,
    calls: readFileSync(join(dir, 'calls'), 'utf8'),
    seconds: (Date.now() - started) / 1000,
  };
}

test('a deploy that succeeds returns 0 and sends the candidate tags', () => {
  const r = run(['Pending', 'InProgress', 'Success']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.calls, /--parameters webTag=0\.2\.3-abc1234,serverTag=0\.3\.1-abc1234/);
  assert.match(r.calls, /--timeout-seconds 600/);
});

test('with no tags it sends no parameters (the undo)', () => {
  const r = run(['Success'], { args: [] });
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.calls, /--parameters/);
});

test('a failed command fails', () => {
  const r = run(['InProgress', 'Failed']);
  assert.equal(r.status, 1);
  assert.match(r.out, /ended Failed/);
});

test('status errors are retried, not taken as the end', () => {
  const r = run(['!InvocationDoesNotExist', '!ThrottlingException', 'InProgress', 'Success']);
  assert.equal(r.status, 0, r.out);
});

test('Cancelling is waited through, and after Cancelled the whole window passes before it returns', () => {
  // bash's SECONDS counts whole seconds, so a window of N can end up to a second early in real time: wait 3, expect 2.
  const r = run(['InProgress', 'Cancelling', 'Cancelling', 'Cancelled'], { wait: 3 });
  assert.equal(r.status, 1);
  assert.match(r.out, /cancelled; waiting/);
  assert.ok(r.seconds >= 1.9, `returned after ${r.seconds}s, before the window ended`);
});

test('a command still running at the deadline fails without returning early', () => {
  const r = run(['InProgress'], { wait: 1 });
  assert.equal(r.status, 1);
  assert.match(r.out, /still InProgress after 1s/);
});
