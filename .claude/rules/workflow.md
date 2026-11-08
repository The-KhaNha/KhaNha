---
paths:
  - ".claude/**"
  - ".github/**"
  - ".changes/**"
  - "scripts/**"
  - "**/package.json"
  - ".agents/**"
  - ".codex/**"
  - "**/AGENTS.md"
---

# Workflow rules (agents, hooks, CI, releases)

Loaded with any file under `.claude/`, `.github/`, `.changes/`, `scripts/`, `.agents/` or `.codex/`, a `package.json`
or an `AGENTS.md`. Section numbers match `CLAUDE.md`.

## 16. Plugin usage

Seven plugins are enabled for every developer in `.claude/settings.json` (`agent-skills`, `superpowers`,
`claude-security`, `code-review`, `frontend-design`, `ponytail`, `skill-creator`). Several cover the same moment;
the table names one pick per moment so they do not fire over each other. Load the pick with the `Skill` tool. When
the superpowers `SessionStart` hook asks for `brainstorming` first, the pick here wins: this table is the project's
decision.

| Moment | Use | Not used here (same job) |
| --- | --- | --- |
| a vague or underspecified ask | `agent-skills:interview-me`, then `agent-skills:spec` | `superpowers:brainstorming` |
| a feature | `agent-skills:plan` → `agent-skills:build` | `superpowers:writing-plans`, `executing-plans` |
| a bug | `superpowers:systematic-debugging` or `agent-skills:debugging-and-error-recovery` (root cause), then `agent-skills:test` (prove it with a failing test) | – |
| an endpoint or auth change | `agent-skills:api-and-interface-design` + `agent-skills:security-and-hardening` | – |
| a new screen or a visual direction | `frontend-design:frontend-design` for the direction (inside the `@theme` tokens, §7), then `agent-skills:frontend-ui-engineering` to build it | – |
| UI changes to an existing screen | `agent-skills:frontend-ui-engineering` | – |
| before opening a PR | `code-review:code-review` on the diff (bugs; `--fix` is fine inside the scope), then `simplify`; `/post-change` runs it for a major change | `superpowers:requesting-code-review` |
| before merging a large or cross-cutting PR | `agent-skills:review` (five axes) or the `agent-skills:code-reviewer` agent | – |
| review comments arrive (CodeRabbit or a person) | `superpowers:receiving-code-review` (verify each point before applying), then `coderabbit-fixer` for CodeRabbit threads (§17) | – |
| auth, orders, money, user data or the request pipeline | `claude-security:claude-security` scan of the branch's changes (static findings) + the `agent-skills:security-auditor` agent (threat model) | – |
| before a release | `claude-security:claude-security` full scan → `/break` (live attack; confirms the scan's findings) → `agent-skills:ship` | – |
| performance | `agent-skills:webperf`, `agent-skills:performance-optimization`; `perf-auditor` owns the numbers | – |
| about to say "done", "fixed" or "passing" | `superpowers:verification-before-completion` (run the §13 gate and show the output first) | – |
| a decision worth recording | `agent-skills:documentation-and-adrs` | – |
| branches, commits, PRs, releases | `agent-skills:git-workflow-and-versioning`, within §21 | `superpowers:finishing-a-development-branch` (§21 already decides what happens to a branch) |
| starting a PR while another branch has uncommitted work | `superpowers:using-git-worktrees` (a worktree off the PR's base; never a stash, §12) | – |
| two or more independent tasks | `superpowers:dispatching-parallel-agents` for read-only agents only; agents that write source run one at a time (one shared working tree, §12) | `superpowers:subagent-driven-development` |
| over-engineering creeping in | `ponytail:ponytail`; before a release PR, `ponytail:ponytail-debt` lists the deliberate `ponytail:` shortcuts | `ponytail:ponytail-review`, `ponytail:ponytail-audit` (`simplify` and `refactorer` cover them) |
| a CI workflow, a `scripts/ci` check or a release script | `agent-skills:ci-cd-and-automation` (a guard per §13; releases per §21) | – |
| a workflow repeated three times; editing `.claude/skills` | `skill-creator:skill-creator` to make or measure a project skill, `superpowers:writing-skills` for the writing itself | – |
| editing `CLAUDE.md`, `.claude/rules` or an agent prompt | `agent-skills:context-engineering` | – |

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

### What counts as a major change

- Any change under `server/src/{routes,controllers,services,schemas,middleware,jobs}/`, `server/src/worker.ts`,
  `server/supabase/migrations/`, `client/src/{pages,services,components}/`, `client/src/App.tsx`, or any
  `package.json`; or
- 5 or more source files; or
- 150 or more changed lines across `client/src` + `server/src`.

Docs-only changes, a single-file style tweak, copy edits and one-line fixes are not major. The same rules live in
`.claude/hooks/major-change-gate.js` (keep them in sync; its change-intent reminder mirrors `needsIntent` in
`scripts/version/lib.mjs`).

### The post-change pipeline

Run `/post-change` once a major piece of work is finished — not after every edit:

1. gate (typecheck + lint + test);
2. `refactorer` → `responsive-fixer` (UI only) → `logging-auditor`, one at a time (all three edit source);
3. `test-generator` ∥ `docs-writer` (disjoint files);
4. `ui-verifier` → `perf-auditor` (read-only, on the final state; sequential because the Playwright MCP is one shared
   browser — never run two browser-driving agents at once);
5. `code-review:code-review` on the diff, plus a `claude-security:claude-security` scan of the changes when the
   scope touches auth, orders, money, middleware or the request pipeline;
6. act on every verdict (below), re-run the gate if anything changed;
7. `graphify update .`, `node .claude/hooks/major-change-gate.js --mark`, stop what you started, delete screenshots.

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

**Subagent model.** An agent file's `model:` wins. For a built-in agent (`general-purpose`, `Plan`, …) pass `model`
on the spawn:

- `sonnet` when the work is clear and needs little planning or thought: the task, the files and the done-check are
  already written down (a PR from its plan, a mechanical rename, a scripted check);
- `opus` when it has to design, choose between approaches, find an unknown cause, or decide something about auth,
  orders, money or a migration's shape.

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

## 21. Branches, PR size, versions and releases

**Branches.** Feature branches → PR into `dev` (`ci-ok` green before merging, enforced by the `ci-ok required`
ruleset on `main`, `dev` and each listed `feat/P<n>`, ADR-011; `dev` deploys staging) → a release PR into `main`
(production, merged by the user) → a back-merge PR into `dev`. Hotfixes branch off `main` as `hotfix/*`, carry their
own intent, get their own release run and are back-merged the same way. Migrations are immutable once merged into
`dev`. Agents that compare against "the base" use the PR's base branch: `origin/dev` for features, `origin/main` for
hotfixes, `origin/feat/P<n>` for a phase's PRs.

**Phase feature branches.** A phase may get its own feature branch `feat/P<n>`, cut from `dev` (P1 has one; one agent
builds its PRs in order). Its PRs come from `feat/p<n>-<NN>-<slug>` branches (git cannot hold
`feat/P1` and `feat/P1/…` side by side) and go into `feat/P<n>`, with the same size limit, CI (`ci.yml` and `security.yml`
match `feat/**` for PRs; `ci.yml` also runs on pushes to `feat/P<n>`) and CodeRabbit review (`.coderabbit.yaml`
matches `^feat/`). When a phase branch is cut, add it by its exact name to the `ci-ok required` ruleset (Settings →
Rules); a `feat/*` pattern would also catch the work branches and refuse their pushes. Migrations are immutable once
merged into the phase branch. When the phase is done, `feat/P<n>` goes into `dev` as one PR, merged by the user.

**PR size (STRICTLY ENFORCED).** Keep every PR reviewable: at most **38 changed files or 750 changed lines** against
its base (`node .claude/hooks/major-change-gate.js --status` prints both; `package-lock.json`,
`server/src/types/database.ts` and docs, meaning every Markdown file, do not count; tests do), and one theme per PR. Plan a task that is bigger than that as steps, each its own PR. The
release PR (`release/*`, from `release.yml`) and a phase branch's PR into `dev` are exempt: each bundles work already
reviewed in its own PRs.

- When a branch reaches either limit, or its theme is done: finish and verify the change in hand (the §13 gate,
  `/post-change` for a major change), commit, push, open the PR into the base, and tell the user it is ready.
- Then **stop**: start no other work, and do not poll CI or the PR. The user says when it is merged (or what to fix);
  only then branch fresh off the updated base for the next step.
- `.claude/hooks/major-change-gate.js` reminds once per branch when it passes the limit (`--status` prints the size).

**CodeRabbit budget.** The repository is public, so CodeRabbit reviews it on the free open-source plan: **1–10 PR
reviews an hour per PR author, rising with the repository's stars** (about 1 an hour while it has few), 25 chat
messages an hour, 100–300 files a review, all in rolling windows ([plans](https://docs.coderabbit.ai/management/plans),
[rate limits](https://docs.coderabbit.ai/management/rate-limits), checked 2026-11-03). Every PR one account opens
draws on the same allowance. A review is spent by opening a PR or marking a draft ready, by each `@coderabbitai review`
or `full review`, and by reopening a PR. `.coderabbit.yaml` turns off the review of later pushes and skips release and
back-merge PRs, so a push costs nothing.

- Open a PR once, complete (the flow above). With several ready at once, open the first, open the rest as drafts
  (`gh pr create --draft`), and mark the next one ready (`gh pr ready <n>`) only when a review is free again: a posted
  review does not free one, time does. `@coderabbitai rate limit` on an open PR says when, without spending a review.
- After a `coderabbit-fixer` round, push once. Comment `@coderabbitai review` only when the round changed behaviour,
  not for nitpicks.
- A "rate limited" comment means that review did not run: wait for the time it gives, then comment
  `@coderabbitai review` once. Never push again, or close and reopen, to trigger it.
- Mention `@coderabbitai` only to ask it something: each mention spends a chat message.
- A phase branch's PR into `dev` bundles reviewed work: put `@coderabbitai ignore` in its description.

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
