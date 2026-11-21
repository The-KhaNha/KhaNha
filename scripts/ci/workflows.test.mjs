import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

// The repository is public and its AWS roles trust GitHub Environments (P8, infra/terraform/bootstrap). This guard
// keeps a future workflow from handing a role to code nobody approved: a job that can mint a cloud token
// (`id-token: write`) must name an Environment, never run on `pull_request_target`, never check out a pull request's
// head, and only a read-only Environment may run on a pull request at all.
const READ_ONLY_ENVIRONMENTS = new Set(['infra-plan']);

// Workflows are Prettier-formatted YAML, so a line reader is enough (as in ci-ok.test.mjs): top-level keys at column
// 0, jobs at 2 spaces, job keys at 4.
function blockAfter(lines, index, indent) {
  const body = [];
  for (const line of lines.slice(index + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (line.search(/\S/) < indent) break;
    body.push(line);
  }
  return body;
}

function triggersOf(lines) {
  const i = lines.findIndex((l) => /^(on|'on'|"on"):/.test(l));
  if (i === -1) return [];
  const inline = lines[i].replace(/^[^:]+:\s*/, '').trim();
  if (inline)
    return inline
      .replace(/[[\]]/g, '')
      .split(',')
      .map((t) => t.trim());
  return blockAfter(lines, i, 2)
    .filter((l) => /^ {2}[\w-]+:/.test(l))
    .map((l) => l.trim().replace(/:.*/, ''));
}

const grantsIdToken = (text) => /id-token:\s*write|permissions:\s*write-all/.test(text);

export function checkWorkflow(text) {
  const lines = text.split('\n');
  const triggers = triggersOf(lines);
  const top = lines.findIndex((l) => /^permissions:/.test(l));
  const workflowIdToken =
    top !== -1 && grantsIdToken([lines[top], ...blockAfter(lines, top, 2)].join('\n'));

  const jobsAt = lines.findIndex((l) => /^jobs:/.test(l));
  const problems = [];
  if (jobsAt === -1) return problems;

  let name = null;
  let body = [];
  const jobs = [];
  for (const line of lines.slice(jobsAt + 1)) {
    if (/^\S/.test(line)) break;
    const start = line.match(/^ {2}([\w-]+):\s*$/);
    if (start) {
      if (name) jobs.push([name, body]);
      name = start[1];
      body = [];
    } else if (name) body.push(line);
  }
  if (name) jobs.push([name, body]);

  for (const [job, jobLines] of jobs) {
    const jobText = jobLines.join('\n');
    const ownPermissions = jobLines.some((l) => /^ {4}permissions:/.test(l));
    const idToken = ownPermissions ? grantsIdToken(jobText) : workflowIdToken;
    if (!idToken) continue;

    const envLine = jobLines.findIndex((l) => /^ {4}environment:/.test(l));
    let environment = null;
    if (envLine !== -1) {
      const inline = jobLines[envLine].replace(/^ {4}environment:\s*/, '').trim();
      const named = blockAfter(jobLines, envLine, 6).find((l) => /^ {6}name:/.test(l));
      environment = inline || named?.replace(/^ {6}name:\s*/, '').trim() || null;
    }
    const ifLine = jobLines.findIndex((l) => /^ {4}if:/.test(l));
    const condition =
      ifLine === -1
        ? ''
        : [jobLines[ifLine], ...blockAfter(jobLines, ifLine, 6)].join(' ').replace(/\s+/g, ' ');

    if (!environment) problems.push(`${job}: asks for id-token: write without an environment`);
    if (triggers.includes('pull_request_target'))
      problems.push(`${job}: can mint a cloud token in a pull_request_target workflow`);
    if (/github\.event\.pull_request\.head\.(sha|ref)|github\.head_ref/.test(jobText))
      problems.push(`${job}: checks out a pull request's head with a cloud token`);
    // Fail closed: only a plain non-PR event comparison with no `||` and no mention of
    // pull_request counts as excluding pull requests.
    const onlyNonPrEvents =
      /github\.event_name\s*==\s*'(?!pull_request)/.test(condition) &&
      !condition.includes('||') &&
      !condition.includes('pull_request');
    if (
      environment &&
      !READ_ONLY_ENVIRONMENTS.has(environment) &&
      triggers.includes('pull_request') &&
      !onlyNonPrEvents
    )
      problems.push(`${job}: environment ${environment} can run on a pull request`);
  }
  return problems;
}

const dir = new URL('../../.github/workflows/', import.meta.url);

test('every workflow keeps cloud tokens behind an approved Environment', () => {
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    assert.deepEqual(checkWorkflow(readFileSync(new URL(file, dir), 'utf8')), [], file);
  }
});

const job = (lines) => `on:\n  pull_request:\n  push:\njobs:\n  deploy:\n${lines}\n`;

