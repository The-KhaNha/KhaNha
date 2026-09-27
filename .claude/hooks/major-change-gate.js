#!/usr/bin/env node
// Stop hook. Advisory only: it never blocks the turn.
//   1. Classifies the files changed since the last /post-change (working tree vs HEAD, minus files whose content
//      is unchanged since the mark). A major change is recorded in .claude/.state/pending.json and announced once.
//   2. Refreshes the graphify graph when source files are newer than graphify-out/graph.json.
//
//   node .claude/hooks/major-change-gate.js            the Stop hook
//   node .claude/hooks/major-change-gate.js --mark     /post-change finished: record the current state as verified
//   node .claude/hooks/major-change-gate.js --status   print the classification (debugging)
//   node .claude/hooks/major-change-gate.js --self-test

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const STATE = path.join(ROOT, '.claude/.state');
const MARK = path.join(STATE, 'post-change.json');
const PENDING = path.join(STATE, 'pending.json');

// Keep in sync with CLAUDE.md "What counts as a major change".
const MAJOR_PATHS = [
  /^server\/src\/(routes|controllers|services|schemas|middleware)\//,
  /^server\/supabase\/migrations\//,
  /^client\/src\/(pages|services|components)\//,
  /^client\/src\/App\.tsx$/,
  /(^|\/)package\.json$/,
];
const SOURCE = /^(client\/src|server\/src|server\/scripts)\/.*\.(ts|tsx|js|css)$|^server\/supabase\/migrations\/.*\.sql$/;
const LINE_COUNTED = /^(client\/src|server\/src)\//;
const MIN_FILES = 5;
const MIN_LINES = 150;

/** changes: [{ file, lines }] → { major, reason } */
function classify(changes) {
  const byPath = changes.find(({ file }) => MAJOR_PATHS.some((re) => re.test(file)));
  if (byPath) return { major: true, reason: `touches ${byPath.file}` };
  const sources = changes.filter(({ file }) => SOURCE.test(file));
  if (sources.length >= MIN_FILES) return { major: true, reason: `${sources.length} source files` };
  const lines = changes
    .filter(({ file }) => LINE_COUNTED.test(file))
    .reduce((sum, { lines: n }) => sum + n, 0);
  if (lines >= MIN_LINES) return { major: true, reason: `${lines} changed lines` };
  return { major: false, reason: 'minor' };
}

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Every file that differs from HEAD (tracked edits, deletions, untracked), with changed-line counts. */
function workingChanges() {
  const lines = new Map();
  for (const row of git('diff', 'HEAD', '--numstat', '--no-renames').split('\n')) {
    const [added, deleted, file] = row.split('\t');
    if (file) lines.set(file, (Number(added) || 0) + (Number(deleted) || 0));
  }
  for (const file of git('ls-files', '--others', '--exclude-standard').split('\n')) {
    if (!file || lines.has(file)) continue;
    let count = 0;
    try {
      count = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n').length;
    } catch {}
    lines.set(file, count);
  }
  return [...lines].map(([file, n]) => ({ file, lines: n }));
}

