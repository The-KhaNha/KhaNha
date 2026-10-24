# Testing

Both packages use [Vitest](https://vitest.dev). The server drives the real Express app with Supertest against a real
Supabase database. The client runs unit tests in jsdom with Testing Library.

## Running

```bash
# server/ — needs the local Supabase stack running and seeded
cd server
npm run db:start          # once per boot (Docker)
npm run seed              # demo store, menu and test accounts
npm test                  # vitest run
npm run test:watch

# client/ — no backend needed
cd client
npm test
npm run test:watch
```

The full gate for a touched package is `npm run typecheck && npm run lint && npm test`.

## Where tests live

| Package | Location                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Environment      |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| server  | `server/test/**/*.test.ts`: `test/api/` one suite per router, `test/unit/` pure logic (schemas, serializers, errors, validate)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | node             |
| client  | next to the code: `src/**/<name>.test.ts(x)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | jsdom            |
| client  | `e2e/smoke.spec.ts` at 360×640, every `/api` call mocked, Vite reused or started by `playwright.config.ts`: the add-to-cart path, and on `/`, `/menu`, `/cart`, `/login`, `/register`, plus `/orders`, `/profile`, `/orders/:id` in every status and `/orders/:id/success` (customer) and `/staff` (staff) signed in with a mocked session (`signIn()`): one `<main>` landmark, every control at least 44px, and both at 320px wide (WCAG 1.4.10 reflow) and at 200% text (once the web font and one-shot animations settle) nothing past the screen edge (sideways scrollers exempt), no sideways page scroll, no button or link label running past its own edges and no text cut off by a clipping box without an ellipsis. `npm run e2e:chromium` (CI, every client PR) and `npm run e2e:webkit` (`browsers.yml`, weekly; `npm run e2e:install` once) | Chromium, WebKit |

- Server config: `server/vitest.config.mts`. Files run one at a time (`fileParallelism: false`), because the suites
  share one database. It sets `RATE_LIMIT_IP_MAX`, `RATE_LIMIT_WRITE_MAX` and `RATE_LIMIT_REGISTER_MAX` to `0`
  (off), since the suites fire hundreds of writes a minute as one user; the limiter itself is tested through its
  factory in `test/unit/rate-limit.safe.test.ts`.
- Client config: `client/vitest.config.ts`. It is separate from `vite.config.ts`, which refuses to load without a
  mode's Supabase env. The setup in `src/test/setup.ts` loads the jest-dom matchers and cleans up after each test.

## The test-target guard (server)

`server/test/setup/guard.ts` runs before any test file imports the app. It calls `resolveTestTarget()` from
`test/setup/target.ts`, which decides which Supabase project the run may touch:

| `TEST_TARGET`     | Allowed when                                                                                            | Suites that run       |
| ----------------- | ------------------------------------------------------------------------------------------------------- | --------------------- |
| `local` (default) | `APP_ENV=local` and `SUPABASE_URL` host is `127.0.0.1`/`localhost`                                      | every `*.test.ts`     |
| `staging`         | `ALLOW_STAGING_TESTS=1`, `APP_ENV=staging`, `TEST_STAGING_HOST` set, and `SUPABASE_URL` host matches it | only `*.safe.test.ts` |
| `production`      | never                                                                                                   | –                     |

If the guard throws, the whole run stops before a single request is made. `vitest.config.mts` loads `server/.env` before choosing which files to include, so the file filter and the guard always read the same `TEST_TARGET`. Production is never a test target.

## Destructive vs staging-safe suites

- A suite is **staging-safe** when it only reads shared data, or creates its own data and removes it in
  `afterAll`. Name the file `*.safe.test.ts`.
- Anything else (it calls `resetDemoData()`, changes shared stock or the store, or leaves orders behind) is
  **destructive**. Name it `*.test.ts`. Destructive suites run on local only.

## Helpers (`server/test/setup/helpers.ts`)

- `createTestUser(role?)` creates a confirmed user through the admin API, sets the role on the profile (the trigger
  always makes a CUSTOMER) and signs in. It returns `{ id, email, password, token }`. Send the token as
  `Authorization: Bearer <token>`.
- `deleteTestUser(user)` deletes the auth user; the profile goes with it through the cascade. Call it in `afterAll`.
- `testAuthMatrix(...)` runs the shared 401 cases (no header, malformed scheme, foreign JWT, deleted user) against a
  route; `foreignJwt()` makes a well-formed JWT with a random signature (fails JWKS verification like a foreign or tampered
  token); `deleteAccountByEmail(email)` removes an account a test
  registered.
- `resetDemoData()` runs `scripts/seed.ts`. That wipes every order through `reset_demo_orders` and restores the
  store, the menu (including stock) and the two demo accounts. It refuses to run unless the target is local.

### The per-file API server

`server/test/setup/api.ts`:

Every suite calls `api()` (a Supertest client), never `request(createApp())` directly:

- `request(createApp())` makes Supertest listen on every interface (`::`) but connect to `127.0.0.1`. On macOS,
  another local process already bound to `127.0.0.1` on that same random port wins the connection, so the test's
  request silently gets a stranger's reply — seen as a foreign 404 or an "Invalid authentication" body, roughly 1 run
  in 10.
- `test/setup/api.ts` instead starts one real server per test file, bound to `127.0.0.1` itself
  (`createApp().listen(0, '127.0.0.1')`), so there is nothing else it could connect to. `test/setup/guard.ts` calls
  `startApi()` in `beforeAll` and `stopApi()` in `afterAll`; a suite that calls `api()` before `guard.ts` has run
  gets a clear thrown error instead of a hang.
- All suites under `test/api/` use `api().get(...)` / `.post(...)` / etc.; none import `createApp()` or `supertest`
  directly.

### One run at a time (`server/test/setup/run-lock.ts`)

All test runs share the local Supabase database, and a destructive suite reseeds it (`resetDemoData()`), which wipes
every non-demo account — including a parallel run's test users, whose requests then fail with 401. A `globalSetup`
therefore takes a file lock (`<tmpdir>/food-pickup-server-tests.lock`) before any suite runs and releases it after;
a second concurrent `npm test` waits (up to 5 minutes) instead of corrupting the first run's data. A lock left behind
by a crashed run is detected (its pid is gone) and cleared automatically.

## Edge-case matrix for every endpoint

Each endpoint suite covers the rows that apply to it:

| Area           | Cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth           | no token, malformed `Authorization`, expired or foreign token, valid token whose profile was deleted → 401                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Role           | a customer on a staff route (e.g. `PATCH /api/orders/:id/status`) → 403; a customer or staff account on an admin route (`GET`/`PATCH /api/admin/settings`) → 403                                                                                                                                                                                                                                                                                                                                                            |
| Validation     | each zod bound (string lengths, 30 lines, qty 10, the `site_settings` limit bounds 1-200/1-500, duplicate lines merged), NUL bytes, wrong types, extra fields, empty or malformed body → 400; body too large → 413                                                                                                                                                                                                                                                                                                          |
| Not found      | a missing id, a non-uuid id, another user's order → 404 (never 403, so ids do not leak)                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Business rules | `INSUFFICIENT_STOCK` naming the item, `ITEM_UNAVAILABLE`, `STORE_CLOSED`, client prices ignored, the full 5×5 status-transition matrix, cancelling restores stock                                                                                                                                                                                                                                                                                                                                                           |
| Concurrency    | `Promise.all` race for the last unit of stock → exactly one order succeeds; concurrent status updates on one order                                                                                                                                                                                                                                                                                                                                                                                                          |
| Accounts       | `EMAIL_TAKEN`, password length bounds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Error envelope | every error is `{ error: { code, message, details? } }`, with no stack trace or SQL text                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Idempotency    | the same `idempotencyKey` twice → the same order, stock reserved once; two simultaneous requests with one key → one order; the same key from two users, or no key → two orders; the same key with a different cart, note or name → 409 `IDEMPOTENCY_KEY_REUSED` naming the placed order, stock untouched (also when the two race); a non-UUID key → 400; the key never appears in a response                                                                                                                                |
| Rate limits    | past the limit → 429 `RATE_LIMITED` in the envelope with `Retry-After` and `RateLimit-Policy` / `RateLimit`; per user (one account at its limit never blocks another from the same address); the flood limit counts a signed-in caller on their own while anonymous and forged-token requests share the address (`rate-limit-wiring.safe.test.ts`); a 429 log line carries `limiter` and `keyedBy` and the client never sees them; the address fallback and `X-Forwarded-For` behind a trusted proxy; `0` turns a limit off |
| Headers        | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and the CSP on a 200, a 404 and a 401; no HSTS over plain http; no `X-Powered-By`; the menu answers at most `MENU_ITEMS_MAX` items                                                                                                                                                                                                                                                                                                                           |
| Caching        | `Cache-Control: no-cache` + `Vary: Authorization` on an `/api` response, a bodiless 304 on a matching `If-None-Match`; the cached menu reflects a real order and its cancellation; saved `site_settings` are reflected by the next `GET /api/orders`/`GET /api/admin/settings`; `cached()` shares one load between concurrent misses, reloads after its TTL, never caches a rejected load, and `invalidate()` drops one key or all of them — see [API.md#caching](API.md#caching)                                           |

The response shapes in `server/src/types/api.ts` (`XDto`) and `client/src/types/api.ts` (`X`) are kept in sync by
hand. The `test-generator` agent compares them field by field, and endpoint tests assert the real response bodies
against them. `ErrorCode` exists only on the server (`server/src/utils/errors.ts`); the client treats
`ApiError.code` as a string.

A test that fails because of a real bug is a bug report. Never weaken the assertion to make it pass.

**Every fix ships with its guard** (CLAUDE.md §13): the test or check that fails if the same class of bug returns,
seen failing with the fix reverted. The guards added with the break-test fixes:

| Class of bug                                                                                             | Guard                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| user-typed data left in browser storage after sign-out                                                   | `client/src/lib/storageKeys.test.ts`: every `fp_` key classified; user-typed keys cleared by the auth store alone                                                                                                                                                                                                                                     |
| a reused idempotency key silently answering a different order                                            | `server/test/api/orders.test.ts` "idempotencyKey" (409, stock untouched, the race); `client/src/pages/Checkout.test.tsx` (new key, cart kept)                                                                                                                                                                                                         |
| an oversized body read to the end before its 413                                                         | `server/test/api/body-limit.safe.test.ts`; the `images` job's nginx 413 check                                                                                                                                                                                                                                                                         |
| layout past the screen, text cut off, or controls under 44px, at large text or 320px wide                | `client/e2e/smoke.spec.ts` (every client PR on Chromium, weekly on WebKit), `ui-verifier` L11, `/break` E1                                                                                                                                                                                                                                            |
| layout shift when the web font arrives late (CLS)                                                        | `client/e2e/smoke.spec.ts` "a late web font does not shift the layout" (Chromium; font CSS held until the fallback text is checked, CLS within `perf-budget.json` on `/`, `/menu`, `/orders/:id`, `/staff`, and the text drawn in a metric-matched fallback; skips on a laptop without Roboto, Arial or Liberation Sans, never in CI), `perf-auditor` |
| a top bar title cut to "Orde…", or a page 320px wide that scrolls sideways                               | `client/e2e/smoke.spec.ts` (h1 not ellipsized, 320px reflow)                                                                                                                                                                                                                                                                                          |
| the largest paint hidden in an entrance fade, so LCP reads seconds late                                  | `client/e2e/smoke.spec.ts` "the order page's largest paint is its hero"; `client/src/pages/Order.test.tsx` (no entrance on the first status)                                                                                                                                                                                                          |
| the page moving while it loads (a lazy fallback's margin, a header that wraps when its first data lands) | `client/e2e/smoke.spec.ts` "loading the page moves nothing" (`/login`, `/register`, `/staff` at 360, 390 and 412 px with the first poll held; CLS ≤ 0.01)                                                                                                                                                                                             |
| an Add tap re-rendering the whole menu, or the staff clock re-rendering the board                        | `client/src/menuRenders.test.tsx`; `client/src/pages/StaffDashboard.test.tsx`                                                                                                                                                                                                                                                                         |
| a keyframe that repaints (box-shadow) instead of using transform and opacity                             | `client/src/lib/designTokens.test.ts` "every keyframe animates only transform and opacity"                                                                                                                                                                                                                                                            |
| a form field edge below 3:1 (WCAG 1.4.11)                                                                | `client/src/components/Input.test.tsx` "draws an idle field edge in a 3:1 colour"                                                                                                                                                                                                                                                                     |
| the customer tabs showing on `/staff` or `/admin`                                                        | `client/src/App.test.tsx` "shell by route"                                                                                                                                                                                                                                                                                                            |
| a checkout's database reads running in series on a slow link                                             | `server/test/api/order-reads.test.ts` (reads in flight together)                                                                                                                                                                                                                                                                                      |
| a staff card's stale "unreachable" error                                                                 | `client/src/features/orders/staffBoardRules.test.ts`                                                                                                                                                                                                                                                                                                  |

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request into `dev`, `main` or a phase feature branch (`feat/P1`, CLAUDE.md
§21) and on every push to them; the push run on a phase branch catches two PRs that were each green alone but break
together once both are merged. Its aggregate
job `ci-ok` sums them up. On GitHub Free a private repository has no rulesets, so it is advisory: merge only when it
is green ([ADR-011](adr/011-free-tiers.md)). It fails when any job failed or was cancelled, and counts
skipped jobs as passed. The workflow has no `paths:` filter, so every PR reports `ci-ok`; inside it the `changes` job
(`dorny/paths-filter`) skips what a PR does not touch, to fit GitHub Free's 2,000 Actions minutes a month:

| Changed                                         | Jobs that run (besides `changes`, `repo`, `version-intent` on PRs, `ci-ok`) |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| `client/**`                                     | `client`, `images`                                                          |
| `server/**`, `client/src/config/fallbacks.json` | `server-static`, `server-tests`, `migrations` (PRs), `images`               |
| `compose.yaml`                                  | `images`                                                                    |
| `.github/workflows/ci.yml`, `.node-version`     | all of them                                                                 |
| only docs, plans, `scripts/**`, `.claude/**`    | none                                                                        |

Roughly: a docs-only PR costs 4–5 billed minutes a push, a client change about 12, a server change about 20 (most of it
`server-tests` starting Supabase). Each job is billed rounded up to a whole minute.

| Job                        | Runs                                                                                                                                                                                                                                                                                                                                                                            | Reproduce locally                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `client`                   | `npm ci`, typecheck, lint, `format:check`, test, `build:staging`, the bundle budget, then `scripts/ci/check-dist-secrets.mjs` over `dist/` (a Supabase secret key, a `service_role` JWT, a private key or a server-only env name in the built bundle fails), then `npm run e2e:chromium` (the smoke spec; failure screenshots as `chromium-smoke`)                              | `cd client && npm run build:staging && node ../scripts/ci/check-bundle.mjs . && node ../scripts/ci/check-dist-secrets.mjs .`     |
| `server-static`            | `npm ci --ignore-scripts`, typecheck, lint, `format:check`, build                                                                                                                                                                                                                                                                                                               | the same commands in `server/`                                                                                                   |
| `server-tests`             | `npm ci`, `db:start:ci` (Postgres, GoTrue, PostgREST, Kong only), `cp .env.example .env`, seed, `npm test`, then `db:types` must leave `src/types/database.ts` unchanged; `db:stop` always; 15-minute timeout                                                                                                                                                                   | `npm run db:start && npm run seed && npm test && npm run db:types && git diff --exit-code -- src/types/database.ts` in `server/` |
| `migrations` (PR only)     | `scripts/ci/check-migrations.mjs`: the PR may only add migrations, each with a 14-digit prefix newer than the base's newest; added files already on `main` (hotfix back-merges) are skipped                                                                                                                                                                                     | `node scripts/ci/check-migrations.mjs --base origin/dev`                                                                         |
| `changes`                  | which parts changed (`client`, `server`, `images`), for the jobs below                                                                                                                                                                                                                                                                                                          | –                                                                                                                                |
| `version-intent` (PR only) | `scripts/version/check.mjs`: a PR that changes package source adds a `.changes/*.md` intent (the `no-release` label skips it); a `release/*` PR into `main` has no intents left and versions above the latest tags                                                                                                                                                              | `npm run change:check`                                                                                                           |
| `repo`                     | root `npm ci`, `format:check` (`scripts/**`, `.github/**`, `plans/**`), `npm test` (`node --test` over `scripts/**/*.test.mjs`), `check:durations`, and on PRs gitleaks over the PR's own commits (`--log-opts origin/<base>..HEAD`)                                                                                                                                            | `npm run format:check && npm test` at the root                                                                                   |
| `images`                   | hadolint on both Dockerfiles; buildx builds of `fp-api` and `fp-web` (GitHub Actions cache, `GIT_COMMIT` = the SHA); smoke: `/api/health` with dummy Supabase env (and the commit in it), `/healthz` and `/runtime-env.js`, `X-Frame-Options` + `nosniff` on both, and nginx answering a 200 kB body with the JSON 413; size budgets 400 MB API, 100 MB web (printed to 0.1 MB) | `docker compose up --build web api`, or the `docker build` / `docker run` lines in DEPLOYMENT.md                                 |
| `ci-ok`                    | aggregates the jobs above                                                                                                                                                                                                                                                                                                                                                       | –                                                                                                                                |

The budgets live in `client/perf-budget.json` (CLAUDE.md §2b): `initialJsGzipKb` for the bundle, and `lcpMs`, `inpMs`,
`cls` for the web vitals, which the smoke reads and `scripts/ci/perf-budget.test.mjs` holds `client/lighthouserc.json` to. `scripts/ci/check-bundle.mjs`
reads `client/dist/.vite/manifest.json`, sums the entry chunk and its static imports at gzip level 9, prints a table
(lazy chunks listed for information) and exits 1 when over.

`server-tests` runs the whole server suite, destructive tests included, against a throwaway local stack. Expect 8–10
minutes for the workflow: the Supabase image pulls take 2–4 minutes and the tests 1–3. `db:start:ci`'s `-x` list names
the CLI's containers, which change between CLI versions (check `npx supabase start --help` after a CLI bump).

Dependabot (`.github/dependabot.yml`) opens weekly grouped minor/patch PRs into `dev` for both packages, GitHub
Actions and the Dockerfiles, labelled `dependencies` and `no-release`.

Validate a workflow change with `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest -color`.

`release.yml` is not a check: it opens the release PR (`workflow_dispatch`) and, after the merge into `main`, tags
the versions and opens the back-merge PR into `dev` (CLAUDE.md §21).

### Lighthouse (`perf.yml`)

On pushes to `dev` that touch `client/**` (one run per merged client PR) and on demand (`workflow_dispatch`, before
a release); informational. About 12 minutes a run, so it does not run on every PR push (ADR-011). It starts local Supabase
(`db:start:ci`, seed), brings up `docker compose up --wait web api`, runs `npx @lhci/cli autorun` in `client/` with
`client/lighthouserc.json` (`/` and `/menu`, 360×640, Slow 4G, 4× CPU, three runs; LCP, CLS and TBT budgets as
warnings) and uploads `client/lhci/` as the `lighthouse-report` artifact. Numbers: `docs/PERF_BASELINE.md`
"CI numbers".

### WebKit smoke (`browsers.yml`)

Weekly (Monday 03:30 UTC) and on demand; informational. Installs WebKit with its system libraries and runs
`npm run e2e:webkit` (`client/e2e/smoke.spec.ts`: home, menu, add to cart, cart at 360px, no sideways scroll,
clean console, every `/api` call mocked). Failure screenshots are uploaded as `webkit-smoke`. Locally,
`npm run e2e:chromium` runs the same spec on Chromium where WebKit cannot launch (WSL without its libraries).

### Security checks (`security.yml`)

Runs weekly (Monday 03:00 UTC), on demand, and on PRs that change a `package.json`, a lockfile or `.gitleaks.toml`.
Informational. A PR's own commits are scanned for secrets by `ci.yml`'s `repo` job on every PR.

| Job       | Runs                                                                                   | Reproduce locally                                                                                  |
| --------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `audit`   | `npm audit --omit=dev --audit-level=high` in `client/` and `server/` (only what ships) | the same command in each package                                                                   |
| `secrets` | the gitleaks binary over the full history, `--redact`, with `.gitleaks.toml`           | `docker run --rm -v "$PWD":/repo -w /repo zricethezav/gitleaks:v8.30.1 detect --source . --redact` |

`.gitleaks.toml` extends the default rules and allowlists by value only: Supabase publishable keys and the CLI's fixed
local secret in `server/.env.example`. A real key anywhere else, `.env.example` included, still fails. CodeQL is not run: it
needs GitHub Code Security, which a private repository on GitHub Free does not have (ADR-011).

### Break testing (`/break`)

Not a CI job: the `app-breaker` agent (`.claude/agents/app-breaker.md`) is run through `/break` before a release
and after a change to auth, orders, money or the request pipeline. Four groups (`security` at effort `xhigh`,
`data`, `flow`, `env`) attack the local servers with curl, throwaway scripts and the Playwright browser: secrets
in the built bundle and history, direct API calls logged out or as someone else, tampered prices and roles, floods
(the rate limits), stored script in names and notes, missing headers, a menu past `MENU_ITEMS_MAX`, long emoji
names, email capitalisation, empty forms, double submit with and without an `idempotencyKey`, refresh mid-form,
saves while offline, dead buttons, text at 200%, the WebKit smoke, time zones and a throttled golden path. Every
BREAK comes with a repro, evidence and a fix; what cannot be tested is listed as untested with the reason. Read-only
for source; the main session fixes and re-runs the failed group.

### Staging tests (later)

Not set up yet. When they are, a workflow sets `TEST_TARGET=staging`, `ALLOW_STAGING_TESTS=1`, `APP_ENV=staging`,
`TEST_STAGING_HOST` and the staging `SUPABASE_URL` / `SUPABASE_SECRET_KEY` from repository secrets, then runs
`npm test` in `server/`. The config then picks up `*.safe.test.ts` only.
