# P0 — Foundations and guardrails: implementation plan

The PR-by-PR plan for [ROADMAP.md P0](ROADMAP.md#p0--foundations-and-guardrails). The roadmap says what P0 builds and
why; this file says in which order, in which pull requests, with which files, tests, docs and checks. When the two
disagree, the roadmap's design wins and this file is fixed. When a PR merges, tick its box here and in the roadmap.

> **Status: done**. PRs 01–16 are merged into `dev`. P0 was sized **L** for a team of two or three.

## How the team works P0

- **Branches.** Feature branches → PR into `dev` (CI required; `dev` deploys staging from P8.5) → a release PR into
  `main` (production, merged by the user) → a back-merge PR into `dev`. Hotfixes branch off `main` as `hotfix/*`.
  Only the user merges into `main`. Migrations are immutable once merged into `dev`.
- **Every PR below** merges into `dev` on its own with `ci-ok` green, one concern per PR, one to two days of work.
  Follow CLAUDE.md: `/before-write` for anything new, the gate (`npm run typecheck && npm run lint && npm test`) in
  every touched package (the server needs `npm run db:start && npm run seed`), `/post-change` when the PR is a major
  change (CLAUDE.md §17), the owning docs (§6) updated in the same PR, and a change intent from PR 05 onward.
- **Node 24 everywhere**, any installer. **LF line endings everywhere** (PR 01 makes both mechanical).
- **Repository-level scripts** live in `scripts/` (`scripts/version/*.mjs`, `scripts/ci/*.mjs`), are tested with
  `node --test`, and are formatted by a root `package.json` whose only devDependency is `prettier` (it also covers
  `.github/**` and `plans/**`). This is the one deviation from the roadmap's "root `package.json` with no
  dependencies"; the root is still not a workspace.
- **Verification** is plain bash. Probe with `curl -s -o /dev/null -w '%{http_code}' <url>`.

## Build order

| #   | PR                                                                                                       | Step | Depends on |
| --- | -------------------------------------------------------------------------------------------------------- | ---- | ---------- |
| 01  | Toolchain pin + line endings                                                                             | P0.1 | –          |
| 02  | `ci.yml` static jobs, `ci-ok`, bundle budget, Dependabot, PR template                                    | P0.2 | 01         |
| 03  | Supabase in CI, migrations job, generated-types drift                                                    | P0.2 | 02         |
| 04  | `security.yml`                                                                                           | P0.2 | 02         |
| 05  | Versioning: scripts, `.changes/`, `version-intent` job, `release.yml`, hook and CLAUDE.md wiring         | P0.3 | 02         |
| 06  | ADR-001..010 — docs only, **in parallel with 02–05**; ADR-002 and ADR-007 accepted before PR 09          | P0.8 | 01         |
| 07  | Health + version, readiness, keep-alive, `X-Client-Version`, status fallback                             | P0.7 | 05         |
| 08  | `min_client_version` migration, the 426 gate, the client's "outdated" handling                           | P0.7 | 03, 07     |
| 09  | Dockerfiles, nginx template, runtime env                                                                 | P0.6 | 07         |
| 10  | `compose.yaml`, the `images` CI job                                                                      | P0.6 | 09         |
| 11  | Lighthouse CI `perf.yml`                                                                                 | P0.2 | 10         |
| 12  | Error classes, cause chains, redaction                                                                   | P0.5 | 05         |
| 13  | Config a: `site_settings` columns, admin form, `docs/CONFIGURATION.md`                                   | P0.4 | 08         |
| 14  | Config b: `GET /api/config`, `useConfig`, fallbacks and parity, poll intervals from config               | P0.4 | 13         |
| 15  | Config c: `MenuResponse.rules`, `max_lines_per_order` enforced in the service                            | P0.4 | 14         |
| 16  | Config d: seed fixture module, env-driven ports, TTL and trust proxy, `APP_TITLE`, duration grep, policy | P0.4 | 14         |

Why this order: CI first so everything after is gated; versioning early so intents accumulate from the start; health
and the version gate before the images that health-check them; ADRs in parallel because P0.6 commits to two of them;
error classes before the configuration registry so a database outage during `/api/config` answers 503; the
configuration registry last because it is the largest step and blocks nothing else.

## Cross-cutting decisions

- **CI shape.** One workflow for correctness (`ci.yml`) whose aggregate job `ci-ok` is the single required check on
  `dev` and `main`; `perf.yml` and `security.yml` are informational. No `paths:` filters in `ci.yml`: a path-filtered
  required check leaves unrelated PRs stuck at "Expected". PR-only jobs (`migrations`, `version-intent`) are skipped
  on pushes, and `ci-ok` treats skipped as success.
- **Release flow.** The version bump happens inside a **release PR** (`release/<date>` off `dev`, opened by
  `release.yml`), never as a bot commit on `main`, which a ruleset would block without a bypass token. The user
  merging the release PR is the production approval. On the merge, `release.yml` tags `client-vX` and `server-vY` and
  opens the back-merge PR into `dev`. Both bot PRs use a GitHub App token, because PRs opened with `GITHUB_TOKEN` do
  not trigger CI; without the App, the workflow pushes the branch and prints the compare URL for the user to open.
- **Images.** Staging images are built from `dev` and tagged `dev-<sha7>` (plus a moving `dev`); production images are
  built from `main` after the release PR merged and tagged with the semver and the SHA. Digests are not promoted
  between the two, because the release commit makes the trees differ; `/api/health` reports version and commit in
  both. P8.2's registry scan is the image scan, so P0 ships no Trivy step.
- **Scope trims** (each with its reason in the roadmap): server-driven `pollAfterMs` waits for P9.1's measurements;
  seed data becomes a typed fixture module, not JSON plus zod; no ESLint `no-magic-numbers` rule, only the duration
  grep; `InvariantError` arrives with its first thrower in P1.2; the client error reporter moves to P1.6 with the rate
  limiter.

## The pull requests

Merged pull requests are collapsed to a summary and links; their full specifications are in this file's history.

### PR 01 — Toolchain pin and line endings (P0.1)

- [x] Merged

Node 24 is pinned for every installer, the packages refuse another major, and the repository normalises line endings to LF.

Now documented in: [README.md](../README.md) "Prerequisites"

### PR 02 — CI static jobs, `ci-ok`, bundle budget, Dependabot, PR template (P0.2)

- [x] Merged

CI runs the static jobs on every pull request into `dev` and `main`, gated by one required `ci-ok` check, with the initial-JS budget in `client/perf-budget.json`, grouped Dependabot updates and a pull request template.

Now documented in: [docs/TESTING.md "Continuous integration"](../docs/TESTING.md#continuous-integration) (including Dependabot)

### PR 03 — Supabase in CI, migrations job, generated-types drift (P0.2)

- [x] Merged

The server suite runs against a slim local Supabase in CI, generated types are checked for drift, and a `migrations` job rejects edits to pushed migrations and out-of-order timestamps.

Now documented in: [docs/TESTING.md "Continuous integration"](../docs/TESTING.md#continuous-integration)

### PR 04 — `security.yml` (P0.2)

- [x] Merged

`security.yml` runs `npm audit` and a gitleaks scan on pull requests and weekly, as an advisory check; CodeQL stayed a user step.

Now documented in: [docs/TESTING.md "Security checks"](../docs/TESTING.md#security-checks-securityyml), [docs/adr/011-free-tiers.md](../docs/adr/011-free-tiers.md) (CodeQL)

### PR 05 — Versioning with change intents (P0.3)

- [x] Merged

Versions come from change intents in `.changes/`: `change`, `release` and `check` scripts, a release workflow that opens the release PR and the back-merge, and the branch model in the agent rules.

Now documented in: [.changes/README.md](../.changes/README.md), [.claude/rules/workflow.md §21](../.claude/rules/workflow.md#21-branches-pr-size-versions-and-releases), [docs/adr/008-semver-from-change-intents.md](../docs/adr/008-semver-from-change-intents.md)

### PR 06 — Architecture decision records (P0.8)

- [x] Merged

ADR-001 to ADR-010 were written from the roadmap's decision table with a template and an index.

Now documented in: [docs/adr/README.md](../docs/adr/README.md#index)

### PR 07 — Health, readiness, keep-alive, client version (P0.7a)

- [x] Merged

`/api/health` reports version and commit, `/api/ready` probes the database in about a second, keep-alive is tuned for the load balancer, and every request carries `X-Client-Version`.

Now documented in: [docs/API.md "GET /health"](../docs/API.md#get-health), [docs/API.md "GET /ready"](../docs/API.md#get-ready), [docs/DEPLOYMENT.md "Server environment variables"](../docs/DEPLOYMENT.md#server-environment-variables), [docs/LOGGING.md](../docs/LOGGING.md)

### PR 08 — `min_client_version` and the 426 gate (P0.7b)

- [x] Merged

`site_settings.min_client_version` and a gate that answers 426 `CLIENT_OUTDATED` to older clients, with a refresh banner in the client.

Now documented in: [docs/API.md "Client version gate"](../docs/API.md#client-version-gate)

### PR 09 — Dockerfiles, nginx, runtime env (P0.6a)

- [x] Merged

The API and web Dockerfiles, nginx with security headers and a report-only CSP, and a runtime env script so one web image serves any environment.

Now documented in: [docs/DEPLOYMENT.md "Containers"](../docs/DEPLOYMENT.md#containers), [docs/DEPLOYMENT.md "Web image runtime environment"](../docs/DEPLOYMENT.md#web-image-runtime-environment)

### PR 10 — `compose.yaml` and the `images` CI job (P0.6b)

- [x] Merged

`compose.yaml` runs the API and web images against the host's Supabase, and the `images` CI job builds, lints and smoke-tests both.

Now documented in: [docs/DEPLOYMENT.md "Local compose"](../docs/DEPLOYMENT.md#local-compose), [docs/TESTING.md "Continuous integration"](../docs/TESTING.md#continuous-integration)

### PR 11 — Lighthouse CI (P0.2, deferred until the compose stack exists)

- [x] Merged

`perf.yml` runs Lighthouse against the compose stack at the mobile budgets as an advisory check.

Now documented in: [docs/TESTING.md "Lighthouse"](../docs/TESTING.md#lighthouse-perfyml)

### PR 12 — Error classes, cause chains, redaction (P0.5)

- [x] Merged

`IntegrationError` with cause chains maps to 503 `UPSTREAM_UNAVAILABLE`, and the logger redacts the wider set of secret and personal keys.

Now documented in: [docs/LOGGING.md "Error classes"](../docs/LOGGING.md#error-classes), [docs/LOGGING.md "Never logged"](../docs/LOGGING.md#never-logged), [docs/API.md "Errors"](../docs/API.md#errors)

### PR 13 — Config a: `site_settings` columns and the admin form (P0.4)

- [x] Merged

The order-lines limit and the three polling intervals became `site_settings` columns, editable from the admin form, which renders from a registry.

Now documented in: [docs/CONFIGURATION.md "Site settings"](../docs/CONFIGURATION.md#site-settings)

### PR 14 — Config b: `GET /api/config`, `useConfig`, fallbacks and parity (P0.4)

- [x] Merged

`GET /api/config` serves limits, polling and session settings, and the client reads them through `useConfig` with parity-tested fallbacks.

Now documented in: [docs/API.md "GET /config"](../docs/API.md#get-config), [docs/CONFIGURATION.md](../docs/CONFIGURATION.md)

### PR 15 — Config c: menu rules and the lines limit (P0.4)

- [x] Merged

`GET /api/menu` carries the cart `rules`, and `createOrder` enforces the `max_lines_per_order` site setting.

Now documented in: [docs/CONFIGURATION.md "Site settings"](../docs/CONFIGURATION.md#site-settings), [docs/API.md "Headers and limits"](../docs/API.md#headers-and-limits)

### PR 16 — Config d: fixtures, env-driven ports and TTL, policy (P0.4)

- [x] Merged

Seed data became a typed fixture module, the dev ports, cache TTL and proxy hops came from env, and `check:durations` guards against hard-coded durations.

Now documented in: [docs/CONFIGURATION.md "What stays in code"](../docs/CONFIGURATION.md#what-stays-in-code), [docs/DEPLOYMENT.md "Server environment variables"](../docs/DEPLOYMENT.md#server-environment-variables)

## A1 rows: resolved in P0, and deferred

Resolved: `MAX_ITEM_LINES` (site setting, PR 13/15); the three poll constants (PR 14); `PUBLIC_READ_TTL_MS` (PR 16);
`REQUEST_TIMEOUT_MS` (runtime env, PR 09); `SESSION_IDLE_TTL_MS` (env-served through `/api/config`, PR 14); the
name, note, password and phone bounds (platform constants with a parity test, PR 14); the seed `STORE`, `MENU` and
accounts (fixture module, PR 16); ports 8000 and 5173 and the 54321 probe (PR 16); `APP_TITLE` (PR 16).

Deferred, per the roadmap: `MAX_QUANTITY_PER_ITEM`, `MAX_LINE_QUANTITY` and `LOW_STOCK_MAX` → P2.3 (served in
`rules` from PR 15, consumed there); `prep_time_*` → P6.1; `order_number` → P6.2; the checkout copy → P5.3.
`STAGING_REF` / `PRODUCTION_REF`, the presentation constants and `CACHE_PREFIX` stay by design.

## CLAUDE.md edits, aggregated

| Section  | Change                                                                                                                                                                                       | PR             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| preamble | `plans/` holds where we are going                                                                                                                                                            | done           |
| §2       | migrations append-only "enforced by the `migrations` CI job"; a change the deployed client cannot survive ships with a `min_client_version` bump                                             | 03, 08         |
| §2c      | "Future (Docker + nginx)" becomes present tense and points at DEPLOYMENT.md "Containers"                                                                                                     | 09             |
| §3       | Node 24 pin; root scripts table (`change`, `release`, `release:dry`, `change:check`, `check:bundle`, `check:migrations`, `check:durations`, `format:check`); ports sentence; compose on 8080 | 01, 05, 10, 16 |
| §6       | rows: `.changes/README.md` and the CHANGELOGs; `docs/adr/`; `docs/CONFIGURATION.md`; workflow changes → `docs/TESTING.md` "Continuous integration"                                           | 05, 06, 13     |
| §8       | config from the API, never mirrored (fallbacks parity); intervals from `useConfig().polling`                                                                                                 | 14             |
| §10      | the error classes bullet                                                                                                                                                                     | 12             |
| §11      | the no-hardcoding policy and the CI grep                                                                                                                                                     | 16             |
| §12      | the release commit inside the release PR is the one automated commit; only the user merges into `main`                                                                                       | 05             |
| §13      | CI runs the gate on every PR into `dev` and `main`                                                                                                                                           | 02             |
| §17      | keep `major-change-gate.js`'s intent reminder in sync (no path changes in P0)                                                                                                                | 05             |
| §18      | compose as a backgrounded process; probe `/healthz`                                                                                                                                          | 10             |
| §19      | `clientVersion` on access lines; the 503 row; 426 at `debug`                                                                                                                                 | 07, 08, 12     |
| new      | "Versioning and branches"                                                                                                                                                                    | 05             |

## User steps (cannot be done from the repository)

> **GitHub Free and Supabase Free** ([ADR-011](../docs/adr/011-free-tiers.md), 28 September 2026): the repository is
> private on GitHub Free, so rulesets, required checks and CodeQL are not available and those steps are dropped;
> `ci-ok` is advisory and merging only on green is a rule. `ci.yml` gates its heavy jobs by changed paths to fit the
> 2,000 Actions minutes a month. The remaining steps below still apply.

- ~~Rulesets on `dev` and `main`~~ (not on GitHub Free for a private repository).
- Make `dev` the GitHub default branch.
- Labels `no-release` and `dependencies`.
- The release GitHub App (contents and pull-requests write), installed on the repository, with `RELEASE_APP_ID` and
  `RELEASE_APP_PRIVATE_KEY` as secrets.
- ~~CodeQL default setup~~ (not eligible: private repository on GitHub Free).
- Accept or amend ADR-001..010; ADR-002 and ADR-007 were accepted on 28 September 2026.
- Decide when the CSP moves from Report-Only to enforced.

## Risks and gotchas

- **JWT issuer vs the container's Supabase URL** (PR 09): test sign-in through the container in the first hour; fall
  back to host networking on Linux.
- **Renormalisation** (PR 01) may touch many files; keep it alone in its PR.
- **`supabase start` in CI** pulls about 1 GB of images (2–4 min); the CLI is pinned through the lockfile, and the
  `-x` service names are version specific.
- **Required checks with path filters hang PRs**: only `ci-ok` is required; `perf.yml` and `security.yml` are not.
- **PRs opened with `GITHUB_TOKEN` do not trigger CI**: hence the GitHub App token for the release and back-merge PRs.
- **`headersTimeout` must exceed `keepAliveTimeout`**; the 10 s shutdown deadline stays under Docker's SIGKILL.
- **nginx `add_header` inheritance**: include the security snippet in every location. **`API_UPSTREAM`** takes no
  trailing slash.
- **CSP**: the inline `onload=` in `index.html` moves into `main.tsx`; ship Report-Only first.
- **Vite `define` in tests**: `__APP_VERSION__` must also be defined in `vitest.config.ts`.
- **CodeQL** needs a public repository or GitHub Code Security; **gitleaks-action** needs a licence for organisation
  repositories (use the binary).