test('the guard accepts a read-only plan on pull requests and a guarded apply', () => {
  const plan = job('    environment: infra-plan\n    permissions:\n      id-token: write');
  const apply = job(
    "    if: github.event_name == 'push'\n    environment: production-infra\n    permissions:\n      id-token: write",
  );
  assert.deepEqual(checkWorkflow(plan), []);
  assert.deepEqual(checkWorkflow(apply), []);
});

test('the guard refuses an apply condition that can still run on a pull request', () => {
  for (const cond of [
    "github.event_name == 'push' || github.event_name == 'pull_request'",
    "github.event_name != 'pull_request' || always()",
  ]) {
    const text = job(
      `    if: ${cond}\n    environment: production-infra\n    permissions:\n      id-token: write`,
    );
    assert.match(checkWorkflow(text).join(), /can run on a pull request/, cond);
  }
});

test('the guard refuses a token without an environment', () => {
  assert.match(
    checkWorkflow(job('    permissions:\n      id-token: write')).join(),
    /without an environment/,
  );
});

test('the guard refuses a token granted at the workflow level to a job with no environment', () => {
  const text =
    'on: push\npermissions:\n  id-token: write\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n';
  assert.match(checkWorkflow(text).join(), /without an environment/);
});

test('the guard refuses pull_request_target', () => {
  const text = job('    environment: infra-plan\n    permissions:\n      id-token: write').replace(
    '  pull_request:',
    '  pull_request_target:',
  );
  assert.match(checkWorkflow(text).join(), /pull_request_target/);
});

test("the guard refuses checking out a pull request's head", () => {
  const text = job(
    '    environment: infra-plan\n    permissions:\n      id-token: write\n    steps:\n      - uses: actions/checkout@x\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}',
  );
  assert.match(checkWorkflow(text).join(), /pull request's head/);
});

test('the guard refuses an approving environment reachable from a pull request', () => {
  const text = job('    environment: production\n    permissions:\n      id-token: write');
  assert.match(checkWorkflow(text).join(), /environment production can run on a pull request/);
});

// Production deploys (P8 PR 07): every job that can reach AWS waits for the user's approval, a dev commit deploys
// only while production is dark, and one deploy never cancels another half-way through.
test('deploy-production keeps its rules', () => {
  const text = readFileSync(new URL('deploy-production.yml', dir), 'utf8');
  const jobs = text
    .slice(text.indexOf('\njobs:\n'))
    .split(/\n(?= {2}[\w-]+:\n)/)
    .slice(1);
  const minting = jobs.filter((body) => grantsIdToken(body));
  assert.ok(minting.length > 0, 'a deploy job mints a token');
  for (const body of minting)
    assert.match(body, /^ {4}environment: production$/m, body.split('\n')[0]);
  assert.match(
    text,
    /merge-base --is-ancestor "\$commit" origin\/main/,
    'a release must be on main',
  );
  assert.match(
    text,
    /\[ "\$DARK" = true \] && git merge-base --is-ancestor "\$commit" origin\/dev/,
    'a rehearsal needs PRODUCTION_DARK',
  );
  assert.match(text, /DARK: \$\{\{ vars\.PRODUCTION_DARK \}\}/);
  const concurrency = text.match(/^concurrency:\n((?: {2}.*\n)+)/m)?.[1] ?? '';
  assert.match(concurrency, /cancel-in-progress: false/);
  assert.match(concurrency, /group: deploy-production\n/, 'one group for every production deploy');

  // Migrations ship with the deploy (the user, 21 November 2026): behind the approval, before the code, with
  // credentials checked before anything is pushed and held by that one job alone.
  const migrating = jobs.filter((body) => /deploy-migrate\.sh "\$/.test(body));
  assert.equal(migrating.length, 1, 'one job migrates');
  const [deploy] = migrating;
  assert.match(
    deploy,
    /^ {4}environment: production$/m,
    'the migrating job waits for the approval',
  );
  const at = (re) => deploy.search(re);
  assert.ok(
    at(/name: Deploy to the host/) > at(/deploy-migrate\.sh "\$/),
    'migrations before code',
  );
  assert.ok(at(/deploy-migrate\.sh --check/) !== -1, 'the credentials are checked');
  assert.ok(at(/deploy-migrate\.sh --check/) < at(/push: true/), 'before any image is pushed');
  const secret = /secrets\.SUPABASE_(ACCESS_TOKEN|DB_PASSWORD)/;
  for (const body of jobs.filter((b) => b !== deploy))
    assert.doesNotMatch(body, secret, `${body.split('\n')[0]} holds no Supabase secret`);
  for (const file of readdirSync(dir).filter(
    (f) => /\.ya?ml$/.test(f) && f !== 'deploy-production.yml',
  ))
    assert.doesNotMatch(readFileSync(new URL(file, dir), 'utf8'), secret, file);
});
