# Jobs

Background work: the outbox, the queues and the schedules ([ADR-002](adr/002-outbox-pgmq-pg-cron.md)). Tables and
functions in detail: [SCHEMA.md](SCHEMA.md). The job runner is [below](#handlers-and-the-runner); the worker process
that runs it arrives in P1 PR 04 ([plan](../plans/P1_PLATFORM_CORE.md)).

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

`runQueue(handler, { signal, log })` reads up to the free concurrency slots at a time, waiting up to `POLL_SECONDS`
(5) for a first message. That stays under the 8 s statement timeout PostgREST's `authenticator` role runs with
(Supabase's default; `service_role` inherits it), and under the worker's shutdown grace. On abort it stops reading,
leaves anything read during the abort unstarted (back after its visibility timeout), and resolves once the handlers in
flight finish. A failing read (the database unreachable) backs off 1 s → 5 s. If recording an outcome fails, the
message simply comes back. A message never read, or one that is not a domain event, is an `InvariantError`:
dead-lettered, logged with `invariant: true`. Log lines: [LOGGING.md](LOGGING.md#jobs).

| Handler         | Queue             | Concurrency | Visibility | Attempts | Backoff     | Does (until P6.3)                        |
| --------------- | ----------------- | ----------- | ---------- | -------- | ----------- | ---------------------------------------- |
| `notifyHandler` | `q_notifications` | 4           | 30 s       | 5        | 5 s → 900 s | logs `info` "Order event" with `orderId` |

## Schedules

Registered by migrations with `cron.schedule(name, schedule, command)`. Scheduling an existing name replaces it. Each
schedule calls a SQL function that takes `p_now timestamptz default now()`, so tests choose the time.

| Job                   | Schedule (UTC)            | Runs                           | Added by                    |
| --------------------- | ------------------------- | ------------------------------ | --------------------------- |
| `purge-domain-events` | `17 21 * * *` (02:47 IST) | `public.purge_domain_events()` | `20261024181904_outbox.sql` |

- Supabase recommends at most 8 jobs running at once, each under 10 minutes.
- A paused Free project runs nothing; staging's schedules resume after a restore (ADR-002).
- `cron.job_run_details` keeps a row per run. One nightly job is harmless; the first every-minute schedule (P5.2)
  ships a cleanup for it.

## Retention

| What                    | Kept                                     |
| ----------------------- | ---------------------------------------- |
| `domain_events`         | 30 days (`purge_domain_events`, nightly) |
| a handled queue message | deleted when handled, never archived     |
| `job_failures`          | until an operator replays or closes it   |

## Runbook

Local: `cd server && npx supabase db query --local "<sql>"`. Staging: the dashboard's SQL editor. Production is the
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
