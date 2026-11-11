#!/usr/bin/env node
// Applies the recorded intents: pnpm run release [--dry-run] [--allow-major]
// Takes the highest level per package, writes the versions into package.json directly (no `pnpm version`: no
// lifecycle scripts, no git checks; pnpm-lock.yaml does not record them), prepends the CHANGELOGs, deletes the consumed intents and
// writes the gitignored release.json with the tags release.yml creates after the release PR merges.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bump,
  CHANGES_DIR,
  highestLevel,
  isMain,
  PACKAGES,
  parseArgs,
  parseVersion,
  readIntents,
} from './lib.mjs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

export function planRelease(root, { allowMajor = false } = {}) {
  const intents = readIntents(root);
  const packages = {};
  for (const pkg of PACKAGES) {
    const relevant = intents.filter((intent) => intent.levels[pkg]);
    if (relevant.length === 0) continue;
    const level = highestLevel(relevant.map((intent) => intent.levels[pkg]));
    const current = readJson(join(root, pkg, 'package.json')).version;
    if (level === 'major' && parseVersion(current)[0] === 0 && !allowMajor) {
      throw new Error(
        `${pkg}: a major bump before 1.0.0 breaks the deployed client (CLAUDE.md §2). Pass --allow-major if intended.`,
      );
    }
    const version = bump(current, level);
    packages[pkg] = {
      from: current,
      version,
      level,
      tag: `${pkg}-v${version}`,
      summaries: relevant.map((intent) => intent.summary),
    };
  }
  return { intents: intents.map((intent) => intent.name), packages };
}

function prependChangelog(path, version, date, summaries) {
  let existing = '';
  try {
    existing = readFileSync(path, 'utf8');
  } catch {
    existing = '# Changelog\n';
  }
  const entry = `## ${version} — ${date}\n\n${summaries.map((s) => `- ${s.replace(/\s*\n\s*/g, ' ')}`).join('\n')}\n`;
  const [title, ...rest] = existing.split(/\n(?=## )/);
  const body = rest.length > 0 ? `\n${rest.join('\n')}` : '';
  writeFileSync(path, `${title.trimEnd()}\n\n${entry}${body}`);
}

export function applyRelease(root, plan, date = new Date().toISOString().slice(0, 10)) {
  const release = {};
  for (const [pkg, { version, tag, summaries }] of Object.entries(plan.packages)) {
    const pkgJson = readJson(join(root, pkg, 'package.json'));
    pkgJson.version = version;
    // Only package.json: a pnpm-lock.yaml does not record the package's own version.
    writeJson(join(root, pkg, 'package.json'), pkgJson);

    prependChangelog(join(root, pkg, 'CHANGELOG.md'), version, date, summaries);
    release[pkg] = { version, tag };
  }
  for (const name of plan.intents) rmSync(join(root, CHANGES_DIR, name));
  writeJson(join(root, 'release.json'), release);
  return release;
}

if (isMain(import.meta)) {
  try {
    const { flags } = parseArgs(process.argv.slice(2), ['dry-run', 'allow-major']);
    const root = flags.root ?? process.cwd();
    const plan = planRelease(root, { allowMajor: Boolean(flags['allow-major']) });
    if (Object.keys(plan.packages).length === 0) {
      console.log('No change intents in .changes/: nothing to release.');
      process.exit(0);
    }
    for (const [pkg, p] of Object.entries(plan.packages)) {
      console.log(`${pkg}: ${p.from} → ${p.version} (${p.level}, tag ${p.tag})`);
      for (const summary of p.summaries) console.log(`  - ${summary}`);
    }
    console.log(`Consumes ${plan.intents.length} intent(s).`);
    if (flags['dry-run']) {
      console.log('Dry run: nothing written.');
    } else {
      applyRelease(root, plan);
      console.log('Wrote the versions, CHANGELOGs and release.json; deleted the intents.');
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
