---
paths:
  - ".claude/**"
  - ".github/**"
  - ".changes/**"
  - "scripts/**"
  - "**/package.json"
---

# Workflow rules (agents, hooks, CI, releases)

Loaded with any file under `.claude/`, `.github/`, `.changes/`, `scripts/` or a `package.json`. Section numbers match
`CLAUDE.md`.

## 16. Agent-skills plugin usage

Load these with the `Skill` tool at the matching moment:

| Moment                           | Skill                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| a vague or underspecified ask    | `agent-skills:interview-me`, then `agent-skills:spec`                                           |
| a feature                        | `agent-skills:plan` → `agent-skills:build`                                                      |
| a bug                            | `agent-skills:test` (prove it with a failing test), `agent-skills:debugging-and-error-recovery` |
| an endpoint or auth change       | `agent-skills:api-and-interface-design` + `agent-skills:security-and-hardening`                 |
| UI work                          | `agent-skills:frontend-ui-engineering`                                                          |
| before merge                     | `agent-skills:review` or the `agent-skills:code-reviewer` agent                                 |
| auth, orders, money, user data   | the `agent-skills:security-auditor` agent                                                       |
| performance                      | `agent-skills:webperf`, `agent-skills:performance-optimization`                                 |
| a decision worth recording       | `agent-skills:documentation-and-adrs`                                                           |
| branches, commits, PRs, releases | `agent-skills:git-workflow-and-versioning`                                                      |
| before a release                 | `agent-skills:ship`                                                                             |
| over-engineering creeping in     | `ponytail:ponytail`                                                                             |
| a workflow repeated three times  | `anthropic-skills:skill-creator` to make it a project skill                                     |

## 17. Multi-agent workflows: details

**Agents** (`.claude/agents/`):

| Agent                     | Writes                  | Use                                                                                                                                                    |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reuse-scout`             | –                       | before any new component, hook, util, service or endpoint                                                                                              |
| `schema-guard`            | –                       | before any new table, column, enum, function or migration                                                                                              |
| `coderabbit-fixer`        | source                  | CodeRabbit comments (auto-delegated, one per file)                                                                                                     |
| `merge-conflict-resolver` | source                  | conflict markers, migration order, lockfiles                                                                                                           |
| `refactorer`              | source                  | post-change: size, duplication, dead code, misplaced logic                                                                                             |
| `responsive-fixer`        | client UI               | post-change when UI changed: 360–412px first                                                                                                           |
| `logging-auditor`         | logging lines           | post-change: levels, redaction, request ids, no `console`                                                                                              |
| `test-generator`          | tests                   | post-change: unit tests + the endpoint edge-case matrix                                                                                                |
| `docs-writer`             | docs                    | post-change: the §6 ownership map                                                                                                                      |
| `ui-verifier`             | –                       | post-change: static checks + throttled Playwright run; ✅/❌ READY                                                                                     |
| `perf-auditor`            | `docs/PERF_BASELINE.md` | post-change: budgets from §2b, caching from §2c, API latency, queries                                                                                  |
| `app-breaker`             | –                       | `/break` before a release or after auth, orders, money or pipeline changes: security (xhigh), data, flow, env groups; ranked BREAKs with repro and fix |

**Skills** (`.claude/skills/`): `/post-change`, `/fix-coderabbit`, `/resolve-conflicts`, `/before-write`,
`/new-endpoint`, `/db-migration`, `/break`.

### The post-change pipeline

Run `/post-change` once a major piece of work is finished — not after every edit:

1. gate (typecheck + lint + test);
2. `refactorer` → `responsive-fixer` (UI only) → `logging-auditor`, one at a time (all three edit source);
3. `test-generator` ∥ `docs-writer` (disjoint files);
4. `ui-verifier` → `perf-auditor` (read-only, on the final state; sequential because the Playwright MCP is one shared
   browser — never run two browser-driving agents at once);
5. act on every verdict (below), re-run the gate if anything changed;
6. `graphify update .`, `node .claude/hooks/major-change-gate.js --mark`, stop what you started, delete screenshots.

The `Stop` hook classifies what changed since the last mark and, for a major change, records
`.claude/.state/pending.json` and tells the user once. A `UserPromptSubmit` hook then reminds you on each prompt until
`/post-change` marks it verified. Both are advisory and never block.

### CodeRabbit auto-delegation

When a user message contains CodeRabbit content (`@coderabbitai`, `coderabbit`, `Potential issue`,
`Refactor suggestion`, `Nitpick`, `Actionable comments posted`, `Outside diff range comments`,
`Summary by CodeRabbit`, a ` ```suggestion ` block, or a PR number with "fix/address the review comments"), delegate
without waiting for `/fix-coderabbit`: group comments by file, spawn one background `coderabbit-fixer` per file (all
in one message), forward later same-file comments with `SendMessage` only while that fixer is still running, announce
each dispatch in one line, and do not pre-categorize the comments yourself. A `UserPromptSubmit` hook injects a
reminder when the markers appear.

`.claude/settings.json` is shared by every developer (the hooks above and the plugins) and stays committed; it
holds no machine paths, and the graphify hooks skip when graphify is not installed. Personal overrides go in
`.claude/settings.local.json`, which is gitignored.

