# ADR-005: A modular monolith with three processes

## Status

Accepted (2026-10-24), by the user.

## Date

2026-09-28

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

| Process      | Entry point (`server/`) | Does                                | Scales                        |
| ------------ | ----------------------- | ----------------------------------- | ----------------------------- |
| `api`        | `src/server.ts`         | HTTP endpoints and payment webhooks | horizontally; stateless       |
| `worker`     | `src/worker.ts`         | consumes the pgmq queues            | horizontally                  |
| `reconciler` | `src/reconciler.ts`     | payment reconciliation only         | one active instance (a lease) |

Time-based transitions run in `pg_cron` inside Postgres, not in a process of ours.

## Consequences

- One server image; the command picks the process (P0.6).
- The layering from CLAUDE.md §4 stays as it is, and every process reuses the same services and SQL functions.
- The reconciler runs on every host, but only the holder of the `reconciler` lease works.
- The API never does long-running work.
- Splitting a process into its own service later remains possible, because the boundaries already exist.

## Links

- [Containers and processes][containers-and-processes]
- [P0.6 Docker images and local compose][p0.6]
- [P1.2 Background jobs: outbox, queues and scheduler][p1.2]
- [P5.10 Payment reconciliation service][p5.10]
- [P8.4 Compute on EC2][p8.4]
- [ADR-002][adr-002], [ADR-007][adr-007]

[containers-and-processes]: ../../plans/ROADMAP.md#containers-and-processes
[p0.6]: ../../plans/ROADMAP.md#p06-docker-images-and-local-compose
[p1.2]: ../../plans/ROADMAP.md#p12-background-jobs-outbox-queues-and-scheduler
[p5.10]: ../../plans/ROADMAP.md#p510-payment-reconciliation-service
[p8.4]: ../../plans/ROADMAP.md#p84-compute-on-ec2
[adr-002]: 002-outbox-pgmq-pg-cron.md
[adr-007]: 007-pilot-on-ec2-compose.md
