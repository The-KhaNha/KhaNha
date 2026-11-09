import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Safety hooks and CI security checks must stay out of automatic approval (.claude/rules/workflow.md §21
// "CodeRabbit approval"): a PR that weakens one must always get a human's review.
const guardPaths = [
  'server/supabase/migrations/**',
  '.github/workflows/**',
  'server/src/middleware/auth.ts',
  'server/src/middleware/rateLimit.ts',
  '.claude/hooks/**',
  '.claude/settings.json',
  '.codex/hooks.json',
  '.codex/config.toml',
  'scripts/codex/hooks.mjs',
  'scripts/ci/check-dist-secrets*',
  'scripts/ci/gitleaks-*',
  'scripts/ci/check-migrations*',
];

// The root package has no YAML dependency, so this reads only the shape of `reviews.auto_approvals.overrides`
// (list items with `enabled:` and a `paths:` list) and throws on any other line.
function parseOverrides(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === '    overrides:');
  assert.notEqual(start, -1, 'reviews.auto_approvals.overrides not found at the expected indent');
  const overrides = [];
  let current;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (!line.startsWith('      ')) break; // dedent: the overrides list ended
    let m;
    if ((m = line.match(/^ {6}- enabled: (true|false)$/))) {
      current = { enabled: m[1] === 'true', paths: [] };
      overrides.push(current);
    } else if (line === '        paths:') {
      assert.ok(current, `paths before an override item: ${line}`);
    } else if ((m = line.match(/^ {10}- '([^']+)'$/))) {
      assert.ok(current, `path before an override item: ${line}`);
      current.paths.push(m[1]);
    } else {
      assert.fail(`unrecognised line in overrides: ${line}`);
    }
  }
  assert.ok(overrides.length > 0, 'overrides list is empty');
  return overrides;
}

const overrides = parseOverrides(readFileSync('.coderabbit.yaml', 'utf8'));

test('auto-approval is disabled for every guard path, and enabled for none', () => {
  for (const path of guardPaths) {
    const matching = overrides.filter((o) => o.paths.includes(path));
    assert.ok(matching.length > 0, `${path} must be in an override`);
    for (const o of matching) assert.equal(o.enabled, false, `${path} must disable auto-approval`);
  }
});
