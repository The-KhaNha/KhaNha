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

| Package | Location                                                                                                                       | Environment |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| server  | `server/test/**/*.test.ts`: `test/api/` one suite per router, `test/unit/` pure logic (schemas, serializers, errors, validate) | node        |
| client  | next to the code: `src/**/<name>.test.ts(x)`                                                                                   | jsdom       |

- Server config: `server/vitest.config.mts`. Files run one at a time (`fileParallelism: false`), because the suites
  share one database.
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

| Area           | Cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth           | no token, malformed `Authorization`, expired or foreign token, valid token whose profile was deleted → 401                                                                                                                                                                                                                                                                                                                                                                        |
| Role           | a customer on a staff route (e.g. `PATCH /api/orders/:id/status`) → 403; a customer or staff account on an admin route (`GET`/`PATCH /api/admin/settings`) → 403                                                                                                                                                                                                                                                                                                                  |
| Validation     | each zod bound (string lengths, 30 lines, qty 10, the `site_settings` limit bounds 1-200/1-500, duplicate lines merged), NUL bytes, wrong types, extra fields, empty or malformed body → 400; body too large → 413                                                                                                                                                                                                                                                                |
| Not found      | a missing id, a non-uuid id, another user's order → 404 (never 403, so ids do not leak)                                                                                                                                                                                                                                                                                                                                                                                           |
| Business rules | `INSUFFICIENT_STOCK` naming the item, `ITEM_UNAVAILABLE`, `STORE_CLOSED`, client prices ignored, the full 5×5 status-transition matrix, cancelling restores stock                                                                                                                                                                                                                                                                                                                 |
| Concurrency    | `Promise.all` race for the last unit of stock → exactly one order succeeds; concurrent status updates on one order                                                                                                                                                                                                                                                                                                                                                                |
| Accounts       | `EMAIL_TAKEN`, password length bounds                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Error envelope | every error is `{ error: { code, message, details? } }`, with no stack trace or SQL text                                                                                                                                                                                                                                                                                                                                                                                          |
| Caching        | `Cache-Control: no-cache` + `Vary: Authorization` on an `/api` response, a bodiless 304 on a matching `If-None-Match`; the cached menu reflects a real order and its cancellation; saved `site_settings` are reflected by the next `GET /api/orders`/`GET /api/admin/settings`; `cached()` shares one load between concurrent misses, reloads after its TTL, never caches a rejected load, and `invalidate()` drops one key or all of them — see [API.md#caching](API.md#caching) |

The response shapes in `server/src/types/api.ts` (`XDto`) and `client/src/types/api.ts` (`X`) are kept in sync by
hand. The `test-generator` agent compares them field by field, and endpoint tests assert the real response bodies
against them. `ErrorCode` exists only on the server (`server/src/utils/errors.ts`); the client treats
`ApiError.code` as a string.

A test that fails because of a real bug is a bug report. Never weaken the assertion to make it pass.

## Staging later (GitHub Actions)

Not set up yet. When it is, a workflow sets `TEST_TARGET=staging`, `ALLOW_STAGING_TESTS=1`, `APP_ENV=staging`,
`TEST_STAGING_HOST` and the staging `SUPABASE_URL` / `SUPABASE_SECRET_KEY` from repository secrets, then runs
`npm test` in `server/`. The config then picks up `*.safe.test.ts` only.
