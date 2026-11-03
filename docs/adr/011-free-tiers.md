# ADR-011: Supabase Free and GitHub Free

## Status

Accepted (2026-09-28), by the user. Amended (2026-11-03), by the user: the repository is public, so GitHub Free's
public-repository features apply (rulesets, secret scanning, unlimited Actions minutes) and the GitHub table below
records what the project now uses.

## Date

2026-09-28

## Context

The project runs on the free tiers of Supabase and GitHub. The repository (`The-KhaNha/KhaNha`) was private until
2026-11-03 and is public since. Several
parts of the roadmap and of P0 assumed paid features: branch rulesets with a required `ci-ok` check, CodeQL, unlimited
Actions minutes, Supabase's session inactivity timeout and daily backups. This ADR records what the free tiers
provide, what they do not, and what the project does instead.

## Options considered

1. **Stay on the free tiers and design around their limits.**
2. **Pay for Supabase Pro and GitHub Team.** Not chosen now; revisit before the paid pilot (P9.5) if a limit below
   starts to cost more than the plan.

## Decision

Use Supabase Free and GitHub Free. Everything the project builds must work within them.

### GitHub Free (public repository, since 2026-11-03)

| Feature                                                             | Available                                                           | What the project does                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rulesets, branch protection, required checks                        | yes (no while private)                                              | the `ci-ok required` ruleset, with no bypass, blocks a merge into `main`, `dev` or a listed `feat/P<n>` until `ci-ok` is green (a new phase branch is added to it when cut); the `Force push` ruleset on `main` blocks deletion and force pushes and requires a PR. Only the user merges into `main` (CLAUDE.md §21) |
| Secret scanning and push protection                                 | yes (no while private)                                              | on: GitHub scans every branch and its history and rejects a push that holds a known provider's key. gitleaks still runs on every PR (`ci.yml` `repo`) and weekly over every branch (`security.yml`)                                                                                                                  |
| Workflow runs from fork PRs                                         | approval setting                                                    | every outside contributor's run waits for approval; fork runs get no secrets and a read-only token                                                                                                                                                                                                                   |
| CodeQL (GitHub Code Security)                                       | yes (no while private)                                              | not run yet; Semgrep CE and `trivy config` analyse the code, Dockerfiles and workflows on every PR (`ci.yml` `static-analysis`); `npm audit`, `trivy image` and gitleaks cover dependencies, images and secrets (`security.yml`)                                                                                     |
| Actions                                                             | unlimited minutes on standard runners (2,000 a month while private) | heavy jobs still run only when their files changed (`ci.yml` `changes` job), which keeps a PR's run short; Lighthouse runs on merges to `dev` and on demand, not per PR push; the dependency audit and the image scan run weekly and on PRs that change dependencies or the images                                   |
| Repository secrets, labels, default branch, GitHub Apps, Dependabot | yes                                                                 | used as planned (the release App, `no-release` / `dependencies` labels, `dev` as default branch)                                                                                                                                                                                                                     |

### Supabase Free

| Limit                                                | Consequence                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two active projects per organisation                 | staging and production use both; there are no preview branches                                                                                                                                                                                                                                                                               |
| 500 MB database, shared CPU, 5 GB egress             | queues delete handled messages and trim old events ([ADR-002][adr-002]); photos stay out of the database (ADR-006)                                                                                                                                                                                                                           |
| Paused after 7 days without database activity        | production has daily traffic; staging may pause and is restored from the dashboard. A paused project runs no cron jobs                                                                                                                                                                                                                       |
| No downloadable backups                              | a scheduled `supabase db dump` of production to off-site storage is required before real users (P9.5)                                                                                                                                                                                                                                        |
| Session time-box and inactivity timeout are Pro only | the 7-day sign-out is enforced by the client alone (`sessionActivity.ts`); see below                                                                                                                                                                                                                                                         |
| pgmq (Queues) and pg_cron (Cron)                     | available, no extra cost ([ADR-002][adr-002])                                                                                                                                                                                                                                                                                                |
| PostgREST's own connection pool is small             | 10 locally (fixed by the CLI); hosted, sized with the compute and not documented (Nano/Micro: 60 Postgres connections, Supabase advises PostgREST under 40% of them). The API and the worker share it, so the worker never waits in the database: quick reads and a wait in the worker ([JOBS.md](../JOBS.md#the-worker-process) "Capacity") |

## Consequences

- The `ci-ok required` ruleset blocks a merge into `main`, `dev` or a listed `feat/P<n>` while `ci-ok` is red, so
  merge discipline is a setting as well as a rule. A new phase branch is added to the ruleset when it is cut.
  `docs/TESTING.md` describes the gate.
- Actions minutes are unlimited on standard runners while the repository is public, so they are no longer a monthly
  budget. A PR's run is still kept short by running heavy jobs only when their files changed (`ci.yml` `changes`
  job). Should the repository go private again, the 2,000-minute monthly limit and the missing ruleset return.
- **Session length is weaker on hosted projects.** Without the Pro inactivity timeout, a stolen refresh token keeps
  working until the user signs out, because the client-side cap cannot bind an attacker. A server-side check (record
  each user's last activity and refuse requests after `SESSION_IDLE_DAYS`) closes the gap. It is a follow-up for P1
  and needs a decision on where "last activity" is stored.
- Backups are the project's own job until a paid plan.

## Links

- [ADR-002][adr-002] (queues and cron on the free tier)
- [ADR-007][adr-007] (secrets outside GitHub)
- [P0 plan][p0] (the user steps that no longer apply)
- [P1 PR 15][p1-15] (the server-side idle check: per-session `session_activity`, enforced in `requireAuth`)
- [Supabase pricing](https://supabase.com/pricing), [project pausing](https://supabase.com/docs/guides/platform/free-project-pausing),
  [session limits](https://supabase.com/docs/guides/auth/sessions),
  [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)

[adr-002]: 002-outbox-pgmq-pg-cron.md
[adr-007]: 007-pilot-on-ec2-compose.md
[p0]: ../../plans/P0_FOUNDATIONS.md
[p1-15]: ../../plans/P1_PLATFORM_CORE.md#pr-15--server-side-idle-sign-out-adr-011-follow-up
