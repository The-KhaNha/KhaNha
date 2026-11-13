#!/usr/bin/env node
// Stop hook. Advisory only: it never blocks the turn.
//   1. Classifies the files changed since the last /post-change (working tree vs HEAD, minus files whose content
//      is unchanged since the mark). A major change is recorded in .claude/.state/pending.json and announced once.
//   2. Reminds once per set of files when package source changed but no .changes/*.md intent was added
//      (.claude/rules/workflow.md §21).
//   3. Refreshes the graphify graph when source files are newer than graphify-out/graph.json.
//   4. Reminds once per branch when the branch has outgrown a reviewable PR (.claude/rules/workflow.md "PR size").
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
const INTENT_REMINDED = path.join(STATE, 'intent-reminded.json');
const PR_REMINDED = path.join(STATE, 'pr-size-reminded.json');

// Keep in sync with .claude/rules/workflow.md "PR size": a PR stays reviewable at up to 50 files and 1000 changed lines against its
// base. The lockfiles, the generated database types and docs (every Markdown file) are not counted; tests are.
const PR_MAX_FILES = 50;
const PR_MAX_LINES = 1000;
const PR_UNCOUNTED = /(^|\/)pnpm-lock\.yaml$|^server\/src\/types\/database\.ts$|\.md$/;

