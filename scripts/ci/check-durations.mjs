#!/usr/bin/env node
// No hard-coded durations in business logic (CLAUDE.md §11): a `\d+_000` literal (10_000, 60_000, …) in a service,
// the domain layer or a client *Rules.ts file is a timeout or interval that belongs in configuration
// (docs/CONFIGURATION.md). Tests are exempt. Prints file:line for each hit and exits 1.
//
//   node scripts/ci/check-durations.mjs [--root <repo>]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const DURATION = /\b\d+_000\b/;

const SCOPES = [
  { dir: 'server/src/services', include: (f) => /\.[cm]?[jt]s$/.test(f) },
  { dir: 'server/src/domain', include: (f) => /\.[cm]?[jt]s$/.test(f) },
  { dir: 'client/src/features', include: (f) => /Rules\.tsx?$/.test(f) },
];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** [{ file, line, text }] for every duration literal in scope. */
export function findDurations(root) {
  const hits = [];
  for (const { dir, include } of SCOPES) {
    for (const path of walk(join(root, dir))) {
      if (!include(path) || /\.test\.[cm]?[jt]sx?$/.test(path)) continue;
      readFileSync(path, 'utf8')
        .split('\n')
        .forEach((text, i) => {
          if (DURATION.test(text))
            hits.push({ file: relative(root, path), line: i + 1, text: text.trim() });
        });
    }
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootFlag = process.argv.indexOf('--root');
  const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];
  const hits = findDurations(root);
  for (const { file, line, text } of hits) console.error(`${file}:${line}: ${text}`);
  if (hits.length > 0) {
    console.error(
      `\n${hits.length} hard-coded duration(s): move them to configuration (docs/CONFIGURATION.md).`,
    );
    process.exit(1);
  }
  console.log('Durations: none hard-coded in services, domain or *Rules.ts.');
}
