# ADR-005: A modular monolith with three processes

## Status

Accepted (2026-10-24), by the user.

Amended (2026-11-17), by the user:

- **The reconciler's lease is its queue.** It consumes a queue of its own (`q_reconciliation`), where a message is
  visible to one consumer at a time, and every action it takes is idempotent. No lease table is built.
- **Three processes, always.** If a host cannot hold them, the host is sized up; the reconciler is not folded into
  the worker.

## Date

2026-09-28 (accepted 2026-10-24), 2026-11-17 (amended)

## Context

Today `server/` runs one process, the Express API. The roadmap adds queue consumers (ADR-002) and asks for
"a separate service for reconciliation" (R29). These must deploy and fail independently of the API without
duplicating its domain logic, SQL functions, auth and scoping.

## Options considered

1. **One codebase, three processes: `api`, `worker` and `reconciler`.** They share `server/` but get their own
   container, command, environment and scaling.
2. **Separate repositories or services per domain.** Rejected: network hops, and duplicated auth and scoping code.

## Decision

One codebase, three processes (`api`, `worker`, `reconciler`): a modular monolith.

| Process      | Entry point (`server/`) | Does                                | Scales                                                             |
| ------------ | ----------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| `api`        | `src/server.ts`         | HTTP endpoints and payment webhooks | horizontally; stateless                                            |
| `worker`     | `src/worker.ts`         | consumes the pgmq queues            | horizontally                                                       |
| `reconciler` | `src/reconciler.ts`     | payment reconciliation only         | one consumer at a time, through its own queue (amended 2026-11-17) |

Time-based transitions run in `pg_cron` inside Postgres, not in a process of ours.

## Consequences

- One server image; the command picks the process (P0.6).
- The layering from CLAUDE.md §4 stays as it is, and every process reuses the same services and SQL functions.
- The reconciler may run on every host. It consumes its own queue, `q_reconciliation`: pgmq shows a message to one
  consumer at a time, so one instance does each piece of work, and each heal goes through an idempotent SQL
  function, so a repeat changes nothing. A lease table is added only if a measurement shows the queue is not
  enough (amended 2026-11-17; first written as "only the holder of the `reconciler` lease works").
- On the pilot's 1 GB host the reconciler is the fourth container. If the four do not fit, the host goes to the
  next size (`t4g.small`, [ADR-011][adr-011]); the reconciler's work is not moved into the worker (amended
  2026-11-17).
- The API never does long-running work.
- Splitting a process into its own service later remains possible, because the boundaries already exist.

## Links

- [Containers and processes][containers-and-processes]
- [P0.6 Docker images and local compose][p0.6]
- [P1.2 Background jobs: outbox, queues and scheduler][p1.2]
- [P5.10 Payment reconciliation service][p5.10]
- [P8.4 Compute on EC2][p8.4]
- [ADR-002][adr-002], [ADR-007][adr-007], [ADR-011][adr-011]
- [P5 plan, PR 20][p5-plan]

[containers-and-processes]: ../../plans/ROADMAP.md#containers-and-processes
[p0.6]: ../../plans/ROADMAP.md#p06-docker-images-and-local-compose
[p1.2]: ../../plans/ROADMAP.md#p12-background-jobs-outbox-queues-and-scheduler
[p5.10]: ../../plans/ROADMAP.md#p510-payment-reconciliation-service
[p8.4]: ../../plans/ROADMAP.md#p84-compute-on-ec2
[adr-002]: 002-outbox-pgmq-pg-cron.md
[adr-007]: 007-pilot-on-ec2-compose.md
[adr-011]: 011-free-tiers.md
[p5-plan]: ../../plans/P5_PAYMENTS.md#pr-20--the-reconciler-its-process-and-its-sweeps-p510
