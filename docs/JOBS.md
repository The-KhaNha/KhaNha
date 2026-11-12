# Jobs

Background work: the outbox, the queues and the schedules ([ADR-002](adr/002-outbox-pgmq-pg-cron.md)). Tables and
functions in detail: [SCHEMA.md](SCHEMA.md). The job runner is [below](#handlers-and-the-runner); the worker process
that runs it is [below](#the-worker-process).

## The outbox

- A transition function calls `emit_event(...)` before it returns. `emit_event` inserts a `domain_events` row and
  sends the event to every queue subscribed to its type or to its family, inside the caller's transaction: the state
  change, its event and its queue messages commit together, or a raise leaves none of them.
- Every queue message is
  `{ eventId, type, aggregateId, storeId, payload, actor, requestId, occurredAt }`.
- Event types are `<aggregate>.<what happened>` in lower case (`order.placed`, `order.ready`). The family is the part
  before the first dot plus `.*` (`order.*`).
- Payloads carry ids and statuses: never a whole row and never an amount (the free tier's 500 MB, ADR-011). A handler
  reads anything else it needs.
- Delivery is at least once: a message whose handler did not finish comes back after its visibility timeout. Every
  handler is idempotent through a natural key (one notification per event, user and channel).

## Order events

Emitted by `place_order` and `update_order_status` ([SCHEMA.md](SCHEMA.md#place_order)), in the same transaction as
the change: a transition that raises (a stock refusal, an invalid move) leaves no event.

| Type              | Emitted when                    | Payload                     |
| ----------------- | ------------------------------- | --------------------------- |
| `order.placed`    | an order is placed              | `{ orderNumber }`           |
| `order.preparing` | a status changes to `PREPARING` | `{ orderNumber, from, to }` |
| `order.ready`     | a status changes to `READY`     | `{ orderNumber, from, to }` |
| `order.collected` | a status changes to `COLLECTED` | `{ orderNumber, from, to }` |
| `order.cancelled` | a status changes to `CANCELLED` | `{ orderNumber, from, to }` |

- Payloads are ids and statuses only, never an amount or personal data. `aggregateId` is the order id.
- `actor` is `{ type: 'USER', id, role }`, built by `requestContext(req)` (`server/src/middleware/auth.ts`, a
  `RequestContext` from `server/src/types/auth.ts`) and passed down as `p_actor`. `requestId` is the request's `x-request-id`. An API deployed before this change calls
  the functions without them, and its events carry neither.
- `order.*` is subscribed to `q_notifications`, consumed by `notifyHandler`.
- An idempotent replay of `POST /orders` and a repeated status change ([API.md](API.md#patch-ordersidstatus)) emit
  nothing.

## Store events

Emitted by `pause_store` and `resume_store`, `create_store_from_template` and the `stores_changed` trigger ([SCHEMA.md](SCHEMA.md#stores)) in the same transaction as the change.
`aggregateId` and `storeId` are the store id. Nothing subscribes to them yet.

| Type            | Emitted when                                                                                                                                             | Payload                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `store.paused`  | a store is paused, or its pause changes                                                                                                                  | `{ pausedUntil }`                                                        |
| `store.resumed` | a paused store is resumed                                                                                                                                | `{}`                                                                     |
| `store.created` | a branch is opened from the template                                                                                                                     | `{ brandId, templateStoreId }`                                           |
| `store.changed` | a store's name, tagline, description, area, address, contact phone or status really changes (a profile edit, a publish, an unpublish, an operator's SQL) | `{ fields, status }`: the changed column names, sorted; never the values |

A repeated pause or resume emits nothing, and neither does a resume of a pause that already ran out. A pause that ends
by itself emits nothing either: it is derived, and a sweep comes with the first consumer.

## Menu events

`menu.changed` (`aggregateId` and `storeId`: the store; payload `{ itemIds }`) is emitted by the `menu_items_emit_changed`
statement triggers ([SCHEMA.md](SCHEMA.md#triggers)) in the transaction of any write that changed what a menu shows:
an insert, or an update of anything but `stock_quantity` and `template_item_id`. One statement is one event per store,
so a copy or a bulk edit is one event, and a stock move (every order) is none. The actor and request id come from
`app.actor` or the Data API's `x-actor` and `x-request-id` headers. Nothing subscribes to it yet (P7.7).

## Queues and subscriptions

| Queue             | Subscribed to | Consumer                           | Added by                    |
| ----------------- | ------------- | ---------------------------------- | --------------------------- |
| `q_notifications` | `order.*`     | `notifyHandler` (`jobs/notify.ts`) | `20261024181904_outbox.sql` |

A queue is created with its first consumer, never ahead of it, in one migration: `select pgmq.create('q_<name>')`,
then its `event_subscriptions` rows. A subscription naming a queue that does not exist makes `emit_event` raise, and
with it every transition that emits a matching event.

The `pgmq` schema is not exposed through the Data API, and `pgmq_public` is not enabled: the API and the worker
reach the queues only through the `queue_*` wrappers (`security definer`, `EXECUTE` for `service_role` only): read,
delete, retry, dead-letter and metrics. `server/test/api/database-lockdown.test.ts` fails if `anon` or
`authenticated` can use the `pgmq` or `cron` schema.

`queue_read`'s `p_poll_seconds` is how long to wait for a first message; `0` returns at once. A message the worker
gives up on goes to `job_failures` through `queue_dead_letter`, which deletes it and records it only if it was still
in the queue (another reader may have handled it after its visibility timeout ran out).

## Handlers and the runner

A handler (`JobHandler<T>` in `server/src/jobs/runner.ts`) consumes one queue: its `concurrency`,
`visibilityTimeoutSec` (longer than its slowest run, or a second reader takes the message too), `maxAttempts`,
`backoff` and `handle(message, { log, signal })`. `message.event` is what `emit_event` sent, and `message.attempt` is
pgmq's read count, 1 on the first delivery.

| `handle` …                                                                       | The runner                                                                       |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| resolves                                                                         | deletes the message                                                              |
| throws `RetryableError` (or a retryable `IntegrationError`), attempt < max       | hides it for `min(maxSec, baseSec × 2^(attempt−1))` ±20% seconds (`queue_retry`) |
| throws `PermanentError`, anything else, or a retryable error on the last attempt | dead-letters it (`queue_dead_letter`: a `job_failures` row, the message deleted) |

Delivery is at least once, so a handler is idempotent by a natural key (one notification per event, user and
channel): a worker that dies mid-message leaves it to come back after its visibility timeout.
A handler must not put personal data in an error message: the message reaches both the log (`err`) and
`job_failures.last_error`.

`runQueue(handler, { signal, log, onActive })` reads up to the free concurrency slots at a time with `pgmq.read`, which
returns at once. A read that found work is followed by another at once; an empty queue is read again after
`POLL_SECONDS` (2), the most a new job waits to start. Nothing waits in the database (see "Capacity" below). On abort it
stops reading (the idle wait ends at once), leaves anything read during the abort unstarted (back after its visibility
timeout), and resolves once the handlers in flight finish. Every call the runner makes is bounded, so a connection that
dies without closing cannot stall a queue: a read by 5 s, a delete, retry or dead letter by 10 s. Stopping waits for the
read in progress rather than cancelling it: a cancelled read may still take a message in the database, and that message
would stay hidden for its whole visibility timeout with no one to handle it. A failing read (the database unreachable) backs off 1 s → 5 s. If recording an outcome fails, the
message simply comes back. A message never read, or one that is not a domain event, is an `InvariantError`:
dead-lettered, logged with `invariant: true`. Log lines: [LOGGING.md](LOGGING.md#jobs).

| Handler         | Queue             | Concurrency | Visibility | Attempts | Backoff     | Does (until P6.3)                        |
| --------------- | ----------------- | ----------- | ---------- | -------- | ----------- | ---------------------------------------- |
| `notifyHandler` | `q_notifications` | 4           | 30 s       | 5        | 5 s → 900 s | logs `info` "Order event" with `orderId` |

## The worker process

`server/src/worker.ts` is the second entry point ([ADR-005](adr/005-modular-monolith-three-processes.md)), next to `src/server.ts`. It runs
the API's image with another command (`node dist/src/worker.js`; `pnpm run dev:worker`, `start:worker`) and the same
env. It runs wherever the API runs; one or more replicas are safe, because pgmq's visibility timeouts hand each
message to one reader at a time.

- **Consumers.** The `HANDLERS` list in `worker.ts` (today `notifyHandler`). A new consumer is added there: one
  `runQueue` per handler.
- **`GET /health`** on `WORKER_HEALTH_PORT` (default 8001); any other path or method is 404. It answers 200 while every
  queue's loop made progress within `staleAfterSec = max(3 × POLL_SECONDS, visibilityTimeoutSec)`, else 503. Progress
  is `RunOptions.onActive`: a read returned (a failed one too) or a job finished. Body:
  `{ ok, queues: [{ queue, lastActiveAt, stale, depth, oldestAgeSec }], version, commit }`. `depth` and `oldestAgeSec`
  come from `queue_metrics` with a 1 s timeout and are `null` when the database does not answer. It is liveness only:
  a database outage keeps the loops turning, so it never makes a healthy worker unhealthy. Code: `jobs/health.ts`.
- **Shutdown.** SIGTERM or SIGINT stops reading; jobs in flight finish (a read in progress returns first, in
  milliseconds). The process exits within `SHUTDOWN_DEADLINE_MS` (10 s) or exits 1. Unfinished messages come back after their
  visibility timeout. Shared with the API: `utils/shutdown.ts`.
- **Capacity.** The wait between reads is in the worker, not the database: a read holds a pooled connection for a
  few milliseconds, so an idle worker holds none, however many queues it reads (the roadmap plans seven) and however
  many replicas run. The cost is reads, about 30 a minute per idle queue at the 2 s poll, each about a millisecond in
  the database (`docs/PERF_BASELINE.md` "Worker"). A long-poll would hold one connection per queue per replica from
  PostgREST's pool, which the API shares and which is small ([ADR-011](adr/011-free-tiers.md)). A consumer that needs
  sub-second pickup gets LISTEN/NOTIFY wake-ups on a direct connection, never a return to the long-poll.

Deployment: [DEPLOYMENT.md](DEPLOYMENT.md#local-compose). Log lines: [LOGGING.md](LOGGING.md#the-worker-process).

## Schedules

Registered by migrations with `cron.schedule(name, schedule, command)`. Scheduling an existing name replaces it. A
schedule that purges by age calls a SQL function that takes `p_now timestamptz default now()`, so tests choose the time.

| Job                      | Schedule (UTC)            | Runs                              | Added by                              |
| ------------------------ | ------------------------- | --------------------------------- | ------------------------------------- |
| `purge-domain-events`    | `17 21 * * *` (02:47 IST) | `public.purge_domain_events()`    | `20261024181904_outbox.sql`           |
| `purge-session-activity` | `27 21 * * *` (02:57 IST) | `public.purge_session_activity()` | `20261102110929_session_activity.sql` |

- Supabase recommends at most 8 jobs running at once, each under 10 minutes.
- A paused Free project runs nothing; staging's schedules resume after a restore (ADR-002).
- `cron.job_run_details` keeps a row per run. One nightly job is harmless; the first every-minute schedule (P5.2)
  ships a cleanup for it.

## Retention

| What                    | Kept                                                                        |
| ----------------------- | --------------------------------------------------------------------------- |
| `domain_events`         | 30 days (`purge_domain_events`, nightly)                                    |
| a handled queue message | deleted when handled, never archived                                        |
| `job_failures`          | until an operator replays or closes it                                      |
| `audit_log`             | 13 months; no purge job yet (P9.5)                                          |
| `session_activity`      | until Supabase Auth removes the session (`purge_session_activity`, nightly) |

## Runbook

Local: `cd server && pnpm exec supabase db query --local "<sql>"`. Staging: the dashboard's SQL editor. Production is the
user's.

| To                                            | Run                                                                                                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| see each queue's depth and oldest message age | `select queue_name, queue_length, oldest_msg_age_sec from pgmq.metrics_all();`                                                                                 |
| look at waiting messages without taking them  | `select msg_id, read_ct, enqueued_at, message from pgmq.q_q_notifications order by msg_id limit 20;` (table `q_<queue>`)                                       |
| drop every waiting message in a queue         | `select pgmq.purge_queue('q_notifications');`                                                                                                                  |
| check the schedules and their last runs       | `select jobname, schedule, active from cron.job;` and `select status, return_message, start_time from cron.job_run_details order by start_time desc limit 20;` |
| list open dead letters                        | `select id, queue_name, attempts, last_error, failed_at from public.job_failures where resolved_at is null order by id;`                                       |
| replay a dead letter, then close it           | `select pgmq.send(queue_name, message) from public.job_failures where id = <id>;` then `update public.job_failures set resolved_at = now() where id = <id>;`   |
| purge old events now                          | `select public.purge_domain_events();`                                                                                                                         |