// Keep in sync with .claude/rules/workflow.md "What counts as a major change".
const MAJOR_PATHS = [
  /^server\/src\/(routes|controllers|services|schemas|middleware|jobs|domain|integrations)\//,
  /^server\/src\/worker\.ts$/,
  /^server\/supabase\/migrations\//,
  /^client\/src\/(pages|services|components)\//,
  /^client\/src\/App\.tsx$/,
  /(^|\/)(package\.json|pnpm-workspace\.yaml)$/,
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

// Keep in sync with needsIntent in scripts/version/lib.mjs (this hook is CommonJS and cannot import it).
const INTENT_SOURCE = /^(client\/src|server\/src|server\/scripts|server\/supabase\/migrations)\/|(^|\/)(package\.json|pnpm-workspace\.yaml)$/;
const INTENT_FILE = /^\.changes\/(?!README\.md$)[^/]+\.md$/;

/** files: changed paths → true when package source changed and no change intent is among them. */
function needsIntent(files) {
  return files.some((f) => INTENT_SOURCE.test(f)) && !files.some((f) => INTENT_FILE.test(f));
}

/** rows: [{ file, lines }] of a branch against its base → { files, lines, over } */
function prSize(rows) {
  const counted = rows.filter(({ file }) => !PR_UNCOUNTED.test(file));
  const lines = counted.reduce((sum, { lines: n }) => sum + n, 0);
  return { files: counted.length, lines, over: counted.length > PR_MAX_FILES || lines > PR_MAX_LINES };
}

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Every file that differs from `baseline` (tracked edits, deletions, untracked, and any commits made since
 *  `baseline`), with changed-line counts. `baseline` is the HEAD saved by the last --mark, so committed-but-
 *  unverified changes still count even once `git diff HEAD` alone would be empty. */
function workingChanges(baseline) {
  const lines = new Map();
  for (const row of git('diff', baseline, '--numstat', '--no-renames').split('\n')) {
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

/** Changes whose content differs from what the last /post-change verified. Diffs against the HEAD saved at that
 *  mark (falling back to the current HEAD before any mark exists), so a commit made since does not hide the
 *  change: it only drops out once its content matches what was verified. */
function unverifiedChanges() {
  const mark = readJson(MARK);
  const baseline = mark?.head || 'HEAD';
  const changes = workingChanges(baseline);
  const hashes = contentHashes(changes.map((c) => c.file));
  const verified = mark?.hashes ?? {};
  return { changes: changes.filter((c) => verified[c.file] !== hashes[c.file]), hashes };
}

/** The base a branch's PR merges into (.claude/rules/workflow.md §21): origin/main for hotfix/*, the phase
 *  branch for a phase PR (feat/p1-05-… → origin/feat/P1), else origin/dev. null for branches whose PR is not sized:
 *  dev, main, release/* and a phase branch itself (each bundles work already reviewed in its own PRs). */
function prBase(branch) {
  if (['dev', 'main', 'HEAD'].includes(branch) || branch.startsWith('release/')) return null;
  if (/^feat\/P\d+$/.test(branch)) return null;
  const phase = /^feat\/p(\d+)-/i.exec(branch);
  if (phase) return `origin/feat/P${phase[1]}`;
  return branch.startsWith('hotfix/') ? 'origin/main' : 'origin/dev';
}

/** The branch's changes, committed or not, against the base its PR merges into (prBase). null when the PR is not
 *  sized or the base is not fetched. */
function branchChanges() {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
  const base = prBase(branch);
  if (!base) return null;
  let mergeBase;
  try {
    mergeBase = git('merge-base', base, 'HEAD').trim();
  } catch {
    return null;
  }
  // workingChanges also counts untracked files, which a plain `git diff` misses.
  const rows = workingChanges(mergeBase);
  return { branch, base, rows };
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
  assert.equal(classify([c('server/src/jobs/notify.ts')]).major, true);
  assert.equal(classify([c('server/src/domain/permissions.ts')]).major, true);
  assert.equal(classify([c('server/src/worker.ts')]).major, true);
  assert.equal(classify([c('server/src/utils/shutdown.ts', 20)]).major, false);
  assert.equal(classify([c('server/supabase/migrations/2026_x.sql')]).major, true);
  assert.equal(classify([c('client/src/App.tsx')]).major, true);
  assert.equal(classify([c('client/package.json')]).major, true);
  assert.equal(classify([c('client/src/components/Button.tsx')]).major, true);
  const five = ['a', 'b', 'c', 'd', 'e'].map((n) => c(`client/src/lib/${n}.ts`));
  assert.equal(classify(five).major, true);
  assert.equal(classify(five.slice(1)).major, false);
  assert.equal(classify([c('client/src/lib/a.ts', 100), c('server/src/utils/b.ts', 50)]).major, true);
  assert.equal(classify([c('client/src/lib/a.ts', 149)]).major, false);
  assert.equal(needsIntent([]), false);
  assert.equal(needsIntent(['docs/API.md', '.github/workflows/ci.yml']), false);
  assert.equal(needsIntent(['server/src/app.ts']), true);
  assert.equal(needsIntent(['client/package.json']), true);
  assert.equal(needsIntent(['server/pnpm-workspace.yaml']), true);
  assert.equal(classify([c('client/pnpm-workspace.yaml')]).major, true);
  assert.equal(needsIntent(['server/src/app.ts', '.changes/20260928-090000-abcd.md']), false);
  assert.equal(needsIntent(['server/src/app.ts', '.changes/README.md']), true);
  const files = (n, lines = 1) => Array.from({ length: n }, (_, i) => c(`client/src/lib/f${i}.ts`, lines));
  assert.equal(prSize([]).over, false);
  assert.equal(prSize(files(50)).over, false, '50 files is within the limit');
  assert.equal(prSize(files(51)).over, true, '51 files is over');
  assert.equal(prSize([c('server/src/app.ts', 1000)]).over, false, '1000 lines is within the limit');
  assert.equal(prSize([c('server/src/app.ts', 1001)]).over, true, '1001 lines is over');
  const uncounted = [
    c('pnpm-lock.yaml', 9000),
    c('client/pnpm-lock.yaml', 900),
    c('server/src/types/database.ts', 800),
    c('docs/API.md', 900),
    c('plans/P1_PLATFORM_CORE.md', 900),
    c('README.md', 50),
    c('.changes/20261101-090000-abcd.md', 5),
  ];
  assert.deepEqual(prSize(uncounted), { files: 0, lines: 0, over: false }, 'lockfiles, generated types and docs do not count');
  assert.equal(prSize([...uncounted, c('server/test/api/orders.test.ts', 1001)]).over, true, 'tests count');
  assert.equal(prBase('feat/store-hours'), 'origin/dev');
  assert.equal(prBase('hotfix/stock-race'), 'origin/main');
  assert.equal(prBase('feat/p1-05-transitions-emit-events'), 'origin/feat/P1', 'a phase PR is sized against its phase');
  assert.equal(prBase('feat/P12-07-x'), 'origin/feat/P12');
  assert.equal(prBase('feat/P1'), null, 'the phase branch bundles PRs already reviewed one by one');
  for (const exempt of ['dev', 'main', 'HEAD', 'release/2026-10-24']) assert.equal(prBase(exempt), null, exempt);
  testMarkSurvivesCommit();
  console.log('major-change-gate: ok');
}

/** A commit made after --mark must still show up as unverified (regression: `git diff HEAD` alone goes empty once
 *  the change is committed). Runs the real hook, as a subprocess, against a scratch git repo. */
function testMarkSurvivesCommit() {
  const assert = require('node:assert');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'major-change-gate-selftest-'));
  // Strip Git repository-selection vars so both child processes operate on the scratch repo under `tmp`,
  // never the caller's repo (GIT_DIR/GIT_WORK_TREE etc. would otherwise leak through process.env).
  const childEnv = { ...process.env };
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_COMMON_DIR',
    'GIT_CEILING_DIRECTORIES',
  ]) {
    delete childEnv[key];
  }
  const run = (...args) =>
    execFileSync(process.execPath, [__filename, ...args], {
      cwd: tmp,
      env: { ...childEnv, CLAUDE_PROJECT_DIR: tmp },
      encoding: 'utf8',
    });
  const g = (...args) => execFileSync('git', args, { cwd: tmp, env: childEnv, encoding: 'utf8' });
  try {
    g('init', '-q');
    g('config', 'user.email', 'test@test.local');
    g('config', 'user.name', 'test');
    fs.mkdirSync(path.join(tmp, 'server/src/routes'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'server/src/routes/index.ts'), 'export {};\n');
    g('add', '-A');
    g('commit', '-q', '-m', 'init');
    run('--mark');

    fs.writeFileSync(path.join(tmp, 'server/src/routes/index.ts'), 'export {}; // changed\n');
    g('add', '-A');
    g('commit', '-q', '-m', 'unverified change');

    const status = JSON.parse(run('--status'));
    assert.equal(status.major, true, 'a committed-but-unmarked change to a major path must still be classified major');
    assert.ok(status.files.includes('server/src/routes/index.ts'));

    run('--mark');
    const after = JSON.parse(run('--status'));
    assert.equal(after.major, false, 'marking again with no further changes clears the pending state');

    // Unstaged new files count toward the PR size (a plain `git diff` would report zero).
    g('update-ref', 'refs/remotes/origin/dev', 'HEAD~1');
    g('checkout', '-q', '-b', 'feat/x');
    for (let i = 0; i <= PR_MAX_FILES; i++) fs.writeFileSync(path.join(tmp, `lib${i}.ts`), 'x\n');
    const sized = JSON.parse(run('--status')).pr;
    assert.equal(sized.over, true, 'untracked files count toward the PR size');
    // A release branch bundles PRs already reviewed one by one: it gets no size (.claude/rules/workflow.md "PR size").
    g('checkout', '-q', '-b', 'release/2026-09-30');
    assert.equal(JSON.parse(run('--status')).pr, null, 'release/* branches are exempt from the PR size');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
    const pr = branchChanges();
    const prInfo = pr && { branch: pr.branch, base: pr.base, ...prSize(pr.rows) };
    console.log(JSON.stringify({ ...verdict, files: changes.map((c) => c.file), pr: prInfo }, null, 2));
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
  const changed = changes.map((c) => c.file);
  if (needsIntent(changed)) {
    const reminded = readJson(INTENT_REMINDED);
    if (JSON.stringify(reminded?.files) !== JSON.stringify(changed)) {
      writeJson(INTENT_REMINDED, { at: new Date().toISOString(), files: changed });
      messages.push(
        '[version] Source changed, no .changes/*.md: run `pnpm run change --client <level> --server <level> "summary"`.',
      );
    }
  }
  const pr = branchChanges();
  if (pr) {
    const size = prSize(pr.rows);
    // Once per branch: past the limit the rule is to stop, not to be told again every turn.
    if (size.over && readJson(PR_REMINDED)?.branch !== pr.branch) {
      writeJson(PR_REMINDED, { at: new Date().toISOString(), branch: pr.branch });
      messages.push(
        `[pr-size] ${pr.branch} is at ${size.files} files / ${size.lines} lines against ${pr.base} ` +
          `(limit ${PR_MAX_FILES} / ${PR_MAX_LINES}, .claude/rules/workflow.md "PR size"): finish the change in hand, raise the PR, ` +
          'tell the user, and stop until they say it is merged.',
      );
    }
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
