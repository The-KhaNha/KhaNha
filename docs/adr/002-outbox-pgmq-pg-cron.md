# ADR-002: Background work through an outbox, pgmq and pg_cron

## Status

Proposed

## Date

2026-09-28

## Context

R28 needs asynchronous work: notifications, analytics, expired holds and pickup windows, reconciliation, refund
retries, media variants and recommendations. Today every piece of work happens inside a request. A state change and
the work it triggers must never disagree: an order that commits must always produce its events, and a transaction
that raises must leave none behind.

## Options considered

1. **Transactional outbox into pgmq in the existing Postgres, a Node worker, and pg_cron for time triggers.**
   Enqueuing is part of the same transaction as the state change, and nothing is added outside Supabase.
2. **BullMQ on Redis, or SQS.** Rejected: a dual write (commit, then enqueue) that can lose or invent events, plus
   new infrastructure to run.

## Decision

Background work uses a transactional outbox into **pgmq** (Supabase Queues) inside the existing Postgres, a Node
worker process to consume the queues, and **pg_cron** (Supabase Cron) for time-based triggers.

- `emit_event(...)` inserts a `domain_events` row and sends it to every subscribed queue. Every transition function
  calls it before returning, so the state change and its events commit together or not at all.
- The worker (`server/src/worker.ts`) reads each queue, retries with backoff and jitter, and dead-letters into
  `job_failures` after `maxAttempts`.
- pg_cron schedules are registered by migrations. Each calls a SQL transition function, or enqueues a message when the
  work needs an external call.

## Consequences

- No new infrastructure, and no dual-write window.
- Delivery is at least once, so every handler must be idempotent through natural unique keys; `event_handled` is only
  an optimisation.
- Queue wrappers are `security definer` functions granted to `service_role` only, rather than exposing
  `pgmq_public`.
- Every time-based SQL function takes `p_now timestamptz default now()`, so tests choose the time instead of sleeping.
- Queue load lands on the same Postgres as the app, which the load tests must cover.
- Both extensions must be available on the Supabase plan tier and in the local CLI stack; verify this before P1.2
  starts.
- This ADR must be accepted before P0.6 commits to the compose layout.

## Links

- [P1.2 Background jobs: outbox, queues and scheduler][p1.2]
- [P0.6 Docker images and local compose][p0.6]
- [P0.8 Architecture decision records][p0.8]
- Consumers: [P5.2][p5.2], [P5.7][p5.7],
  [P5.9][p5.9], [P5.10][p5.10],
  [P6.3][p6.3], [P7.1][p7.1], [P7.7][p7.7]
- [ADR-005][adr-005] (the worker as its own process)

[p1.2]: ../../plans/ROADMAP.md#p12-background-jobs-outbox-queues-and-scheduler
[p0.6]: ../../plans/ROADMAP.md#p06-docker-images-and-local-compose
[p0.8]: ../../plans/ROADMAP.md#p08-architecture-decision-records
[p5.2]: ../../plans/ROADMAP.md#p52-order-lifecycle-v2-and-stock-holds
[p5.7]: ../../plans/ROADMAP.md#p57-refunds
[p5.9]: ../../plans/ROADMAP.md#p59-sla-breaches-and-pickup-windows
[p5.10]: ../../plans/ROADMAP.md#p510-payment-reconciliation-service
[p6.3]: ../../plans/ROADMAP.md#p63-notifications
[p7.1]: ../../plans/ROADMAP.md#p71-analytics-pipeline
[p7.7]: ../../plans/ROADMAP.md#p77-recommender-v1
[adr-005]: 005-modular-monolith-three-processes.md
