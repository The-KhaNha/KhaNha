import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { intentFileName, recordChange } from './change.mjs';
import { checkVersionIntent } from './check.mjs';
import { bump, highestLevel, needsIntent, parseIntent } from './lib.mjs';
import { applyRelease, planRelease } from './release.mjs';

let root;
const git = (...args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
    },
  });
const commit = (message) => {
  git('add', '-A');
  git('commit', '-q', '--allow-empty', '-m', message);
};
const write = (file, body) => {
  mkdirSync(join(root, file, '..'), { recursive: true });
  writeFileSync(join(root, file), body);
};
const json = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));
const change = (...argv) => recordChange(argv, { root }).file;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'version-'));
  for (const pkg of ['client', 'server']) {
    write(`${pkg}/package.json`, JSON.stringify({ name: pkg, version: '0.1.0' }, null, 2) + '\n');
    write(
      `${pkg}/package-lock.json`,
      JSON.stringify(
        { name: pkg, version: '0.1.0', packages: { '': { version: '0.1.0' } } },
        null,
        2,
      ) + '\n',
    );
    write(`${pkg}/CHANGELOG.md`, '# Changelog\n\n## 0.1.0 — 2026-09-28\n\n- First version.\n');
  }
  write('.changes/README.md', 'format\n');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('lib', () => {
  test('bump', () => {
    assert.equal(bump('0.1.9', 'patch'), '0.1.10');
    assert.equal(bump('0.1.9', 'minor'), '0.2.0');
    assert.equal(bump('0.9.3', 'major'), '1.0.0');
  });

  test('highestLevel', () => {
    assert.equal(highestLevel(['patch', 'minor', 'patch']), 'minor');
    assert.equal(highestLevel(['patch', 'major', 'minor']), 'major');
  });

  test('needsIntent: source and package.json yes, docs and CI no', () => {
    assert.equal(needsIntent(['client/src/App.tsx']), true);
    assert.equal(needsIntent(['server/supabase/migrations/1_x.sql']), true);
    assert.equal(needsIntent(['server/scripts/seed.ts']), true);
    assert.equal(needsIntent(['server/package.json']), true);
    assert.equal(
      needsIntent(['docs/API.md', '.github/workflows/ci.yml', 'server/test/a.test.ts']),
      false,
    );
  });

  test('parseIntent rejects bad front matter', () => {
    assert.throws(() => parseIntent('no front matter'), /front matter/);
    assert.throws(() => parseIntent('---\nweb: minor\n---\n\nx'), /unknown package/);
    assert.throws(() => parseIntent('---\nclient: huge\n---\n\nx'), /level/);
    assert.throws(() => parseIntent('---\nclient: minor\n---\n\n'), /empty summary/);
  });
});

describe('change.mjs', () => {
  test('writes a parseable intent with a sortable, collision-resistant name', () => {
    const file = change('--client', 'minor', '--server', 'patch', 'Store list');
    assert.match(file, /^\.changes\/\d{8}-\d{6}-[0-9a-f]{4}\.md$/);
    const intent = parseIntent(readFileSync(join(root, file), 'utf8'));
    assert.deepEqual(intent, {
      levels: { client: 'minor', server: 'patch' },
      summary: 'Store list',
    });
  });

  test('the name is UTC date then time', () => {
    assert.equal(
      intentFileName(new Date('2026-09-28T07:05:09Z'), 'abcd'),
      '20260928-070509-abcd.md',
    );
  });

  test('needs a package and a summary, validates levels, and --dry-run writes nothing', () => {
    assert.throws(() => change('summary only'), /at least one/);
    assert.throws(() => change('--client', 'minor'), /summary/);
    assert.throws(() => change('--client', 'big', 'x'), /must be one of/);
    recordChange(['--server', 'patch', 'x', '--dry-run'], { root });
    assert.deepEqual(readdirSync(join(root, '.changes')), ['README.md']);
  });
});

