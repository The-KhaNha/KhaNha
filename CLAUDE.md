# CLAUDE.md

Rules for working in food-pickup. `CLAUDE.md` holds the rules; `docs/` holds how things are today; `plans/` holds
where we are going (the roadmap, research and phase plans). When they disagree, the code is the truth: fix the doc in
the same change.

Rules that apply to one part of the repository live in `.claude/rules/` and load when you touch its files:
`frontend.md` (`client/`), `backend.md` (`server/`, Dockerfiles, nginx, compose) and `workflow.md` (`.claude/`,
`.github/`, `.changes/`, `scripts/`, `package.json`). Each section below that has more there says so.

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
pickup; staff move orders through PLACED → PREPARING → READY → COLLECTED (or CANCELLED).
Roles: CUSTOMER, STAFF (the restaurant's order board, `/staff`), ADMIN (site-wide developer/operator, `/admin` site
settings; no staff powers). Site-wide limits live in the one-row `site_settings` table, edited by admins.

- Real users, real concurrency. Stock races are settled inside the `place_order` transaction, never in app code.
- Security and accessibility are requirements, not polish.
- **Never touch production.** `npm run db:push:production` and `npm run seed -- --production` are run by the user
  only. Tests run against local Supabase only (§13, `docs/TESTING.md`).