Agents added during a session are not registered until the next session; meanwhile spawn `general-purpose` with
"Read `.claude/agents/<name>.md` and act as that agent".

## 18. Long-running processes

- **Always background:** `./start.sh`, dev servers, `docker compose up` (or run it with `-d`; stop with
  `docker compose down`), `npm run db:start` / `db:reset`, `npm install`, builds, test runs
  that hit the database, and background agents. Quick commands (curl, git status/diff, a scoped grep) stay in the
  foreground.
- While anything runs, every turn shows:
  ```text
  ## In-flight
  | # | Kind | Started | Elapsed | Latest | Status |
  ```
  Status is 🟢 running · 🟡 waiting · ✅ done (shown once) · 🔴 errored. Omit the block when nothing runs, and it must
  be gone on the final turn.
- **Never pipe a long-running process** (dev servers, `start.sh`, `docker compose up`) through `head`, `grep -m` or
  anything else that exits early: when it exits, the pipe kills the server mid-session. Redirect to a log file in the
  scratchpad and filter that.
- **Probe before starting:** `curl -s -o /dev/null -w '%{http_code}'` on `http://localhost:8000/api/health`,
  `http://localhost:8001/health` (the worker), `http://localhost:5173`, `http://127.0.0.1:54321/rest/v1/` and, for compose, `http://localhost:8080/healthz`. Anything answering belongs to the user: use it, never
  restart it. `start.sh` kills whatever holds 8000/8001/5173, so never run it while the user's servers are up.
- **Clean up only what you started** (`TaskStop`), then check those ports answer `000`. Leave the user's servers
  alone. Never `kill` by port unless you have confirmed the process is yours and told the user.
- Delete every Playwright screenshot or trace you created before the final message (never anything under
  `client/public/` or tracked by git).
- **Stalled or errored agent:** run `bash .claude/scripts/extract-last-agent-state.sh <output_file> 6`, then finish its
  plan, re-spawn it with the extracted state, or show it to the user. Never let stalled work disappear silently. Never
  `Read` an agent's transcript file directly.

## 20. Knowledge graph (graphify)

This project has a knowledge graph at `graphify-out/` with god nodes, community structure, and cross-file
relationships.

- The graph is advisory. For a broad question (where is X, what depends on Y, what a change touches), start with
  `graphify query "<question>"` when `graphify-out/graph.json` exists, `graphify path "<A>" "<B>"` for relationships
  and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than
  `GRAPH_REPORT.md` or raw grep output. For a known file, symbol or line, grep or Read directly.
- `.claude/hooks/graphify-hint.js` (`PreToolUse` on `Bash|Grep` and `Read|Glob`) runs `graphify hook-guard`, which
  decides when a search or a source read could start from the graph, and replaces its "MANDATORY" wording with a
  one-line advisory tip. It never blocks a call; the agents' own "orient with graphify" steps are unchanged.
- If `graphify-out/wiki/index.md` exists, use it for broad navigation instead of raw source browsing.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review or when query/path/explain do not surface
  enough context.
- After modifying code, run `graphify update .` (AST-only, no API cost). The graph also refreshes automatically: the
  `Stop` hook runs `graphify update .` when source files are newer than the graph, and the git `post-commit` /
  `post-checkout` hooks (`graphify hook install`) refresh it on every commit and checkout.

## 21. Versions and releases

**Versions.** `client/package.json` and `server/package.json` keep independent semver lines (0.x until the pilot
launch). A change that touches `client/src`, `server/src`, `server/scripts`, `server/supabase/migrations` or a
`package.json` records its bump before it is finished:

```bash
npm run change -- --client minor --server patch "Store list and per-store menus behind the multi_store_ui flag."
```

| Package | major                                                                                                                                         | minor                                                                    | patch                                    |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------- |
| server  | a breaking contract change for the deployed client (a field removed or renamed, a changed meaning or error code); should not happen, given §2 | a new endpoint, field, error code, setting or migration adding behaviour | a fix, performance, refactor, logging    |
| client  | a removed route, or persisted storage (`fp_cart`, `fp_cache`) reset without a migration                                                       | a new user-visible feature or screen                                     | a fix, copy, style or performance change |

Docs-only, CI and tooling changes need no intent (label the PR `no-release`). The format is in `.changes/README.md`.
Three places enforce it: the `version-intent` CI job (`scripts/version/check.mjs`), the last step of `/post-change`,
and a one-time reminder from `.claude/hooks/major-change-gate.js`.

**Releases.** The bump happens only inside a release PR: `release.yml` → `prepare` (`workflow_dispatch`, `dry_run`
on by default) branches `release/<date>` off `dev`, runs `npm run release` (highest level per package; versions in
`package.json` and `package-lock.json`; CHANGELOGs; intents deleted; `major` before 1.0.0 refused without
`--allow-major`), commits and opens the PR into `main`. The user merging it is the production approval. On the merge,
`tag-and-backmerge` tags `client-vX` / `server-vY` and opens the back-merge PR into `dev` (`no-release`). Staging
images are tagged `dev-<sha7>`; `package.json` keeps the last released version.
