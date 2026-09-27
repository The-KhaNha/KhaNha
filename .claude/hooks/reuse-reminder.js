#!/usr/bin/env node
// PreToolUse(Write): one-line reuse reminder when a NEW file is about to be created where duplicates usually start.

const fs = require('node:fs');

const RULES = [
  [/\/client\/src\/components\//, 'new shared component — check docs/COMPONENTS.md / run reuse-scout first'],
  [/\/client\/src\/lib\//, 'new client hook/util — check docs/COMPONENTS.md / run reuse-scout first'],
  [/\/server\/src\/services\//, 'new service — check docs/BACKEND_STRUCTURE.md / run reuse-scout first'],
  [/\/server\/supabase\/migrations\//, 'new migration — run schema-guard first (/db-migration)'],
];

let input;
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
const rawPath = input?.tool_input?.file_path ?? '';
const path = rawPath.replace(/\\/g, '/');
if (!path || fs.existsSync(rawPath) || /\.test\.tsx?$/.test(path)) process.exit(0);

const rule = RULES.find(([re]) => re.test(path));
if (rule) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: `[reuse-first] ${rule[1]}: ${path}`,
      },
    }),
  );
}
