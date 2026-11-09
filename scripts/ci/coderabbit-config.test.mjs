import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Safety hooks must stay out of automatic approval (.claude/rules/workflow.md §21 "CodeRabbit approval"): a PR that
// weakens one must always get a human's review.
const config = readFileSync('.coderabbit.yaml', 'utf8');
const overrides = config.split('overrides:')[1]?.split('merge_risk_instructions:')[0] ?? '';

test('auto-approval is disabled for every guard path', () => {
  assert.match(overrides, /enabled: false/);
  for (const path of [
    'server/supabase/migrations/**',
    '.github/workflows/**',
    'server/src/middleware/auth.ts',
    'server/src/middleware/rateLimit.ts',
    '.claude/hooks/**',
    '.claude/settings.json',
    '.codex/hooks.json',
    '.codex/config.toml',
    'scripts/codex/hooks.mjs',
  ]) {
    assert.ok(overrides.includes(`'${path}'`), `${path} must disable auto-approval`);
  }
});
