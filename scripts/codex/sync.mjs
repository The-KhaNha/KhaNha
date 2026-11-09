import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const quote = JSON.stringify;

function entries(directory) {
  return existsSync(directory)
    ? readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    : [];
}

export function field(source, key) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? '';
  const value = new RegExp(`^${key}: (.+)$`, 'm').exec(header)?.[1]?.trim();
  if (!value) throw new Error(`Missing single-line ${key} in prompt frontmatter`);
  if (/^[>|][-+]?$/.test(value)) {
    const block = new RegExp(`^${key}: [^\\n]+\\n((?:[ \\t]+[^\\n]*(?:\\n|$))+)`, 'm').exec(
      header,
    )?.[1];
    if (!block) throw new Error(`Empty ${key} block in prompt frontmatter`);
    return block.trim().replace(/\s+/g, ' ');
  }
  if (value.startsWith('"')) return JSON.parse(value);
  return value.startsWith("'") ? value.slice(1, -1).replaceAll("''", "'") : value;
}

function agent(name, description, source) {
  const instructions = `Read AGENTS.md and docs/CODEX.md from the repository root, then read ${source} and act as that role. Follow its scope, tools, safety rules, output format and handoff classes. Resolve shared workflow references using docs/CODEX.md. Model names in the source are runtime-specific; inherit the parent model and effort. Never commit or run destructive git.`;
  return `name = ${quote(name)}\ndescription = ${quote(description)}\ndeveloper_instructions = ${quote(instructions)}\n`;
}

