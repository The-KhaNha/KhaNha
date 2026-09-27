#!/usr/bin/env node
// UserPromptSubmit: when the prompt looks like pasted CodeRabbit review content, remind the main agent to delegate.
// (UserPromptSubmit hooks take no matcher, so the pattern is checked here.)

const MARKERS =
  /@coderabbitai|coderabbit\.ai|\bcoderabbit\b|_:warning:\s*Potential\s+issue_|_:hammer_and_wrench:\s*Refactor\s+suggestion_|_:pencil2:\s*Nitpick_|Actionable\s+comments\s+posted|Outside\s+diff\s+range\s+comments|Comments\s+suppressed\s+due\s+to\s+low\s+confidence|Summary\s+by\s+CodeRabbit|```suggestion/i;

let input;
try {
  input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
if (!MARKERS.test(input?.prompt ?? '')) process.exit(0);

process.stdout.write(
  '[coderabbit auto-delegation] This prompt contains CodeRabbit review content. Delegate to the coderabbit-fixer ' +
    'subagent without waiting for /fix-coderabbit: group the comments by target file, spawn ONE background ' +
    'coderabbit-fixer per file (parallel Agent calls in one message), and forward later comments for a file to its ' +
    'fixer with SendMessage only while that fixer is still running (otherwise spawn a new one). Show the ' +
    '"## In-flight" block while any fixer runs. SAFE fixes are applied; STRUCTURAL/AMBIGUOUS come back as ' +
    'AskUserQuestion with file:line and the concrete options; FLAGGED (branch-intent) always halts. See ' +
    '.claude/agents/coderabbit-fixer.md and CLAUDE.md "Multi-agent workflows".',
);
