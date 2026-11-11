# Docs: who owns what

`docs/` holds how things are today; `CLAUDE.md` holds the rules; `plans/` holds where we are going. What each doc
covers is listed in the [README](../README.md#docs). This page is the ownership map that `CLAUDE.md` §6 enforces:
update the owning doc **in the same change**; a change that skips its doc is incomplete.

| You changed                                                                               | Update                                                                                                                            |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| an endpoint, request/response shape, error code or server rule                            | `docs/API.md` (+ `ErrorCode` in `server/src/utils/errors.ts`, DTOs on both sides)                                                 |
| a migration, table, column, enum, index or SQL function                                   | `docs/SCHEMA.md`                                                                                                                  |
| a queue, event subscription, pg_cron schedule, job handler or retention rule              | `docs/JOBS.md`                                                                                                                    |
| a role, route guard, RLS, grant, ownership rule or staff-only action                      | `docs/PERMISSIONS.md`                                                                                                             |
| a design token (colour, type, radius, shadow, motion) or a design rule                    | `docs/DESIGN.md`                                                                                                                  |
| a shared atom or variant, a `lib/` hook/util, feature rules                               | `docs/COMPONENTS.md`                                                                                                              |
| a page, route, feature folder, store or client service                                    | `docs/FRONTEND_STRUCTURE.md`                                                                                                      |
| a route, controller, service, middleware, schema or util module                           | `docs/BACKEND_STRUCTURE.md`                                                                                                       |
| an env var, environment, db push step, build step, production setup                       | `docs/DEPLOYMENT.md` + the `.env.example`                                                                                         |
| log levels, redaction, logging conventions                                                | `docs/LOGGING.md`                                                                                                                 |
| cache headers, the server read cache, client persisted caches, photo variants             | `docs/API.md` "Caching" + `docs/FRONTEND_STRUCTURE.md` "Caching"                                                                  |
| test targets, helpers, the edge-case matrix                                               | `docs/TESTING.md`                                                                                                                 |
| a workflow in `.github/`, a `scripts/ci/` check, the bundle budget                        | `docs/TESTING.md` "Continuous integration"                                                                                        |
| perf baselines                                                                            | `docs/PERF_BASELINE.md` (owned by `perf-auditor`)                                                                                 |
| a cross-cutting flow (auth, checkout, order lifecycle), a top-level dir, a system diagram | `docs/ARCHITECTURE.md`                                                                                                            |
| a site setting, a deployment setting or a platform limit                                  | `docs/CONFIGURATION.md` (the registry)                                                                                            |
| a decision worth recording                                                                | `docs/adr/NNN-title.md` from `docs/adr/0000-template.md`, indexed in `docs/adr/README.md` (`agent-skills:documentation-and-adrs`) |
| the change-intent format or level rules                                                   | `.changes/README.md` (+ §21)                                                                                                      |
| a release (written by `pnpm run release`, never by hand)                                  | `client/CHANGELOG.md`, `server/CHANGELOG.md`                                                                                      |
| quick start, scripts, demo                                                                | `README.md`                                                                                                                       |

One owner per topic; other docs link to it instead of copying. `docs-writer` applies this map after a major
change (`/post-change`).

Runtime compatibility, skill discovery, role adapters, plugin prompt setup and hook translation are owned by
[CODEX.md](CODEX.md). The source workflow rules remain in `.claude/rules/workflow.md`.
