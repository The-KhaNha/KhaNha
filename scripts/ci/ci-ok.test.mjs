import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// `ci-ok` is the one required check: it once passed a run whose jobs GitHub "abandoned" (never given a runner),
// so a PR showed green with nothing tested. It must pass only when every job succeeded or was skipped.
function ciOkScript() {
  const lines = readFileSync(
    new URL('../../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  ).split('\n');
  const step = lines.findIndex((l) => l.includes('name: All jobs passed or were skipped'));
  assert.notEqual(step, -1, 'the ci-ok step was not found in ci.yml');
  const run = lines.findIndex((l, i) => i > step && l.trim() === 'run: |');
  assert.notEqual(run, -1, 'the ci-ok step has no `run: |` block');
  const indent = lines[run + 1].match(/^ */)[0];
  const body = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== '' && !line.startsWith(indent)) break;
    body.push(line.slice(indent.length));
  }
  return body.join('\n');
}

const exitCode = (results) =>
  spawnSync('bash', ['-e', '-c', ciOkScript()], { env: { ...process.env, RESULTS: results } })
    .status;

test('ci-ok passes when every job succeeded or was skipped', () => {
  assert.equal(exitCode('success skipped success skipped'), 0);
});

for (const bad of ['failure', 'cancelled', 'abandoned', 'timed_out']) {
  test(`ci-ok fails when a job ended ${bad}`, () => {
    assert.notEqual(exitCode(`success ${bad} skipped`), 0);
  });
}

test('ci-ok fails when it received no job results at all', () => {
  assert.notEqual(exitCode(''), 0);
});
