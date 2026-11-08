import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function normalize(input, repository = root) {
  const original = input.tool_name?.split('.').at(-1);
  const name = ['exec_command', 'shell_command', 'shell'].includes(original) ? 'Bash' : original;
  const args = input.tool_input ?? {};
  if (name === 'apply_patch') {
    const patch =
      typeof args === 'string' ? args : (args.command ?? args.patch ?? args.input ?? '');
    return [...patch.matchAll(/^\*\*\* Add File: (.+)$/gm)].map((match) => ({
      ...input,
      tool_name: 'Write',
      tool_input: { file_path: resolve(input.cwd ?? repository, match[1]) },
    }));
  }
  return [
    { ...input, tool_name: name, tool_input: { ...args, command: args.command ?? args.cmd } },
  ];
}

export function runHooks(input, repository = root) {
  const event = input.hook_event_name;
  const groups =
    JSON.parse(readFileSync(resolve(repository, '.claude/settings.json'), 'utf8')).hooks[event] ??
    [];
  const contexts = [];
  const warnings = [];
  let denial;
  for (const normalized of normalize(input, repository)) {
    for (const group of groups) {
      if (group.matcher && !new RegExp(group.matcher).test(normalized.tool_name ?? '')) continue;
      for (const hook of group.hooks) {
        if (hook.type !== 'command') continue;
        const result = spawnSync(hook.command, {
          shell: true,
          cwd: repository,
          env: { ...process.env, CLAUDE_PROJECT_DIR: repository },
          input: JSON.stringify(normalized),
          encoding: 'utf8',
          timeout: (hook.timeout ?? 10) * 1000,
          maxBuffer: 1024 * 1024,
        });
        if (result.status === 2)
          denial = result.stderr.trim() || 'Shared hook blocked this operation.';
        else if (result.error || result.status !== 0)
          warnings.push(
            `Shared ${event} hook failed (${result.error?.code ?? result.status}); inspect .claude/settings.json.`,
          );
        const raw = result.stdout?.trim();
        if (!raw) continue;
        let output;
        try {
          output = JSON.parse(raw);
        } catch {
          contexts.push(raw);
          continue;
        }
        const specific = output.hookSpecificOutput;
        if (specific?.permissionDecision === 'deny') denial = specific.permissionDecisionReason;
        if (specific?.additionalContext) contexts.push(specific.additionalContext);
      }
    }
  }
  const output = {};
  if (warnings.length) output.systemMessage = warnings.join('\n');
  if (event === 'Stop') {
    if (contexts.length) output.systemMessage = [...warnings, ...contexts].join('\n');
  } else if (contexts.length || denial) {
    output.hookSpecificOutput = { hookEventName: event };
    if (contexts.length) output.hookSpecificOutput.additionalContext = contexts.join('\n');
    if (denial)
      Object.assign(output.hookSpecificOutput, {
        permissionDecision: 'deny',
        permissionDecisionReason: denial,
      });
  }
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(JSON.stringify(runHooks(JSON.parse(readFileSync(0, 'utf8')))));
  } catch (error) {
    process.stderr.write(`Shared hook adapter failed: ${error.message}\n`);
    process.exitCode = 2;
  }
}
