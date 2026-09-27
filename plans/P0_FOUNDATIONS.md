# P0 — Foundations and guardrails: implementation plan

The PR-by-PR plan for [ROADMAP.md P0](ROADMAP.md#p0--foundations-and-guardrails). The roadmap says what P0 builds and
why; this file says in which order, in which pull requests, with which files, tests, docs and checks. When the two
disagree, the roadmap's design wins and this file is fixed. When a PR merges, tick its box here and in the roadmap.

> **Status: approved plan, nothing built yet** (28 September 2026). P0 is sized **L** for a team of two or three.

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

### PR 01 — Toolchain pin and line endings (P0.1)

- [ ] Merged

| File                                                    | Purpose                                                                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.nvmrc`, `.node-version` (both `24`)                   | nvm reads the first; fnm and nodenv read both; `actions/setup-node` reads `.node-version`                                                                                      |
| `client/.npmrc`, `server/.npmrc` (`engine-strict=true`) | `npm ci` and `npm install` refuse another Node major (`EBADENGINE`); this covers Volta and plain installs                                                                      |
| `client/package.json`, `server/package.json`            | `"engines": { "node": "24.x" }`; server `@types/node` → `^24`                                                                                                                  |
| root `package.json`                                     | `private`, `engines`, devDependency `prettier`, scripts `format` and `format:check` (`scripts/**`, `.github/**`, `plans/**`); later PRs add their scripts                      |
| `.gitattributes`                                        | keep the graphify merge line; add `* text=auto eol=lf`, `*.sh text eol=lf`, `*.template text eol=lf`, `Dockerfile* text eol=lf`, `*.{png,jpg,jpeg,webp,ico,woff,woff2} binary` |
| `README.md`, `CLAUDE.md` §3                             | prerequisites "Node 24 with any installer; `npm ci` refuses other majors" (replacing "Node 20+ … Node 26"); tooling row                                                        |

Details: inspect `git ls-files --eol` first, then run `git add --renormalize .` once in this PR and nowhere else, so
the renormalisation diff stays isolated.

Verify: `node -v` prints 24.x; `npm ci` in both packages; the gate in both; in a Node 22 shell `npm ci` fails with
`EBADENGINE`; `git ls-files --eol | grep -c crlf` prints 0.

### PR 02 — CI static jobs, `ci-ok`, bundle budget, Dependabot, PR template (P0.2)

- [ ] Merged

| File                               | Purpose                                                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`         | triggers `pull_request: { branches: [dev, main] }` and `push: { branches: [dev, main] }`; jobs `client`, `server-static`, `repo`, `ci-ok`                               |
| `client/vite.config.ts`            | `build.manifest: true`                                                                                                                                                  |
| `client/perf-budget.json`          | `{ "initialJsGzipKb": 170 }` — the budget lives in a file, not in the script                                                                                            |
| `scripts/ci/check-bundle.mjs`      | entry chunk plus its static `imports` from `client/dist/.vite/manifest.json`, gzip level 9, a table, exit 1 when over; lazy chunks listed for information               |
| `.github/dependabot.yml`           | npm in `/client` and `/server`, `github-actions`, `docker` (active from PR 09); weekly; grouped minor/patch; `target-branch: dev`; `labels: [dependencies, no-release]` |
| `.github/pull_request_template.md` | checkboxes: intent recorded or `no-release`; docs updated per §6; migration expand/contract stage stated; `/post-change` run                                            |
| `docs/TESTING.md`, `CLAUDE.md` §13 | a "Continuous integration" section replaces "Staging later (GitHub Actions)"; §13 gains "CI runs the same gate on every PR into `dev` and `main`"                       |

Details:

- `concurrency: { group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}, cancel-in-progress: ${{ github.event_name == 'pull_request' }} }`.
- `actions/setup-node@v4` with `node-version-file: .node-version`, `cache: npm`, `cache-dependency-path` per package.
- `client`: `npm ci`, typecheck, lint, `format:check`, test, `build:staging`, `node scripts/ci/check-bundle.mjs`.
  `server-static`: `npm ci --ignore-scripts` (skips the Supabase CLI binary download), typecheck, lint,
  `format:check`, build. `repo`: root `npm ci`, `format:check`, `node --test scripts`.
- `ci-ok`: `needs` every other job, `if: always()`, fails when any result is `failure` or `cancelled`; `skipped`
  counts as success.

Verify: `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest -color`; a draft PR into `dev` shows `ci-ok`
green; setting the budget to 10 turns the `client` job red.

User steps: labels `no-release` and `dependencies`; rulesets on `dev` and `main` requiring a PR and `ci-ok` (no
bypass list; `main` accepts PRs from `release/*` and `hotfix/*` only); make `dev` the GitHub default branch.

### PR 03 — Supabase in CI, migrations job, generated-types drift (P0.2)

- [ ] Merged

| File                                   | Purpose                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/package.json`                  | script `db:start:ci`: `supabase start -x studio,storage-api,imgproxy,mailpit,realtime,edge-runtime,logflare,vector,supavisor,postgres-meta` (the devDependency CLI, pinned by the lockfile; check the `-x` names against `npx supabase start --help`)                                                                       |
| `.github/workflows/ci.yml`             | job `server-tests`: `npm ci`, `npm run db:start:ci`, `cp .env.example .env`, `npm run seed`, `npm test`, then `npm run db:types && git diff --exit-code -- src/types/database.ts`; `timeout-minutes: 15`; `if: always()` → `npm run db:stop`. Job `migrations`: `if: github.event_name == 'pull_request'`, `fetch-depth: 0` |
| `scripts/ci/check-migrations.mjs`      | `--base origin/<base>`: `git diff --name-status --no-renames <base>...HEAD -- server/supabase/migrations/` may contain only `A` rows; every added 14-digit prefix sorts after the newest on the base; files already on `origin/main` are ignored (hotfix back-merges)                                                       |
| `scripts/ci/check-migrations.test.mjs` | `node --test` against a scratch repository, the same technique as `major-change-gate.js --self-test`                                                                                                                                                                                                                        |
| `docs/TESTING.md`, `CLAUDE.md` §2      | what runs in CI, the 15-minute budget, how to reproduce locally; §2 "append-only once pushed (enforced by the `migrations` CI job)"                                                                                                                                                                                         |

Details: `cp .env.example .env` works because `server/.env.example` already holds the local CLI's default keys and
`http://127.0.0.1:54321`, so the test-target guard sees `APP_ENV=local`. `run-lock.ts` needs nothing: one job, one
test process. Expect 8–10 minutes for the whole workflow (image pulls 2–4 min, tests 1–3 min).

Verify: a branch that edits an existing migration turns `migrations` red; one that adds an older-timestamped migration
turns it red; a clean branch is green and `database.ts` shows no drift.

### PR 04 — `security.yml` (P0.2)

- [ ] Merged

Triggers: PRs into `dev` and `main`, and a weekly schedule. Not a required check. Jobs: `audit`
(`npm audit --omit=dev --audit-level=high` in each package); `secrets` (the gitleaks **binary** downloaded from its
release, `gitleaks detect --redact`, `fetch-depth: 0`; the GitHub Action needs a licence for organisation repos);
CodeQL is a **user step** (default setup in the repository's Code security settings), possible only if the repository
is public or has GitHub Code Security; otherwise skip it and say so in `docs/TESTING.md`.

Verify: the workflow is green; a scratch commit containing a fake `sb_secret_` string turns `secrets` red.

### PR 05 — Versioning with change intents (P0.3)

- [ ] Merged

| File                                         | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.changes/README.md`                         | the format (front matter `client:` / `server:` = major, minor or patch, then a summary), the level rules table from the roadmap, "docs-only changes need no intent"                                                                                                                                                                                                                                                                                                             |
| `scripts/version/change.mjs`                 | `npm run change -- --client minor --server patch "summary"` writes `.changes/<yyyymmdd>-<hhmmss>-<4hex>.md`; validates the levels; needs at least one package; `--dry-run`                                                                                                                                                                                                                                                                                                      |
| `scripts/version/release.mjs`                | highest level per package; writes `version` into `package.json` and `package-lock.json` (`""` and `packages[""]`) directly, without `npm version` (no lifecycle scripts, no git checks); prepends `## <version> — <date>` and the summaries to `client/CHANGELOG.md` and `server/CHANGELOG.md`; deletes the consumed intents; writes gitignored `release.json` (`{ client: { version, tag }, server: {…} }`); refuses `major` before 1.0.0 without `--allow-major`; `--dry-run` |
| `scripts/version/check.mjs`                  | PR into `dev`, or `hotfix/*` into `main`: source changed (`client/src`, `server/src`, `server/scripts`, `server/supabase/migrations`, any `package.json`) ⇒ a file was **added** under `.changes/`, unless `--allow-missing` (the `no-release` label, which Dependabot PRs carry). PR from `release/*` into `main`: `.changes/` is empty and both versions are above the latest `client-v*` / `server-v*` tags. Never runs on `push`                                            |
| `scripts/version/*.test.mjs`                 | `node --test`, run by the `repo` job                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| root `package.json`                          | scripts `change`, `release`, `release:dry`, `change:check`                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `.github/workflows/ci.yml`                   | job `version-intent` (PR only) runs `check.mjs` with the flags derived from `github.base_ref`, `github.head_ref` and the labels                                                                                                                                                                                                                                                                                                                                                 |
| `.github/workflows/release.yml`              | job `prepare` (`workflow_dispatch`, input `dry_run` default `true`): check out `dev`, `npm run release`, commit on `release/<yyyymmdd>`, push, open the PR into `main` with an `actions/create-github-app-token` token. Job `tag-and-backmerge` (`push` to `main`): for each package whose version has no tag, create `client-vX` / `server-vY`; push `backmerge/<sha7>` and open the PR into `dev` labelled `no-release`                                                       |
| `client/CHANGELOG.md`, `server/CHANGELOG.md` | seeded with `## 0.1.0`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `.claude/hooks/major-change-gate.js`         | a pure `needsIntent(files)`; a one-time reminder "source changed, no `.changes/*.md`: run `npm run change`"; `--self-test` cases                                                                                                                                                                                                                                                                                                                                                |
| `.claude/skills/post-change/SKILL.md`        | scope `origin/dev...HEAD`; a step "record the intent if missing"                                                                                                                                                                                                                                                                                                                                                                                                                |
| 14 `.claude/**` files that say `origin/main` | one convention: "the PR's base branch: `origin/dev` for features, `origin/main` for hotfixes" (10 agents, `hooks/block-destructive-git.js`, skills `db-migration`, `post-change`, `resolve-conflicts`)                                                                                                                                                                                                                                                                          |
| `CLAUDE.md`                                  | new **"Versioning and branches"** section (branch model, level rules, `npm run change`, the release PR, tags, back-merge, hotfixes, "the release commit inside the release PR is the one automated commit; Claude never commits or tags"); §3 root scripts; §6 rows for `.changes/README.md` and the CHANGELOGs; §12 note                                                                                                                                                       |
| `.changes/<date>-p0-foundations.md`          | the first intent: `client: patch`, `server: patch`                                                                                                                                                                                                                                                                                                                                                                                                                              |

Details: staging images are tagged `dev-<sha7>`; `package.json` keeps the last released version; `/api/health.commit`
and Profile disambiguate; the 426 gate compares the numeric triple only, so staging is never "outdated" against a new
`min_client_version`.

Verify: two branches that each add an intent merge cleanly; `npm run release:dry` shows one bump per package;
`node scripts/version/check.mjs --base origin/dev` fails after touching `server/src` without an intent and passes with
`--allow-missing`; `release.yml` with `dry_run=true` prints the same plan.

User steps: create the GitHub App (contents and pull-requests write), install it on the repository, store
`RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY` as repository secrets.

### PR 06 — Architecture decision records (P0.8)

- [ ] Merged

`docs/adr/0000-template.md` (Status, Date, Context, Options considered, Decision, Consequences, Links),
`docs/adr/README.md` (the index), and `001-brands-own-stores.md`, `002-outbox-pgmq-pg-cron.md`,
`003-payment-aggregator-chosen-in-p4.md`, `004-rupees-and-paise.md`, `005-modular-monolith-three-processes.md`,
`006-media-s3-cloudfront.md`, `007-pilot-on-ec2-compose.md`, `008-semver-from-change-intents.md`,
`009-rate-limiting-token-buckets.md`, `010-polling-plus-web-push.md`, each `Status: Proposed`, lifted from the
roadmap's ADR table (decision, rejected alternative, consequences) and linking the roadmap step that depends on it.
Docs: CLAUDE.md §6 row "a decision worth recording → `docs/adr/NNN-title.md` (`agent-skills:documentation-and-adrs`)";
README docs table row.

User step: move each ADR to Accepted or amend it; ADR-002 and ADR-007 before PR 09.

### PR 07 — Health, readiness, keep-alive, client version (P0.7a)

- [ ] Merged

Server:

| File                                   | Change                                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/version.ts`                 | `APP_VERSION` read from `package.json` relative to `process.cwd()` (`server/` in dev and tests, `/app` in the image; never `__dirname`, which differs between `src/` and `dist/src/`); `GIT_COMMIT` from env              |
| `src/utils/env.ts`                     | `GIT_COMMIT` (string, default `unknown`); `KEEP_ALIVE_TIMEOUT_MS` (positive int, default `65000`)                                                                                                                         |
| `src/controllers/health.controller.ts` | `GET /api/health` → `{ ok: true, version, commit }`; `GET /api/ready` → one `site_settings` select with `AbortSignal.timeout(1000)`, 200 `{ ready: true }` or 503 `{ ready: false }`, never thrown into the error handler |
| `src/routes/index.ts`                  | `/health` and `/ready` registered first (PR 08 mounts the gate after them)                                                                                                                                                |
| `src/server.ts`                        | `server.keepAliveTimeout = env.KEEP_ALIVE_TIMEOUT_MS`; `server.headersTimeout = env.KEEP_ALIVE_TIMEOUT_MS + 1000` (must stay larger); a 10 s shutdown deadline (`setTimeout(() => process.exit(1), 10_000).unref()`)      |
| `src/middleware/clientVersion.ts`      | `readClientVersion(req)`: accepts `^\d+\.\d+\.\d+(-[\w.]+)?$` up to 32 chars, else `undefined` (no log injection)                                                                                                         |
| `src/app.ts`                           | `pinoHttp({ …, customProps: (req) => ({ clientVersion: readClientVersion(req) ?? 'none' }) })`                                                                                                                            |

Client:

| File                                 | Change                                                                                                                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vite.config.ts`, `vitest.config.ts` | `define: { __APP_VERSION__: JSON.stringify(pkg.version), __APP_COMMIT__: JSON.stringify(process.env.GIT_COMMIT ?? 'local') }` in both (otherwise `api.ts` throws `ReferenceError` in unit tests); `src/vite-env.d.ts` declares both                                 |
| `src/lib/appVersion.ts`              | exports `APP_VERSION`, `APP_COMMIT`                                                                                                                                                                                                                                 |
| `src/services/api.ts`                | sends `X-Client-Version: APP_VERSION` on every request (same origin through the Vite proxy and nginx: no preflight)                                                                                                                                                 |
| `src/pages/Profile.tsx`              | footer "Food Pickup v0.1.0 (1a2b3c4)"                                                                                                                                                                                                                               |
| `src/features/orders/orderStatus.ts` | `FALLBACK_STATUS_META` ("Updating…", neutral tokens, `next: null`, `actionLabel: null`, `canCancel: false`) and a `statusMeta(status: string)` accessor (the `Record<OrderStatus, …>` type would make `?? FALLBACK` dead code); replace every `STATUS_META[…]` read |

Tests: `test/api/health.safe.test.ts` (`version` matches `^\d+\.\d+\.\d+`, `/api/ready` 200);
`test/unit/readiness.safe.test.ts` (a rejecting probe → 503); client `api.test.ts` asserts the header;
`orderStatus.test.ts` covers the fallback.

Docs: `docs/API.md` (`GET /health`, new `GET /ready`, a Headers row for `X-Client-Version`); `docs/DEPLOYMENT.md` and
`server/.env.example` (`GIT_COMMIT`, `KEEP_ALIVE_TIMEOUT_MS` and why it exceeds the ALB's 60 s); `docs/LOGGING.md`
(`clientVersion` on access lines); `docs/BACKEND_STRUCTURE.md`; `docs/COMPONENTS.md` (`lib/appVersion.ts`);
`docs/FRONTEND_STRUCTURE.md` (Profile).

Verify: `curl -s localhost:8000/api/health` shows version and commit; `npm run db:stop` → `/api/ready` answers 503
within about a second while `/api/health` stays 200; Profile shows the version at 390 px.

### PR 08 — `min_client_version` and the 426 gate (P0.7b)

- [ ] Merged

| File                                                     | Change                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/supabase/migrations/<ts>_min_client_version.sql` | `alter table public.site_settings add column min_client_version text not null default '0.0.0' check (min_client_version ~ '^\d+\.\d+\.\d+$');` then `npm run db:types`                                                                                                                |
| `src/utils/semver.ts`                                    | `parseSemver`, `compareSemver` on the numeric triple (prerelease ignored, see the staging labelling)                                                                                                                                                                                  |
| `src/utils/errors.ts`                                    | `ErrorCode` + `CLIENT_OUTDATED`; factory `clientOutdated()` → `AppError(426, …, 'A new version of Food Pickup is available. Refresh the page to continue.')`                                                                                                                          |
| `src/middleware/clientVersion.ts`                        | `clientVersionGate`: `readClientVersion(req) ?? '0.1.0'` (missing or malformed = the legacy V0 client); `await getSettings()` (already `cached('site_settings')`, so no database hit per request); throw when below                                                                   |
| `src/routes/index.ts`                                    | **exemption by mount order:** `/health`, `/ready` (later `/config` and the webhooks) are registered before `apiRouter.use(clientVersionGate)`; no path list and no `OPTIONS` case (`cors()` answers preflights before the router; same-origin sends none); a comment says why         |
| `src/middleware/errorHandler.ts`                         | a 426 logs at `debug`: a stale tab will keep asking                                                                                                                                                                                                                                   |
| serializer, DTOs, schema, seed                           | `SiteSettingsDto.minClientVersion` on both sides; `updateSettingsSchema.minClientVersion` (`^\d+\.\d+\.\d+$`); `updateSettings` passes it; `scripts/seed.ts` resets it to `'0.0.0'`. The admin form field arrives with the registry rework in PR 13; until then the API is the editor |
| `client/src/services/api.ts`                             | handles 426 next to the 401 branch: sets an `outdated` flag in a tiny store                                                                                                                                                                                                           |
| `client/src/App.tsx`                                     | a top banner "New version available" with a Refresh `Button` while the flag is set                                                                                                                                                                                                    |
| `client/src/lib/useResource.ts`                          | stops polling once the last error was a 426 (otherwise a staff board with data on screen would keep polling every 4 s, because `ErrorState` renders only without data)                                                                                                                |

The deployed V0 client, which lacks the banner, still shows the envelope's message in `ErrorState` because
`request()` maps any error envelope to an `ApiError` whose message the UI shows. That is the intended fallback for the
first gated release.

Tests: `test/unit/semver.safe.test.ts`; `test/api/client-version.test.ts` (destructive: set `9.0.0` through
`supabaseAdmin` and `invalidate('site_settings')`; `GET /api/menu` with `X-Client-Version: 0.1.0` → 426 with
`{ error: { code: 'CLIENT_OUTDATED' } }`; without the header → 426; with `9.0.0` → 200; `/api/health` → 200;
`resetDemoData()` in `afterAll`); `admin.test.ts` accepts and rejects the field; client `api.test.ts` sets the flag on
426; `useResource.test.ts` stops polling.

Docs: `docs/SCHEMA.md` (`site_settings`); `docs/API.md` (426 row, the admin settings body, a "Client version gate"
paragraph); `docs/BACKEND_STRUCTURE.md`; `docs/FRONTEND_STRUCTURE.md` (the banner); CLAUDE.md §2 "a change the
deployed client cannot survive ships with a `min_client_version` bump".

Verify: the gate tests are green; `PATCH /api/admin/settings` with `{"minClientVersion":"9.0.0"}` makes an old tab
show the banner and `curl -i localhost:8000/api/menu` answer `426`; reset to `0.0.0`.

### PR 09 — Dockerfiles, nginx, runtime env (P0.6a)

- [ ] Merged

**`server/Dockerfile`** (the roadmap's three stages): `deps` runs `npm ci --ignore-scripts` (skips the Supabase CLI
binary); `build` runs `npm run build` and keeps `dist/scripts` (so P8.5 can seed staging with
`node dist/scripts/seed.js`; the demo seed already refuses `APP_ENV=production`); `runtime` runs
`npm ci --omit=dev --ignore-scripts`, `ARG GIT_COMMIT=unknown` → `ENV GIT_COMMIT`, `ENV NODE_ENV=production`,
`USER node`, `EXPOSE 8000`, a shell-form `HEALTHCHECK` on `http://127.0.0.1:${PORT:-8000}/api/health` so `$PORT`
expands, and the exec-form `CMD ["node","dist/src/server.js"]` so Node is PID 1 and receives SIGTERM.
`server/.dockerignore`: `node_modules`, `dist`, `.env*`, `supabase/.temp`, `test`, `coverage`.

**`client/Dockerfile`**: stage 1 `node:24-alpine`, `ARG GIT_COMMIT`, `npm ci`, `npm run build:container` (new script
`vite build --mode container`; `vite.config.ts` skips its required-env check when `mode === 'container'`; a committed
`client/.env.container` holds placeholders); stage 2 `nginxinc/nginx-unprivileged:1.27-alpine`,
`COPY --from=build /app/dist /usr/share/nginx/html`, `COPY nginx/default.conf.template /etc/nginx/templates/`,
`COPY nginx/security.conf /etc/nginx/snippets/`, `COPY --chmod=755 nginx/runtime-env.sh
/docker-entrypoint.d/40-runtime-env.sh`, `EXPOSE 8080`, `HEALTHCHECK` on `/healthz`. `client/.dockerignore`:
`node_modules`, `dist`, `.env*`.

**`client/nginx/default.conf.template`** (rendered by the image's entrypoint, which substitutes only variables present
in the environment, so `$uri` and `$host` survive): `listen 8080`; `location = /healthz` → 200; `location =
/runtime-env.js` → `alias /tmp/runtime-env/runtime-env.js` with `Cache-Control: no-cache`; `/assets/` →
`public, max-age=31536000, immutable`; `/images/` → one week; `location = /index.html` → `no-cache`; `/api/` →
`proxy_pass ${API_UPSTREAM}` (**no trailing slash**, or nginx strips `/api`), `proxy_http_version 1.1`, `Host`,
`X-Forwarded-For`, `X-Forwarded-Proto`, `proxy_read_timeout 30s`; `location /` → `try_files $uri /index.html`; gzip on
for text, CSS, JavaScript, JSON and SVG; `include /etc/nginx/snippets/security.conf` in **every** location, because an
`add_header` inside a location discards the inherited ones.

**`client/nginx/security.conf`**: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: camera=(self)`, and the CSP as **`Content-Security-Policy-Report-Only`** in P0:
`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src
https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ${SUPABASE_URL}; frame-ancestors 'none';
base-uri 'self'`. The inline font `onload=` handler in `index.html` moves into `main.tsx` in this PR, so enforcing
later needs no `'unsafe-inline'` for scripts. Flipping to enforce is a user decision once staging shows no reports.

**`client/nginx/runtime-env.sh`**: fails fast when `SUPABASE_URL` or `SUPABASE_PUBLISHABLE_KEY` is empty or contains a
quote; writes `window.__RUNTIME_ENV__={"SUPABASE_URL":…,"SUPABASE_PUBLISHABLE_KEY":…,"LOG_LEVEL":…,"REQUEST_TIMEOUT_MS":…};`
to `/tmp/runtime-env/runtime-env.js` (uid 101 cannot write the html directory).

**Client code**: `index.html` loads `/runtime-env.js` as a classic script before the module script;
`client/public/runtime-env.js` is `window.__RUNTIME_ENV__ = {};` for development (Vite copies it to `dist/` and the
nginx `alias` shadows it); new `src/lib/runtimeEnv.ts` returns each value as
`nonEmpty(window.__RUNTIME_ENV__?.X) ?? import.meta.env.VITE_X` (static property access, so Vite still inlines the
build value); `lib/supabase.ts`, `lib/logger.ts` and `services/api.ts` (`REQUEST_TIMEOUT_MS`, closing that A1 row)
read through it; `src/vite-env.d.ts` declares `Window.__RUNTIME_ENV__`. Test `runtimeEnv.test.ts`: runtime wins over
build; unset falls back to build; empty string falls back to build.

Docs: `docs/DEPLOYMENT.md` "Containers" replaces "Future: Docker + nginx" (images, build args, the runtime env table,
the nginx header table, size budgets 50 MB web / 200 MB server); `client/.env.example` note on runtime env; one README
line; CLAUDE.md §2c future note becomes present tense; `docs/COMPONENTS.md` (`lib/runtimeEnv.ts`);
`docs/FRONTEND_STRUCTURE.md` (`nginx/`, `public/runtime-env.js`).

Verify:

```bash
docker build -t fp-api --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) server
docker run --rm -p 8000:8000 --env-file server/.env -e SUPABASE_URL=http://host.docker.internal:54321 fp-api
curl -s localhost:8000/api/health          # shows the commit
docker build -t fp-web client
docker run --rm -p 8080:8080 -e API_UPSTREAM=http://host.docker.internal:8000 \
  -e SUPABASE_URL=http://127.0.0.1:54321 -e SUPABASE_PUBLISHABLE_KEY=<local publishable key> fp-web
curl -i localhost:8080/runtime-env.js      # no-cache, JSON body; /assets/* immutable; /menu serves index.html
docker image inspect --format '{{.Size}}' fp-web fp-api
docker exec <id> id -u                     # not 0, in both
```

**First hour:** sign in through the container and call `/api/orders`. If a 401 "session expired" appears, the
server library validates the JWT issuer, and the API must reach Supabase at the browser's URL (`network_mode: host`
on Linux). Record the finding in `docs/DEPLOYMENT.md`.

### PR 10 — `compose.yaml` and the `images` CI job (P0.6b)

- [ ] Merged

`compose.yaml` at the root: `api` (build `server` with `GIT_COMMIT: ${GIT_COMMIT:-local}`, `env_file: server/.env`,
`SUPABASE_URL` per PR 09's finding, `CLIENT_ORIGIN: http://localhost:8080`, `TRUST_PROXY_HOPS: 1`,
`extra_hosts: ["host.docker.internal:host-gateway"]`); `web` (`ports: ["8080:8080"]`, `API_UPSTREAM: http://api:8000`,
`SUPABASE_URL` set to the browser-side URL, `SUPABASE_PUBLISHABLE_KEY`, `depends_on: api: condition: service_healthy`
because nginx resolves the upstream at start). Supabase stays on the host. `worker`, `reconciler` and `minio` appear
as comments for P1 and P3.

`ci.yml` job `images` (part of `ci-ok`): buildx; `docker/build-push-action@v6` per image with `push: false`,
`load: true`, `cache-from` / `cache-to: type=gha`, `build-args: GIT_COMMIT=${{ github.sha }}`; `hadolint` on both
Dockerfiles; smoke: `fp-api` with dummy Supabase env → `/api/health` 200 (no database needed), `fp-web` → `/healthz`
and `/runtime-env.js` 200; size assertions (web under 50 MB, server under 200 MB). No Trivy step.

Docs: `docs/DEPLOYMENT.md` "Local compose" (`docker compose up --build web api`, host Supabase, seeding through
`docker compose run api node dist/scripts/seed.js`); README "Run it in containers"; CLAUDE.md §3 ports (compose on 8080) and §18 (compose as a backgrounded long-running process, probe `http://localhost:8080/healthz`);
`docs/TESTING.md` CI row for `images`.

Verify: `npm run db:start` and `npm run seed` on the host, `docker compose up --build web api`, then the README demo
script at `http://localhost:8080` (browse, sign in, order, staff board); `docker compose ps` shows both services
healthy.

### PR 11 — Lighthouse CI (P0.2, deferred until the compose stack exists)

- [ ] Merged

`client/lighthouserc.json`: `formFactor: mobile`, 360×640, `throttling: { rttMs: 150, throughputKbps: 1638,
cpuSlowdownMultiplier: 4 }`, `numberOfRuns: 3`; LCP ≤ 2500 ms and CLS ≤ 0.1 as **warn** for the first two weeks, TBT
≤ 200 ms warn; URLs `/` and `/menu`. `.github/workflows/perf.yml`: PRs touching `client/**` plus nightly; not a
required check; steps `db:start:ci` and seed, `docker compose up -d --build web api`, `npx @lhci/cli autorun`, upload
the report as an artifact. Docs: `docs/PERF_BASELINE.md` gains a "CI numbers" section header (perf-auditor owns the
content and re-baselines on Node 24); `docs/TESTING.md` row.

Verify: the workflow is green with its warnings listed, and the report artifact opens.

### PR 12 — Error classes, cause chains, redaction (P0.5)

- [ ] Merged

| File                             | Change                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/errors.ts`            | `ErrorCode` + `UPSTREAM_UNAVAILABLE`; `class IntegrationError extends Error { provider; operation; retryable; cause }` (ES2022 `cause`); drop `INVALID_CREDENTIALS`, which only the client synthesises                                                                                                     |
| `src/middleware/errorHandler.ts` | `IntegrationError` → 503 `{ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'The service is temporarily unavailable. Please try again in a moment.' } }` with `Retry-After: 5`; the error log line gains `route`, `status`, `code`, `userId`                                                               |
| `src/utils/supabase.ts`          | a PostgREST error with an empty `code` and a transport message (`fetch failed`, `ECONNREFUSED`, `ETIMEDOUT`) becomes `IntegrationError('supabase', 'postgrest', true, { cause })`; confirm the exact shape by stopping Supabase and calling `/api/orders`                                                  |
| `src/middleware/auth.ts`         | a Supabase Auth 5xx becomes `IntegrationError('supabase-auth', 'verify', true, { cause })`                                                                                                                                                                                                                 |
| `src/utils/logger.ts`            | `serializers: { err: pino.stdSerializers.errWithCause }`; `REDACT_PATHS` gains `signature`, `checksum`, `secret`, `apiKey`, `api_key`, `key_secret`, `webhookSecret`, `webhook_secret`, `vpa`, `pickupCode`, `pickup_code`, `customerPhone`, `customer_phone`, `headers.authorization`, each also as `*.x` |

Not in this PR: `InvariantError` (P1.2, with its first thrower), 502 `PAYMENT_UNAVAILABLE` (P5), the client error
reporter (P1.6), provider-specific header names (with the adapter in P5).

Tests: `test/logging.safe.test.ts` covers every new key at the top level and nested, and `err.cause.message` in the
output; `test/unit/errors.safe.test.ts` covers the mapping table with a fake `req` / `res`.

Docs: `docs/LOGGING.md` ("Error classes", "Never logged"); `docs/API.md` error table (503 `UPSTREAM_UNAVAILABLE`);
CLAUDE.md §10 errors bullet and §19 table row.

Verify: `npm run db:stop`, then `curl -i localhost:8000/api/menu` answers the 503 envelope and the log shows one
`error` line with `err.cause`.

### PR 13 — Config a: `site_settings` columns and the admin form (P0.4)

- [ ] Merged

Migration `<ts>_site_settings_config.sql`: `max_lines_per_order integer not null default 30 check (… between 1 and
100)`, `order_poll_ms` (4000), `orders_poll_ms` (8000), `staff_board_poll_ms` (4000), each
`check (… between 2000 and 60000)`. No `session_idle_days` (deployment config, PR 14). Then `npm run db:types`;
`toSiteSettingsDto`, `SiteSettingsDto` and the client `SiteSettings`; `updateSettingsSchema` bounds mirrored;
`updateSettings` builds the update from defined fields; the seed reset covers every column. Client:
`features/admin/settingsRules.ts` registry gains `min` and `kind: 'integer' | 'semver'` (`minClientVersion` from PR
08 joins the form); `pages/Admin.tsx` renders from the registry; `Admin.test.tsx`, `settingsRules.test.ts` and
`admin.test.ts` updated.

Docs: `docs/SCHEMA.md`; `docs/API.md` admin settings body; new `docs/CONFIGURATION.md` (the registry: key, tier,
type, default, bounds, reader, editor) with its CLAUDE.md §6 row.

Verify: the gate; `PATCH /api/admin/settings` with each new field in and out of bounds; the admin page at 390 px.

### PR 14 — Config b: `GET /api/config`, `useConfig`, fallbacks and parity (P0.4)

- [ ] Merged

Server: `env.ts` gains `SESSION_IDLE_DAYS` (1–90, default 7) with the comment "must equal
`auth.sessions.inactivity_timeout` (168h) in `config.toml` and the hosted project's dashboard"; `schemas/limits.ts`
exports the name, note, password and phone bounds the zod schemas already use; `services/config.service.ts`
`getConfig()` **derives from the already-cached `getSettings()`**, so there is no second cache key and no second
invalidation to forget; `controllers/config.controller.ts`; the route is registered before the client-version gate.
`ConfigDto` (server `types/api.ts`, client `Config`):

```ts
interface ConfigDto {
  serverVersion: string;
  minClientVersion: string;
  features: Record<string, boolean>; // empty until P1.7
  payment: { provider: string; publicKey: string | null } | null; // null until P5
  limits: { maxLinesPerOrder: number };
  polling: { orderMs: number; ordersMs: number; staffBoardMs: number };
  session: { idleDays: number };
}
```

Client: `services/config.ts` (`fetchConfig`, `auth: false`); `features/config/useConfig.ts` =
`useResource(fetchConfig, { key: 'config', persist: true })` returning `data ?? fallbacks`;
`client/src/config/fallbacks.json` (add `resolveJsonModule` to `client/tsconfig.json`) holds the `ConfigDto` defaults
plus `validation: { nameMax, noteMax, password: { min, max }, phoneDigits: { min, max } }`;
`features/auth/validation.ts` and `features/auth/sessionActivity.ts` import their constants from it (the one allowed
client copy); `useOrder`, `useOrders` and `StaffDashboard` take their intervals from `useConfig().polling`, and
`POLL_MS`, `pollMs` and `STAFF_POLL_MS` are deleted.

Parity: `server/test/api/config.test.ts` (destructive: `resetDemoData()` first) reads
`client/src/config/fallbacks.json` with `readFileSync` (a JSON import outside the server's `rootDir` fails typecheck)
and expects `GET /api/config` minus `serverVersion` to equal it; `test/unit/limits-parity.safe.test.ts` compares
`fallbacks.validation` with `schemas/limits.ts`.

Docs: `docs/API.md` (`GET /config`; Caching: "served through the settings cache"); `docs/FRONTEND_STRUCTURE.md`
(`services/config.ts`, `features/config/`); `docs/COMPONENTS.md` (`useConfig`); `docs/CONFIGURATION.md` rows;
`docs/DEPLOYMENT.md` and `server/.env.example` (`SESSION_IDLE_DAYS`); CLAUDE.md §8 "config and rules come from the
API, never mirrored; the one copy is `config/fallbacks.json`, parity-tested".

Verify: the gate in both packages (the parity tests are the point); the menu page still polls at the configured
intervals after `PATCH /api/admin/settings` changes `orderPollMs`.

### PR 15 — Config c: menu rules and the lines limit (P0.4)

- [ ] Merged

`menu.service.ts` adds `rules: { maxQuantityPerItem, lowStockThreshold }` (server constants now; per store in P2.3;
the client keeps its mirrors until then and only gains the type). `order.schema.ts` raises the zod sanity bound to
`MAX_ITEM_LINES_HARD = 100`, and `createOrder` enforces `settings.max_lines_per_order` with a `VALIDATION_ERROR`
("An order can have at most N items."); a 10 s stale limit through the settings cache is harmless and documented. Fix
the stale "(20)" comment in `test/unit/schemas.safe.test.ts`.

Tests: `orders.test.ts` (31 lines → 400 with the message), `menu.safe.test.ts` (`rules` present).

Docs: `docs/API.md` (`rules`, the limits table); `docs/CONFIGURATION.md`.

### PR 16 — Config d: fixtures, env-driven ports and TTL, policy (P0.4)

- [ ] Merged

| File                                           | Change                                                                                                                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/scripts/seed-data.ts`                  | a typed fixture module (`STORE`, `MENU`, the demo accounts) imported by `seed.ts`; seeding behaviour byte-identical                                                                                |
| `server/src/utils/env.ts`                      | `PUBLIC_READ_TTL_MS` (0–600000, default 10000); `TRUST_PROXY_HOPS` (default 0; compose sets 1)                                                                                                     |
| `server/src/utils/cache.ts`, `src/app.ts`      | the TTL comes from env; `app.set('trust proxy', env.TRUST_PROXY_HOPS)`                                                                                                                             |
| `client/vite.config.ts`, `client/package.json` | `server.port = Number(env.VITE_DEV_PORT ?? 5173)`; proxy target `env.VITE_API_PROXY_TARGET ?? 'http://localhost:8000'`; drop `--port 5173 --strictPort` from the scripts                           |
| `start.sh`                                     | reads `PORT` and `SUPABASE_URL` from `server/.env` and `VITE_DEV_PORT` from `client/.env.development` for its probes and kills                                                                     |
| `client/src/config/app.ts`                     | `APP_TITLE`, named once                                                                                                                                                                            |
| `scripts/ci/check-durations.mjs`               | fails on `/\b\d+_000\b/` in `server/src/services/**`, `server/src/domain/**` and `client/src/features/**/*Rules.ts` (non-test files), printing `file:line`; root `check:durations`; `ci.yml` steps |

No ESLint `no-magic-numbers` rule.

Docs: both `.env.example` files (drop the "keep it at 8000" warning); `docs/DEPLOYMENT.md` env tables; README ports;
CLAUDE.md §3 ports sentence and §11 no-hardcoding policy (the four tiers, "presentation constants stay", the CI grep);
`docs/BACKEND_STRUCTURE.md` scripts; `docs/CONFIGURATION.md` env tier.

Verify: the gate; `./start.sh` still finds and probes the right ports; `docker compose up` with `TRUST_PROXY_HOPS=1`
logs the real client IP.

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

- Rulesets on `dev` and `main`: require a PR and the `ci-ok` check; `main` accepts PRs from `release/*` and
  `hotfix/*` only; no bypass list.
- Make `dev` the GitHub default branch.
- Labels `no-release` and `dependencies`.
- The release GitHub App (contents and pull-requests write), installed on the repository, with `RELEASE_APP_ID` and
  `RELEASE_APP_PRIVATE_KEY` as secrets.
- CodeQL default setup, if the repository is eligible.
- Accept or amend ADR-001..010; ADR-002 and ADR-007 before PR 09.
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
