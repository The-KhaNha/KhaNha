#!/usr/bin/env node
// The version-intent CI job (pull requests only):
//   node scripts/version/check.mjs --base origin/dev [--head-branch x] [--base-branch dev] [--allow-missing]
// Feature or hotfix PR: package source changed ⇒ the PR adds a .changes/*.md intent (`--allow-missing` is the
// `no-release` label). Release PR (release/* into main): .changes/ is empty and each version is above its last tag.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  compareVersions,
  isIntentFile,
  isMain,
  needsIntent,
  PACKAGES,
  parseArgs,
  readIntents,
} from './lib.mjs';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function latestTag(cwd, pkg) {
  const versions = git(cwd, ['tag', '--list', `${pkg}-v*`])
    .split('\n')
    .filter(Boolean)
    .map((tag) => tag.slice(`${pkg}-v`.length))
    .filter((version) => /^\d+\.\d+\.\d+$/.test(version))
    .sort(compareVersions);
  return versions.at(-1);
}

export function checkRelease(cwd) {
  const problems = [];
  const left = readIntents(cwd);
  if (left.length > 0)
    problems.push(
      `.changes/ still holds ${left.map((i) => i.name).join(', ')}: run pnpm run release`,
    );
  for (const pkg of PACKAGES) {
    const version = JSON.parse(readFileSync(join(cwd, pkg, 'package.json'), 'utf8')).version;
    const tag = latestTag(cwd, pkg);
    if (tag && compareVersions(version, tag) <= 0) {
      problems.push(`${pkg}: version ${version} is not above the latest tag ${pkg}-v${tag}`);
    }
  }
  return problems;
}

export function checkFeature(cwd, base, { allowMissing = false } = {}) {
  const rows = git(cwd, ['diff', '--name-status', '--no-renames', `${base}...HEAD`])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, file] = line.split('\t');
      return { status, file };
    });
  if (!needsIntent(rows.map((row) => row.file))) return [];
  if (rows.some((row) => row.status === 'A' && isIntentFile(row.file))) return [];
  if (allowMissing) return [];
  return [
    'Package source changed but no change intent was added. Run `pnpm run change --client <level> --server <level> "summary"`, or label the PR no-release if nothing ships.',
  ];
}

export function checkVersionIntent({
  cwd = process.cwd(),
  base,
  headBranch,
  baseBranch,
  allowMissing,
}) {
  const isRelease = headBranch?.startsWith('release/') && baseBranch === 'main';
  return isRelease ? checkRelease(cwd) : checkFeature(cwd, base, { allowMissing });
}

if (isMain(import.meta)) {
  try {
    const { flags } = parseArgs(process.argv.slice(2), ['allow-missing']);
    if (!flags.base) throw new Error('--base <ref> is required');
    const cwd = flags.cwd ?? process.cwd();
    const problems = checkVersionIntent({
      cwd,
      base: flags.base,
      headBranch:
        flags['head-branch'] ??
        (process.env.GITHUB_HEAD_REF || git(cwd, ['branch', '--show-current'])),
      baseBranch:
        flags['base-branch'] ??
        (process.env.GITHUB_BASE_REF || flags.base.replace(/^origin\//, '')),
      allowMissing: Boolean(flags['allow-missing']),
    });
    if (problems.length > 0) {
      for (const problem of problems) console.error(`✗ ${problem}`);
      process.exit(1);
    }
    console.log('Version intent: OK.');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
