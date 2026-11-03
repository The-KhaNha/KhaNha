# P1 — Platform core: implementation plan

The PR-by-PR plan for [ROADMAP.md P1](ROADMAP.md#p1--platform-core). The roadmap says what P1 builds and why; this
file says in which order, in which pull requests, with which files, tests, docs and checks, and where P1 deliberately
builds less than the roadmap describes (each with its reason and the phase that picks it up). When a PR merges, tick
its box here and in the roadmap.

> **Status: in progress** (1 November 2026). PRs 02 and 02b are merged into `feat/P1`; next is PR 01. Every
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
  `feat/P1` as "P1 PR <NN> — <title>", and then the agent stops until the user says it merged.
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

| #   | PR                                                                         | Step       | Depends on                                      | Size (files / lines) |
| --- | -------------------------------------------------------------------------- | ---------- | ----------------------------------------------- | -------------------- |
| 01  | The 429 contract and one error-details union                               | P1.1, P1.6 | –                                               | 8 / 180              |
| 02  | Outbox schema: events, subscriptions, the first schedule                   | P1.2       | –                                               | 11 / 470             |
| 02b | Queue wrappers and dead letters                                            | P1.2       | 02                                              | 6 / 300              |
| 03  | The job runner                                                             | P1.2       | 02b                                             | 9 / 450              |
| 04  | The worker process                                                         | P1.2       | 03                                              | 14 / 300             |
| 05  | Today's transitions emit events and carry their actor; retry-safe statuses | P1.2, P1.4 | 03                                              | 10 / 490             |
| 06  | Audit log                                                                  | P1.3       | 05                                              | 7 / 380              |
| 07  | `GET /api/admin/audit`                                                     | P1.3       | 06                                              | 12 / 400             |
| 08  | Order snapshots v2                                                         | P1.5       | 05                                              | 9 / 300              |
| 09  | Money in paise: expand                                                     | ADR-004    | 08                                              | 14 / 420             |
| 10  | `POST /api/client-errors`                                                  | P1.6       | 01                                              | 13 / 380             |
| 11  | `client_error_sample_percent` through to `/api/config`                     | P1.6       | 10                                              | 16 / 250             |
| 12  | The error reporter, and render errors told apart from chunk failures       | P1.6       | 11                                              | 11 / 420             |
| 13  | Feature flags: table, evaluation, the admin flip                           | P1.7       | 06                                              | 16 / 470             |
| 14  | Client-visible flags in `/api/config`                                      | P1.7       | 13                                              | 6 / 150              |
| 15  | Server-side idle sign-out                                                  | ADR-011    | 02                                              | 9 / 380              |
| 16  | Money in paise: contract                                                   | ADR-004    | P1 merged into `dev` and released to production | 7 / 220              |

The PRs are built in the table's order: 01, then 03 to 15 (02 and 02b are merged). PR 16 is not part of `feat/P1`: it
goes into `dev` once the release containing P1 runs in production.

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

### PR 01 — The 429 contract and one error-details union (P1.1, P1.6)

- [x] Merged

| File                                    | Change                                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/utils/errors.ts`            | `export type ErrorDetails = ItemErrorDetails \| ReplayedOrderDetails \| FieldErrorDetails \| RateLimitDetails`; `RateLimitDetails = { kind: 'rateLimit'; retryAfterSeconds: number }`; `AppError.details?: ErrorDetails`; `rateLimited()` takes the seconds and whether this is the first refusal in the window |
| `server/src/middleware/errorHandler.ts` | `ErrorDescription.details?: ErrorDetails` (the duplicated union goes); a 429 logs `warn` for the first refusal per key per window and `debug` after it                                                                                                                                                          |
| `server/src/middleware/rateLimit.ts`    | the handler passes the seconds it already computes for `Retry-After`, and `rateLimit.used === limit + 1` as the first refusal                                                                                                                                                                                   |
| `client/src/types/api.ts`               | `ApiErrorDetails` gains `kind?: 'rateLimit'` and `retryAfterSeconds?: number`                                                                                                                                                                                                                                   |
| `plans/ROADMAP.md`                      | the P1 section matches this plan (the table above, the A3 status, the shipped interim limiter)                                                                                                                                                                                                                  |

Rule recorded in `docs/API.md`: existing detail shapes stay untagged; every new one carries `kind`.

Tests: `test/unit/errors.safe.test.ts` (every details shape passes through the handler untouched);
`test/unit/rate-limit.safe.test.ts` (the 429 body's `retryAfterSeconds` equals `Retry-After`; a burst of ten refusals
logs one `warn` and nine `debug`).

Docs: `docs/API.md` (details shapes, the 429 row); `docs/LOGGING.md` and CLAUDE.md §19 (429 is `warn` once per key per
window). Intent: `--server minor --client patch`.

Verify: with `RATE_LIMIT_WRITE_MAX=2`, three `PATCH /api/admin/settings` calls give a 429 with `details`, and the log
holds one `warn`.

### PR 02 — Outbox schema: events, subscriptions, the first schedule (P1.2)

- [x] Merged

Split at 692 lines: the queue wrappers and `job_failures` moved to [PR 02b](#pr-02b--queue-wrappers-and-dead-letters-p12).

`/before-write`: schema-guard, NEW TABLE ×3 (nothing stores events today; `job_failures` lands in 02b).

Migration `<ts>_outbox.sql`:

- `create extension if not exists pgmq; create extension if not exists pg_cron;` in the schemas ADR-002 verified. The
  `pgmq` schema is not added to `api.schemas` in `config.toml`, and `pgmq_public` is not enabled.
- `domain_events`, `event_subscriptions` as in the roadmap (no `event_handled`); only the aggregate index on
  `domain_events` (nothing reads by type yet).
- `emit_event(p_type, p_aggregate_type, p_aggregate_id, p_store_id, p_payload, p_actor, p_request_id)` inserts the
  event and sends `{ eventId, type, aggregateId, storeId, payload, actor, requestId, occurredAt }` to every queue
  subscribed to the exact type or its family (`split_part(p_type, '.', 1) || '.*'`), once per distinct queue.
  Returns the event id. `security definer`: the queue tables are not `service_role`'s.
- `select pgmq.create('q_notifications')`; subscription `('order.*', 'q_notifications')`.
- `purge_domain_events(p_now timestamptz default now(), p_keep interval default '30 days')`, scheduled
  `cron.schedule('purge-domain-events', '17 21 * * *', …)` (21:17 UTC, 02:47 IST: off-peak).
- RLS on every new table with no policies; `revoke all … from public, anon, authenticated`; `EXECUTE` on the
  functions to `service_role` only. Then `npm run db:types`.

Tests (`test/api/outbox.test.ts`): an event goes to an exact and a family subscription, once each; an unsubscribed
type leaves only the event row; `purge_domain_events(p_now => now() + interval '31 days')` deletes and `'29 days'`
keeps; `cron.job` lists the schedule. `test/api/database-lockdown.test.ts` (with the `localSql` helper) checks from the
catalogs that every `public` table has RLS on and grants nothing to `anon`/`authenticated`, that neither can execute a
`public` function or use the `pgmq` or `cron` schema: the guard for every later migration.

Docs: `docs/SCHEMA.md` (tables, functions, extensions, the schedule); **new `docs/JOBS.md`** (the outbox model,
queues and subscriptions, schedules, retention, a runbook) with its CLAUDE.md §6 row; `docs/PERMISSIONS.md`;
`docs/TESTING.md` (`localSql`, the lockdown test); `docs/CONFIGURATION.md` (the 30-day retention as a platform constant
in the migration). Intent: `--server minor`.

Verify: `npm run db:reset`, the gate, `select * from cron.job`; once merged, `feat/P1` is pushed to staging
(`npm run db:push:staging`) and confirms both extensions appear under the project's Integrations.

### PR 02b — Queue wrappers and dead letters (P1.2)

- [x] Merged

`/before-write`: schema-guard, NEW TABLE (`job_failures`, in PR 02's verdict for all three tables).

Migration `<ts>_queue_wrappers.sql`:

- `job_failures` as in the roadmap; RLS on, revoked from `anon` and `authenticated`.
- Queue wrappers, `security definer`, `search_path = ''`, fully qualified `pgmq.*` calls, `EXECUTE` to `service_role`
  only:
  - `queue_read(p_queue, p_vt_seconds, p_qty, p_poll_seconds)` returns `(msg_id, read_ct, enqueued_at, message)`:
    `pgmq.read_with_poll` when `p_poll_seconds > 0`, else `pgmq.read` (read_with_poll checks its deadline before
    reading, so `0` there would never read anything);
  - `queue_delete`; `queue_retry(p_queue, p_msg_id, p_delay_seconds)` (`pgmq.set_vt`);
  - `queue_dead_letter(p_queue, p_msg_id, p_message, p_attempts, p_error)` deletes, and inserts `job_failures` only if
    the delete took the message, returning whether it did;
  - `queue_metrics(p_queue)`: depth and oldest age, for the worker's health.

  Then `npm run db:types`.

Tests (`test/api/queue.test.ts`): a read hides a message for its visibility timeout; `p_poll_seconds` `0` and `1` both
read a waiting message; a retry brings it back with `read_ct + 1`; a dead letter writes `job_failures` and empties the
queue; `queue_metrics` counts the depth. The lockdown test covers the new grants.

Docs: `docs/SCHEMA.md` (`job_failures`, the wrappers); `docs/JOBS.md` (how the worker reaches the queues; the runbook's
dead-letter rows: list open ones, replay one, close it). Intent: `--server minor`.

### PR 03 — The job runner (P1.2)

- [x] Merged

Split at 786 lines: the error handler's `invariant: true` on a request's 500 moved to PR 04 (the plan's seam).

| File                         | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server/src/jobs/runner.ts`  | the `JobHandler<T>` / `QueueMessage<T>` / `JobContext` types (the roadmap's, with `concurrency` as a field); pure `backoffSeconds(attempt, { baseSec, maxSec }, random)` = `min(max, base·2^(attempt−1))` ±20%; `runQueue(handler, { signal, log, now, random })`: long-poll `queue_read` → a child logger `{ queue, jobId, eventId, eventType, attempt }` per message → handle → `queue_delete`; `RetryableError` → `queue_retry` with the backoff; `PermanentError`, any other error, or the last attempt → `queue_dead_letter` and one `error` line. A failing queue RPC (database unreachable) logs `warn` once and backs off 1 s → 5 s. The abort signal stops reading; in-flight handlers finish |
| `server/src/jobs/notify.ts`  | the `q_notifications` handler: one `info` `Order event` with `{ eventType, orderId }`. P6.3 replaces the body                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `server/src/utils/errors.ts` | `RetryableError`, `PermanentError`; `InvariantError` (P0.5's deferred class, a programmer error) with its first throwers, the loop's impossible states (a message the database reports as never read)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

`/before-write`: reuse-scout, expected NO MATCH (nothing loops over work today).

Tests: `test/unit/backoff.safe.test.ts` (growth, cap, jitter bounds with a fixed random); `test/api/runner.test.ts`
(a real queue, the runner in-process, a 1 s visibility timeout): success deletes the message; a retryable failure
succeeds on attempt 2; a handler that always fails leaves one `job_failures` row after `maxAttempts` and exactly one
`error` line; a handler that never settles, then an abort, then a second runner: the message comes back after the
visibility timeout with `attempt = 2` and is handled once; abort waits for in-flight handlers.

Docs: `docs/JOBS.md` (the handler contract, the retry policy, "handlers are idempotent by natural keys", log
fields); `docs/LOGGING.md` (handled = `debug` with `durationMs`, retry = `warn`, dead letter = `error`, empty polls
never logged); `docs/BACKEND_STRUCTURE.md` (`jobs/`). Intent: `--server patch` (no process runs it yet).

Split seam if over 750 lines: the `InvariantError` mapping moves to PR 04.

### PR 04 — The worker process (P1.2)

- [x] Merged

As built, the health rule counts progress rather than polls: a queue is healthy while its loop made progress
(a read returned, a failed one too, or a job finished; `runQueue`'s `onActive`) within
`max(3 × POLL_SECONDS, visibilityTimeoutSec)`. With every slot busy the loop does not read, and a database outage
must not restart the worker: liveness only, like the API's `/api/health`. Depth and age come from `queue_metrics`
(1 s, `null` when it does not answer). Two fixes found while verifying: `onShutdown` keeps catching repeat signals
(tsx and a terminal's Ctrl+C deliver two, and an uncaught second one killed the process mid-stop), and `start.sh`
stops whole process trees (it left `tsx watch` behind). The shutdown is shared as `utils/shutdown.ts`
(`onShutdown`, `SHUTDOWN_DEADLINE_MS`). The runner's 5 s long-poll is replaced by quick reads and a 2 s wait in the
worker (`POLL_SECONDS`), so an idle worker holds no database connection (risk "Waiting in the database"; JOBS.md
"Capacity").

Also carries PR 03's split-off: `server/src/middleware/errorHandler.ts` logs an `InvariantError`'s 500 with
`invariant: true`, with its case in `test/unit/errors.safe.test.ts`.

Implements [ADR-005](../docs/adr/005-modular-monolith-three-processes.md) (accepted 24 October 2026).

| File                                             | Change                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/worker.ts`                           | entry: the handler list (`notify`), one `runQueue` per handler; `GET /health` on `WORKER_HEALTH_PORT` with `node:http` (200 while every queue polled within 3× its poll window, JSON with the last poll, depth and oldest age per queue; else 503); SIGTERM / SIGINT abort the loops and exit after in-flight work or the shutdown deadline |
| `server/src/server.ts`, `server/src/utils/…`     | `SHUTDOWN_DEADLINE_MS` exported once and shared by both entry points                                                                                                                                                                                                                                                                        |
| `server/src/utils/env.ts`, `server/.env.example` | `WORKER_HEALTH_PORT` (default 8001)                                                                                                                                                                                                                                                                                                         |
| `server/package.json`                            | `dev:worker` (`tsx watch src/worker.ts`), `start:worker` (`node dist/src/worker.js`)                                                                                                                                                                                                                                                        |
| `start.sh`                                       | starts the worker next to the API (`.logs/worker.log`), probes and frees `WORKER_HEALTH_PORT` like 8000 and 5173                                                                                                                                                                                                                            |
| `compose.yaml`                                   | `worker`: the api image, `command: ["node", "dist/src/worker.js"]`, healthcheck on `/health`; the `reconciler` placeholder comment says P5.10 (scheduled jobs are pg_cron)                                                                                                                                                                  |
| `.claude/hooks/major-change-gate.js`             | `server/src/jobs/` and `server/src/worker.ts` are major-change paths (its `--self-test` covers them)                                                                                                                                                                                                                                        |

Tests: `test/unit/worker-health.safe.test.ts` (healthy, then 503 once a queue's loop is quiet past its limit, with an
injected clock), `test/unit/shutdown.safe.test.ts` (one stop, repeats still caught, the deadline, a failed stop), a
`runner.test.ts` case for `onActive`, and `app-breaker` E5 (`start.sh` stops cleanly and leaves nothing behind).

Docs: CLAUDE.md §3 (scripts), §4 (`jobs/`, the `worker.ts` entry), §17 (paths), §18 (the worker is long-running;
`start.sh` runs it); `docs/DEPLOYMENT.md` (env, the compose row, "the worker runs wherever the API runs");
`docs/ARCHITECTURE.md` (the worker in the containers diagram); `docs/BACKEND_STRUCTURE.md`; README (the worker log).
Intent: `--server minor`.

Verify: `./start.sh` runs three processes; `curl localhost:8001/health`; `docker compose up -d` shows `worker`
healthy; `kill -TERM` during a slow handler logs a clean stop.

### PR 05 — Today's transitions emit events and carry their actor; retry-safe statuses (P1.2, P1.4)

- [x] Merged

As built: the new parameters default to null on both functions, so the API already deployed (which calls them by
name without them) keeps working between the migration and the new API; push the migration first. The repeat
rule needs no list of staff targets in SQL: a repeat counts when the current status equals `p_next_status` and
`p_from_statuses` (the API's `ALLOWED_TRANSITIONS`) is not empty, so `PLACED → PLACED` stays 409.
`update_order_status` now locks the row (`for update`) before deciding, which also gives the event's `from`.

Migration `<ts>_transitions_emit_events.sql`, both functions dropped and recreated (a new parameter changes the
signature; re-granted to `service_role` only, as the idempotency migration did):

- `place_order(…, p_actor jsonb, p_request_id text)`: sets `app.actor` and `app.request_id`; emits `order.placed`
  with `{ orderNumber }` before returning (no amount: payloads carry ids and statuses). The idempotent replay path
  emits nothing.
- `update_order_status(p_order_id, p_next_status, p_from_statuses, p_actor jsonb, p_request_id text)`: sets the same
  two values; emits `order.<status in lower case>` with `{ orderNumber, from, to }`. **A repeat of a transition that
  already happened** (the current status is `p_next_status`, and `p_next_status` is a staff target) returns without
  changing anything, emitting anything or moving stock (D2). `PLACED → PLACED` stays 409.

Server: `createOrder(user, input, ctx)` and `updateOrderStatus(id, next, ctx)` take `ctx: { actor, requestId }`,
built once in `order.controller.ts` from `req.user` and `req.id` (the type lives in `types/auth.ts`).

Tests (`test/api/order-events.test.ts`): placing an order writes one `order.placed` event with the customer as actor
and the request's `x-request-id`, and one `q_notifications` message that an in-process runner consumes; an
`INSUFFICIENT_STOCK` refusal leaves no event and no message (the roadmap's "a transaction that raises leaves no event
behind"); an idempotent replay emits nothing; every staff transition emits its A5 event with the staff actor; a
repeated `READY` answers 200 with the order and emits nothing; cancelling twice restores stock once. The 5×5 matrix in
`orders.test.ts` changes on purpose: the diagonal of staff targets becomes 200.

Docs: `docs/API.md` (`PATCH /orders/:id/status`: a repeat answers 200); `docs/SCHEMA.md` (signatures);
`docs/ARCHITECTURE.md` (the outbox sequence: transition → event → queue → worker); `docs/JOBS.md` (the order events);
CLAUDE.md §10 ("every transition function sets `app.actor` and `app.request_id` and calls `emit_event`"), §14 (the
lifecycle walk checks `domain_events`; a repeated transition is 200). Intent: `--server minor`.

Split seam if over 750 lines: the retry-safe repeat becomes its own PR with a second `create or replace` of
`update_order_status` (same signature, so no re-grant).

### PR 06 — Audit log (P1.3)

- [x] Merged

As built: the actor never comes from `updated_by`. A later SQL edit leaves the last admin's id there, so that
fallback would have pinned the edit on them. A table write through the Data API names its actor with the `x-actor`
and `x-request-id` headers instead (PostgREST hands them to the transaction as `request.headers`); settings rows now
carry their request id too. `actor_role` comes from the actor itself (the API read it from `profiles` on that
request), so the trigger reads no other table. `service_role` gets `select` only: the trigger writes as the owner, so
the secret key cannot insert, edit or remove a row (it still vouches for the actor it sends). The publishable-key check is the lockdown test's, which covers every table.

`/before-write`: schema-guard, expected NEW TABLE (`domain_events` is trimmed at 30 days; the audit record is kept
13 months and covers changes that are not events).

Migration `<ts>_audit_log.sql`:

- `actor_type` enum, `audit_log` and its three indexes as in the roadmap.
- Append-only twice over: `revoke update, delete, truncate on audit_log from service_role` (and from everyone else),
  and row and statement triggers that raise on update, delete and truncate.
- `audit_row_change()` (`security definer`, `search_path = ''`): the diff of the watched columns (`TG_ARGV`: column
  names, or `*` for every column but `updated_at` / `updated_by`) as `{ column: [old, new] }`; the actor from
  `app.actor`, else `{ type: USER, id: new.updated_by }` when the row has one, else `SYSTEM` (SQL editor, seed,
  migrations); `actor_role` from `profiles` at that moment; `request_id` from `app.request_id`.
- Triggers, `after update … for each row when (…)`: `site_settings` (`*`), `orders` (`status`), `profiles` (`role`),
  `menu_items` (`name`, `price`, `is_available`, `image_url`, `category`; never `stock_quantity`). PR 09 adds
  `price_paise` to the watched list and PR 16 drops `price` from it.

Tests (`test/api/audit.test.ts`): `PATCH /api/admin/settings` writes one row naming the admin; a staff status change
writes one row with the staff actor and the request id; placing an order writes none; a role change through the
secret key is `SYSTEM`; `update` and `delete` on `audit_log` fail through the secret key; the publishable key cannot
read it.

Docs: `docs/SCHEMA.md`; `docs/PERMISSIONS.md` (append-only, who reads); `docs/ARCHITECTURE.md` (logs, events and
audit: three records, three purposes, three retentions); CLAUDE.md §10 ("an audited table is written through an RPC
that sets `app.actor`, or carries `updated_by`"). Intent: `--server minor`.

Verify: once merged and pushed to staging from `feat/P1`, an `update` on `audit_log` with the staging secret
key fails (the roadmap's
"verify service_role's privileges on hosted Supabase").

### PR 07 — `GET /api/admin/audit` (P1.3)

- [x] Merged

As built: `limit` is defaulted in `listAudit`, not by zod: a required key would not fit Express's `ParsedQs`-typed
handlers. `entityId` needs `entityType` (ids repeat across types, and the entity index leads with the type). `from` is
inclusive and `to` exclusive, and `from` must be before `to`. The service reads one row past the page, so `nextCursor`
is null exactly on the last page. The response is `no-store` (it must not outlive the admin's sign-out).
Migration `20261102101707_audit_log_id_indexes.sql`: PR 06's indexes ended in `occurred_at desc`, so every filtered
page sorted all its matches; they now end in `id desc`, plus `(entity_type, id desc)` for a type filter alone. The
P9.5 purge will want its own `occurred_at` index. Push it to staging (`npm run db:push:staging`) before the API ships.

Recipe: `/new-endpoint`. `/before-write`: reuse-scout, expected NO MATCH for the service, REUSE for the admin
router, `requireAdmin` and the serializer pattern.

- `GET /api/admin/audit?entityType&entityId&actorId&from&to&before&limit` (ADMIN). `entityType` from the closed list
  of audited entities; `before` is the keyset cursor (`id < before`, newest first); `limit` 1–100, default 50.
- `schemas/admin.schema.ts` (`auditQuerySchema`), `services/audit.service.ts` (`listAudit`, never `cached()`),
  `admin.controller.ts`, `admin.routes.ts`; `AuditEntryDto` + `toAuditEntryDto`; the client `AuditEntry` type (no UI
  until P7.4).
- Response `{ entries, nextCursor }`, `nextCursor` null on the last page.

Tests (`test/api/audit-read.test.ts`): `testAuthMatrix` (401, customer 403, staff 403, admin 200); each filter;
a cursor walk over three pages with no duplicate or gap; out-of-bounds `limit` and malformed dates 400.

Docs: `docs/API.md`, `docs/PERMISSIONS.md`, `docs/BACKEND_STRUCTURE.md`. Intent: `--server minor`.

### PR 08 — Order snapshots v2 (P1.5)

- [x] Merged

> **As built:** the backfill runs with `orders_set_updated_at` disabled, so past orders keep their `updatedAt`.
> `admin.test.ts` and `caching-gaps.test.ts`, which insert orders directly, now pass a `store_name`. `selectOrders()`
> joins only `order_items` now.

Migration `<ts>_order_snapshots.sql`: `order_items.image_url`, `order_items.category`, `orders.store_name`; backfill
from today's `menu_items` and `stores` (the best copy left); then `set not null`. `create or replace place_order`
(PR 05's signature, so grants stay) writes the three snapshots, read inside the function: the API's arguments do not
change.

Server: `selectOrders()` reads `store_id`, `store_name` and `order_items.image_url` and drops the `menu_items
(image_url)` and `stores (id, name)` joins (two fewer joins on every polled order read). The DTOs do not change:
`store` is `{ id: store_id, name: store_name }`. `category` is stored for analytics (P7.1) and not sent.

Tests: `test/api/order-snapshots.test.ts` (destructive, `resetDemoData()` after): place an order, change the item's
price, name and photo and the store's name, and `GET /api/orders/:id` is deep-equal to the response before;
`test/unit/serializers.safe.test.ts` for the new mapping.

Docs: `docs/SCHEMA.md`; `docs/API.md` (`OrderItemDto.imageUrl` is the photo at order time, `store.name` the name at
order time). Intent: `--server minor`.

Verify: the deployed API (old code) still reads orders after the migration, because the columns it joins are
untouched; the new API needs the migration first, as always.

### PR 09 — Money in paise: expand (ADR-004)

- [x] Merged

> **As built:** `place_order` reads every line's `menu_items` row once (into a jsonb array) and takes the total and
> the lines from that one read, so an item without a stock count (not locked by the stock loop) cannot change price
> between the two. The API no longer sends a price in `p_lines`. Tests that write `orders` or `menu_items` directly
> (`admin`, `caching-gaps`, `menu-cap`, `order-snapshots`) now write the paise columns too; `audit.test.ts` checks that a
> `price_paise`-only edit is audited. The class guard also scans `server/scripts`. `docs/ARCHITECTURE.md` (the
> checkout diagrams and the ER diagram) is updated with the owning docs.
>
> Two additions, approved during review. **Expected price check:** the API charged from its own read and
> `place_order` stored from a later one, so a price change in between charged one amount and stored another. The API
> now sends each line's charged price as `unit_price_paise`; `place_order` compares it with the same read it stores
> from and raises `PRICE_CHANGED` (`{ menuItemId, name, price }`, rolling back the stock), which the API answers 409
> `PRICE_CHANGED`, no `details`, the message naming the item and its new price. A deployed-API call without
> `unit_price_paise` is not checked. **Sync trigger:** `menu_items_sync_price` (before insert or update of `price`,
> `price_paise`; executable by nobody) derives whichever price column was not written and refuses both written and
> disagreeing, so the deployed API's rupee-only writes keep working and the columns cannot drift. PR 16 drops the
> trigger with the rupee column.

[ADR-004](../docs/adr/004-rupees-and-paise.md) as amended (D8). `/before-write`: schema-guard, expected EXTEND
(`_paise` columns beside the rupee ones, expand → migrate → contract).

Migration `<ts>_money_paise.sql`:

- `menu_items.price_paise`, `orders.total_paise`, `order_items.unit_price_paise`, `order_items.line_total_paise`, all
  `bigint`; backfilled ×100; then `not null`, `check (… >= 0)` and `check (… % 100 = 0)` (whole rupees while the
  API's rupee fields exist).
- `create or replace place_order` (PR 08's signature): **prices each line from `menu_items.price_paise` inside the
  function** and ignores any price in `p_lines`, so the API still deployed during the migration keeps working and no
  caller can pass a stale or tampered price; writes the paise columns and, until PR 16, the rupee columns too, so the
  deployed API's reads stay right.
- The audit trigger on `menu_items` watches `price_paise` as well.

| File                                                      | Change                                                                                                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/utils/money.ts`                               | `paiseToRupees`, `rupeesToPaise`; the only place either conversion happens                                                              |
| `server/src/utils/serializers.ts`                         | `price`, `total`, `unitPrice` and `lineTotal` are read from the paise columns and converted; `selectOrders()` selects the paise columns |
| `server/src/services/order.service.ts`, `menu.service.ts` | prices and the total in paise internally (`simulatePayment` takes paise); the rupee fields only at the serializer                       |
| `server/scripts/seed-data.ts`, `seed.ts`                  | prices in paise; the rupee column written beside it until PR 16                                                                         |

Tests: `test/unit/money.safe.test.ts`; `test/unit/money-boundary.safe.test.ts`, the class guard: it scans
`server/src` and fails on `* 100` or `/ 100` outside `money.ts`; `orders.test.ts` and `menu.safe.test.ts` pass
unchanged (the contract did not move); a direct `place_order` call with a tampered `unit_price` in `p_lines` still
charges the menu price; inserting 4950 paise into `price_paise` fails the whole-rupee check.

Docs: `docs/SCHEMA.md` (columns, checks, the unit rule); `docs/API.md` (amounts are stored in paise and sent in
rupees; nothing changes for clients); `docs/BACKEND_STRUCTURE.md` (`utils/money.ts`); CLAUDE.md §10 ("money is paise in
the database; `utils/money.ts` is the only converter"). Intent: `--server minor`.

### PR 10 — `POST /api/client-errors` (P1.6)

- [x] Merged

As built: a blank env value now counts as unset (`utils/env.ts`), found while adding `RATE_LIMIT_CLIENT_ERRORS_MAX`:
`z.coerce` read `RATE_LIMIT_IP_MAX=` as 0, which turned the limit off; `env-blank.safe.test.ts` guards it. `clientVersion` is not passed to the `warn` call, because `req.log` already carries it (pino-http
`customProps` in `app.ts`), so it is written once rather than as a duplicate key; the line adds `at`, so a report
sent late (a batch after an outage) still says when it happened. The limiter counts requests (each up to 5 reports),
so the test's 31st report is the 31st one-report request. The test's own app copy stubs `getSettings` with
`min_client_version` 9.0.0: the seeded `0.0.0` gates nothing, so it could not tell a mount after the gate apart.
No route file: the route sits in `routes/index.ts` next to `/config`, which it shares the gate exemption with.

Recipe: `/new-endpoint`. Self-reported, not Sentry (D5); Sentry is a later, low-priority roadmap item (P10.4).

- Body (`schemas/clientErrors.schema.ts`, strict): `{ reports: [{ kind: 'error' | 'unhandledrejection' | 'render',
message (≤ 500), stack? (≤ 3500), route (≤ 200), at }] }`, 1–5 reports. A transform drops anything shaped like a
  JWT, an `sb_` key or a `Bearer` value from `message` and `stack`, behind the client's own scrub (PR 12):
  `REDACT_PATHS` covers keys, not strings.
- Mounted in `routes/index.ts` **before** the client-version gate (a stale tab's errors are the ones worth seeing) and
  without `requireAuth` (errors happen before sign-in). `clientErrorLimiter`: per IP, `RATE_LIMIT_CLIENT_ERRORS_MAX`
  (default 30 per window).
- One `warn` `Client error` per report with `{ clientVersion, route, kind, message, stack }`; answers 204. Never
  `error`: a client cannot page anyone.

Tests (`test/api/client-errors.safe.test.ts`, logs only): 204; six reports, an oversized stack and an unknown field
are 400; the 31st report in a window is 429; an outdated `X-Client-Version` still gets 204; a token-shaped string never
reaches the log.

Docs: `docs/API.md`; `docs/LOGGING.md` ("Client error reports") and CLAUDE.md §19; `docs/CONFIGURATION.md`,
`docs/DEPLOYMENT.md` and `server/.env.example` (`RATE_LIMIT_CLIENT_ERRORS_MAX`); `docs/BACKEND_STRUCTURE.md`. Intent:
`--server minor`.

### PR 11 — `client_error_sample_percent` through to `/api/config` (P1.6)

- [ ] Merged

The P0.4 pattern (P0 PRs 13 and 14): migration column `client_error_sample_percent integer not null default 100
check (… between 0 and 100)`; `npm run db:types`; `settings.service.ts` `COLUMN`, `updateSettingsSchema`,
`toSiteSettingsDto`, `SiteSettingsDto` / `SiteSettings`; `ConfigDto.clientErrors: { samplePercent }` (additive);
`client/src/config/fallbacks.json`; a `settingsRules.ts` row (the admin form renders from it). PR 06's `*` trigger
audits the new column with no change.

Tests: `admin.test.ts` (bounds), `config.test.ts` (the parity check already compares the whole shape),
`settingsRules.test.ts`.

Docs: `docs/SCHEMA.md`, `docs/API.md`, `docs/CONFIGURATION.md`. Intent: `--server minor --client patch`.

### PR 12 — The error reporter, and render errors told apart from chunk failures (P1.6)

- [ ] Merged

`/before-write`: reuse-scout, expected **EXTEND `PageBoundary`** rather than the roadmap's new `AppErrorBoundary`
(CLAUDE.md §5). The file list assumes EXTEND.

| File                                        | Change                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/src/lib/errorReporter.ts`           | `installErrorReporter()` (`error`, `unhandledrejection`), `reportError(error, kind)`, `setSamplePercent(n)`; at most 5 reports per page load, 4 KB each; query strings, `eyJ…` tokens, `sb_…` keys and `Bearer …` scrubbed; route = `location.pathname`; sampled once per page load; batched and flushed on a short debounce and on `pagehide` |
| `client/src/services/clientErrors.ts`       | `sendClientErrors(reports)`: `request()` with `auth: false` and `keepalive: true`, so it survives the page closing and keeps the `X-Client-Version` header; never throws, never retries, never reports its own failure                                                                                                                         |
| `client/src/services/api.ts`                | `RequestOptions.keepalive`                                                                                                                                                                                                                                                                                                                     |
| `client/src/components/PageBoundary.tsx`    | **fixes a bug:** today every caught error shows "We couldn't reach the server", including a render bug inside a page. A failed chunk import keeps that copy; any other error is reported (`reportError(error, 'render')`) and shows "Something went wrong" with Reload. Gains `scope: 'page' \| 'app'`                                         |
| `client/src/App.tsx`, `client/src/main.tsx` | `installErrorReporter()` first in `main.tsx`; `<PageBoundary scope="app">` around the shell, so a crash in the nav or header no longer blanks the page; one effect passes `useConfig().clientErrors.samplePercent` to the reporter                                                                                                             |

Budget: the reporter sits in the initial chunk and stays under 1 KB gzip (`npm run check:bundle`).

Tests: `lib/errorReporter.test.ts` (the cap, the 4 KB cut, the scrub, sampling at 0 and 100, one send per batch, a
failed send swallowed); `PageBoundary.test.tsx` (a chunk error keeps the unreachable copy and reports nothing; a render
error reports once and shows the bug copy; `scope="app"` has no skeleton). The class guard: the scrub test runs over
every token shape that `REDACT_PATHS` names.

Docs: `docs/COMPONENTS.md` (`PageBoundary` scopes, `errorReporter`); `docs/FRONTEND_STRUCTURE.md`
(`services/clientErrors.ts`, the root boundary); `docs/LOGGING.md` (the client half). Intent: `--client minor`.

Visual gate: the bug fallback at 390 px (Slow 4G, 4× CPU) and 1280 px, forced with a temporary `throw` in `MenuPage`
that is removed before commit. Done when that throw, on the throttled phone profile, shows up in the server log with
the client version, the route and a stack.

### PR 13 — Feature flags: table, evaluation, the admin flip (P1.7)

- [x] Merged

As built: `audit_row_change()` took `entity_id` from the row's `id`, and `feature_flags` is keyed by `key`, so the
migration redefines it (`create or replace`, same body) with `coalesce(id, key)`; `AUDIT_ENTITY_TYPES` gains
`feature_flag`. `rules` is a strict zod object, both on the PATCH and when read: a misspelt key (`storeId`) is a 400,
or turns a hand-edited flag off, instead of being stripped into "everyone". Lists need at least one entry (`{}` clears
targeting). The percentage reads the first four bytes of the hash, mod 100. `setFlag(key, input, ctx)` takes the
request context, like `updateSettings`. Nothing calls `isEnabled` yet, so the store-only done-when is tested on
`isEnabled` directly. Push the migration to staging before the API ships.

`/before-write`: schema-guard, expected NEW TABLE; reuse-scout, expected REUSE `cached()` / `invalidate()` and the
admin router.

- Migration `<ts>_feature_flags.sql`: the roadmap's table; RLS on, `service_role` only; `audit_row_change('*')`. No
  rows: each flag ships in the migration of the phase that uses it.
- `services/flags.service.ts`: pure `evaluateFlag(flag, { userId, role, storeId })` (`enabled`, then `storeIds`, then
  `roles`, then a stable `percent` from the first bytes of `sha256(key + ':' + userId)`; no user means not in the
  percentage); `rules` parsed with zod when read, so a hand-edited malformed rule is off and logs one `warn`;
  `getFlags()` through `cached('feature_flags', PUBLIC_READ_TTL_MS, …)` (flags are not user data; evaluation is per
  caller); `isEnabled(key, ctx)`, an unknown key off; `setFlag(admin, key, input)` updates with `updated_by` and calls
  `invalidate('feature_flags')`.
- `PATCH /api/admin/flags/:key` (ADMIN) with `{ enabled?, clientVisible?, rules? }` → `FeatureFlagDto` (both sides).
  An unknown key is 404. No list endpoint until the P7.4 page.

Tests: `test/unit/flags.safe.test.ts` (each rule alone and combined; the percentage is stable per user and within ±3%
of target over 10 000 ids; a malformed rule is off); `test/api/flags.test.ts` (a second store inserted for the test: a
flag limited to one store is on for that store only, the roadmap's done-when; `testAuthMatrix` on the PATCH; the
cache test that fails without `invalidate`; the audit row names the admin who flipped it).

Docs: `docs/SCHEMA.md`; `docs/API.md`; `docs/PERMISSIONS.md`; `docs/CONFIGURATION.md` (flags as their own kind of
setting); `docs/BACKEND_STRUCTURE.md`; CLAUDE.md §2c (flags read through `cached()`, invalidated by the flip). Intent:
`--server minor --client patch`.

Split seam if over 750 lines: the admin PATCH and its matrix move to their own PR, and the cache test waits for it.

### PR 14 — Client-visible flags in `/api/config` (P1.7)

- [ ] Merged

Carried from PR 13's review: `isEnabled` and `getFlags` throw when the flags read fails. The first caller (this PR's
`getConfig()`) must fail closed (no flags, never a 500 on `/api/config`), with its test.

`config.service.ts`: `features` holds every `client_visible` flag without targeting rules, as `enabled`; a targeted
client-visible flag is `false` here (it needs `/api/me/config`, built with the first such flag). `ConfigDto` does
not change shape. A flip reaches `/api/config` through `invalidate('feature_flags')`: `getConfig()` reads the cached
flags next to the cached settings.

Tests: `config.test.ts` (a client-visible untargeted flag appears; a targeted or server-only flag does not; a flip
shows on the next request); the fallbacks parity check keeps `features: {}`.

Docs: `docs/API.md` (`features`). Intent: `--server minor`.

### PR 15 — Server-side idle sign-out (ADR-011 follow-up)

- [x] Merged

As built (perf review): concurrent first requests of a session (a page load) share one in-flight check, so a
session costs one `touch_session` call per window per process, not one per parallel request. As built: schema-guard NEW TABLE `session_activity`, as expected (`auth.sessions` is GoTrue's, outside the Data API,
and moves on token refresh, not on API use). `verifyCredentials` exposes the claim as `jwtClaims.session_id`
(`unknown`, so it is checked as a UUID; a token without one skips the check). The 401 reuses the existing "Your
session has expired. Please sign in again." rather than a near-duplicate. The check runs after the profile lookup (the
row references `profiles`) in `enforceSessionIdle`, which `requireAuth` calls. **Fail-open:** if `touch_session` fails
(the migration not yet on an environment, a dropped connection) the request goes on and `error` "Session idle check
failed" is logged at most once per 5 minutes per process (with a `suppressed` count; a missing function would
otherwise log once per active session); the token is verified and the client cap still holds, while
fail-closed would sign every user out whenever the call fails. **A live session is required** (user decision, from
code review): sign-out revokes the refresh token, but the access token (checked locally) stays valid for up to 1 h;
`touch_session` therefore also refuses a session gone from `auth.sessions`, row or no row, so a replay is not let back
in as "never seen" once the purge drops its row. It is security definer for that read, like the purge. A refusal is
remembered in-process for the 5-minute window, so a replayed token costs no RPC and no sign-out call; after the
window it is checked (and revoked) again. A sign-out that answers session_not_found (auth-js:
`AuthSessionMissingError`, status 400, no code) counts as already revoked and logs nothing; any other failure is
`warn` "Idle session not revoked". A process that checked a session within the last 5 minutes lets its token through
until the window ends, so a sign-out takes effect within 5 minutes.
`last_seen_at` has no index, so a touch stays a HOT update. **Purge by session end, not age** (user decision):
`purge_session_activity()` deletes a row only when its session is gone from `auth.sessions`, so it can never be
refreshed again. The planned 90-day purge would have let a stolen refresh token held unused for 90+ days back in (an
unknown session counts as never seen). It is security definer (owner `postgres`, as pg_cron runs it), because
`service_role` cannot read `auth.sessions`; confirmed locally through a real pg_cron run. **Staging must confirm the
same** after the migration lands: `select status, return_message from cron.job_run_details` for
`purge-session-activity` reads `succeeded` (hosted Supabase lets the `postgres` role read `auth`), and
`touch_session`, which reads `auth.sessions` the same way, answers true for a live session: a signed-in request on
staging must not log `error` "Session idle check failed" (a permission error there fails open, so it would not show as
a 401).

D3: in P1, per session. `/before-write`: schema-guard, expected NEW TABLE (activity is per session, which no table
holds; a `profiles` column would let a phone in use keep a stolen laptop session alive).

- Migration `<ts>_session_activity.sql`: `session_activity (session_id uuid primary key, user_id uuid not null
references profiles on delete cascade, last_seen_at timestamptz not null)`; RLS on, `service_role` only.
  `touch_session(p_session_id, p_user_id, p_idle interval, p_now timestamptz default now()) returns boolean`: true
  and `last_seen_at = p_now` for a session seen within `p_idle` or never seen (sessions older than the deploy start
  their clock then); false, untouched, for one idle longer. A daily `purge-session-activity` job deletes the rows
  whose session is gone from `auth.sessions` (never by age, see As built).
- `middleware/auth.ts` `requireAuth`: reads the token's `session_id` claim (confirm `verifyCredentials` exposes it);
  calls `touch_session` at most once per session per 5 minutes per process (a module-level map); an idle session is
  401 `UNAUTHORIZED` "Your session has expired. Please sign in again." and is revoked with
  `supabaseAdmin.auth.admin.signOut(token, 'local')`, so its refresh token stops working. The client already clears
  its session on a 401.

Cost: one RPC per active session per 5 minutes per API instance.

Tests: `test/api/session-activity.test.ts` (the SQL through `p_now`: fresh, within the window, past it, never seen
but live, gone from `auth.sessions` with or without a row; the purge drops an ended session's row and keeps a live
one's however old); `test/api/session-idle.test.ts` (an idle session is 401 and revoked; a signed-out session's
still-valid access token is 401);
`test/unit/auth.safe.test.ts` (with the RPC stubbed: the throttle skips a second call within 5 minutes; false means
401 and one sign-out call, and a replay within the window is 401 with no second RPC or sign-out; session_not_found
from the sign-out logs no warn, another failure does).

Docs: `docs/PERMISSIONS.md` (sessions); `docs/DEPLOYMENT.md` "Hosted session timeout" (the server now enforces it);
`docs/SCHEMA.md`; `docs/API.md` (the 401); `docs/JOBS.md` (the schedule); CLAUDE.md §10 sessions bullet; a link in
ADR-011's Links to this PR (the decision itself is not rewritten). Intent: `--server minor`.

### PR 16 — Money in paise: contract (ADR-004)

- [ ] Merged

Not part of `feat/P1`. It goes into `dev` from `feat/p1-16-paise-contract` once `feat/P1` has merged into `dev` and
the release containing it runs in production (the user confirms): until then the deployed API still reads the rupee
columns.

Migration `<ts>_money_paise_contract.sql`: `create or replace place_order` without the rupee writes; the audit trigger
stops watching `price`; drop the `menu_items_sync_price` trigger and its function (PR 09) before the column; drop `menu_items.price`, `orders.total`, `order_items.unit_price` and
`order_items.line_total`; `npm run db:types`. The seed stops writing them. The whole-rupee checks stay until a paise
API field replaces each rupee field (ADR-004).

Tests: the full suite passes unchanged (the API contract never moved); `money-boundary.safe.test.ts` still guards the
class.

Docs: `docs/SCHEMA.md`. Intent: `--server patch`.

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

| #   | Decision                                                                                | Answer                                                                                                                                   | Applies to |
| --- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| D1  | Rate limiter: keep `express-rate-limit`, or move to `rate-limiter-flexible` now         | keep it; ADR-009 accepted with that amendment (`rate-limiter-flexible` arrives with the Redis store)                                     | PR 01      |
| D2  | A staff status change repeated after a lost answer: 200 with the order, or 409 as today | 200; other invalid transitions stay 409                                                                                                  | PR 05      |
| D3  | The server-side idle sign-out in P1                                                     | yes, keyed per session                                                                                                                   | PR 15      |
| D4  | The generic idempotency table and middleware                                            | built in P5.3 with `POST /api/checkout`, its first consumer                                                                              | P5.3       |
| D5  | Error tracking: self-reported or Sentry (roadmap decision 8)                            | self-reported in P1; Sentry later as a low-priority roadmap item (P10.4)                                                                 | PR 10–12   |
| D6  | How long `domain_events` are kept                                                       | 30 days; the audit log is the long-term record                                                                                           | PR 02      |
| D7  | ADR-005 (three processes)                                                               | accepted as written                                                                                                                      | PR 04      |
| D8  | When money moves to paise (ADR-004 as amended)                                          | in P1, right after the snapshots: expand in PR 09, contract in PR 16 once PR 09 runs in production                                       | PR 09, 16  |
| D9  | Who builds P1, and where                                                                | one agent, PR by PR, each into the `feat/P1` feature branch, which goes into `dev` at the end (two parallel lanes until 1 November 2026) | all        |

## Closing P1

Once every box but PR 16's is ticked: on a fresh `origin/feat/P1`, the gate in both packages, `npm run e2e:chromium`
and `/break` (P1 changes auth, orders, money and the request pipeline), with fixes as normal PRs into `feat/P1`. Then
the PR `feat/P1` → `dev` ("P1 — platform core", exempt from the size limit, linking the plan's PRs); the user merges
it and cuts the release as usual (`release.yml`).

## User steps (cannot be done from the repository)

- Merge PR 00 into `dev` (the docs PR needs an exemption from the size limit), then create `feat/P1` from `dev`.
- Merge each PR into `feat/P1`, merge `dev` into `feat/P1` when `dev` has moved, push `feat/P1`'s migrations to
  staging (`npm run db:push:staging`), and merge `feat/P1` into `dev` when P1 is done ([closing P1](#closing-p1)).
- After P1 reaches `main`: `npm run db:push:production` (user only), then check that pgmq and pg_cron show under the
  production project's Integrations.
- Confirm when the release containing P1 runs in production, so PR 16 can start.
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
  keeps the two columns in step. PR 16 must not run before production runs PR 09's API.
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
