#!/usr/bin/env node
// UserPromptSubmit: if the Stop hook recorded an unverified major change, remind the agent to run /post-change.

const fs = require('node:fs');
const path = require('node:path');

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
let pending;
try {
  pending = JSON.parse(fs.readFileSync(path.join(root, '.claude/.state/pending.json'), 'utf8'));
} catch {
  process.exit(0);
}

const files = pending.files ?? [];
const shown = files.slice(0, 5).join(', ') + (files.length > 5 ? ', …' : '');
process.stdout.write(
  `[post-change] unverified major change (${files.length} files: ${shown}) — run /post-change once this ` +
    `piece of work is finished (${pending.reason}).`,
);
