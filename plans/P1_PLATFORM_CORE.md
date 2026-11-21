# P1 — Platform core: implementation plan

The PR-by-PR plan for [ROADMAP.md P1](ROADMAP.md#p1--platform-core). The roadmap says what P1 builds and why; this
file says in which order, in which pull requests, with which files, tests, docs and checks, and where P1 deliberately
builds less than the roadmap describes (each with its reason and the phase that picks it up). When a PR merges, tick
its box here and in the roadmap.

> **Status: done** (10 November 2026). PRs 01–16 and 02b are merged into `feat/P1`, PR 16 last (#35). The closing
> `/break` run's fixes landed as three more PRs: order integrity (#36), client resilience (#37) and path-only request
> logs with a wider phone scrub (#38). Next is the phase PR `feat/P1` → `dev` (user decision of 9 November 2026:
> nothing reaches production until P8; P1 is tested on staging). Every
> [decision](#decisions) is answered, and ADR-001, 004, 005, 006, 008, 009 and 010 are accepted (001, 004, 006 and 009
> with amendments). One agent builds P1 on the `feat/P1` feature branch, one PR at a time, in the order below.

## How the team works P1

The P0 rules stand ([P0 plan](P0_FOUNDATIONS.md#how-the-team-works-p0), CLAUDE.md §13–§21), plus the PR size limit
that arrived after P0 and the phase feature branch:

- **Every P1 PR goes into `feat/P1`**, the phase feature branch (CLAUDE.md §21), which goes into `dev` as one PR when
  P1 is done. CI and CodeRabbit run on every PR into `feat/P1` and on every push to it.
- **At most 38 changed files or 750 changed lines per PR** against `origin/feat/P1` (`package-lock.json`,
  `server/src/types/database.ts` and docs do not count; tests do), one theme each. Every PR below carries a size
  estimate, written when docs still counted; one that grows past the limit splits at the seam its section names.
- **One agent, one PR at a time,** in the [build order](#build-order). Each PR branches as `feat/p1-<NN>-<slug>` from a
  fresh `origin/feat/P1`, is finished (gate, `/post-change`, intent, owning docs, its box ticked here), opened into
  `feat/P1` as `P1 PR <NN> — <title>`, and then the agent stops until the user says it merged.
- **Migrations and staging.** A new migration must be newer than the newest on `feat/P1`. Staging takes migrations from
  `feat/P1` only while P1 is open (`npm run db:push:staging` needs `supabase login` and the database password): staging
  already holds `feat/P1`'s migrations, so a push from `dev` would be refused. When `dev` moves (Dependabot, a hotfix
  back-merge), merge `dev` into `feat/P1` before the next PR, so a migration on `dev` never lands out of order.
- **`/before-write` first** for every new table, function, endpoint, module or component, with the verdict in the PR
  description. The expected verdicts are noted per PR; a different verdict changes the PR, not the other way round.
- **Every bug fix ships with its guard** (CLAUDE.md §13): each PR names the test that fails without it.

## Where P1 starts

P0 already shipped parts of P1. The plan builds on them instead of rebuilding them.

| Roadmap step     | Already in the code                                                                                                                                                                                                                                           | Left for P1                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| P1.1 error codes | `AppError.details` is a union of three untagged shapes (item, replayed order, field), duplicated in `errorHandler.ts`; the client mirrors it as one flat `ApiErrorDetails`                                                                                    | one exported `ErrorDetails` union, and a `kind` tag on every new shape   |
| P1.2 jobs        | nothing; `compose.yaml` has a commented `worker` placeholder; ADR-002 verified pgmq 1.5.1 and pg_cron 1.6.4 on the local stack and on every Supabase plan                                                                                                     | all of it                                                                |
| P1.3 audit       | `site_settings.updated_by`; `update_order_status` does not know which staff member acted                                                                                                                                                                      | all of it                                                                |
| P1.4 idempotency | `POST /api/orders` takes `idempotencyKey` in the body (`checkoutDraftStore` keeps one per attempt); `place_order` takes an advisory lock and `orders (user_id, idempotency_key)` is unique; a changed cart under the same key is 409 `IDEMPOTENCY_KEY_REUSED` | a staff status change that is retried after a lost answer gets 409 today |
| P1.5 snapshots   | `order_items` snapshots `name` and `unit_price`; `selectOrders()` joins `menu_items (image_url)` and `stores (id, name)` live                                                                                                                                 | the photo and store name                                                 |
| P1.6 rate limits | `middleware/rateLimit.ts` (`express-rate-limit`, fixed windows): flood (600/min per user or IP), write (30/min per user), register (10/min per IP), sizes from `RATE_LIMIT_*` env; 429 with `Retry-After` and draft-7 headers; `trust proxy` from env         | the details kind, one `warn` per burst, client error reporting           |
| P1.7 flags       | `ConfigDto.features` exists and is always `{}`                                                                                                                                                                                                                | all of it                                                                |
| ADR-004 money    | every amount is whole rupees in an `integer` column (`menu_items.price`, `orders.total`, `order_items.unit_price`, `order_items.line_total`)                                                                                                                  | paise columns in the database, rupees only at the API (PR 09, PR 16)     |
| ADR-011          | the 7-day idle sign-out is enforced by the client only (`sessionActivity.ts`); ADR-011 names a server check as "a follow-up for P1"                                                                                                                           | the server check (PR 15)                                                 |

## Build order

| #   | PR                                                                         | Step       | Depends on                                   | Size (files / lines) |
| --- | -------------------------------------------------------------------------- | ---------- | -------------------------------------------- | -------------------- |
| 01  | The 429 contract and one error-details union                               | P1.1, P1.6 | –                                            | 8 / 180              |
| 02  | Outbox schema: events, subscriptions, the first schedule                   | P1.2       | –                                            | 11 / 470             |
| 02b | Queue wrappers and dead letters                                            | P1.2       | 02                                           | 6 / 300              |
| 03  | The job runner                                                             | P1.2       | 02b                                          | 9 / 450              |
| 04  | The worker process                                                         | P1.2       | 03                                           | 14 / 300             |
| 05  | Today's transitions emit events and carry their actor; retry-safe statuses | P1.2, P1.4 | 03                                           | 10 / 490             |
| 06  | Audit log                                                                  | P1.3       | 05                                           | 7 / 380              |
| 07  | `GET /api/admin/audit`                                                     | P1.3       | 06                                           | 12 / 400             |
| 08  | Order snapshots v2                                                         | P1.5       | 05                                           | 9 / 300              |
| 09  | Money in paise: expand                                                     | ADR-004    | 08                                           | 14 / 420             |
| 10  | `POST /api/client-errors`                                                  | P1.6       | 01                                           | 13 / 380             |
| 11  | `client_error_sample_percent` through to `/api/config`                     | P1.6       | 10                                           | 16 / 250             |
| 12  | The error reporter, and render errors told apart from chunk failures       | P1.6       | 11                                           | 11 / 420             |
| 13  | Feature flags: table, evaluation, the admin flip                           | P1.7       | 06                                           | 16 / 470             |
| 14  | Client-visible flags in `/api/config`                                      | P1.7       | 13                                           | 6 / 150              |
| 15  | Server-side idle sign-out                                                  | ADR-011    | 02                                           | 9 / 380              |
| 16  | Money in paise: contract                                                   | ADR-004    | 09; last into `feat/P1`, before the phase PR | 7 / 220              |

The table gives the dependency order; every PR in it is merged. PR 16 also went into `feat/P1`, as its last
implementation PR before the phase PR into `dev` (user decision of 9 November 2026: nothing reaches production until P8, so no production API still reads the rupee columns).

Why this order: the 429 contract first because it is small and every later 429 (P5, P6, P7 buckets) inherits it; the
outbox schema before the runner and the runner before the process, so each lands testable on its own; today's
transitions are rewritten **once** (PR 05) to set the actor, the request id and the events together, so the audit
trigger (PR 06) needs no further rewrite; snapshots (PR 08) and paise (PR 09) each build on the previous
`place_order`; the money move lands in P1 so P2's store templates and P3's menu editing are built on paise from the
start, while the data is smallest; flags after audit so the flag table ships with its audit trigger; the idle check
needs only pg_cron from PR 02.

## Cross-cutting decisions

- **Transitions own their side effects.** Every SQL transition function takes `p_actor jsonb` and `p_request_id text`,
  sets them for the transaction with `set_config('app.actor', …, true)` and `set_config('app.request_id', …, true)`,
  and calls `emit_event` before returning. The audit trigger and the outbox read the same actor, and the state change,
  its events and its audit rows commit together or not at all.
- **The worker reaches Postgres the way the API does:** RPCs through supabase-js with the secret key. No `pg`
  dependency, no database password in env, no second access path to secure. Long polls stay under PostgREST's
  statement timeout.
- **Free-tier budget** ([ADR-011](../docs/adr/011-free-tiers.md): 500 MB, shared CPU). Event payloads carry ids and
  statuses, never the whole order and never an amount; handled messages are deleted, not archived; `domain_events`
  keeps 30 days (D6); a queue is created with its first consumer, not ahead of it.
- **Money is paise in the database, rupees at the API** ([ADR-004](../docs/adr/004-rupees-and-paise.md)). Only
  `server/src/utils/money.ts` converts; `place_order` prices lines from `menu_items` itself.
- **Time is a parameter.** Every time-based SQL function takes `p_now timestamptz default now()`; the runner takes its
  clock and random source as arguments. No test sleeps past a few seconds or back-dates rows.
- **One test runner.** SQL functions are tested through RPCs in Vitest against local Supabase, the harness CI already
  runs. No pgTAP: a second runner and CI step would test the same functions through a different door.
- **No `min_client_version` bump in P1.** Every API change is additive: a `kind` on new error details, new config
  fields, new endpoints, and a 200 where a repeated status change answered 409. The money move keeps every rupee field
  the client reads.

## Where P1 builds less than the roadmap

Approved with the plan. The roadmap's P1 section is updated to match in PR 01 (the code is the truth, CLAUDE.md
preamble).

| Roadmap says                                                                                                 | P1 does                                                                                                                                                                                                    | Picked up by                                            |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| P1.1 "`details` can only be `ItemErrorDetails`"; tag every shape with `kind`                                 | three shapes exist already and stay untagged (the deployed client reads them); new shapes carry `kind`; the client narrows on `kind` for new shapes and on `code` for old ones                             | –                                                       |
| P1.2 seven queues created up front                                                                           | `q_notifications` only, the one with a consumer                                                                                                                                                            | each consumer's phase                                   |
| P1.2 `event_handled` table                                                                                   | not built (the roadmap calls it an optimisation); handlers are idempotent by natural keys                                                                                                                  | the first handler that measures a need                  |
| P1.2 metrics (counts, durations, depth)                                                                      | duration on each job log line; depth and oldest-message age in the worker's `/health` JSON                                                                                                                 | P8.7 (observability stack)                              |
| P1.2 `WORKER_CONCURRENCY_<QUEUE>` env                                                                        | a `concurrency` field per handler                                                                                                                                                                          | the first queue that needs tuning per environment       |
| P1.2 `order.status_changed`                                                                                  | the A5 names: `order.placed`, `order.preparing`, `order.ready`, `order.collected`, `order.cancelled` (P6.3 subscribes to `order.ready`)                                                                    | –                                                       |
| P1.3 `GET /api/stores/:storeId/audit`                                                                        | not built: it needs store memberships                                                                                                                                                                      | P2.2                                                    |
| P1.3 triggers on `store_settings`, `catalog_items`, `store_memberships`, policies, payouts                   | triggers on the tables that exist (`site_settings`, `orders.status`, `profiles.role`, `menu_items` name, price, availability, photo, category; `feature_flags` in PR 13)                                   | each table's own phase adds its trigger                 |
| P1.3 audit "stock changes"                                                                                   | not by trigger: `place_order` moves stock on every order, which would write an audit row per order. Manual stock edits arrive with their audited RPC                                                       | P3.5                                                    |
| P1.3 13-month retention, partitions                                                                          | no job yet (the first row expires in 13 months)                                                                                                                                                            | P9.5 launch checklist                                   |
| P1.4 `idempotency_keys` table, `idempotent(scope)` middleware, `Idempotency-Key` header                      | not built (D4): the only creating write, `POST /api/orders`, is already idempotent through `orders.idempotency_key`; the routes the roadmap lists (checkout, payment confirm, refunds, reviews) come later | P5.3, with `POST /api/checkout`, its first consumer     |
| A3 `IDEMPOTENCY_KEY_REUSED` is 422                                                                           | stays **409**, as shipped (error codes and statuses stay stable, CLAUDE.md §2)                                                                                                                             | –                                                       |
| P1.5 `store_slug`, `currency`, `subtotal`, `discount_total`, `base_unit_price`, `deal_id`, `catalog_item_id` | not added: nothing gives them a value yet (no slug, one currency, no deals)                                                                                                                                | P2.1, P3.6, P5                                          |
| P1.5 `menu_items.archived_at`                                                                                | not added: no endpoint deletes a menu item, and the `order_items` foreign key already blocks a delete                                                                                                      | P3.4, the first delete path                             |
| P1.6 `rate-limiter-flexible` token buckets                                                                   | keep `express-rate-limit` (D1, ADR-009 as amended)                                                                                                                                                         | ADR-009's own trigger: a third API instance needs Redis |
| P1.6 every limit a site setting                                                                              | limits stay deployment env (`docs/CONFIGURATION.md` classifies them so); only the error sample rate is a site setting                                                                                      | –                                                       |
| P1.6 fail open for reads, closed for money when the store is down                                            | not applicable: an in-memory store cannot be unreachable                                                                                                                                                   | with the Redis store                                    |
| P1.6 buckets for payment confirm, pickup codes, reviews; `max_active_checkouts_per_user`                     | not built: those routes do not exist; each lands with `createRateLimiter` and its feature                                                                                                                  | P5.2, P5.3, P6.2, P7.5                                  |
| P1.7 `GET /api/me/config`                                                                                    | not built: `/api/config` serves only client-visible flags without targeting rules                                                                                                                          | the first client-visible flag targeted by role or user  |
| P1.7 flags edited through SQL until P7.4                                                                     | `PATCH /api/admin/flags/:key` (ADMIN), so the audit row names who flipped a flag (a SQL editor session has no app user)                                                                                    | the flags page in P7.4                                  |
| –                                                                                                            | **added:** the server-side idle sign-out ADR-011 left for P1 (D3)                                                                                                                                          | –                                                       |
| P5.1 money in paise for payments only (ADR-004 as proposed)                                                  | **added:** every money column moves to paise (ADR-004 as amended), in two PRs                                                                                                                              | –                                                       |

## The pull requests

Merged pull requests are collapsed to a summary and links; their full specifications are in this file's git history.

### PR 01 — The 429 contract and one error-details union (P1.1, P1.6)

- [x] Merged

The 429 body now carries `retryAfterSeconds` (equal to `Retry-After`) in a `kind: 'rateLimit'` details shape, and every error's `details` is one typed union; a burst of refusals logs one `warn` per key per window (#7).

Now documented in: [docs/API.md "Error details"](../docs/API.md#error-details); [docs/LOGGING.md "Levels"](../docs/LOGGING.md#levels).

### PR 02 — Outbox schema: events, subscriptions, the first schedule (P1.2)

- [x] Merged

The outbox: `domain_events`, `event_subscriptions`, `emit_event`, the nightly purge, `pgmq` and `pg_cron`, and the lockdown test that every later migration is held to (#4).

Now documented in: [docs/JOBS.md "The outbox"](../docs/JOBS.md#the-outbox); [docs/JOBS.md "Schedules"](../docs/JOBS.md#schedules); [docs/SCHEMA.md "domain_events"](../docs/SCHEMA.md#domain_events); [docs/SCHEMA.md "emit_event"](../docs/SCHEMA.md#emit_event).

### PR 02b — Queue wrappers and dead letters (P1.2)

- [x] Merged

`job_failures` and the `security definer` queue wrappers the worker reaches `pgmq` through (#5).

Now documented in: [docs/SCHEMA.md "job_failures"](../docs/SCHEMA.md#job_failures); [docs/SCHEMA.md "Queue wrappers"](../docs/SCHEMA.md#queue-wrappers); [docs/JOBS.md "Queues and subscriptions"](../docs/JOBS.md#queues-and-subscriptions).

### PR 03 — The job runner (P1.2)

- [x] Merged

The job runner: handler contract, retry with backoff, dead letters and graceful abort, with `q_notifications`' first handler (#12).

Now documented in: [docs/JOBS.md "Handlers and the runner"](../docs/JOBS.md#handlers-and-the-runner); [docs/LOGGING.md "Jobs"](../docs/LOGGING.md#jobs); [docs/BACKEND_STRUCTURE.md "jobs/"](../docs/BACKEND_STRUCTURE.md#jobs).

### PR 04 — The worker process (P1.2)

- [x] Merged

The worker process ([ADR-005](../docs/adr/005-modular-monolith-three-processes.md)): one `runQueue` per handler, a `/health` endpoint on `WORKER_HEALTH_PORT`, shared graceful shutdown, no database connection held while idle (#14).

Now documented in: [docs/JOBS.md "The worker process"](../docs/JOBS.md#the-worker-process); [docs/LOGGING.md "The worker process"](../docs/LOGGING.md#the-worker-process); [docs/BACKEND_STRUCTURE.md "jobs/"](../docs/BACKEND_STRUCTURE.md#jobs).

### PR 05 — Today's transitions emit events and carry their actor; retry-safe statuses (P1.2, P1.4)

- [x] Merged

`place_order` and `update_order_status` take the actor and request id and emit the order events in their transaction; a repeated staff transition answers 200 and changes nothing (#15).

Now documented in: [docs/JOBS.md "Order events"](../docs/JOBS.md#order-events); [docs/SCHEMA.md "update_order_status"](../docs/SCHEMA.md#update_order_status); [docs/SCHEMA.md "place_order"](../docs/SCHEMA.md#place_order); [docs/ARCHITECTURE.md "8.3 Inside update_order_status"](../docs/ARCHITECTURE.md#83-inside-update_order_status-and-two-staff-pressing-at-once).

### PR 06 — Audit log (P1.3)

- [x] Merged

The append-only `audit_log` and the `audit_row_change()` trigger on the audited tables; the actor comes from `app.actor` or the `x-actor` headers, else `SYSTEM` (#17).

Now documented in: [docs/SCHEMA.md "audit_log"](../docs/SCHEMA.md#audit_log); [docs/SCHEMA.md "audit_row_change"](../docs/SCHEMA.md#audit_row_change).

### PR 07 — `GET /api/admin/audit` (P1.3)

- [x] Merged

`GET /api/admin/audit`: a keyset-paged, filterable, `no-store` read of the audit log for admins (#19).

Now documented in: [docs/API.md "GET /admin/audit"](../docs/API.md#get-adminaudit); [docs/SCHEMA.md "audit_log"](../docs/SCHEMA.md#audit_log).

### PR 08 — Order snapshots v2 (P1.5)

- [x] Merged

Orders snapshot the item photo, item category and store name at order time, so a later menu or store edit never changes a past order, and the polled order read drops two joins (#20).

Now documented in: [docs/SCHEMA.md "orders"](../docs/SCHEMA.md#orders); [docs/SCHEMA.md "order_items"](../docs/SCHEMA.md#order_items); [docs/API.md "GET /orders"](../docs/API.md#get-orders).

### PR 09 — Money in paise: expand (ADR-004)

- [x] Merged

The expand step of [ADR-004](../docs/adr/004-rupees-and-paise.md): paise columns beside the rupee ones, `place_order` pricing every line from `menu_items.price_paise`, an expected-price check that refuses a stale price with 409 `PRICE_CHANGED`, and `utils/money.ts` as the only converter (#27, with the checkout half in #29).

Now documented in: [docs/SCHEMA.md "place_order"](../docs/SCHEMA.md#place_order); [docs/ARCHITECTURE.md "6.2 Inside place_order"](../docs/ARCHITECTURE.md#62-inside-place_order); [docs/API.md "POST /orders"](../docs/API.md#post-orders); [docs/BACKEND_STRUCTURE.md "utils/"](../docs/BACKEND_STRUCTURE.md#utils).

### PR 10 — `POST /api/client-errors` (P1.6)

- [x] Merged

`POST /api/client-errors`: scrubbed, bounded browser error reports, rate limited per address and mounted before the client-version gate, logged as `warn` (#21).

Now documented in: [docs/API.md "POST /client-errors"](../docs/API.md#post-client-errors); [docs/LOGGING.md "Client error reports"](../docs/LOGGING.md#client-error-reports).

### PR 11 — `client_error_sample_percent` through to `/api/config` (P1.6)

- [x] Merged

The `client_error_sample_percent` site setting, carried through the admin form to `GET /api/config` as `clientErrors.samplePercent` (#25).

Now documented in: [docs/API.md "GET /config"](../docs/API.md#get-config); [docs/SCHEMA.md "site_settings"](../docs/SCHEMA.md#site_settings).

### PR 12 — The error reporter, and render errors told apart from chunk failures (P1.6)

- [x] Merged

The browser error reporter and `PageBoundary` scopes: a crash is reported and shown as "Something went wrong", while a failed chunk keeps the "couldn't reach the server" copy, and a crash in the shell no longer blanks the page (#30).

Now documented in: [docs/LOGGING.md "Client error reports"](../docs/LOGGING.md#client-error-reports); [docs/COMPONENTS.md "Layout and navigation"](../docs/COMPONENTS.md#layout-and-navigation); [docs/FRONTEND_STRUCTURE.md](../docs/FRONTEND_STRUCTURE.md).

### PR 13 — Feature flags: table, evaluation, the admin flip (P1.7)

- [x] Merged

Feature flags: the `feature_flags` table, pure evaluation (`enabled`, stores, roles, stable percentage), the cached read and `PATCH /api/admin/flags/:key`, which audits who flipped a flag (#22).

Now documented in: [docs/API.md "PATCH /admin/flags/:key"](../docs/API.md#patch-adminflagskey); [docs/SCHEMA.md "feature_flags"](../docs/SCHEMA.md#feature_flags); [docs/CONFIGURATION.md "Feature flags"](../docs/CONFIGURATION.md#feature-flags).

### PR 14 — Client-visible flags in `/api/config` (P1.7)

- [x] Merged

`GET /api/config` serves every client-visible, untargeted flag in `features`, failing closed to `{}` when the flags read fails (#26).

Now documented in: [docs/API.md "GET /config"](../docs/API.md#get-config); [docs/LOGGING.md "Levels"](../docs/LOGGING.md#levels).

### PR 15 — Server-side idle sign-out (ADR-011 follow-up)

- [x] Merged

Server-side idle sign-out ([ADR-011](../docs/adr/011-free-tiers.md) follow-up): `session_activity` and `touch_session`, a per-process throttle in `requireAuth`, a 401 and revoke for an idle or no-longer-live session, and a purge by session end (#24).

Now documented in: [docs/API.md "Authentication"](../docs/API.md#authentication); [docs/PERMISSIONS.md "Session lifetime"](../docs/PERMISSIONS.md#session-lifetime); [docs/DEPLOYMENT.md "Hosted session timeout"](../docs/DEPLOYMENT.md#hosted-session-timeout); [docs/SCHEMA.md "touch_session"](../docs/SCHEMA.md#touch_session); [docs/SCHEMA.md "purge_session_activity"](../docs/SCHEMA.md#purge_session_activity).

### PR 16 — Money in paise: contract (ADR-004)

- [x] Merged

The contract step of ADR-004: `place_order` stops writing rupees, the sync trigger and the rupee columns are dropped, and the seed writes paise only (#35).

Now documented in: [docs/SCHEMA.md "Migrations"](../docs/SCHEMA.md#migrations); [ADR-004](../docs/adr/004-rupees-and-paise.md).

## CLAUDE.md edits, aggregated

| Section | Change                                                                                                                                                                                       | PR             |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| §2c     | feature flags are read through `cached()` and invalidated by the flip                                                                                                                        | 13             |
| §3      | `dev:worker`, `start:worker`                                                                                                                                                                 | 04             |
| §4      | `jobs/` and the `worker.ts` entry point                                                                                                                                                      | 04             |
| §6      | the `docs/JOBS.md` row (queues, subscriptions, schedules, handlers, retry policy, runbook)                                                                                                   | 02             |
| §9      | uploads go to S3 (ADR-006), with the `MEDIA_STORAGE=local` development fallback                                                                                                              | done           |
| §10     | transitions set `app.actor` / `app.request_id` and call `emit_event`; audited tables are written through an RPC or carry `updated_by`; money is paise in the database; the server idle check | 05, 06, 09, 15 |
| §14     | the lifecycle walk checks `domain_events` and `audit_log`; a repeated transition is 200                                                                                                      | 05, 06         |
| §17     | major-change paths `server/src/jobs/` and `server/src/worker.ts`, in step with `major-change-gate.js`                                                                                        | 04             |
| §18     | the worker is a long-running process; `start.sh` starts it; probe `:8001/health`                                                                                                             | 04             |
| §19     | job log fields and levels; 429 `warn` once per key per window; client error reports are `warn` `Client error`                                                                                | 01, 03, 10     |

## Decisions

Answered by the user on 24 October 2026.

| #   | Decision                                                                                | Answer                                                                                                                                                                  | Applies to |
| --- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| D1  | Rate limiter: keep `express-rate-limit`, or move to `rate-limiter-flexible` now         | keep it; ADR-009 accepted with that amendment (`rate-limiter-flexible` arrives with the Redis store)                                                                    | PR 01      |
| D2  | A staff status change repeated after a lost answer: 200 with the order, or 409 as today | 200; other invalid transitions stay 409                                                                                                                                 | PR 05      |
| D3  | The server-side idle sign-out in P1                                                     | yes, keyed per session                                                                                                                                                  | PR 15      |
| D4  | The generic idempotency table and middleware                                            | built in P5.3 with `POST /api/checkout`, its first consumer                                                                                                             | P5.3       |
| D5  | Error tracking: self-reported or Sentry (roadmap decision 8)                            | self-reported in P1; Sentry later as a low-priority roadmap item (P10.4)                                                                                                | PR 10–12   |
| D6  | How long `domain_events` are kept                                                       | 30 days; the audit log is the long-term record                                                                                                                          | PR 02      |
| D7  | ADR-005 (three processes)                                                               | accepted as written                                                                                                                                                     | PR 04      |
| D8  | When money moves to paise (ADR-004 as amended)                                          | in P1, right after the snapshots: expand in PR 09, contract in PR 16, into `feat/P1` before the phase PR (amended 9 November 2026: nothing reaches production until P8) | PR 09, 16  |
| D9  | Who builds P1, and where                                                                | one agent, PR by PR, each into the `feat/P1` feature branch, which goes into `dev` at the end (two parallel lanes until 1 November 2026)                                | all        |

## Closing P1

Once every box is ticked (PR 16 included, since 9 November 2026): on a fresh `origin/feat/P1`, the gate in both packages, `npm run e2e:chromium`
and `/break` (P1 changes auth, orders, money and the request pipeline), with fixes as normal PRs into `feat/P1`. Then
the PR `feat/P1` → `dev` ("P1 — platform core", exempt from the size limit, linking the plan's PRs); the user merges
it. No release into `main` and no production migration until P8 (D8 as amended 9 November 2026): P1 is tested on
staging.

## User steps (cannot be done from the repository)

- Merge PR 00 into `dev` (the docs PR needs an exemption from the size limit), then create `feat/P1` from `dev`.
- Merge each PR into `feat/P1`, merge `dev` into `feat/P1` when `dev` has moved, push `feat/P1`'s migrations to
  staging (`npm run db:push:staging`), and merge `feat/P1` into `dev` when P1 is done ([closing P1](#closing-p1)).
  PR 16's contract migration is the exception: push it to staging only once `feat/P1` is in `dev` and staging runs
  that API ([PR 16](#pr-16--money-in-paise-contract-adr-004)).
- At P8, when P1 first reaches `main` (not before, D8): `npm run db:push:production` (user only), then check that
  pgmq and pg_cron show under the production project's Integrations.
- Run the worker wherever the API runs. Until P8.4 there is no hosted API, so on staging `q_notifications` fills
  while no worker runs; `docs/JOBS.md` has the purge command.
- Flip flags in production with `PATCH /api/admin/flags/:key` and an admin token, so the audit names you.

## Risks and gotchas

- **Waiting in the database holds a connection.** PR 03's long-poll held a PostgREST connection per queue per replica,
  and the roadmap's seven queues would have taken most of a pool of about 10 that the API shares. PR 04 replaced it:
  quick `pgmq.read` calls, and a 2 s wait in the worker when a queue is empty. Do not bring the long-poll back;
  LISTEN/NOTIFY on a direct connection is the upgrade if a consumer needs sub-second pickup.
- **Redefining a transition function.** A new parameter needs drop + create and the grants again (the idempotency
  migration's pattern); `create or replace` with the same signature keeps them. PRs 05, 08, 09 and 16 all touch
  `place_order`: each body starts from the previously merged body, never from an older copy.
- **The paise expand window.** Between PR 09's migration and the new API reaching every environment, the old API
  still passes rupee prices in `p_lines` (no `unit_price_paise`, so no price check) and writes `menu_items.price`
  alone; `place_order` ignores those prices and prices from `menu_items.price_paise`, and `menu_items_sync_price`
  keeps the two columns in step. PR 16 must not run anywhere an older API is deployed; it lands in `feat/P1` with PR 09's API (user decision of 9 November 2026: nothing reaches production until P8).
- **Visibility timeout shorter than a slow handler** means a second delivery while the first still runs. Handlers are
  idempotent anyway; set each timeout to at least twice its slowest expected run.
- **pg_cron on Supabase:** at most 8 concurrent jobs of at most 10 minutes; schedules are UTC; a paused staging
  project runs none and its queues wait.
- **500 MB database.** Watch `pg_total_relation_size` of `domain_events`, `audit_log` and the queue tables weekly
  during the pilot (the `docs/JOBS.md` runbook); lean payloads and the 30-day retention are the first levers.
- **Audit actor fallback.** A direct table write with neither `app.actor` nor `updated_by` is recorded as `SYSTEM`.
  PR 06's test pins which write gets which actor, so a new writer that forgets the actor fails a test.
- **Stock drain under simulated payment.** One account can reserve stock at 30 orders a minute today. P5.2's holds
  and real payment close it; if it bites first, a per-user active-order cap inside `place_order` (ADR-009's
  database layer) is the fix.
- **`keepalive` requests are capped at 64 KB in flight;** five 4 KB reports fit.
- **Hosted privileges.** Revoking `update` from `service_role` must hold on hosted Supabase as it does locally; PR 06
  verifies it on staging.

## Doc fixes outside P1

- `plans/ROADMAP.md` P2 and P3.1 still describe a live brand catalog with per-store overrides and brand-scoped
  memberships; ADR-001 (as amended) replaces that with brand templates, per-store memberships and the brand owner.
  Rewrite them before P2 is planned.
- `plans/ROADMAP.md` data model, P5.1 and P5.6: money columns follow ADR-004 as amended (paise everywhere in the
  database).
- `plans/P0_FOUNDATIONS.md`: the status line still says "nothing built yet" and no box is ticked, though P0 merged
  in #2.
