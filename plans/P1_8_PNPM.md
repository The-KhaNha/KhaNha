# P1.8 — pnpm: implementation plan

The plan for [ROADMAP.md P1.8](ROADMAP.md#p18-tooling-pnpm-after-the-phase-merges): the three package roots (the
repository root, `client/` and `server/`) move from npm to pnpm. They stay three independent roots; a workspace comes
later, with the first shared package. The roadmap says what changes and why; this file says in which pull requests,
with which files, checks and user steps, and where the step does something different from the roadmap's wording.

> **Status: proposal** (11 November 2026). The precondition holds: `feat/P1` is in `dev` (#40). Two PRs into `dev`,
> both before `feat/P2` is cut, so no phase PR ever conflicts with a lockfile swap. The version is decided (D1, the
> user, 11 November 2026): **pnpm 12, or 11 if 12 is blocked**. The other [decisions](#decisions) are open; each has
> a default, and the plan is written for the defaults.

## How the step is worked

The standing rules apply (CLAUDE.md §13–§21): each PR branches from a fresh `origin/dev`, stays within 38 changed
files and 750 changed lines (Markdown and lockfiles do not count), passes the gate, and then work stops until the
user says it is merged.

- **Gate.** The root gate (`format:check` and `test`) plus the full gate in `client/` and `server/`
  (`typecheck`, `lint`, `test`, and the e2e smoke in `client/`), all run **through pnpm**, because the install
  layout is what changes.
- **No dependency changes.** `pnpm import` builds each `pnpm-lock.yaml` from the committed `package-lock.json`, so
  every resolved version stays what it is today. A version that moves is a bug in the PR.
- **Intent.** `--client patch --server patch` in PR 01 (the Dockerfiles change what ships); `--server patch` in PR 02
  (it edits a message in `server/src`).

## Where the step starts

| Area            | Today                                                                                                                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifests       | three `package.json`, each with `engines.node ^24.15.0` and no `packageManager`; `client/` and `server/` carry `overrides.minimatch`                                                                                                     |
| Settings        | three identical `.npmrc`: `engine-strict=true` and `min-release-age=7` (an npm-only key: it holds back versions younger than 7 days)                                                                                                     |
| Lockfiles       | three `package-lock.json` (lockfile v3)                                                                                                                                                                                                  |
| Install scripts | only `esbuild` (dev) and `fsevents` (optional) have one. The `supabase` CLI no longer does (its binary is an optional platform package), so the "skips the Supabase CLI download" comments in `ci.yml` and `server/Dockerfile` are stale |
| CI installs     | six `actions/setup-node` blocks with `cache: npm` (`ci.yml` client, server-static, server-tests and repo; `browsers.yml`; `perf.yml`); the Playwright cache key hashes `client/package-lock.json`                                        |
| CI security     | `security.yml` runs `npm audit --audit-level=moderate` per root and is triggered by `**/package-lock.json` and `**/.npmrc`                                                                                                               |
| Images          | `client/Dockerfile`: `npm ci`, `npm run build:container`. `server/Dockerfile`: `npm ci --ignore-scripts` (deps), `npm ci --omit=dev --ignore-scripts` (prod-deps); the runtime stage has no npm and no corepack, by design               |
| Releases        | `scripts/version/release.mjs` writes the new version into `package-lock.json`, and `version.test.mjs` asserts it                                                                                                                         |
| PR size hook    | `PR_UNCOUNTED` in `.claude/hooks/major-change-gate.js` uncounts `package-lock.json`; its self-test fixtures name the file                                                                                                                |
| Dependabot      | `npm` entries for `/client` and `/server` (the root has none)                                                                                                                                                                            |
| Prose           | `npm` or `npx` appears in `README.md` (47 places), `docs/DEPLOYMENT.md` (48), `docs/TESTING.md` (21), 12 agents, 5 skills, 3 rule files, `CLAUDE.md` (6) and about 15 code comments, messages and env examples                           |

## Choices that hold in both PRs

- **One pnpm version, pinned three times.** `"packageManager": "pnpm@<version>"` with the same value in all three
  `package.json` files; corepack (shipped with Node 24) gives every developer, CI job and image build that version.
  The version is the newest **12.x** that is at least 7 days old on the day of PR 01 (the project's own release-age
  rule; on 11 November 2026 the registry's `latest` is 12.18.0, and 11's newest is 11.28.9). Both majors run on
  Node 24. Fall back to 11.28.x only if Dependabot cannot read 12's lockfile or corepack cannot fetch 12.
- **`pnpm run <script>`, not the bare `pnpm <script>`** the roadmap wrote (D2). The sweep from `npm run` is then
  mechanical, and a script can never be shadowed by a pnpm built-in command, now or after a pnpm upgrade.
  `npm ci` → `pnpm install --frozen-lockfile`; `npx <bin>` → `pnpm exec <bin>` for an installed binary and
  `pnpm dlx <pkg>` for a download (`@lhci/cli` in `perf.yml`).
- **Settings move to `pnpm-workspace.yaml`, one per root.** pnpm 12 reads project settings only from
  `pnpm-workspace.yaml`; from `.npmrc` it reads nothing but registry, auth, TLS and proxy settings
  ([pnpm settings](https://pnpm.io/settings), read 11 November 2026). Today's two `.npmrc` lines would therefore be
  **silently ignored** if left where they are. Each root gets a settings-only `pnpm-workspace.yaml` (no `packages:`
  list, so still no workspace) and its `.npmrc` is deleted:
  - `engineStrict: true` (pnpm 12 checks the project's `engines.node` and fails on a mismatch with it);
  - `minimumReleaseAge` for the 7 days `min-release-age=7` gives today. The settings page names it without its unit
    (it was minutes in pnpm 10: 10080); PR 01 takes the unit from the pinned version's reference;
  - `overrides` for `minimatch` in `client/` and `server/`.

  All three roots need their own file: pnpm looks upward for the nearest one, so `client/` without a file would
  pick up the repository root's and stop being an independent root.

- **Dependency build scripts stay off** (D3), through pnpm 12's `allowBuilds`, with `strictDepBuilds` on so a new
  dependency that has an install script fails the install until someone decides, instead of warning. Nothing is
  allowed today: `esbuild` works without its script (the platform binary is an optional dependency) and is recorded
  as not allowed. A dependency that later needs its script (P3's `sharp` does not: it also ships platform packages)
  is allowed by name, in the PR that adds it. The exact shape of both settings comes from the pinned version's
  reference; verify step 1 below is the check.
- **Corepack in CI, no new action** (D4): a `corepack enable` step before each `actions/setup-node`, which then
  takes `cache: pnpm` and `cache-dependency-path: <root>/pnpm-lock.yaml`.

## Build order

| #   | PR                                               | Depends on | Size (files / lines, lockfiles and Markdown not counted) |
| --- | ------------------------------------------------ | ---------- | -------------------------------------------------------- |
| 01  | The swap: manifests, lockfiles, CI, images, docs | –          | 33 / 340                                                 |
| 02  | The wording left in code, comments and examples  | 01         | 16 / 60                                                  |

Two PRs because about 45 files other than Markdown mention npm, over the 38-file limit. The seam: PR 01 holds
everything that must change together for an install, a build or a CI run to work, plus every Markdown file (they do
not count, and CLAUDE.md §6 wants docs in the same change). PR 02 holds strings that only read wrong.

## The pull requests

### PR 01 — The swap

- [ ] Merged

| File                                                                     | Change                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`, `client/package.json`, `server/package.json`             | `packageManager`; `overrides` in pnpm's form; a script that calls `npm run` or `npx` inside itself calls pnpm                                                                                                                                                                                                                                                                             |
| three `pnpm-workspace.yaml` (new), three `.npmrc` (deleted)              | `engineStrict`, the 7-day `minimumReleaseAge`, `overrides`, `allowBuilds` and `strictDepBuilds`, as in [the choices](#choices-that-hold-in-both-prs)                                                                                                                                                                                                                                      |
| three `pnpm-lock.yaml` (new), three `package-lock.json` (deleted)        | made with `pnpm import`, then `pnpm install --frozen-lockfile` must pass unchanged                                                                                                                                                                                                                                                                                                        |
| `.github/workflows/{ci,browsers,perf,security,release}.yml`              | `corepack enable` + `cache: pnpm`; installs, scripts and `npx` calls as in [the choices](#choices-that-hold-in-both-prs); the Playwright cache key hashes `client/pnpm-lock.yaml`; `security.yml` audits with `pnpm audit --audit-level moderate` and triggers on `**/pnpm-lock.yaml` and `**/pnpm-workspace.yaml`; the two stale "Supabase CLI download" comments say what is true today |
| `.github/dependabot.yml`                                                 | unchanged (`npm` is Dependabot's ecosystem name for pnpm too); a comment says so                                                                                                                                                                                                                                                                                                          |
| `client/Dockerfile`                                                      | build stage: copy `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml` (where `.npmrc` is copied today), `corepack enable`, `pnpm fetch`, `pnpm install --frozen-lockfile --offline`, `pnpm run build:container`                                                                                                                                                                    |
| `server/Dockerfile`                                                      | `deps` and `prod-deps` do the same with `--ignore-scripts` (and `--prod` in `prod-deps`); the runtime stage is untouched and still has no package manager                                                                                                                                                                                                                                 |
| `start.sh`, `build.sh`, `run.sh`, `server/scripts/db-push.sh`            | installs and script calls go through pnpm (`pnpm exec supabase` in `db-push.sh`)                                                                                                                                                                                                                                                                                                          |
| `scripts/version/release.mjs`, `version.test.mjs`                        | the lockfile write goes (a `pnpm-lock.yaml` does not carry the package's own version), and so do its assertions; a new assertion: a release leaves the lockfile untouched                                                                                                                                                                                                                 |
| `scripts/version/{lib,change,check}.mjs`                                 | comments and printed hints name pnpm; `change.mjs` accepts its arguments with or without a leading `--` (see Risks)                                                                                                                                                                                                                                                                       |
| `.claude/hooks/major-change-gate.js`                                     | `PR_UNCOUNTED` matches `pnpm-lock.yaml` instead of `package-lock.json`; the fixtures and the reminder text follow                                                                                                                                                                                                                                                                         |
| `.prettierignore`, `.coderabbit.yaml`, `.gitignore`, `client/.gitignore` | the lockfile name                                                                                                                                                                                                                                                                                                                                                                         |
| `client/playwright.config.ts`                                            | `command: 'pnpm run dev'`                                                                                                                                                                                                                                                                                                                                                                 |
| `scripts/ci/package-manager.test.mjs` (new)                              | the guard, below                                                                                                                                                                                                                                                                                                                                                                          |

Markdown in the same PR (not counted): `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/*.md`, `.changes/README.md`,
the PR template, `.claude/rules/*.md`, every agent and skill that names a command (the lockfile recipe in
`merge-conflict-resolver` and `/resolve-conflicts` becomes "take the base's `pnpm-lock.yaml`, then `pnpm install`"),
then `node scripts/codex/sync.mjs` so the generated `.codex/` and `.agents/` descriptions follow. The plans keep
their history: `P0_FOUNDATIONS.md` and `P1_PLATFORM_CORE.md` are not rewritten; the roadmap's P1.8 section gets its
tick and an "as built" note for the three places this plan differs from it: pnpm 12 rather than an unnamed version,
settings in `pnpm-workspace.yaml` rather than `.npmrc`, and `pnpm run <script>` rather than `pnpm <script>`.

**The guard** (`scripts/ci/package-manager.test.mjs`, in the root `test` script, so `ci.yml`'s `repo` job runs it):

- the three `packageManager` values are equal and name pnpm;
- every root has a `pnpm-lock.yaml` and no `package-lock.json`;
- no workflow, Dockerfile, shell script or `package.json` script contains `npm ci`, `npm run`, `npm install`,
  `npm test` or `npx`;
- every root has its own `pnpm-workspace.yaml` with `engineStrict`, `minimumReleaseAge`, `allowBuilds` and
  `strictDepBuilds`, and none of them has a `packages:` list;
- no `.npmrc` in the repository carries a setting pnpm would ignore (anything but registry, auth, TLS or proxy).

Seen failing first: run it on `dev` before the swap (every assertion fails), then on the branch.

Verify:

1. Fresh clone, `corepack enable`, `pnpm install --frozen-lockfile` in the three roots; no warning about ignored
   build scripts, no lockfile change. Then prove each setting bites, on a scratch copy: a dependency with an
   install script fails the install (`strictDepBuilds`), and a version published yesterday is not picked
   (`minimumReleaseAge`).
2. The gate in all three roots, and `pnpm run e2e:chromium` in `client/`. pnpm's `node_modules` is strict: a package
   imported but not declared (it resolved through npm's hoisting) fails here, and the fix is to declare it.
3. With Node 22 active, `pnpm install` is refused (engine-strict still bites).
4. `./build.sh` then `./run.sh up`: both images build, `/healthz` and `/api/health` answer, and the image sizes stay
   inside `ci.yml`'s budgets (web 50 MB, api 300 MB).
5. `pnpm run release:dry` prints the same bump as `npm run release:dry` did on the same commit.
6. `pnpm run change -- --server patch "x"` and `pnpm run change --server patch "x"` both write the same intent file
   (then delete it).
7. `ci-ok` green on the PR, including `images`, `repo` and `security.yml`'s audit.

### PR 02 — The wording left in code, comments and examples

- [ ] Merged

Strings only; no behaviour changes. `server/src/services/store.service.ts` (the "run the seed" message),
`server/src/utils/env.ts`, `server/vitest.config.mts`, `server/test/setup/helpers.ts`, `server/scripts/seed.ts`,
`server/scripts/seed-data.ts`, `client/scripts/make-icons.mjs`, `compose.yaml`, `server/.env.example`,
`client/.env.example`, `client/.env.container`, `client/.env.development`. The guard from PR 01 gains one assertion:
no file under `client/src`, `server/src`, `server/scripts` or `client/scripts` contains `npm run` or `npx`.

Tests: the suite that asserts the store-missing message, if one does, follows the new text.

Verify: `grep -rn "npm run\|npx \|npm ci\|package-lock" --exclude-dir=node_modules --exclude-dir=plans --exclude-dir=adr .`
returns only CHANGELOG history.

## Done when

The roadmap's check, restated: a fresh clone installs with `pnpm install` in all three roots from the committed
lockfiles; `ci-ok` is green; both images build and answer their health checks; `pnpm run release:dry` prints the same
bump as before; and on a laptop with another pnpm project, `pnpm store path` and `du -sh */node_modules` show the
shared store at work. Then tick P1.8 in the roadmap.

## User steps

- Before PR 01 is opened: answer the [decisions](#decisions), or accept the defaults.
- After PR 01 merges, on every machine and worktree: delete the three `node_modules` folders, `corepack enable`,
  `pnpm install` in each root. An old `node_modules` built by npm must not be reused.
- Check the first Dependabot PR after the merge: it must update a `pnpm-lock.yaml`. If Dependabot cannot read the
  lockfile version the pinned pnpm writes, pin the newest pnpm it supports.

## Risks and gotchas

- **Undeclared imports.** npm's flat `node_modules` lets code import a package it never declared. pnpm does not. The
  gate finds every case; declare the package rather than loosening pnpm's layout.
- **`--` in script arguments.** npm needs `npm run change -- --client minor`; pnpm forwards arguments without it and
  may pass a literal `--` through. `change.mjs` skips a leading `--`, with a test, so both spellings work and old
  habits do not write a broken intent.
- **Images.** pnpm's `node_modules` is symlinks into `node_modules/.pnpm`. Copying the whole folder between build
  stages keeps them valid; copying a single package folder does not. If the copied tree misbehaves in the runtime
  stage, set the hoisted linker for the `prod-deps` stage only.
- **Corepack needs the network once** per machine and per image build to fetch pnpm. CI and Docker have it; an
  offline laptop needs one online `pnpm --version` first.
- **`pnpm audit` is not `npm audit`.** Flags and exit codes differ slightly; the first `security.yml` run on the PR
  is the check that the job still fails on a moderate advisory (try it once with a known-vulnerable version in a
  scratch branch, never merged).
- **pnpm 12 moves fast** (four releases in the two weeks before this plan). The pin changes only on purpose, in all
  three roots at once, in a PR whose description lists the release notes read. Two notes already matter: since
  12.16, `pnpm add`, `remove` and `update` refuse to run when `node_modules` does not match the settings (run
  `pnpm install` first), and 12.19 offers a new lockfile format that stays off until Dependabot reads it.
- **Open branches.** Any branch cut before PR 01 conflicts in its lockfile. Merge `dev` in and regenerate with
  `pnpm install`; never hand-merge a lockfile. `feat/P4` is the one long-lived branch today.

## ADRs this step touches

| ADR            | What the step does with it                                                                                                                            | Needs                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 008 semver     | the release stops writing the version into a lockfile. The ADR describes intents, the release PR and the tags, and never mentions the lockfile        | nothing                                                                                              |
| 011 free tiers | its GitHub table names `npm audit` as the dependency check; the tool becomes `pnpm audit`                                                             | **resolved (the user, 11 November 2026):** left as written; the sweep and the guard skip `docs/adr/` |
| –              | the package manager itself has no ADR: the roadmap's P1.8 and this plan record the choice (tooling, like the Node pin in P0.1, which has none either) | **resolved (the user, 11 November 2026):** no ADR                                                    |

## Decisions

| #   | Decision                               | Default                                                                                                                                                                |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Which pnpm version to pin              | **answered (the user, 11 November 2026): 12, or 11.** The newest 12.x at least 7 days old on the day of PR 01; 11.28.x only if Dependabot or corepack cannot handle 12 |
| D2  | `pnpm run <script>` or `pnpm <script>` | `pnpm run <script>` everywhere (the roadmap wrote the bare form)                                                                                                       |
| D3  | Dependency build scripts               | none allowed, and an unreviewed one fails the install (`strictDepBuilds`)                                                                                              |
| D4  | pnpm in CI                             | corepack, not the `pnpm/action-setup` action                                                                                                                           |

## Later: the workspace

Unchanged from the roadmap's step 2: a root `pnpm-workspace.yaml` with `packages:`, one lockfile, `pnpm --filter`,
`pnpm deploy` in the Dockerfiles and one CI cache path, in the PR that adds the first shared package. Neither the
[P2 plan](P2_MULTI_STORE.md) nor the [P3 plan](P3_CATALOG_AND_MEDIA.md) adds one: both keep the server and client
DTO copies and their parity tests.
