#!/usr/bin/env node
// PreToolUse(Bash): denies git commands that throw away work in the shared working tree. Parallel subagents edit
// the same checkout, so one `git stash` or `checkout .` silently wipes another agent's edits.
// Commit, merge and rebase are NOT blocked here: they are policy (CLAUDE.md), so the main agent can run them when
// the user asks. Self-check: node .claude/hooks/block-destructive-git.js --self-test

const FORBIDDEN = [
  [/\bgit\s+stash\b/, 'git stash'],
  [/\bgit\s+reset\s+(?:.*\s)?--(?:hard|merge)\b/, 'git reset --hard / --merge'],
  [/\bgit\s+restore\s+(?:.*\s)?(?:\.|--)(?:\s|$)/, 'git restore . / -- <path>'],
  [/\bgit\s+checkout\s+(?:.*\s)?(?:\.|--)(?:\s|$)/, 'git checkout . / -- <path>'],
  [/\bgit\s+clean\s+(?:.*\s)?(?:-[a-zA-Z]*f|--force\b)/, 'git clean -f / --force'],
  [/\bgit\s+push\s+(?:.*\s)?(?:-f|--force(?:-with-lease)?(?:=\S*)?)(?:\s|$)/, 'git push --force'],
  [/\bgit\s+branch\s+(?:.*\s)?(?:-D|--delete\s+--force|--force\s+--delete)(?:\s|$)/, 'git branch -D'],
];

function blockedBy(command) {
  // `git -C <dir> <verb>` and `git -c k=v <verb>` still name the same verb.
  const normalized = command.replace(/\bgit\s+(?:-[Cc]\s+\S+\s+)+/g, 'git ');
  const hit = FORBIDDEN.find(([re]) => re.test(normalized));
  return hit ? hit[1] : undefined;
}

if (process.argv.includes('--self-test')) {
  const assert = require('node:assert');
  for (const cmd of [
    'git stash',
    'git stash pop',
    'cd x && git reset --hard HEAD~1',
    'git -C /tmp/r reset --merge',
    'git restore .',
    'git restore -- a.ts',
    'git checkout .',
    'git checkout -- src/a.ts',
    'git clean -fd',
    'git clean --force',
    'git push -f origin main',
    'git push --force-with-lease',
    'git branch -D feat',
  ]) {
    assert.ok(blockedBy(cmd), `should block: ${cmd}`);
  }
  for (const cmd of [
    'git status',
    'git diff HEAD',
    'git checkout -b feat',
    'git checkout main',
    'git restore --staged a.ts',
    'git commit -m x',
    'git merge origin/main',
    'git rebase main',
    'git push origin feat',
    'git branch -d merged',
    'git reset HEAD a.ts',
    'git log --stat',
  ]) {
    assert.equal(blockedBy(cmd), undefined, `should allow: ${cmd}`);
  }
  console.log('block-destructive-git: ok');
  process.exit(0);
}

let input;
try {
  input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
const command = input?.tool_input?.command ?? '';
const label = command && blockedBy(command);
if (label) {
  const reason =
    `[block-destructive-git] ${label} is blocked: parallel agents share this working tree, and it would discard ` +
    `their uncommitted edits. Read-only git (status, diff, log, show, blame) is fine. If the user explicitly asked ` +
    `for this, tell them to run it themselves. Blocked: \`${command.slice(0, 200)}\``;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
}