function emit(file, content, check) {
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return;
  if (check) throw new Error(`Out of date: ${file}. Run node scripts/codex/sync.mjs`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function skill(name, description, source, context = '') {
  const summary = description.replace(/[<>]/g, '').slice(0, 1024);
  return `---\nname: ${name}\ndescription: ${quote(summary)}\n---\n\nRead docs/CODEX.md from the repository root, then read and follow ${quote(source)}.\n${context}`;
}

export function syncProject(repository = root, check = false) {
  for (const entry of entries(join(repository, '.claude/agents'))) {
    if (!entry.name.endsWith('.md')) continue;
    const source = `.claude/agents/${entry.name}`;
    const prompt = readFileSync(join(repository, source), 'utf8');
    emit(
      join(repository, '.codex/agents', `${field(prompt, 'name')}.toml`),
      agent(field(prompt, 'name'), field(prompt, 'description'), source),
      check,
    );
  }
  for (const entry of entries(join(repository, '.claude/skills'))) {
    if (!existsSync(join(repository, '.claude/skills', entry.name, 'SKILL.md'))) continue;
    const folder = join(repository, '.agents/skills', entry.name);
    const file = join(folder, 'SKILL.md');
    const stat = lstatSync(folder, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) {
      if (check || readlinkSync(folder) !== `../../.claude/skills/${entry.name}`)
        throw new Error(`Expected skill adapter: ${folder}`);
      unlinkSync(folder);
    } else if (stat && !existsSync(file))
      throw new Error(`Preserving existing skill directory: ${folder}`);
    const source = `.claude/skills/${entry.name}/SKILL.md`;
    const prompt = readFileSync(join(repository, source), 'utf8');
    emit(file, skill(field(prompt, 'name'), field(prompt, 'description'), source), check);
  }
}

export function syncPlugins(repository = root, pluginHome = join(homedir(), '.claude/plugins')) {
  const settings = JSON.parse(readFileSync(join(repository, '.claude/settings.json'), 'utf8'));
  const installed = join(pluginHome, 'installed_plugins.json');
  if (!existsSync(installed))
    throw new Error('No local plugin registry. Install the configured plugins first.');
  const registry = JSON.parse(readFileSync(installed, 'utf8')).plugins;
  const missing = [];
  const manifest = join(repository, '.codex/local-plugins.json');
  const previous = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : [];
  const managed = [];
  const slug = (value) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  function save(file, content) {
    // Two prompts that normalize to one name would silently overwrite each other.
    if (managed.some((entry) => entry.path === relative(repository, file).split(sep).join('/')))
      throw new Error(`Plugin adapter name collision after normalizing: ${file}`);
    emit(file, content, false);
    managed.push({
      path: relative(repository, file).split(sep).join('/'),
      hash: createHash('sha256').update(content).digest('hex'),
    });
  }
  let skills = 0;
  let agents = 0;
  for (const [id, enabled] of Object.entries(settings.enabledPlugins)) {
    if (!enabled) continue;
    const candidates = registry[id] ?? [];
    const install =
      candidates.find(
        (entry) =>
          entry.scope === 'project' && resolve(entry.projectPath ?? '') === resolve(repository),
      ) ?? candidates.find((entry) => entry.scope === 'user');
    if (!install || !existsSync(install.installPath)) {
      missing.push(id);
      continue;
    }
    const plugin = id.split('@')[0];
    const pluginRoot = install.installPath;
    const prompts = entries(join(pluginRoot, 'skills'))
      .filter((entry) => existsSync(join(pluginRoot, 'skills', entry.name, 'SKILL.md')))
      .map((entry) => join(pluginRoot, 'skills', entry.name, 'SKILL.md'));
    prompts.push(
      ...entries(join(pluginRoot, 'commands'))
        .filter((entry) => entry.name.endsWith('.md'))
        .map((entry) => join(pluginRoot, 'commands', entry.name)),
    );
    for (const source of prompts) {
      const shortName =
        basename(source) === 'SKILL.md' ? basename(dirname(source)) : basename(source, '.md');
      const name = `local-${slug(plugin)}-${slug(shortName)}`;
      const description = field(readFileSync(source, 'utf8'), 'description');
      const body = skill(
        name,
        description,
        source,
        `Resolve relative resources from ${quote(dirname(source))}, CLAUDE_SKILL_DIR to that directory, and CLAUDE_PLUGIN_ROOT to ${quote(pluginRoot)}. Pass the user's arguments as ARGUMENTS. Read referenced files explicitly; invocation-time shell substitutions and @file includes do not execute automatically.\n`,
      );
      save(join(repository, '.agents/skills', name, 'SKILL.md'), body);
      skills++;
    }
    for (const entry of entries(join(pluginRoot, 'agents'))) {
      if (!entry.name.endsWith('.md')) continue;
      const source = join(pluginRoot, 'agents', entry.name);
      const prompt = readFileSync(source, 'utf8');
      const name = `local-${slug(plugin)}-${slug(basename(entry.name, '.md'))}`;
      save(
        join(repository, '.codex/agents', `${name}.toml`),
        agent(name, field(prompt, 'description'), source),
      );
      agents++;
    }
  }
  for (const old of previous) {
    if (managed.some((entry) => entry.path === old.path)) continue;
    if (
      !/^(?:\.agents\/skills\/local-[a-z0-9-]+\/SKILL\.md|\.codex\/agents\/local-[a-z0-9-]+\.toml)$/.test(
        old.path,
      )
    )
      throw new Error('Invalid local plugin manifest path');
    const file = join(repository, old.path);
    if (!existsSync(file)) continue;
    if (createHash('sha256').update(readFileSync(file)).digest('hex') !== old.hash)
      throw new Error(`Preserving edited plugin adapter: ${file}`);
    unlinkSync(file);
  }
  emit(manifest, JSON.stringify(managed, null, 2) + '\n', false);
  return { skills, agents, missing };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (
      args.some((arg) => !['--check', '--plugins'].includes(arg)) ||
      (args.includes('--check') && args.includes('--plugins'))
    )
      throw new Error('Usage: node scripts/codex/sync.mjs [--check | --plugins]');
    syncProject(root, args.includes('--check'));
    if (args.includes('--plugins')) {
      const result = syncPlugins();
      console.log(
        `Local plugin bridge: ${result.skills} skills/commands, ${result.agents} agents.`,
      );
      if (result.missing.length) {
        console.error(`Unavailable plugins: ${result.missing.join(', ')}`);
        process.exitCode = 1;
      }
    }
    console.log('Project skill and agent adapters are current.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
