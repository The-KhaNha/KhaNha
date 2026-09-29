# CLAUDE.md

Rules for working in food-pickup. `CLAUDE.md` holds the rules; `docs/` holds how things are today; `plans/` holds
where we are going (the roadmap, research and phase plans). When they disagree, the code is the truth: fix the doc in
the same change.

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

| Part             | Stack                                                                                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client `client/` | React 18, Vite 6, Tailwind v4 (`@theme` tokens in `src/index.css`), zustand, react-router 7, `lucide-react`, supabase-js (auth only)                                                                                              |
| API `server/`    | Express 5, zod, Supabase via `@supabase/server` (secret key, JWKS token checks), pino                                                                                                                                             |
| Database         | Supabase Postgres; schema and RPCs in `server/supabase/migrations/`                                                                                                                                                               |
| Tooling          | Node 24 (≥ 24.15, which jsdom needs; `.nvmrc`, `.node-version`, `engines` + `engine-strict`: `npm ci` refuses other majors), npm, TypeScript strict, ESLint (flat config per package), Prettier (root `.prettierrc.json`), Vitest |

Root (`package.json`, not a workspace; only devDependency `prettier`):

| Script                                                                                 | Does                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run format` / `format:check`                                                      | Prettier over `scripts/**`, `.github/**` and `plans/**`                                                                                                      |
| `npm test`                                                                             | `node --test` over `scripts/**/*.test.mjs`                                                                                                                   |
| `npm run change -- --client <level> --server <level> "summary"`                        | record a change intent in `.changes/` (§21)                                                                                                                  |
| `npm run release:dry` / `release`                                                      | print / apply the version bump from the intents (release PR only)                                                                                            |
| `npm run change:check`                                                                 | the `version-intent` CI check against `origin/dev`                                                                                                           |
| `npm run check:bundle` / `check:migrations` / `check:durations` / `check:dist-secrets` | the CI checks: initial JS budget (after a client build), migrations append-only against `origin/dev`, no hard-coded durations, no secret in the built bundle |

Both packages: `npm run dev`, `typecheck`, `lint`, `format`, `format:check`, `test`, `test:watch`, `build`.

Server only:

| Script                                                       | Does                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `npm run db:start` / `db:stop`                               | local Supabase in Docker (API `:54321`)                                        |
| `npm run db:start:ci`                                        | the same without Studio, storage, realtime, mail, logs and edge functions (CI) |
| `npm run db:reset`                                           | reapply every migration locally (wipes local data)                             |
| `npm run db:new <name>`                                      | new migration file                                                             |
| `npm run db:types`                                           | regenerate and format `src/types/database.ts` from local (CI fails on drift)   |
| `npm run seed`                                               | demo store, menu and accounts (local/staging; wipes orders)                    |
| `npm run db:push:staging`                                    | push migrations to staging                                                     |
| `npm run db:push:production`, `npm run seed -- --production` | **user only**                                                                  |

Client: `npm run dev:staging` / `build:staging` use `client/.env.staging`; `npm run e2e:webkit` runs the WebKit smoke
(`npm run e2e:install` once). `npm run build` needs
`client/.env.production`, which does not exist yet.

Ports: client `5173` (`VITE_DEV_PORT`), API `8000` (`PORT`), local Supabase `54321` (`SUPABASE_URL`); `start.sh`
reads all three from the env files. `docker compose up web api` serves both on `8080`. `./start.sh [--seed]` starts API + client (it kills
whatever holds 8000/5173 first — see §18). Details: `README.md`, `docs/DEPLOYMENT.md`.

## 4. Project structure

The map is in `docs/ARCHITECTURE.md`, `docs/FRONTEND_STRUCTURE.md` and `docs/BACKEND_STRUCTURE.md`. The layering
rules:

- **Client:** `pages/` compose `features/*` and `components/`. Business rules live in `features/*/…Rules.ts` and
  `features/orders/orderStatus.ts`, not in components. State: zustand stores in `features/*/…Store.ts`. HTTP only in
  `services/` (§8).
- **Server:** `routes/*.routes.ts` → `middleware/validate.ts` (zod) → `controllers/*.controller.ts` →
  `services/*.service.ts` → `utils/serializers.ts`. Controllers are thin and have no try/catch: Express 5 forwards
  rejected promises to `middleware/errorHandler.ts`. `src/app.ts` builds the app (`createApp()`); `src/server.ts`
  only listens.

## 5. Reusable components (STRICTLY ENFORCED)

`docs/COMPONENTS.md` is the catalog: the `components/` atoms (props, variants, when to use), the `lib/` hooks and
utils, and the `features/*` rules and hooks.

1. Check the catalog first.
2. If something almost fits, extend it with a variant prop. Never fork an atom because "my screen is a bit
   different".
3. Build new only when nothing fits, then add it to the catalog in the same change.

Mandates:

- Every food photo goes through `FoodPhoto`.
- Every data view has a Skeleton, an EmptyState and an ErrorState.
- Buttons use `Button` / `ButtonLink` / `buttonClasses()`.

## 6. Documentation (STRICTLY ENFORCED)

Update the owning doc **in the same change**. A change that skips its doc is incomplete.

| You changed                                                                               | Update                                                                                                                            |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| an endpoint, request/response shape, error code or server rule                            | `docs/API.md` (+ `ErrorCode` in `server/src/utils/errors.ts`, DTOs on both sides)                                                 |
| a migration, table, column, enum, index or SQL function                                   | `docs/SCHEMA.md`                                                                                                                  |
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

- Given a screenshot or design, describe what you see (layout, spacing, type, colors, states) before writing code.
- Colors, type sizes, radii, shadows and fonts come from the `@theme` tokens in `client/src/index.css`, documented in
  `docs/DESIGN.md`. No new hard-coded hex, arbitrary `text-[Npx]`, `rounded-[Npx]` or `shadow-[…]`: add a token or
  use the nearest step (`lib/designTokens.test.ts` fails otherwise).
- Mobile-first: bottom nav, `pb-safe` for the home indicator, sheets on phones and dialogs on desktop.
- Design rules written in component comments are binding. For example: `PopularBadge` is the ONLY thing allowed on
  top of a food photo; `OpenPill`'s pulse is one of only two looping animations in the app.
- Respect `prefers-reduced-motion`.
- **Ask before building** when the data shape, edge states (empty/loading/error), logic, layout at narrow widths or
  copy is ambiguous. A short question is cheaper than a redo.
- **Visual gate:** before calling a UI change done, use the Playwright MCP to screenshot the golden path, one edge
  state (empty, error or loading), at 390px and 1280px, the phone pass throttled (Slow 4G + 4× CPU). Say exactly what
  you verified. Delete the screenshots afterwards.

## 8. Frontend data fetching (STRICTLY ENFORCED)

- Only `client/src/services/*.ts` call `request()` from `services/api.ts`. No `fetch(` and no `'/api'` strings
  anywhere else.
- GETs use `lib/useResource.ts` through a `features/*/use*.ts` hook.
- After a mutation, call `reload()` / `mutate()` on **every** resource the mutation affects. A missing one is a
  stale-UI bug.
- Errors are `ApiError`. The server's message is user-facing: show it. Failed loads render `ErrorState` (with
  `unreachable` when `err.isUnreachable`); cart-line problems use `describeProblem` in `features/cart/cartRules.ts`.
- Public, non-user data is cached with `useResource({ persist: true })` (§2c); user data never is.
- Polling goes through `useResource`'s `pollInterval`, with the interval from `useConfig().polling` (site settings,
  edited at `/admin`); never a hard-coded interval.
- Config and rules come from the API (`GET /api/config`), never mirrored by hand. The one client copy is
  `client/src/config/fallbacks.json` (defaults and field bounds), parity-tested by the server suite.

## 9. Icons and assets

- Icons are named imports from `lucide-react`. A genuinely custom icon goes in `client/src/components/icons/` as a
  component. No inline `<svg>` in pages or features.
- Images live in `client/public/images/` and reach the UI through the database `image_url` and `FoodPhoto`. A new
  photo goes through `python3 client/scripts/optimize-images.py` (compression + the 400px thumbnail, §2c).
- Every `<img>` has `alt`, explicit dimensions or an aspect box, and `loading="lazy"` below the fold.
- Runtime hosts allowed: Google Fonts and the Supabase project. Nothing else.
- Future user uploads go to Supabase Storage and are never committed.

## 10. Backend engineering

- **Schema first:** zod in `schemas/*.schema.ts` with real bounds; `XInput` / `XQuery` inferred with `z.infer`.
- **Serializers:** rows become `XDto` (`server/src/types/api.ts`) in `utils/serializers.ts`. Update the client copy
  in `client/src/types/api.ts` (named `X`) in the same change.
- **Errors:** throw the `AppError` factories in `utils/errors.ts`; add new codes to `ErrorCode`. The envelope is
  `{ error: { code, message, details? } }`.
  A dependency that fails or cannot be reached is an `IntegrationError { provider, operation, retryable, cause }`
  (503 `UPSTREAM_UNAVAILABLE` with `Retry-After`); wrap with `{ cause }`, never swallow it (`docs/LOGGING.md`
  "Error classes").
- **Atomic multi-step writes** go into a SQL function (`p_` params; expected failures raise P0001 with the API error
  code as the message and JSON detail, decoded by `raisedByDatabase` in `utils/supabase.ts`).
- **Trust nothing from the client:** prices and totals come from the database. Someone else's resource is 404, never 403. The role is read from `profiles` on every request, never from the token.
- **`supabaseAdmin` bypasses RLS,** so every query scopes by user explicitly.
- Public reads are cached with `cached()` and invalidated by the writes that change them (§2c).
- Sessions: access tokens stay 1 h (refreshed by supabase-js). A sign-in ends after 7 days without use; each use
  restarts the week (`client/src/features/auth/sessionActivity.ts` + `auth.sessions.inactivity_timeout = "168h"` in
  `server/supabase/config.toml` locally; on hosted Supabase Free the inactivity timeout is a Pro setting, so the
  client cap is the only enforcement there, `docs/adr/011-free-tiers.md`). Never raise `jwt_expiry` to get longer
  sign-ins: a long-lived bearer token cannot be revoked.
- Env is read only through `utils/env.ts`. `src/types/database.ts` is generated (`npm run db:types`); never
  hand-edit it.
- Recipes: `/new-endpoint`, `/db-migration`.

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
one key; a layout check over every route, not one card), at the cheapest layer that catches it. CI runs the same gate on every PR into `dev` and `main` (`.github/workflows/ci.yml`, aggregate job `ci-ok`;
`docs/TESTING.md` "Continuous integration"). On GitHub Free nothing enforces it (no rulesets on a private repo,
ADR-011): never merge with `ci-ok` red or pending.

## 14. CRUD and lifecycle verification

For any endpoint or order-flow change, exercise it against the local API with a real token:

```bash
KEY=$(grep VITE_SUPABASE_PUBLISHABLE_KEY client/.env.development | cut -d= -f2)
TOKEN=$(curl -s "http://127.0.0.1:54321/auth/v1/token?grant_type=password" -H "apikey: $KEY" \
  -H 'Content-Type: application/json' -d '{"email":"anishka@example.com","password":"test1234"}' | jq -r .access_token)
curl -s localhost:8000/api/orders -H "Authorization: Bearer $TOKEN" | jq
```

Walk the lifecycle: create → get → list → each valid status transition (staff token: `staff@campuscafe.local` /
`staff123`; admin: `admin@campuscafe.local` / `admin123`) → an invalid transition returns 409 → cancelling restores stock → another user's order returns 404. Then
confirm the UI shows the result.

## 15. Reuse-first workflow

You self-trigger this; the user almost never says "create a new table". The moment you think _"I'll build a new
component / hook / util / service for …"_ run `reuse-scout`; _"I'll add a table / column / migration / SQL function
for …"_ run `schema-guard`; _"this is like X but different enough to fork"_ — almost always wrong, run `reuse-scout`.
`/before-write <intent>` runs both and returns REUSE / EXTEND / BUILD NEW. A `PreToolUse(Write)` hook reminds you when
a new file appears under `client/src/components/`, `client/src/lib/`, `server/src/services/` or
`server/supabase/migrations/`, but your judgment is the gate.

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

## 17. Multi-agent workflows

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

- Any change under `server/src/{routes,controllers,services,schemas,middleware}/`, `server/supabase/migrations/`,
  `client/src/{pages,services,components}/`, `client/src/App.tsx`, or any `package.json`; or
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

### Verdict handoff

A subagent's report is the start of action, not the end of the turn. Classify every item and act in the same turn:

| Class        | Examples                                                                                                                    | Main agent                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| AUTO-EXECUTE | REUSE verdicts, SAFE fixes (already applied), ✅ READY                                                                      | apply / accept now; never end the turn with one un-actioned       |
| CONFIRM      | EXTEND / NO MATCH / NEW TABLE, STRUCTURAL and FLAGGED fixes, ❌ blockers, budget regressions, missing logging on a new flow | one batched `AskUserQuestion` with file:line and concrete options |
| ADVISORY     | AMBIGUOUS comments, coverage notes, perf opportunities without one fix                                                      | list them                                                         |

After the user answers, apply the answer yourself or spawn a fresh agent of the same type with the answer. The
original agent has exited: never `SendMessage` it. `SendMessage` is only for a still-running background agent.

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
  `http://localhost:5173`, `http://127.0.0.1:54321/rest/v1/` and, for compose, `http://localhost:8080/healthz`. Anything answering belongs to the user: use it, never
  restart it. `start.sh` kills whatever holds 8000/5173, so never run it while the user's servers are up.
- **Clean up only what you started** (`TaskStop`), then check those ports answer `000`. Leave the user's servers
  alone. Never `kill` by port unless you have confirmed the process is yours and told the user.
- Delete every Playwright screenshot or trace you created before the final message (never anything under
  `client/public/` or tracked by git).
- **Stalled or errored agent:** run `bash .claude/scripts/extract-last-agent-state.sh <output_file> 6`, then finish its
  plan, re-spawn it with the extracted state, or show it to the user. Never let stalled work disappear silently. Never
  `Read` an agent's transcript file directly.

## 19. Logging

- Log only through `server/src/utils/logger.ts` (pino; inside a request use `req.log`, which carries the request id)
  and `client/src/lib/logger.ts`. `console.*` fails lint.
- Levels are tunable per environment: `LOG_LEVEL` on the server (default `debug` on local, `info` on staging and
  production) and `VITE_LOG_LEVEL` on the client (default `debug` in dev, `warn` in builds; `debug`/`info` are
  compiled out of production builds).

| Level   | Meaning                                                                                                   | In this app                                                                                                        |
| ------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `error` | 5xx or unexpected; server logs it with `err` (stack and cause chain), `route`, `status`, `code`, `userId` | unhandled route error; 503 `UPSTREAM_UNAVAILABLE` (database or Auth unreachable, an `IntegrationError`)            |
| `warn`  | expected but worth noticing                                                                               | 401 / 403 / 429 (426 `CLIENT_OUTDATED` is `debug`: a stale tab keeps asking)                                       |
| `info`  | lifecycle and business events                                                                             | listening/shutdown, `Order placed`, `Order status changed`, 4xx like `INSUFFICIENT_STOCK`, access lines for writes |
| `debug` | dev tracing                                                                                               | access lines for successful reads (polled lists)                                                                   |

- Access lines carry `clientVersion` (the `X-Client-Version` header, `none` when missing or malformed).
- Structured fields first, a short constant message second: `req.log.info({ orderId, status }, 'Order status changed')`.
- Never log tokens, the secret key, passwords, or raw email/phone. Redaction (`REDACT_PATHS`) covers object keys
  only, never message strings.
- Log a failure once, at the boundary (`errorHandler`). Do not log and rethrow. Nothing above `debug` on polling
  paths or in loops.
- Details: `docs/LOGGING.md`.

## 20. Knowledge graph (graphify)

This project has a knowledge graph at `graphify-out/` with god nodes, community structure, and cross-file
relationships.

- For codebase questions, first run `graphify query "<question>"` when `graphify-out/graph.json` exists. Use
  `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return
  a scoped subgraph, usually much smaller than `GRAPH_REPORT.md` or raw grep output.
- If `graphify-out/wiki/index.md` exists, use it for broad navigation instead of raw source browsing.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review or when query/path/explain do not surface
  enough context.
- After modifying code, run `graphify update .` (AST-only, no API cost). The graph also refreshes automatically: the
  `Stop` hook runs `graphify update .` when source files are newer than the graph, and the git `post-commit` /
  `post-checkout` hooks (`graphify hook install`) refresh it on every commit and checkout.

## 21. Versioning and branches

**Branches.** Feature branches → PR into `dev` (`ci-ok` green before merging, by rule: GitHub Free enforces nothing;
`dev` deploys staging) → a release PR into `main`
(production, merged by the user) → a back-merge PR into `dev`. Hotfixes branch off `main` as `hotfix/*`, carry their
own intent, get their own release run and are back-merged the same way. Migrations are immutable once merged into
`dev`. Agents that compare against "the base" use the PR's base branch: `origin/dev` for features, `origin/main` for
hotfixes.

**PR size (STRICTLY ENFORCED).** Keep every PR reviewable: at most **25 changed files or 500 changed lines** against
its base (`git diff --shortstat origin/dev...HEAD`; `package-lock.json` and `server/src/types/database.ts` do not
count, tests and docs do), and one theme per PR. Plan a task that is bigger than that as steps, each its own PR. The
release PR (`release/*`, from `release.yml`) is exempt: it bundles work already reviewed in its own PRs.

- When a branch reaches either limit, or its theme is done: finish and verify the change in hand (the §13 gate,
  `/post-change` for a major change), commit, push, open the PR into the base, and tell the user it is ready.
- Then **stop**: start no other work, and do not poll CI or the PR. The user says when it is merged (or what to fix);
  only then branch fresh off the updated base for the next step.
- `.claude/hooks/major-change-gate.js` reminds once per branch when it passes the limit (`--status` prints the size).

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