/** file → git blob hash of its current content ('deleted' when gone). */
function contentHashes(files) {
  const present = files.filter((f) => fs.existsSync(path.join(ROOT, f)));
  const hashes = present.length ? git('hash-object', '--', ...present).trim().split('\n') : [];
  const result = Object.fromEntries(files.map((f) => [f, 'deleted']));
  present.forEach((f, i) => (result[f] = hashes[i]));
  return result;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

/** Changes whose content differs from what the last /post-change verified. */
function unverifiedChanges() {
  const changes = workingChanges();
  const hashes = contentHashes(changes.map((c) => c.file));
  const verified = readJson(MARK)?.hashes ?? {};
  return { changes: changes.filter((c) => verified[c.file] !== hashes[c.file]), hashes };
}

function refreshGraph() {
  const graph = path.join(ROOT, 'graphify-out/graph.json');
  if (!fs.existsSync(graph)) return false;
  // graphify leaves graph.json untouched when nothing it tracks changed, so remember when it last ran too.
  const stamp = path.join(STATE, 'graph-refreshed');
  const builtAt = Math.max(fs.statSync(graph).mtimeMs, fs.existsSync(stamp) ? fs.statSync(stamp).mtimeMs : 0);
  const files = git('ls-files', '--cached', '--others', '--exclude-standard').split('\n');
  const stale = files.some((f) => {
    if (!SOURCE.test(f)) return false;
    try {
      return fs.statSync(path.join(ROOT, f)).mtimeMs > builtAt;
    } catch {
      return false;
    }
  });
  if (!stale) return false;
  const run = spawnSync('graphify', ['update', '.'], { cwd: ROOT, timeout: 60_000, stdio: 'ignore' });
  if (run.status !== 0) return false;
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(stamp, new Date().toISOString() + '\n');
  return true;
}

function selfTest() {
  const assert = require('node:assert');
  const c = (file, lines = 1) => ({ file, lines });
  assert.equal(classify([]).major, false);
  assert.equal(classify([c('docs/API.md', 400), c('README.md', 50)]).major, false);
  assert.equal(classify([c('client/src/lib/format.ts', 3)]).major, false);
  assert.equal(classify([c('client/src/index.css', 20)]).major, false);
  assert.equal(classify([c('server/src/routes/index.ts')]).major, true);
  assert.equal(classify([c('server/supabase/migrations/2026_x.sql')]).major, true);
  assert.equal(classify([c('client/src/App.tsx')]).major, true);
  assert.equal(classify([c('client/package.json')]).major, true);
  assert.equal(classify([c('client/src/components/Button.tsx')]).major, true);
  const five = ['a', 'b', 'c', 'd', 'e'].map((n) => c(`client/src/lib/${n}.ts`));
  assert.equal(classify(five).major, true);
  assert.equal(classify(five.slice(1)).major, false);
  assert.equal(classify([c('client/src/lib/a.ts', 100), c('server/src/utils/b.ts', 50)]).major, true);
  assert.equal(classify([c('client/src/lib/a.ts', 149)]).major, false);
  console.log('major-change-gate: ok');
}

function main() {
  const mode = process.argv[2];
  if (mode === '--self-test') return selfTest();

  if (mode === '--mark') {
    const { hashes } = unverifiedChanges();
    writeJson(MARK, { at: new Date().toISOString(), head: git('rev-parse', 'HEAD').trim(), hashes });
    fs.rmSync(PENDING, { force: true });
    console.log(`post-change: marked ${Object.keys(hashes).length} changed files as verified`);
    return;
  }

  const { changes } = unverifiedChanges();
  const verdict = classify(changes);
  if (mode === '--status') {
    console.log(JSON.stringify({ ...verdict, files: changes.map((c) => c.file) }, null, 2));
    return;
  }

  // Stop hook: drain stdin, never fail the turn.
  try {
    fs.readFileSync(0);
  } catch {}
  const messages = [];
  if (verdict.major) {
    const files = changes.map((c) => c.file);
    const previous = readJson(PENDING);
    writeJson(PENDING, { at: new Date().toISOString(), reason: verdict.reason, files });
    // Announce once per new set of files, not at the end of every turn.
    if (JSON.stringify(previous?.files) !== JSON.stringify(files)) {
      messages.push(
        `[post-change] Major change not verified yet (${verdict.reason}, ${files.length} files). ` +
          'Run /post-change when this piece of work is done.',
      );
    }
  } else {
    fs.rmSync(PENDING, { force: true });
  }
  if (refreshGraph()) messages.push('[graphify] graph refreshed.');
  if (messages.length) process.stdout.write(JSON.stringify({ systemMessage: messages.join(' ') }));
}

try {
  main();
} catch (err) {
  // Advisory hook: a failure here must never block or break the session.
  if (process.argv[2]) throw err;
}
