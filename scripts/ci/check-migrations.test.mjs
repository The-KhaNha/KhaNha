import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { checkMigrations, MIGRATIONS_DIR } from './check-migrations.mjs';

let repo;
const git = (...args) =>
  execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
    },
  });
const write = (name, body = 'select 1;\n') => writeFileSync(join(repo, MIGRATIONS_DIR, name), body);
const commit = (message) => {
  git('add', '-A');
  git('commit', '-q', '-m', message);
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'check-migrations-'));
  git('init', '-q', '-b', 'main');
  mkdirSync(join(repo, MIGRATIONS_DIR), { recursive: true });
  write('20260101000000_init.sql');
  write('20260201000000_second.sql');
  commit('base');
  git('branch', 'dev');
  git('checkout', '-q', '-b', 'feature', 'dev');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

const check = () => checkMigrations({ cwd: repo, base: 'dev', main: 'main' });

test('a branch without migration changes passes', () => {
  writeFileSync(join(repo, 'README.md'), 'x');
  commit('docs');
  assert.deepEqual(check(), []);
});

test('adding a newer migration passes', () => {
  write('20260301000000_third.sql');
  commit('add');
  assert.deepEqual(check(), []);
});

test('editing an existing migration fails', () => {
  write('20260201000000_second.sql', 'select 2;\n');
  commit('edit');
  assert.match(check().join('\n'), /20260201000000_second\.sql: modified/);
});

test('deleting a migration fails', () => {
  git('rm', '-q', join(MIGRATIONS_DIR, '20260201000000_second.sql'));
  commit('delete');
  assert.match(check().join('\n'), /deleted/);
});

test('an older timestamp than the newest on the base fails', () => {
  write('20260115000000_old.sql');
  commit('old');
  assert.match(check().join('\n'), /not after 20260201000000/);
});

test('a name without a 14-digit prefix fails', () => {
  write('add_stuff.sql');
  commit('bad name');
  assert.match(check().join('\n'), /14-digit timestamp/);
});

test('migrations already on main are ignored (hotfix back-merge)', () => {
  git('checkout', '-q', 'dev');
  write('20260301000000_dev_only.sql');
  commit('dev moves ahead');
  git('checkout', '-q', 'main');
  write('20260215000000_hotfix.sql');
  commit('hotfix');
  git('checkout', '-q', '-b', 'backmerge', 'dev');
  git('merge', '-q', '--no-edit', 'main');
  assert.deepEqual(check(), []);
});
