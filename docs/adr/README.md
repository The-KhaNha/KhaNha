# Architecture decision records

An ADR records one architectural decision: the context, the options weighed, the choice and its consequences. The
roadmap's [Architecture decisions][architecture-decisions] table is the summary; these files are the full record,
and later phases link to the ADRs they depend on.

## Adding one

1. Copy [0000-template.md][0000-template] to `NNN-short-title.md`, using the next free number.
2. Fill every section. Link the roadmap steps that depend on it.
3. Start at `Status: Proposed`. Only the user moves an ADR to `Accepted`, or asks for it to be amended.
4. Never rewrite an accepted decision. Write a new ADR that supersedes it, and set the old one to
   `Superseded by ADR-NNN`.
5. Add a row to the index below.

## Index

| ADR   | Title                                                              | Status            | Roadmap step                 |
| ----- | ------------------------------------------------------------------ | ----------------- | ---------------------------- |
| [001] | Brands are templates for their stores                              | Accepted, amended | [P2][p2], [P3.1][p3.1]       |
| [002] | Background work: outbox, pgmq and pg_cron                          | Accepted          | [P1.2][p1.2]                 |
| [003] | The payment aggregator and money model are chosen in P4            | Proposed          | [P4][p4], [P5][p5]           |
| [004] | Money in paise in the database, rupees at the API                  | Accepted, amended | [P5.1][p5.1], [P5.6][p5.6]   |
| [005] | A modular monolith with three processes                            | Accepted          | [P1.2][p1.2], [P5.10][p5.10] |
| [006] | Media in S3 behind CloudFront                                      | Accepted, amended | [P3.3][p3.3], [P8.3][p8.3]   |
| [007] | Pilot on EC2 with docker compose                                   | Accepted          | [P0.6][p0.6], [P8.4][p8.4]   |
| [008] | Semantic versioning from change intents                            | Accepted          | [P0.3][p0.3]                 |
| [009] | Rate limiting per user in the API, in the database and at the edge | Accepted, amended | [P1.6][p1.6], [P9.3][p9.3]   |
| [010] | Live updates through polling plus Web Push                         | Accepted          | [P6.3][p6.3], [P10.3][p10.3] |
| [011] | Supabase Free and GitHub Free                                      | Accepted, amended | all (constraints)            |

[p0.3]: ../../plans/ROADMAP.md#p03-semantic-versioning-with-change-intents
[p0.6]: ../../plans/ROADMAP.md#p06-docker-images-and-local-compose
[p1.2]: ../../plans/ROADMAP.md#p12-background-jobs-outbox-queues-and-scheduler
[p1.6]: ../../plans/ROADMAP.md#p16-rate-limiting-and-abuse-protection-v1
[p2]: ../../plans/ROADMAP.md#p2--multi-store-and-multi-branch
[p3.1]: ../../plans/ROADMAP.md#p31-catalog-for-multi-branch-brands
[p3.3]: ../../plans/ROADMAP.md#p33-images-on-s3
[p4]: ../../plans/ROADMAP.md#p4--payment-aggregator-research-and-selection
[p5]: ../../plans/ROADMAP.md#p5--payments-escrow-and-refunds
[p5.1]: ../../plans/ROADMAP.md#p51-payment-gateway-port-and-adapter
[p5.6]: ../../plans/ROADMAP.md#p56-ledger-and-escrow
[p5.10]: ../../plans/ROADMAP.md#p510-payment-reconciliation-service
[p6.3]: ../../plans/ROADMAP.md#p63-notifications
[p8.3]: ../../plans/ROADMAP.md#p83-media-bucket-and-cdn
[p8.4]: ../../plans/ROADMAP.md#p84-compute-on-ec2
[p9.3]: ../../plans/ROADMAP.md#p93-edge-protection-and-security-review
[p10.3]: ../../plans/ROADMAP.md#p103-realtime-updates-if-polling-costs-too-much
[architecture-decisions]: ../../plans/ROADMAP.md#architecture-decisions
[0000-template]: 0000-template.md
[001]: 001-brands-own-stores.md
[002]: 002-outbox-pgmq-pg-cron.md
[003]: 003-payment-aggregator-chosen-in-p4.md
[004]: 004-rupees-and-paise.md
[005]: 005-modular-monolith-three-processes.md
[006]: 006-media-s3-cloudfront.md
[007]: 007-pilot-on-ec2-compose.md
[008]: 008-semver-from-change-intents.md
[009]: 009-rate-limiting-token-buckets.md
[010]: 010-polling-plus-web-push.md
[011]: 011-free-tiers.md
