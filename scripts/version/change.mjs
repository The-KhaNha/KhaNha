#!/usr/bin/env node
// Records a change intent: pnpm run change --client minor --server patch "summary" [--dry-run]
// One file per change, so two branches never conflict on the same lines (.changes/README.md).
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHANGES_DIR, formatIntent, isMain, LEVELS, PACKAGES, parseArgs } from './lib.mjs';

export function intentFileName(now = new Date(), suffix = randomBytes(2).toString('hex')) {
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `${date}-${time}-${suffix}.md`;
}

export function recordChange(argv, { root = process.cwd(), now = new Date() } = {}) {
  const { flags, positional } = parseArgs(argv, ['dry-run']);
  const levels = {};
  for (const pkg of PACKAGES) {
    if (flags[pkg] === undefined) continue;
    if (!LEVELS.includes(flags[pkg]))
      throw new Error(`--${pkg} must be one of ${LEVELS.join(', ')}`);
    levels[pkg] = flags[pkg];
  }
  if (Object.keys(levels).length === 0)
    throw new Error('Give at least one of --client <level>, --server <level>');
  const summary = positional.join(' ').trim();
  if (!summary) throw new Error('Give a one-line summary of the change');

  const file = join(CHANGES_DIR, intentFileName(now));
  const body = formatIntent(levels, summary);
  if (!flags['dry-run']) {
    mkdirSync(join(root, CHANGES_DIR), { recursive: true });
    writeFileSync(join(root, file), body);
  }
  return { file, body };
}

if (isMain(import.meta)) {
  try {
    const dryRun = process.argv.includes('--dry-run');
    const { file, body } = recordChange(process.argv.slice(2));
    console.log(`${dryRun ? 'Would write' : 'Wrote'} ${file}:\n\n${body}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
