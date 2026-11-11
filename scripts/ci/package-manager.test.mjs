import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// pnpm, one pinned version, in three independent roots (plans/P1_8_PNPM.md). A leftover npm command or setting fails
// quietly elsewhere: npm ignores the pnpm lockfile, and pnpm ignores every .npmrc setting but registry and auth.
const ROOT = process.env.PM_GUARD_ROOT ?? process.cwd();
const ROOTS = ['.', 'client', 'server'];
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const json = (file) => JSON.parse(read(file));
const tracked = () =>
  execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const NPM_COMMAND = /\bnpm (ci|run|install|test)\b|\bnpx\s/;

test('one pnpm version, pinned in every root', () => {
  const pins = ROOTS.map((r) => json(join(r, 'package.json')).packageManager);
  // With corepack's integrity hash, so the pnpm that installs everything is pinned by content, not by name.
  assert.match(pins[0] ?? '', /^pnpm@\d+\.\d+\.\d+\+sha512\.[0-9a-f]{128}$/);
  assert.deepEqual(pins, [pins[0], pins[0], pins[0]]);
});

test('every root has a pnpm lockfile and no npm one', () => {
  for (const r of ROOTS) {
    assert.ok(existsSync(join(ROOT, r, 'pnpm-lock.yaml')), `${r}/pnpm-lock.yaml`);
    assert.ok(!existsSync(join(ROOT, r, 'package-lock.json')), `${r}/package-lock.json`);
  }
});

test('no npm command (or npx) in workflows, actions, Dockerfiles, shell scripts, repo scripts, hooks or package.json scripts', () => {
  const files = tracked().filter((f) =>
    /^\.github\/(workflows|actions)\/|(^|\/)Dockerfile$|\.sh$|^client\/playwright\.config\.ts$|^(scripts|\.claude\/hooks)\/.*\.m?js$/.test(
      f,
    ),
  );
  assert.ok(files.length > 10, 'the file list is not empty');
  const hits = files.flatMap((f) =>
    read(f)
      .split('\n')
      .map((line, i) => [f, i + 1, line])
      .filter(([, , line]) => NPM_COMMAND.test(line)),
  );
  for (const r of ROOTS)
    for (const [name, script] of Object.entries(json(join(r, 'package.json')).scripts ?? {}))
      if (NPM_COMMAND.test(script)) hits.push([`${r}/package.json`, name, script]);
  assert.deepEqual(hits, []);
});

test('every root keeps its own settings-only pnpm-workspace.yaml', () => {
  for (const r of ROOTS) {
    const file = join(r, 'pnpm-workspace.yaml');
    assert.ok(existsSync(join(ROOT, file)), file);
    const yaml = read(file);
    assert.match(yaml, /^engineStrict: true$/m, `${file}: engineStrict`);
    assert.match(yaml, /^strictDepBuilds: true$/m, `${file}: strictDepBuilds`);
    assert.match(yaml, /^allowBuilds:/m, `${file}: allowBuilds`);
    // Minutes: 7 days, the project's release-age rule.
    assert.ok(
      Number(/^minimumReleaseAge: (\d+)$/m.exec(yaml)?.[1]) >= 7 * 24 * 60,
      `${file}: minimumReleaseAge`,
    );
    assert.doesNotMatch(yaml, /^packages:/m, `${file}: a packages list makes it a workspace`);
  }
});

test('no .npmrc holds a setting pnpm would ignore', () => {
  const allowed =
    /^(@[^:]+:)?registry=|^\/\/|^(cafile|ca|cert|key|strict-ssl|proxy|https-proxy|no-proxy|local-address)=/;
  const ignored = tracked()
    .filter((f) => /(^|\/)\.npmrc$/.test(f))
    .flatMap((f) =>
      read(f)
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && !allowed.test(l))
        .map((l) => `${f}: ${l}`),
    );
  assert.deepEqual(ignored, []);
});
