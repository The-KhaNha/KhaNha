import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

// gitleaks scans `git log -p`, which prints no patch for a merge commit: a secret added only in a merge's conflict
// resolution passes every scan unless --log-opts asks for merge diffs. `--diff-merges=first-parent` diffs each merge
// against its first parent, so the secret is reported once where `-m` reports it once per parent.
const dir = '.github/workflows';
const scans = readdirSync(dir)
  .filter((file) => file.endsWith('.yml'))
  .flatMap((file) =>
    readFileSync(`${dir}/${file}`, 'utf8')
      .replace(/\\\n\s*/g, ' ') // a command wrapped with a trailing backslash is one scan
      .split('\n')
      .filter((line) => /gitleaks"?\s+(detect|git)\b/.test(line))
      .map((line) => ({ file, line: line.trim() })),
  );
const MERGE_DIFFS = /--log-opts="(?:[^"]*\s)?(?:--diff-merges=first-parent|-m)(?:\s[^"]*)?"/;

test('every gitleaks scan in the workflows includes merge-commit diffs', () => {
  // Not vacuous: the PR scan (ci.yml) and the full-history scan (security.yml) must both be found.
  assert.ok(scans.length >= 2, `found ${scans.length} gitleaks scans`);
  for (const { file, line } of scans) assert.match(line, MERGE_DIFFS, `${file}: ${line}`);
});
