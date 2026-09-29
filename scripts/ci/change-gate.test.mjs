import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

// The Stop hook's rules (a major change, a missing change intent, the PR size limit) are plain functions with a
// self-test; run it here so CI catches a broken limit, as the hook itself never fails a turn.
test('major-change-gate self-test', () => {
  execFileSync(process.execPath, ['.claude/hooks/major-change-gate.js', '--self-test'], {
    stdio: 'pipe',
  });
});
