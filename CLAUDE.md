# CLAUDE.md

Rules for working in food-pickup. `CLAUDE.md` holds the standing rules and stays static during ordinary development;
`.claude/rules/` holds the rules for one part of the repository and loads when you touch its files (`frontend.md`
for `client/`, `backend.md` for `server/`, Dockerfiles, nginx and compose, `workflow.md` for `.claude/`, `.github/`,
`.changes/`, `scripts/`, `.agents/`, `.codex/`, `AGENTS.md` and `package.json`); `docs/` holds how things are today;
`plans/` holds where we are going.
Anything that changes with the code (budgets, commands, ports, tables of agents, plugins, docs, limits) lives in
those files and is only referenced here. When they disagree, the code is the truth: fix the doc in the same change.

## 1. Communication style (most important)

The user must always see what you are thinking and what background work is doing.

- Say your working hypothesis as soon as you have it; narrate direction changes ("Confirmed the bug — writing the
  fix"). Before a long read, say what you are looking for. Surface findings as you find them, not only at the end.
- Never leave a silent gap of more than ~30 s. One line before each tool batch is enough.
- Background work is never a black box: pair a long-running bash with `Monitor` filtered to meaningful lines, and a
  background agent with `Monitor` on `bash .claude/scripts/agent-progress-monitor.sh <output_file>`. While anything
  runs, show the `## In-flight` block (§18).
- The final summary is short: what changed, what was verified and how, what is left.

## 2. Production context

food-pickup is a **live production app**: campus-café pickup ordering. Customers browse the menu, order and track
pickup; staff move orders through PLACED → PREPARING → READY → COLLECTED (or CANCELLED). Profile roles: CUSTOMER and
ADMIN (site-wide operator, `/admin` site settings; no staff powers). At a store, a person is its brand's OWNER
(`brands.owner_id`), or a MANAGER or STAFF member (`store_memberships`; the board is `/staff`, `/manage` for owners and
managers); what each may
do is the capability map in `server/src/domain/permissions.ts` (`docs/PERMISSIONS.md`). Site-wide limits live in
the one-row `site_settings` table, edited by admins.

- Real users, real concurrency. Stock races are settled inside the `place_order` transaction, never in app code.
- Security and accessibility are requirements, not polish.
- **Never touch production.** `pnpm run db:push:production` and `pnpm run seed --production` are run by the user
  only. Tests run against local Supabase only (§13, `docs/TESTING.md`).
- Migrations in `server/supabase/migrations/` are append-only once pushed (the `migrations` CI job enforces it).
- API changes stay backward-compatible with the deployed client: add fields, never rename or remove fields the
  client reads, keep error codes stable. A change the deployed client cannot survive ships with a
  `min_client_version` bump (`docs/API.md` "Client version gate").

## 2b. Target devices and network (STRICTLY ENFORCED)

The primary target is a low- to mid-range Android phone (360–412px, ~4× slower CPU) on a slow or flaky connection;
desktop and the staff board are secondary. Mobile-first layouts, tap targets ≥ 44px, `transform`/`opacity`
animations only with `prefers-reduced-motion` honored, a visible loading state and a retry path on every network
call, polling that pauses when the tab is hidden, instant feedback on predictable taps. The budgets are
`client/perf-budget.json`; the rules in full are `.claude/rules/frontend.md` §2b; `perf-auditor` records the
measurements in `docs/PERF_BASELINE.md`. Check UI changes on a throttled 360px viewport before calling them done.

## 2c. Caching (STRICTLY ENFORCED)

Cache wherever it is safe, on both sides: on a slow, metered connection the fastest request is the one never made
and the cheapest body is a 304. "Safe" means a stale copy can never mislead or leak: money, stock and order status
are always confirmed by the server, and user-specific data is never cached where it can outlive a sign-out. Every
new cached read ships with its invalidation and a test that fails without it. Server rules (headers, the TTL read
cache, containers): `.claude/rules/backend.md` §2c. Client rules (persisted public data, storage keys, photos, lazy
routes): `.claude/rules/frontend.md` §2c.

## 3. Tech stack and commands

Client: React 18, Vite 6, Tailwind v4 (`@theme` tokens), zustand, react-router 7, `lucide-react`, supabase-js (auth
only). API: Express 5, zod, Supabase (secret key, JWKS token checks), pino; Supabase Postgres with schema and RPCs in
`server/supabase/migrations/`. Tooling: Node 24 (`.nvmrc`, `engineStrict`), pnpm (corepack), TypeScript strict, ESLint,
Prettier, Vitest. Every script and port: `README.md` "Useful scripts" and "Ports".

## 4. Project structure

The map is `docs/ARCHITECTURE.md`, `docs/FRONTEND_STRUCTURE.md` and `docs/BACKEND_STRUCTURE.md`. Layering rules:
`.claude/rules/frontend.md` §4 (pages compose features and components; rules in `*Rules.ts`; HTTP only in
`services/`) and `.claude/rules/backend.md` §4 (routes → validate → controllers → services → serializers).

## 5. Reusable components (STRICTLY ENFORCED)

Check `docs/COMPONENTS.md` first; extend with a variant prop rather than fork; build new only when nothing fits, and
add it to the catalog in the same change. Mandates: `.claude/rules/frontend.md` §5.

## 6. Documentation (STRICTLY ENFORCED)

Update the owning doc **in the same change**; a change that skips its doc is incomplete. One owner per topic; other
docs link to it instead of copying. The ownership map (what you changed → which doc) is `docs/README.md`.

## 7. Visual fidelity

UI work uses the `@theme` tokens only, asks before building when data, edge states, narrow layouts or copy are
ambiguous, and passes the visual gate (Playwright at 390px throttled and 1280px) before it is done. Details:
`.claude/rules/frontend.md` §7.

## 8. Frontend data fetching (STRICTLY ENFORCED)

Only `client/src/services/*.ts` call `request()`; GETs go through `useResource`; a mutation reloads every resource it
affects; config comes from `GET /api/config`. Details: `.claude/rules/frontend.md` §8.

## 9. Icons and assets

Icons from `lucide-react`, food photos through `FoodPhoto` and `optimize-images.py`, runtime hosts limited to Google
Fonts, the Supabase project and the media bucket's upload origin, uploads never committed. Details: `.claude/rules/frontend.md` §9.

## 10. Backend engineering

Schema first (zod with real bounds), rows become DTOs in `utils/serializers.ts` (client copy updated in the same
change), errors through the `AppError` factories, atomic multi-step writes in a SQL function, prices and totals from
the database, someone else's resource is 404 (never 403), every `supabaseAdmin` query scopes by user, every
transition function sets `app.actor` and `app.request_id` and calls `emit_event` in the same transaction, and an
audited table is written through such a function or with the `x-actor` and `x-request-id` headers. Details
(sessions, env, transitions, audit, recipes): `.claude/rules/backend.md` §10.

## 11. Code quality

- A file over 1000 lines gets split below 800, by responsibility.
- No `any`, `@ts-ignore`, `@ts-expect-error` or `eslint-disable`. Fix the type.
- Comments explain _why_, not _what_. Unused `_`-prefixed args are allowed on purpose.
- **No hard-coding** of anything an operator may need to change. Each value has one tier (site setting, deployment
  setting, platform constant with a parity test, presentation constant); the registry and the tiers are
  `docs/CONFIGURATION.md`. `pnpm run check:durations` (CI) fails on a `\d+_000` duration literal in services, the
  domain layer or `*Rules.ts`.

## 12. Safety

Naming conventions: `.claude/rules/frontend.md` §12 and `.claude/rules/backend.md` §12.

- **Secrets:** never print `.env` files or secret values. Only `VITE_` publishable values may reach the client;
  `sb_secret_…` never leaves the server.
- **Branch-intent guardrail:** a branch often contains deliberate deviations that look like bugs (`// disabled`,
  `// feature-flag`, `// A/B`, `// temporarily`, `// TODO: re-enable`, `enabled={false}`, branch-only conditionals,
  commits saying disable/hide/experiment). Any agent that rewrites code lists these as "Branch-intent flags", never
  changes them without asking (keep / accept / merge both), and records the decision.
- **Destructive git is forbidden for every subagent**, and for the main agent unless the user asks for that exact
  operation: `git stash`, `reset --hard/--merge`, `restore .`/`-- <path>`, `checkout .`/`-- <path>`, `clean -f`,
  `rebase`, `merge`, `cherry-pick`, `revert`, `branch -D`, `push --force*`, `commit`, `git config` writes. Parallel
  agents share one working tree; one stash wipes everyone's edits. `.claude/hooks/block-destructive-git.js` denies
  the destructive subset; the rest is policy. Read-only git is fine. If you see a subagent run one of these, tell the
  user immediately.
- Never commit unless the user asks. Never create tags, and never merge into `main`: only the user merges there. The
  release commit inside the release PR (made by `release.yml`) is the one automated commit (§21).

## 12b. Attribution policy (STRICTLY ENFORCED)

- **NEVER** include any mention of Claude, AI, or AI-assisted generation in commit messages, PR descriptions, code
  comments, or any output visible in the repository.
- **NEVER** add `Co-Authored-By` lines referencing Claude or any AI.
- **NEVER** include "Generated with Claude Code" or similar attribution badges in PRs, commits, or docs.
- All work must appear as if written entirely by the human developer: no AI fingerprints anywhere.

## 13. Validation after every change

In every package you touched: `pnpm run typecheck && pnpm run lint && pnpm test` (the server suite needs local Supabase
running and seeded; in `client/` also the e2e smoke; what each runs: `docs/TESTING.md`). Root and tooling changes
(`scripts/`, `.github/`, `plans/`, root `package.json`) use the root gate `pnpm run format:check && pnpm test` instead
(no `typecheck` or `lint` there; `docs/TESTING.md`). Format with
`pnpm exec prettier --write <files>`. Report failures with their output; never weaken a test to get green.

**Every fix ships with its guard.** A bug fix is done only when the check that would have caught it exists and you
have seen it fail without the fix: a unit or API test, an e2e smoke case, a `scripts/ci/` check or CI step, or a
numbered item in `ui-verifier` / `app-breaker`. Guard the class of bug, not the one line, at the cheapest layer that
catches it. CI runs the same gate on every PR (`docs/TESTING.md` "Continuous integration"), and a ruleset blocks the merge
until `ci-ok` is green.

## 14. CRUD and lifecycle verification

For any endpoint or order-flow change, walk the lifecycle against the local API with real tokens, check that each
change left its `domain_events` row (a repeated transition is 200 and leaves none), and confirm the UI shows the
result: recipe in `.claude/rules/backend.md` §14.

## 15. Reuse-first workflow

You self-trigger this; the user almost never says "create a new table". The moment you think _"I'll build a new
component / hook / util / service for …"_ run `reuse-scout`; _"I'll add a table / column / migration / SQL function
for …"_ run `schema-guard`; _"this is like X but different enough to fork"_ is almost always wrong, run `reuse-scout`.
`/before-write <intent>` runs both and returns REUSE / EXTEND / BUILD NEW. A `PreToolUse(Write)` hook reminds you;
your judgment is the gate.

## 16. Plugin usage

Several installed plugins cover the same moment. `.claude/rules/workflow.md` §16 names one pick per moment (clarify,
plan, debug, build, review, security, release, "done"); that pick wins over a plugin's own hook. Load it with the
`Skill` tool at that moment.

## 17. Multi-agent workflows

Agents live in `.claude/agents/`, skills in `.claude/skills/`. The agents table, what counts as a major change, the
`/post-change` pipeline, the hooks and CodeRabbit auto-delegation: `.claude/rules/workflow.md` §17. Run
`/post-change` once a major piece of work is finished, not after every edit; on CodeRabbit content, delegate to
`coderabbit-fixer` without waiting to be asked.

### Orchestrator and implementers

On a phase plan the main agent orchestrates: it decides who implements each PR, reviews the result, and keeps the
branch, `/post-change`, the commit, the push and the PR (§12 forbids them to a subagent).

- **A `sonnet` implementer** (`general-purpose` with `model: "sonnet"`) when the plan's PR section already names the
  files, the tests and the verify step, and the PR touches none of the areas in the next bullet. One implementer at
  a time (one shared working tree, §12), a fresh one per PR.
- **The main agent itself** when the PR changes auth or permissions, who may read or move an order, `place_order` or
  any price, stock or money path, file uploads, or anything that reaches production (Terraform, IAM, secrets, deploy
  workflows); or when the plan leaves a design choice open.

The brief names the plan file and the PR heading to read, the branch, the rule files for the packages touched, and
the done-check (the §13 gate green, its output in the report). It points at the plan instead of repeating it.

The review is quick but real: read the whole diff against the PR's section (every file, test and doc it names is
there, nothing outside its theme), then run the §13 gate yourself; an implementer's "passing" is not evidence. A
small fix you apply yourself; a larger one goes to a fresh implementer with the findings; after a second failed
round you take the PR over. When the session itself runs on Sonnet, implement directly: a hand-off to the same model
only adds cost.