describe('release.mjs', () => {
  test('one combined bump per package from several intents', () => {
    change('--client', 'patch', 'A fix');
    change('--client', 'minor', '--server', 'patch', 'A feature');
    const plan = planRelease(root);
    assert.equal(plan.packages.client.version, '0.2.0');
    assert.equal(plan.packages.server.version, '0.1.1');
    assert.equal(plan.intents.length, 2);
  });

  test('applies versions, lockfiles, CHANGELOGs, release.json and deletes the intents', () => {
    change('--server', 'minor', 'New endpoint');
    applyRelease(root, planRelease(root), '2026-10-01');
    assert.equal(json('server/package.json').version, '0.2.0');
    assert.equal(json('server/package-lock.json').version, '0.2.0');
    assert.equal(json('server/package-lock.json').packages[''].version, '0.2.0');
    assert.equal(json('client/package.json').version, '0.1.0');
    const log = readFileSync(join(root, 'server/CHANGELOG.md'), 'utf8');
    assert.match(log, /^# Changelog\n\n## 0\.2\.0 — 2026-10-01\n\n- New endpoint\n\n## 0\.1\.0/);
    assert.deepEqual(json('release.json'), { server: { version: '0.2.0', tag: 'server-v0.2.0' } });
    assert.deepEqual(readdirSync(join(root, '.changes')), ['README.md']);
  });

  test('refuses a major before 1.0.0 unless allowed', () => {
    change('--client', 'major', 'Drop a route');
    assert.throws(() => planRelease(root), /allow-major/);
    assert.equal(planRelease(root, { allowMajor: true }).packages.client.version, '1.0.0');
  });

  test('nothing to release without intents', () => {
    assert.deepEqual(planRelease(root).packages, {});
    assert.equal(existsSync(join(root, 'release.json')), false);
  });
});

describe('check.mjs', () => {
  beforeEach(() => {
    git('init', '-q', '-b', 'main');
    commit('base');
    git('branch', 'dev');
    git('checkout', '-q', '-b', 'feature', 'dev');
  });
  const feature = (allowMissing = false) =>
    checkVersionIntent({
      cwd: root,
      base: 'dev',
      headBranch: 'feature',
      baseBranch: 'dev',
      allowMissing,
    });

  test('docs-only change needs no intent', () => {
    write('docs/API.md', 'x');
    commit('docs');
    assert.deepEqual(feature(), []);
  });

  test('source change without an intent fails, and passes with --allow-missing', () => {
    write('server/src/app.ts', 'x');
    commit('src');
    assert.match(feature().join(), /no change intent/);
    assert.deepEqual(feature(true), []);
  });

  test('source change with an added intent passes', () => {
    write('server/src/app.ts', 'x');
    change('--server', 'patch', 'fix');
    commit('src + intent');
    assert.deepEqual(feature(), []);
  });

  test('two branches that each add an intent merge without conflict', () => {
    change('--client', 'patch', 'one');
    commit('one');
    git('checkout', '-q', '-b', 'other', 'dev');
    change('--server', 'patch', 'two');
    commit('two');
    git('checkout', '-q', 'dev');
    git('merge', '-q', '--no-edit', 'feature');
    git('merge', '-q', '--no-edit', 'other');
    assert.equal(planRelease(root).intents.length, 2);
  });

  test('release PR: intents left or a version not above its tag fail', () => {
    git('tag', 'client-v0.1.0');
    git('tag', 'server-v0.1.0');
    git('checkout', '-q', '-b', 'release/20261001', 'dev');
    const release = () =>
      checkVersionIntent({
        cwd: root,
        base: 'main',
        headBranch: 'release/20261001',
        baseBranch: 'main',
      });
    change('--client', 'patch', 'fix');
    const problems = release().join('\n');
    assert.match(problems, /still holds/);
    assert.match(problems, /client: version 0\.1\.0 is not above/);

    applyRelease(root, planRelease(root));
    write('server/package.json', JSON.stringify({ name: 'server', version: '0.1.1' }));
    assert.deepEqual(release(), []);
  });
});