- Migrations in `server/supabase/migrations/` are append-only once pushed (enforced on every PR by the `migrations`
  CI job: only added files, each newer than the base branch's newest).
- A change the deployed client cannot survive ships with a `min_client_version` bump (`PATCH /api/admin/settings`):
  older clients then get 426 `CLIENT_OUTDATED` and a refresh banner (`docs/API.md` "Client version gate").
- API changes stay backward-compatible with the deployed client: add fields, do not rename or remove fields the
  client reads, and keep error codes stable.

## 2b. Target devices and network (STRICTLY ENFORCED)

**The primary UI and performance target is a low- to mid-range Android phone (₹8–15k class, 360–412px wide, ~4×
slower CPU than a laptop) on a slow or flaky connection (Slow 4G / 3G, drops).** Desktop and the staff board are
secondary. Budgets, measured at 360×640 on Slow 4G with 4× CPU throttling (recorded and enforced by `perf-auditor`
in `docs/PERF_BASELINE.md`; the numbers CI reads live in `client/perf-budget.json`, and `client/lighthouserc.json` must
match it):

| Metric       | Budget                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------- |
| LCP          | ≤ 3 s                                                                                          |
| INP          | ≤ 300 ms                                                                                       |
| CLS          | ≤ 0.15                                                                                         |
| Initial JS   | ≤ ~170 KB gzip; staff, auth and checkout routes code-split                                     |
| Menu photo   | ≤ ~80 KB each, sized to its box, `loading="lazy"` below the fold, aspect box so nothing shifts |
| API payloads | lean (no over-fetching); no request waterfalls                                                 |

Rules that follow:

- Mobile-first layouts. Tap targets ≥ 44px. Animate only `transform`/`opacity`, and honor
  `prefers-reduced-motion` (the global rule in `client/src/index.css`).
- No heavy dependency without checking its gzip cost first (`perf-auditor` or `npx vite build` output). supabase-js
  is loaded on demand: go through `getSupabase()` (`lib/supabase.ts`), never import `lib/supabaseClient.ts`.
- The page's largest paint (the store cover) gets `LCP_IMAGE_PROPS`, never sits inside an entrance fade, and does
  not share the link with food photos (`FoodPhotoGate`); see `docs/FRONTEND_STRUCTURE.md` "The largest paint".
- Fonts keep `display=swap` and the preconnect in `client/index.html`.
- Every network call has a visible loading state, an abort/timeout path, and a graceful unreachable state with retry
  (`ErrorState unreachable`). A spinner never hangs forever.
- Polling pauses while the tab is hidden (`useResource` does this) and uses conservative intervals: people pay for
  data.
- Give instant feedback on taps whose result is predictable (add to cart); do not block the UI on a round-trip.
- Check UI changes on a throttled 360px viewport before calling them done (§7).

## 2c. Caching (STRICTLY ENFORCED)

Cache wherever it is safe, on both sides: on a slow, metered connection the fastest request is the one never made
and the cheapest body is a 304. "Safe" means a stale copy can never mislead or leak. Money, stock and order status
are always confirmed by the server, and user-specific data is never cached where it can outlive a sign-out.

**Server**

- Every `/api` response carries `Cache-Control: no-cache` and `Vary: Authorization` (`server/src/app.ts`). With
  Express's ETag, an unchanged body comes back as a bodiless 304, including on every poll. Never give stock, menu or
  order responses a `max-age`.
- Public, read-mostly data (menu, store, any future catalog) is read through `cached(key, PUBLIC_READ_TTL_MS, load)`
  from `server/src/utils/cache.ts`. It is per-process, has a TTL (10 s), and shares one load between concurrent misses.
- Every write through the API that changes cached data calls `invalidate(key)` in the same service, as
  `order.service.ts` does after an order is placed or cancelled. A new cached read ships with its invalidation, and a
  test that fails without it (`server/test/api/menu-cache.test.ts`).
- Write paths never read through the cache (`createOrder` checks `is_open` with the uncached `getStore()`).
  Nothing user-specific ever goes into `cached()`.

**Client**

- What a person typed, or their own data, in browser storage is cleared when a session starts or ends, from
  `features/auth/authStore.ts` (always loaded), never from a lazy chunk: a sign-out before that chunk loads leaks it
  to the next account on a shared phone. `lib/storageKeys.test.ts` fails for any `fp_` key nobody classified.
- Public data uses `useResource({ persist: true })` (menu, store): the last good copy in `localStorage`
  (`fp_cache:v1:<key>`) renders instantly on the next visit and is refreshed at once (stale-while-revalidate). Bump
  the version in `CACHE_PREFIX` (`lib/useResource.ts`) when a persisted response shape changes. Never `persist`
  orders, the profile, or anything else user-specific.
- Every bundled photo has a 400px thumbnail next to it and fits ~80 KB: run
  `python3 client/scripts/optimize-images.py` after adding one (`--refit` for an existing one over budget;
  `lib/photo.test.ts` fails otherwise). `FoodPhoto`'s `sizes` must be the photo's real rendered width, so
  thumbnails download the small file.
- Screens a customer does not need to browse and fill a cart (checkout, order success, login, register, staff) are
  `lazy()` routes in `App.tsx`, behind `PageBoundary` (skeleton while loading, retry if the chunk fails).
- The browser HTTP cache does the rest: never add cache-busting query strings to API calls or images.

**Containers (`server/Dockerfile`, `client/Dockerfile`, `client/nginx/`):** hashed `/assets/*`
`public, max-age=31536000, immutable`; `/images/*` a week; `index.html`, SPA routes and `/runtime-env.js` `no-cache`;
gzip on. See `docs/DEPLOYMENT.md` "Containers".

`perf-auditor` checks all of this (check 10) and reports a missing safe cache as a finding.

## 3. Tech stack and commands

- Client `client/`: React 18, Vite 6, Tailwind v4 (`@theme` tokens in `src/index.css`), zustand, react-router 7,
  `lucide-react`, supabase-js (auth only).
- API `server/`: Express 5, zod, Supabase via `@supabase/server` (secret key, JWKS token checks), pino. Database:
  Supabase Postgres, schema and RPCs in `server/supabase/migrations/`.
- Tooling: Node 24 (≥ 24.15, which jsdom needs; `.nvmrc`, `.node-version`, `engines` + `engine-strict`: `npm ci`
  refuses other majors), npm, TypeScript strict, ESLint (flat
  config per package), Prettier (root `.prettierrc.json`), Vitest.

Both packages: `npm run dev`, `typecheck`, `lint`, `format`, `format:check`, `test`, `build`. Server: `dev:worker`
(the job worker), `db:start` / `db:stop`, `db:reset` (wipes local data), `db:new <name>`, `db:types` (regenerates
`src/types/database.ts`), `seed`, `db:push:staging`; `npm run db:push:production` and `npm run seed -- --production`
are **user only**. Root: `npm run change` (§21), `format`, `test`. Every script: README.md "Useful scripts".

Ports: client `5173` (`VITE_DEV_PORT`), API `8000` (`PORT`), worker health `8001` (`WORKER_HEALTH_PORT`), local
Supabase `54321` (`SUPABASE_URL`), read by `start.sh` from the env files. `./start.sh [--seed]` starts the API, the
worker and the client and kills whatever holds 8000/8001/5173 first (§18); `docker compose up web api worker` runs
the containers, the web app on `8080`.

## 4. Project structure

The map is in `docs/ARCHITECTURE.md`, `docs/FRONTEND_STRUCTURE.md` and `docs/BACKEND_STRUCTURE.md`. The layering
rules:

- **Client:** `pages/` compose `features/*` and `components/`. Business rules live in `features/*/…Rules.ts` and
  `features/orders/orderStatus.ts`, not in components. State: zustand stores in `features/*/…Store.ts`. HTTP only in
  `services/` (§8).
- **Server:** `routes/*.routes.ts` → `middleware/validate.ts` (zod) → `controllers/*.controller.ts` →
  `services/*.service.ts` → `utils/serializers.ts`. Controllers are thin and have no try/catch: Express 5 forwards
  rejected promises to `middleware/errorHandler.ts`. `src/app.ts` builds the app (`createApp()`); `src/server.ts`
  only listens. `src/worker.ts`, the second entry point, runs the queue consumers in `jobs/` (`docs/JOBS.md`).

## 5. Reusable components (STRICTLY ENFORCED)

Check `docs/COMPONENTS.md` first; extend with a variant prop rather than fork; build new only when nothing fits, and
add it to the catalog in the same change. Mandates (`FoodPhoto`, Skeleton/EmptyState/ErrorState, `Button`):
`.claude/rules/frontend.md`.

## 6. Documentation (STRICTLY ENFORCED)

Update the owning doc **in the same change**. A change that skips its doc is incomplete.

| You changed                                                                               | Update                                                                                                                            |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| an endpoint, request/response shape, error code or server rule                            | `docs/API.md` (+ `ErrorCode` in `server/src/utils/errors.ts`, DTOs on both sides)                                                 |
| a migration, table, column, enum, index or SQL function                                   | `docs/SCHEMA.md`                                                                                                                  |
| a queue, event subscription, pg_cron schedule, job handler or retention rule              | `docs/JOBS.md`                                                                                                                    |
| a role, route guard, RLS, grant, ownership rule or staff-only action                      | `docs/PERMISSIONS.md`                                                                                                             |
| a design token (colour, type, radius, shadow, motion) or a design rule                    | `docs/DESIGN.md`                                                                                                                  |
| a shared atom or variant, a `lib/` hook/util, feature rules                               | `docs/COMPONENTS.md`                                                                                                              |
| a page, route, feature folder, store or client service                                    | `docs/FRONTEND_STRUCTURE.md`                                                                                                      |
| a route, controller, service, middleware, schema or util module                           | `docs/BACKEND_STRUCTURE.md`                                                                                                       |
| an env var, environment, db push step, build step, production setup                       | `docs/DEPLOYMENT.md` + the `.env.example`                                                                                         |
| log levels, redaction, logging conventions                                                | `docs/LOGGING.md`                                                                                                                 |
| cache headers, the server read cache, client persisted caches, photo variants             | `docs/API.md` "Caching" + `docs/FRONTEND_STRUCTURE.md` "Caching"                                                                  |
| test targets, helpers, the edge-case matrix                                               | `docs/TESTING.md`                                                                                                                 |
| a workflow in `.github/`, a `scripts/ci/` check, the bundle budget                        | `docs/TESTING.md` "Continuous integration"                                                                                        |
| perf baselines                                                                            | `docs/PERF_BASELINE.md` (owned by `perf-auditor`)                                                                                 |
| a cross-cutting flow (auth, checkout, order lifecycle), a top-level dir, a system diagram | `docs/ARCHITECTURE.md`                                                                                                            |
| a site setting, a deployment setting or a platform limit                                  | `docs/CONFIGURATION.md` (the registry)                                                                                            |
| a decision worth recording                                                                | `docs/adr/NNN-title.md` from `docs/adr/0000-template.md`, indexed in `docs/adr/README.md` (`agent-skills:documentation-and-adrs`) |
| the change-intent format or level rules                                                   | `.changes/README.md` (+ §21)                                                                                                      |
| a release (written by `npm run release`, never by hand)                                   | `client/CHANGELOG.md`, `server/CHANGELOG.md`                                                                                      |
| quick start, scripts, demo                                                                | `README.md`                                                                                                                       |

One owner per topic; other docs link to it instead of copying.

## 7. Visual fidelity

UI work uses the `@theme` tokens only, asks before building when data, edge states, narrow layouts or copy are
ambiguous, and passes the visual gate (Playwright at 390px throttled and 1280px) before it is done. Details:
`.claude/rules/frontend.md`.

## 8. Frontend data fetching (STRICTLY ENFORCED)

Only `client/src/services/*.ts` call `request()`; GETs go through `useResource`; a mutation reloads every resource it
affects; config comes from `GET /api/config`. Details: `.claude/rules/frontend.md`.

## 9. Icons and assets

Icons from `lucide-react`, food photos through `FoodPhoto` and `optimize-images.py`, runtime hosts limited to Google
Fonts and the Supabase project. Restaurant uploads (P3.3) go to S3 behind CloudFront (`docs/adr/006-media-s3-cloudfront.md`)
and are never committed. Details: `.claude/rules/frontend.md`.

## 10. Backend engineering

Schema first (zod with real bounds), rows become DTOs in `utils/serializers.ts` (client copy updated in the same
change), errors through the `AppError` factories, atomic multi-step writes in a SQL function, prices and totals from
the database, someone else's resource is 404 (never 403), and every `supabaseAdmin` query scopes by user. Details
(sessions, env, recipes): `.claude/rules/backend.md`.

## 11. Code quality

- A file over 1000 lines gets split below 800, by responsibility.
- No `any`, `@ts-ignore`, `@ts-expect-error` or `eslint-disable` (lint enforces the first two and flags unused
  disables). Fix the type.
- Comments explain _why_, not _what_.
- Unused `_`-prefixed args/vars are allowed on purpose (Express's 4-argument error handler).
- **No hard-coding** of anything an operator may need to change. Each value has one tier (`docs/CONFIGURATION.md`):
  a site setting (`site_settings`, edited at `/admin`), a deployment setting (env), a platform constant with a parity
  test where both sides need it (`server/src/schemas/limits.ts` ↔ `client/src/config/fallbacks.json`), or a
  presentation constant, which stays in code. `npm run check:durations` (CI) fails on a `\d+_000` duration literal in
  services, the domain layer or `*Rules.ts`.

## 12. Safety and naming conventions

| Thing                | Convention                                                        |
| -------------------- | ----------------------------------------------------------------- |
| Pages                | `pages/<Name>.tsx` exporting `<Name>Page`                         |
| Component props      | `<Name>Props`                                                     |
| Loading placeholders | `<Name>Skeleton`                                                  |
| Hooks                | `useX` in `lib/` or `features/*/`                                 |
| Stores               | `features/*/<x>Store.ts`, `use<X>Store`                           |
| Server modules       | `<area>.routes.ts`, `.controller.ts`, `.service.ts`, `.schema.ts` |
| Response types       | `XDto` on the server, `X` on the client                           |
| Database             | snake_case; JSON is camelCase (serializers convert)               |
| Tests                | `*.test.ts(x)`; staging-safe server suites `*.safe.test.ts`       |

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

In every package you touched:

```bash
npm run typecheck && npm run lint && npm test
```

`npm test` needs local Supabase running and seeded for the server (`npm run db:start`, `npm run seed`). In `client/`,
also `npm run e2e:chromium` (the 360×640 smoke: 200% text, 44px targets; `npm run e2e:webkit` for Safari's engine). Format with
`npx prettier --write <files>` (or `npm run format`). Report failures with their output; never weaken a test to get
green.

**Every fix ships with its guard.** A bug fix is done only when the check that would have caught it exists and you
have seen it fail without the fix: a unit or API test, an e2e smoke case, a `scripts/ci/` check or CI step, or a
numbered item in `ui-verifier` / `app-breaker`. Guard the class of bug, not the one line (a storage-key registry, not
one key; a layout check over every route, not one card), at the cheapest layer that catches it. CI runs the same gate
on every PR into `dev`, `main` and a phase feature branch (§21) (`.github/workflows/ci.yml`, aggregate job `ci-ok`;
`docs/TESTING.md` "Continuous integration"). On GitHub Free nothing enforces it (no rulesets on a private repo,
ADR-011): never merge with `ci-ok` red or pending.

## 14. CRUD and lifecycle verification

For any endpoint or order-flow change, walk the lifecycle against the local API with real tokens and confirm the UI
shows the result: recipe in `.claude/rules/backend.md`.

## 15. Reuse-first workflow

You self-trigger this; the user almost never says "create a new table". The moment you think _"I'll build a new
component / hook / util / service for …"_ run `reuse-scout`; _"I'll add a table / column / migration / SQL function
for …"_ run `schema-guard`; _"this is like X but different enough to fork"_ — almost always wrong, run `reuse-scout`.
`/before-write <intent>` runs both and returns REUSE / EXTEND / BUILD NEW. A `PreToolUse(Write)` hook reminds you when
a new file appears under `client/src/components/`, `client/src/lib/`, `server/src/services/` or
`server/supabase/migrations/`, but your judgment is the gate.

## 16. Agent-skills plugin usage

Load the matching skill with the `Skill` tool: a vague ask → `agent-skills:interview-me`; a feature → `plan` → `build`;
a bug → `test` and `debugging-and-error-recovery`; an endpoint or auth change → `api-and-interface-design` +
`security-and-hardening`; UI → `frontend-ui-engineering`; before merge → `review`; auth, orders, money or user data →
the `security-auditor` agent; performance → `webperf`; a decision → `documentation-and-adrs`; git → `git-workflow-and-versioning`;
a release → `ship`; over-engineering → `ponytail:ponytail`. Full table: `.claude/rules/workflow.md`.

## 17. Multi-agent workflows

Agents live in `.claude/agents/`, skills in `.claude/skills/` (`/post-change`, `/fix-coderabbit`, `/resolve-conflicts`,
`/before-write`, `/new-endpoint`, `/db-migration`, `/break`). The agents table, the pipeline's stages, the hooks and
CodeRabbit delegation in full: `.claude/rules/workflow.md`.

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

Run `/post-change` once a major piece of work is finished, not after every edit; the skill runs the stages in order
(gate; refactorer → responsive-fixer → logging-auditor; test-generator ∥ docs-writer; ui-verifier → perf-auditor) and
marks the change verified.

### CodeRabbit auto-delegation

When a user message carries CodeRabbit content, delegate without waiting for `/fix-coderabbit`: one background
`coderabbit-fixer` per file, all in one message (a hook injects a reminder).

### Verdict handoff

A subagent's report is the start of action, not the end of the turn. Classify every item and act in the same turn:

| Class        | Examples                                                                                                                    | Main agent                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| AUTO-EXECUTE | REUSE verdicts, SAFE fixes (already applied), ✅ READY                                                                      | apply / accept now; never end the turn with one un-actioned       |
| CONFIRM      | EXTEND / NO MATCH / NEW TABLE, STRUCTURAL and FLAGGED fixes, ❌ blockers, budget regressions, missing logging on a new flow | one batched `AskUserQuestion` with file:line and concrete options |
| ADVISORY     | AMBIGUOUS comments, coverage notes, perf opportunities without one fix                                                      | list them                                                         |

After the user answers, apply the answer yourself or spawn a fresh agent of the same type with the answer. The
original agent has exited: never `SendMessage` it. `SendMessage` is only for a still-running background agent.

Agents added during a session are not registered until the next session; meanwhile spawn `general-purpose` with
"Read `.claude/agents/<name>.md` and act as that agent".

## 18. Long-running processes

- **Always background:** `./start.sh`, dev servers, `docker compose up` (or `-d`), `npm run db:start` / `db:reset`,
  `npm install`, builds, test runs that hit the database, and background agents. While anything runs, every turn shows
  the `## In-flight` table (`| # | Kind | Started | Elapsed | Latest | Status |`), gone on the final turn.
- **Never pipe a long-running process** through anything that exits early (`head`, `grep -m`): redirect to a log in
  the scratchpad.
- **Probe before starting** (`curl` on `:8000/api/health`, `:8001/health`, `:5173`, `:54321/rest/v1/`): anything
  answering is the user's; use it, never restart it. **Clean up only what you started**, then check those ports
  answer `000`.
- Details (screenshots, stalled agents): `.claude/rules/workflow.md`.

## 19. Logging

Log only through `server/src/utils/logger.ts` (`req.log` inside a request) and `client/src/lib/logger.ts`;
`console.*` fails lint. Structured fields first, a short constant message second. Never log tokens, the secret key,
passwords, or raw email/phone. Log a failure once, at the boundary; nothing above `debug` on polling paths or in
loops. Levels and what each means: `docs/LOGGING.md`; the rules in full: `.claude/rules/backend.md`.

## 20. Knowledge graph (graphify)

The graph is advisory. For a broad codebase question (where is X, what depends on Y), `graphify query "<question>"`
(or `path` / `explain`) is usually cheaper than grep when `graphify-out/graph.json` exists; for a known file or
symbol, go straight to grep or Read. Run `graphify update .` after modifying code. Details: `.claude/rules/workflow.md`.

## 21. Versioning and branches

**Branches.** Feature branches → PR into `dev` (`ci-ok` green before merging, by rule: GitHub Free enforces nothing;
`dev` deploys staging) → a release PR into `main`
(production, merged by the user) → a back-merge PR into `dev`. Hotfixes branch off `main` as `hotfix/*`, carry their
own intent, get their own release run and are back-merged the same way. Migrations are immutable once merged into
`dev`. Agents that compare against "the base" use the PR's base branch: `origin/dev` for features, `origin/main` for
hotfixes, `origin/feat/P<n>` for a phase's PRs.

**Phase feature branches.** A phase may get its own feature branch `feat/P<n>`, cut from `dev` (P1 has one; one agent
builds its PRs in order). Its PRs come from `feat/p<n>-<NN>-<slug>` branches (git cannot hold
`feat/P1` and `feat/P1/…` side by side) and go into `feat/P<n>`, with the same size limit, CI (`ci.yml` and `security.yml`
match `feat/**` for PRs; `ci.yml` also runs on pushes to `feat/P<n>`) and CodeRabbit review (`.coderabbit.yaml`
matches `feat/.*`). Migrations are immutable once
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

**Versions.** A change that touches `client/src`, `server/src`, `server/scripts`, `server/supabase/migrations` or a
`package.json` records its bump before it is finished (`npm run change -- --client <level> --server <level> "summary"`);
docs-only, CI and tooling changes need none (label the PR `no-release`). Levels and the release process:
`.claude/rules/workflow.md` and `.changes/README.md`.