### Verdict handoff

A subagent's report is the start of action, not the end of the turn. Classify every item and act in the same turn:

| Class        | Examples                                                                                                                    | Main agent                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| AUTO-EXECUTE | REUSE verdicts, SAFE fixes (already applied), ✅ READY                                                                      | apply / accept now; never end the turn with one un-actioned       |
| CONFIRM      | EXTEND / NO MATCH / NEW TABLE, STRUCTURAL and FLAGGED fixes, ❌ blockers, budget regressions, missing logging on a new flow | one batched `AskUserQuestion` with file:line and concrete options |
| ADVISORY     | AMBIGUOUS comments, coverage notes, perf opportunities without one fix                                                      | list them                                                         |

After the user answers, apply the answer yourself or spawn a fresh agent of the same type with the answer. The
original agent has exited: never `SendMessage` it. Agents added during a session are not registered until the next
session; meanwhile spawn `general-purpose` with "Read `.claude/agents/<name>.md` and act as that agent".

## 18. Long-running processes

Always background dev servers, Docker, installs, builds, database-backed test runs and background agents, and show
the `## In-flight` table while anything runs (gone on the final turn). Never pipe a long-running process through
anything that exits early. Probe the ports before starting anything: whatever answers is the user's; use it, never
restart it. Clean up only what you started, then check those ports answer `000`. Details (probes, screenshots,
stalled agents): `.claude/rules/workflow.md` §18.

