# AGENTS.md

Instructions for Codex and other agents that read `AGENTS.md`. The rules are shared with Claude Code and live in one
place, so read them instead of expecting a copy here:

1. **`CLAUDE.md`** — the standing rules (production context, caching, code quality, safety, attribution, versioning).
   Read it in full before changing anything.
2. **`.claude/rules/`** — rules per area; read the one that matches the files you touch, because nothing loads it for
   you: `frontend.md` for `client/`, `backend.md` for `server/`, Dockerfiles, nginx and compose, `workflow.md` for
   `.claude/`, `.github/`, `.changes/`, `scripts/` and `package.json`.
3. **`docs/`** (how things are today, ownership map in `docs/README.md`) and **`plans/`** (where we are going).
4. **`docs/CODEX.md`** — read this before using the shared workflows. It maps skill invocations, agent roles,
   hook execution, plugin resources and background tools to this runtime. It also applies when starting in a
   subdirectory or acting as a delegated agent. Read `workflow.md` for `.agents/`, `.codex/` and `AGENTS.md` changes.

Reading notes for non-Claude agents:

- `CLAUDE.md` and the rules mention Claude-only tooling (subagents, skills, hooks, `AskUserQuestion`, `Monitor`).
  Where you have no such tool, do the same step yourself or ask the user; the rule behind it still applies.
- Never touch production, never commit, tag or merge unless asked, and no destructive git (`CLAUDE.md` §2, §12).
- Never mention an AI or an assistant in commits, PRs, comments or docs, and add no `Co-Authored-By` line (§12b).
- Validate every app package you touched (`client/`, `server/`) with `npm run typecheck && npm run lint && npm test`
  (§13). Root and tooling changes (`scripts/`, `.github/`, `plans/`, root `package.json`) use the root gate,
  `npm run format:check && npm test`: the root has no `typecheck` or `lint` script (`docs/CODEX.md`).
