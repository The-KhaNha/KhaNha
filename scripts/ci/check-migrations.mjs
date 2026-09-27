#!/usr/bin/env node
// Migrations are append-only once merged (CLAUDE.md §2). On a PR, the diff against the base may only add migration
// files, and each added file must sort after the newest migration already on the base, or `supabase db push` would
// apply it out of order (or skip it) on an environment that already has the newer ones.
//
//   node scripts/ci/check-migrations.mjs --base origin/dev [--main origin/main] [--cwd <repo>]
//
// Added files already on the main ref are ignored: a hotfix back-merge brings migrations `dev` has not seen yet, with
// timestamps older than dev's newest, and they are already applied in production.
import { execFileSync } from 'node:child_process';

export const MIGRATIONS_DIR = 'server/supabase/migrations/';
const PREFIX = /^(\d{14})_/;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function listMigrations(cwd, ref) {
  const out = git(cwd, ['ls-tree', '--name-only', `${ref}:${MIGRATIONS_DIR}`]).trim();
  return out ? out.split('\n') : [];
}

function refExists(cwd, ref) {
  try {
    git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** Returns a list of problems; empty means the PR's migrations are fine. */
export function checkMigrations({ cwd = process.cwd(), base, main = 'origin/main' }) {
  const problems = [];
  const onMain = new Set(refExists(cwd, main) ? listMigrations(cwd, main) : []);
  const diff = git(cwd, [
    'diff',
    '--name-status',
    '--no-renames',
    `${base}...HEAD`,
    '--',
    MIGRATIONS_DIR,
  ]).trim();
  const rows = diff
    ? diff.split('\n').map((line) => {
        const [status, path] = line.split('\t');
        return { status, name: path.slice(MIGRATIONS_DIR.length) };
      })
    : [];

  const baseNames = listMigrations(cwd, base);
  const newestOnBase = baseNames
    .map((name) => name.match(PREFIX)?.[1])
    .filter(Boolean)
    .sort()
    .at(-1);

  for (const { status, name } of rows) {
    if (status !== 'A') {
      problems.push(
        `${name}: ${status === 'D' ? 'deleted' : 'modified'}; migrations are append-only`,
      );
      continue;
    }
    if (onMain.has(name)) continue;
    const prefix = name.match(PREFIX)?.[1];
    if (!prefix) {
      problems.push(`${name}: the name must start with a 14-digit timestamp and "_"`);
    } else if (newestOnBase && prefix <= newestOnBase) {
      problems.push(
        `${name}: timestamp ${prefix} is not after ${newestOnBase}, the newest on ${base}`,
      );
    }
  }
  return problems;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!['base', 'main', 'cwd'].includes(key) || argv[i + 1] === undefined) {
      throw new Error(`Unknown or incomplete argument ${argv[i]}`);
    }
    args[key] = argv[i + 1];
  }
  if (!args.base) throw new Error('--base <ref> is required');
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = checkMigrations(parseArgs(process.argv.slice(2)));
  if (problems.length > 0) {
    for (const problem of problems) console.error(`✗ ${problem}`);
    process.exit(1);
  }
  console.log('Migrations: only appended, in order.');
}