## 19. Logging

Log only through `server/src/utils/logger.ts` (`req.log` inside a request) and `client/src/lib/logger.ts`;
`console.*` fails lint. Structured fields first, a short constant message second. Never log tokens, the secret key,
passwords, or raw email/phone. Log a failure once, at the boundary; nothing above `debug` on polling paths or in
loops. Levels: `docs/LOGGING.md`; the rules in full: `.claude/rules/backend.md` §19.

## 20. Knowledge graph (graphify)

The graph is advisory. For a broad codebase question, `graphify query "<question>"` (or `path` / `explain`) is
usually cheaper than grep when `graphify-out/graph.json` exists; for a known file or symbol, go straight to grep or
Read. Run `graphify update .` after modifying code. Details: `.claude/rules/workflow.md` §20.

## 21. Versioning and branches

Feature branches → PR into `dev` (staging) → a release PR into `main` (production, merged by the user) → a
back-merge into `dev`. A phase may have its own `feat/P<n>` branch that its PRs target. Every PR stays within the
size limit and one theme; when a branch reaches the limit or its theme is done, verify, commit, push, open the PR
and **stop** until the user says it is merged. P2 and P3 are the exception: the agent merges each of their PRs into
`feat/P2` / `feat/P3` itself and goes on to the next without waiting for the user (workflow.md §21).
CodeRabbit's hourly review budget, shared by every PR you open, paces when PRs are opened, marked ready and re-reviewed. A change to source records its version bump (`pnpm run change`) before
it is finished; docs, CI and tooling changes are labelled `no-release`. Never merge into `main` and never tag. The
branch model, phase branches, the PR-size numbers, the CodeRabbit budget, bump levels and the release process:
`.claude/rules/workflow.md` §21.
