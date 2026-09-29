// Shared by change.mjs, release.mjs and check.mjs. No dependencies: these run before any `npm ci`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PACKAGES = ['client', 'server'];
export const LEVELS = ['patch', 'minor', 'major'];
export const CHANGES_DIR = '.changes';

/** Source paths whose change needs an intent (docs, CI and tooling do not). */
export function needsIntent(files) {
  return files.some(
    (file) =>
      /^(client\/src|server\/src|server\/scripts|server\/supabase\/migrations)\//.test(file) ||
      /(^|\/)package\.json$/.test(file),
  );
}

export function isIntentFile(file) {
  return /^\.changes\/[^/]+\.md$/.test(file) && !file.endsWith('/README.md');
}

export function parseIntent(text, name = 'intent') {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error(`${name}: missing the --- front matter ---`);
  const levels = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [key, value] = line.split(':').map((part) => part.trim());
    if (!PACKAGES.includes(key)) throw new Error(`${name}: unknown package "${key}"`);
    if (!LEVELS.includes(value))
      throw new Error(`${name}: ${key} level must be one of ${LEVELS.join(', ')}`);
    levels[key] = value;
  }
  if (Object.keys(levels).length === 0) throw new Error(`${name}: no package level`);
  const summary = match[2].trim();
  if (!summary) throw new Error(`${name}: empty summary`);
  return { levels, summary };
}

export function formatIntent(levels, summary) {
  const lines = PACKAGES.filter((pkg) => levels[pkg]).map((pkg) => `${pkg}: ${levels[pkg]}`);
  return `---\n${lines.join('\n')}\n---\n\n${summary.trim()}\n`;
}

export function readIntents(root) {
  const dir = join(root, CHANGES_DIR);
  let names = [];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.md') && name !== 'README.md');
  } catch {
    return [];
  }
  return names.sort().map((name) => ({
    name,
    ...parseIntent(readFileSync(join(dir, name), 'utf8'), name),
  }));
}

export function highestLevel(levels) {
  return levels.reduce((best, level) =>
    LEVELS.indexOf(level) > LEVELS.indexOf(best) ? level : best,
  );
}

export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Not a plain semver version: ${version}`);
  return match.slice(1).map(Number);
}

export function bump(version, level) {
  const [major, minor, patch] = parseVersion(version);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** `--flag value` and bare `--flag` pairs, plus positional arguments. */
export function parseArgs(argv, booleans = []) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (booleans.includes(key)) flags[key] = true;
    else if (argv[i + 1] === undefined) throw new Error(`${arg} needs a value`);
    else flags[key] = argv[(i += 1)];
  }
  return { flags, positional };
}

export function isMain(meta) {
  return meta.url === `file://${process.argv[1]}`;
}
