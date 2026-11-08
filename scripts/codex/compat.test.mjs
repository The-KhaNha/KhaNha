import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { normalize, runHooks } from './hooks.mjs';
import { field, root, syncPlugins, syncProject } from './sync.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'workflow-compat-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  cpSync(join(root, '.claude'), join(directory, '.claude'), {
    recursive: true,
    filter: (file) => !file.includes('/.state'),
  });
  return directory;
}

function put(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, value);
}

test('project discovery uses canonical skills and all agent roles without copying their bodies', (t) => {
  const directory = fixture(t);
  syncProject(directory);
  syncProject(directory, true);
  const source = join(directory, '.claude');
  for (const name of readdirSync(join(source, 'skills'))) {
    const adapter = readFileSync(join(directory, '.agents/skills', name, 'SKILL.md'), 'utf8');
    assert.ok(adapter.includes(`.claude/skills/${name}/SKILL.md`));
    assert.equal(field(adapter, 'name'), name);
    assert.doesNotMatch(field(adapter, 'description'), /[<>]/);
    const description = /^description: (.+)$/m.exec(adapter)[1];
    assert.equal(typeof JSON.parse(description), 'string');
  }
  for (const name of readdirSync(join(source, 'agents'))) {
    const adapter = readFileSync(
      join(directory, '.codex/agents', name.replace('.md', '.toml')),
      'utf8',
    );
    assert.ok(adapter.includes(`.claude/agents/${name}`));
    assert.ok(adapter.includes('docs/CODEX.md'));
    assert.doesNotMatch(adapter, /^model = /m);
  }
  put(
    join(source, 'skills/future/SKILL.md'),
    '---\nname: future\ndescription: A future workflow.\n---\n',
  );
  assert.throws(() => syncProject(directory, true), /Out of date/);
  syncProject(directory);
  syncProject(directory, true);
});

test('discovery preserves existing unrelated skill directories', (t) => {
  const directory = fixture(t);
  const file = join(directory, '.agents/skills/before-write/notes.md');
  put(file, 'local work');
  assert.throws(() => syncProject(directory), /Preserving existing skill directory/);
  assert.equal(readFileSync(file, 'utf8'), 'local work');
});

test('hook bridge blocks destructive git from canonical and native shell inputs', (t) => {
  const directory = fixture(t);
  for (const tool of ['Bash', 'exec_command', 'functions.exec_command', 'shell_command']) {
    for (const cmd of [
      'git stash',
      'git -C /tmp reset --hard HEAD',
      'git push --force-with-lease',
    ]) {
      const result = runHooks(
        { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { cmd, command: cmd } },
        directory,
      );
      assert.equal(result.hookSpecificOutput.permissionDecision, 'deny', `${tool}: ${cmd}`);
    }
    const allowed = runHooks(
      {
        hook_event_name: 'PreToolUse',
        tool_name: tool,
        tool_input: { cmd: 'git status', command: 'git status' },
      },
      directory,
    );
    assert.notEqual(allowed.hookSpecificOutput?.permissionDecision, 'deny');
  }
});

test('patch additions trigger canonical reuse reminders for each new file from a subdirectory', (t) => {
  const directory = fixture(t);
  const patch =
    '*** Begin Patch\n*** Add File: src/components/One.tsx\n+x\n*** Add File: src/lib/useTwo.ts\n+x\n*** End Patch';
  const input = {
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    cwd: join(directory, 'client'),
    tool_input: { command: patch },
  };
  const result = runHooks(input, directory);
  assert.match(result.hookSpecificOutput.additionalContext, /new shared component/);
  assert.match(result.hookSpecificOutput.additionalContext, /new client hook\/util/);
  assert.equal(normalize({ ...input, tool_input: patch }, directory).length, 2);
  assert.deepEqual(
    normalize({ ...input, tool_input: { command: '*** Update File: existing.ts' } }, directory),
    [],
  );
});

