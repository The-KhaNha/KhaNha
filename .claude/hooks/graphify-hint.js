#!/usr/bin/env node
// PreToolUse (Bash|Grep: `search`, Read|Glob: `read`): graphify's own guard decides when a search or a source read
// could start from the knowledge graph (it looks at the commands a shell line actually runs, skips files outside the
// project and softens for a stale graph). This keeps that decision and swaps its "MANDATORY … You MUST" wording for a
// one-line tip: the graph is advisory (CLAUDE.md §20), and a known file or symbol goes straight to grep or Read.
// Fails open: on any error, or when the guard says nothing, it prints nothing; it never blocks a call.
// Self-check: node .claude/hooks/graphify-hint.js --self-test

const TIPS = {
  search:
    'Tip (advisory): for a broad question (where is X, what uses Y), `graphify query "<question>"` is often cheaper ' +
    'than grep. Skip it when you already know the file.',
  read:
    'Tip (advisory): when exploring rather than opening a known file, `graphify query "<question>"`, ' +
    '`graphify explain "<concept>"` or `graphify path "<A>" "<B>"` maps the area first.',
};

/** The guard's output with the tip as its text, or '' when it had nothing to add. */
function advise(kind, guardOutput) {
  let out;
  try {
    out = JSON.parse(guardOutput);
  } catch {
    return '';
  }
  if (!out?.hookSpecificOutput?.additionalContext) return '';
  out.hookSpecificOutput.additionalContext = TIPS[kind];
  return JSON.stringify(out);
}

if (process.argv.includes('--self-test')) {
  const assert = require('node:assert');
  const nudge = (text) =>
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } });
  for (const kind of ['search', 'read']) {
    const out = JSON.parse(advise(kind, nudge('MANDATORY: graphify-out/graph.json exists. You MUST run graphify')));
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(out.hookSpecificOutput.additionalContext, TIPS[kind]);
    assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /MANDATORY|MUST/);
  }
  // Silent when the guard is: no output, garbage, or anything that is not a nudge (a strict-mode deny included).
  const deny = JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny' } });
  for (const quiet of ['', '\n', 'not json', '{}', deny]) {
    assert.equal(advise('search', quiet), '', `silent for ${JSON.stringify(quiet)}`);
  }
  console.log('graphify-hint: ok');
  process.exit(0);
}

const kind = process.argv[2] === 'read' ? 'read' : 'search';
let input;
try {
  input = require('node:fs').readFileSync(0);
} catch {
  process.exit(0);
}
const guard = require('node:child_process').spawnSync('graphify', ['hook-guard', kind], {
  input,
  encoding: 'utf8',
  timeout: 8000,
});
const advice = guard.status === 0 ? advise(kind, guard.stdout) : '';
if (advice) process.stdout.write(advice);