test('prompt hooks retain review delegation and pending major-change reminders', (t) => {
  const directory = fixture(t);
  put(
    join(directory, '.claude/.state/pending.json'),
    JSON.stringify({ files: ['server/src/routes/test.ts'], reason: 'touches a route' }),
  );
  const result = runHooks(
    {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'Potential issue: handle the CodeRabbit comments.',
    },
    directory,
  );
  assert.match(result.hookSpecificOutput.additionalContext, /coderabbit-fixer/);
  assert.match(result.hookSpecificOutput.additionalContext, /unverified major change/);
});

test('Stop output remains advisory and hook failures are visible', (t) => {
  const directory = fixture(t);
  const command = `${JSON.stringify(process.execPath)} -e "process.stdout.write('run post-change')"`;
  put(
    join(directory, '.claude/settings.json'),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command }] }] } }),
  );
  assert.deepEqual(runHooks({ hook_event_name: 'Stop' }, directory), {
    systemMessage: 'run post-change',
  });
  put(
    join(directory, '.claude/settings.json'),
    JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'exit 1' }] }] },
    }),
  );
  assert.match(runHooks({ hook_event_name: 'PreToolUse' }, directory).systemMessage, /hook failed/);
});

test('plugin bridge selects this project, namespaces skills and commands, and reports missing plugins', (t) => {
  const directory = fixture(t);
  const home = join(directory, 'plugins');
  const installPath = join(home, 'chosen');
  put(
    join(directory, '.claude/settings.json'),
    JSON.stringify({
      enabledPlugins: { 'example@market': true, 'absent@market': true, 'disabled@market': false },
    }),
  );
  const prompt =
    '---\nname: review\ndescription: >\n  Review a scoped\n  change safely.\n---\nOriginal body\n';
  put(join(installPath, 'skills/review/SKILL.md'), prompt);
  put(
    join(installPath, 'commands/check.md'),
    '---\ndescription: "Check a pull request"\n---\nCommand body\n',
  );
  put(join(installPath, 'agents/reviewer.md'), prompt);
  put(
    join(home, 'installed_plugins.json'),
    JSON.stringify({
      plugins: {
        'example@market': [
          { scope: 'project', projectPath: '/another/project', installPath: '/missing' },
          { scope: 'project', projectPath: directory, installPath },
        ],
      },
    }),
  );
  assert.deepEqual(syncPlugins(directory, home), {
    skills: 2,
    agents: 1,
    missing: ['absent@market'],
  });
  const skill = readFileSync(
    join(directory, '.agents/skills/local-example-review/SKILL.md'),
    'utf8',
  );
  assert.equal(field(skill, 'name'), 'local-example-review');
  assert.equal(field(skill, 'description'), 'Review a scoped change safely.');
  assert.ok(skill.includes(join(installPath, 'skills/review/SKILL.md')));
  assert.ok(existsSync(join(directory, '.agents/skills/local-example-check/SKILL.md')));
  assert.ok(existsSync(join(directory, '.codex/agents/local-example-reviewer.toml')));
  put(join(directory, '.agents/skills/local-unmanaged/SKILL.md'), 'local work');
  put(join(directory, '.claude/settings.json'), JSON.stringify({ enabledPlugins: {} }));
  assert.deepEqual(syncPlugins(directory, home), { skills: 0, agents: 0, missing: [] });
  assert.ok(!existsSync(join(directory, '.agents/skills/local-example-review/SKILL.md')));
  assert.ok(!existsSync(join(directory, '.codex/agents/local-example-reviewer.toml')));
  assert.equal(
    readFileSync(join(directory, '.agents/skills/local-unmanaged/SKILL.md'), 'utf8'),
    'local work',
  );
});

test('checked-in adapters stay current with shared prompts', () => {
  syncProject(root, true);
  const hooks = JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8')).hooks;
  for (const event of Object.keys(
    JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8')).hooks,
  ))
    assert.ok(hooks[event], `Unregistered event: ${event}`);
  execFileSync(process.execPath, [
    join(root, '.claude/hooks/block-destructive-git.js'),
    '--self-test',
  ]);
});
