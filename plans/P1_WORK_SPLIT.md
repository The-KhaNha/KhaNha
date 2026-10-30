# P1 — work split for two agents

How [P1's 16 PRs](P1_PLATFORM_CORE.md) are divided between two dev agents working at the same time: **lane A** on the
first machine and **lane B** on a second machine. The plan says what each PR builds; this file says who builds it, in
which order, when a lane waits for the other, and how the two stay out of each other's way.

The agents never talk to each other. The user merges every PR and is the only coordinator; each agent learns what
merged from GitHub.

## Branches

```text
dev ──► feat/P1 ◄── feat/p1-02-outbox-schema        (lane A)
            ▲   ◄── feat/p1-01-429-contract         (lane B)
            │   ◄── …one branch per PR, one PR open per lane at a time
            └──────► dev   (one PR when P1 is done, merged by the user)
```

- **`feat/P1`** is the phase feature branch (CLAUDE.md §21), cut from `dev` after PR 00 merges. Every P1 PR goes into
  it. CI runs on every PR into it and on every push to it; CodeRabbit reviews every PR into it.
- **Lane branches** are `feat/p1-<NN>-<slug>`, cut from a fresh `origin/feat/P1` (never `feat/P1/…`: git cannot hold
  that next to `feat/P1`). PR titles are `P1 PR <NN> — <title>`.
- **At the end**, `feat/P1` goes into `dev` as one PR, exempt from the size limit like a release PR.

## PR 00 — before either lane starts (lane A, from `dev`)

Everything decided on 24 October has to be on `dev` before `feat/P1` is cut, so both machines start from the same
base:

- **00a, tooling:** `ci.yml` and `.coderabbit.yaml` list `feat/P1`; `major-change-gate.js` sizes a phase PR against
  its phase branch (`prBase`, with its self-test); CLAUDE.md §13 and §21 and `docs/TESTING.md` describe phase feature
  branches. Labelled `no-release`.
- **00b, docs:** this file, the P1 plan, the ADR decisions (001, 004–006, 008–010), the roadmap's P10.4 and the
  CLAUDE.md §9 uploads line. Labelled `no-release`. It is a planning document of about 1,000 lines, over the 500-line
  limit, so it needs the user's explicit exemption.

Then the user creates `feat/P1` from `dev` (`git push origin origin/dev:refs/heads/feat/P1`), or asks lane A to.

## The lanes

| Lane | Machine      | Theme                                                     | PRs, in order                          | ≈ lines |
| ---- | ------------ | --------------------------------------------------------- | -------------------------------------- | ------- |
| A    | first (here) | background jobs, audit, the order transitions, money      | 02 → 02b → 03 → 05 → 06 → 04 → 08 → 09 | 3,100   |
| B    | second       | errors and client reporting, sessions, audit reads, flags | 01 → 10 → 11 → 12 → 15 → 07 → 13 → 14  | 2,630   |

PR 16 (money: drop the rupee columns) is not in either lane: it goes into `dev` after P1 has merged and its release
runs in production ([after P1](#after-p1)).

Why this cut:

- **Lane A owns every rewrite of `place_order` and `update_order_status`** (05, 08, 09), so no two branches ever hold
  different copies of those function bodies, and the outbox and audit schema everything else builds on.
- **Lane B owns the client** (10–12 are the only PRs with client code beyond type mirrors) **and the request
  pipeline** (`rateLimit.ts`, `auth.ts`, `routes/index.ts`), which lane A never touches.
- The two lanes are about the same size, and the cross-lane waits below line up with the rounds, so neither lane
  should sit idle.

## Waits across lanes

| PR       | Waits until this is merged into `feat/P1` | Why                                                                |
| -------- | ----------------------------------------- | ------------------------------------------------------------------ |
| A 03     | B 01                                      | both edit `utils/errors.ts` and `middleware/errorHandler.ts`       |
| B 15     | A 02                                      | its purge schedule needs pg_cron                                   |
| B 07, 13 | A 06                                      | 07 reads `audit_log`; 13's flag table carries `audit_row_change()` |

Inside a lane, the order is the order above. Before starting a PR, check that its waits have merged:

```bash
gh pr list --base feat/P1 --state merged --search '"P1 PR 06" in:title'
```

Not merged yet: tell the user what you are waiting for, and stop. Never build on the other lane's unmerged branch.

## The expected rounds

A round is one PR open in each lane, both merged by the user before the next round starts.

| Round | Lane A                     | Lane B                               |
| ----- | -------------------------- | ------------------------------------ |
| 1     | 02 outbox schema           | 01 the 429 contract                  |
| 2     | 02b queue wrappers         | 10 `POST /api/client-errors`         |
| 3     | 03 job runner (after 01)   | 11 the error sample setting          |
| 4     | 05 transitions emit events | 12 the error reporter                |
| 5     | 06 audit log               | 15 idle sign-out (after 02)          |
| 6     | 04 worker process          | 07 `GET /api/admin/audit` (after 06) |
| 7     | 08 order snapshots         | 13 feature flags (after 06)          |
| 8     | 09 money in paise: expand  | 14 flags in `/api/config`            |
| 9     | closing P1 (below)         | –                                    |

If one lane runs ahead, it waits at the next row whose dependency is not merged yet; nothing else changes.

Lane A builds 04 (the worker process) after 06: nothing depends on it, and 06 by round 5 keeps lane B's 07 and 13
from waiting. Until 04, events queue up in `q_notifications` with no consumer, which costs a few rows.

## Who edits what

| Area                                                                                                                                                                                                             | Owner                 | Rule for the other lane                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------- |
| SQL functions `place_order`, `update_order_status`, `emit_event`, the queue wrappers, `audit_row_change`                                                                                                         | A                     | never redefined in lane B                                                       |
| `server/src/jobs/`, `worker.ts`, `order.service.ts`, `order.controller.ts`, `menu.service.ts`, `utils/money.ts`, `server/scripts/seed*.ts`, `start.sh`, `compose.yaml`, `major-change-gate.js`                   | A                     | –                                                                               |
| `middleware/rateLimit.ts`, `middleware/auth.ts`, `routes/index.ts`, `admin.*` (schema, controller, routes), `settings.service.ts`, `config.service.ts`, `flags.service.ts`, `audit.service.ts`, all of `client/` | B                     | –                                                                               |
| `utils/errors.ts`, `middleware/errorHandler.ts`                                                                                                                                                                  | B in 01, then A in 03 | sequenced by the wait above                                                     |
| `utils/env.ts`, `server/.env.example` (A 04, B 10), `utils/serializers.ts` (A 08, 09; B 07, 11, 13), `server/src/types/api.ts`                                                                                   | both                  | add your entries beside your own group; never reorder or reformat others' lines |
| `server/src/types/database.ts`                                                                                                                                                                                   | generated             | never merged by hand: `npm run db:types`                                        |
| `docs/*.md`, `CLAUDE.md`                                                                                                                                                                                         | both                  | add your own subsection, row or bullet; never rewrite the other lane's          |
| `plans/P1_PLATFORM_CORE.md`                                                                                                                                                                                      | both                  | a PR ticks only its own "Merged" box                                            |
| `plans/ROADMAP.md`                                                                                                                                                                                               | B (PR 01)             | lane A does not edit it during P1                                               |

## Rules for both lanes

1. **One PR at a time, from a fresh base.** `git fetch origin`, then `git switch -c feat/p1-<NN>-<slug>
origin/feat/P1`. Build the PR as the plan describes, run the gate and `/post-change`, record the intent, tick the
   PR's box in the plan, push, open the PR into `feat/P1`, then **stop** (CLAUDE.md §21). Start the next PR only when
   the user says this one merged.
2. **Sizes and checks against `feat/P1`.** The 25-file / 500-line limit counts against `origin/feat/P1` (the hook
   does this from the branch name). Local runs of the CI checks take the base: `node scripts/version/check.mjs --base
origin/feat/P1` and `node scripts/ci/check-migrations.mjs --base origin/feat/P1`.
3. **Migration timestamps.** CI fails a migration whose timestamp is not after the newest one on `feat/P1`. If the
   other lane merged a migration after you created yours, rename your file to a fresh timestamp
   (`date -u +%Y%m%d%H%M%S`) before you push; it is not merged, so renaming it is allowed. Never touch a migration
   that is on `feat/P1`.
4. **Local database.** Each machine has its own local Supabase. After branching from a `feat/P1` that gained the
   other lane's migrations: `npm run db:reset && npm run seed` (local only).
5. **Conflicts and red CI.** If GitHub shows a conflict on your PR, or its CI fails because `feat/P1` moved, stop and
   ask the user for permission to merge `origin/feat/P1` into your branch (merge and rebase need the user's say-so,
   CLAUDE.md §12); with it, `/resolve-conflicts` regenerates `database.ts` and the lockfiles instead of hand-merging
   them. If the **push** run on `feat/P1` goes red after a merge, the lane whose PR merged last fixes it first, in a
   PR of its own, before anything else merges.
6. **Staging belongs to lane A, from `feat/P1` only.** `npm run db:push:staging` and staging seeds run only from a
   merged `feat/P1`, only by lane A (or the user), never from a lane branch. Lane B needs no staging credentials.
   Production stays the user's (CLAUDE.md §2).
7. **`dev` moves too.** Dependabot and hotfix back-merges land on `dev` during P1. The user merges `dev` into
   `feat/P1` between rounds (or asks lane A to), so the final PR stays small in conflicts. A migration must not land
   on `dev` during P1 without coming into `feat/P1` the same way, or the migration order breaks.
8. **Say it in the PR.** The description names the plan PR, the `/before-write` verdicts, the gate output, and
   anything the other lane needs to know ("adds `audit_row_change()`; PR 13 uses it").

## Setting up the second machine (lane B)

- Clone the repository and `git switch feat/P1` once it exists. Node 24 (`.nvmrc`), Docker, and `gh auth login`.
- The README quick start: `npm ci` in the root, `client/` and `server/`; `cd server && npm run db:start && cp
.env.example .env && npm run seed` (the example file holds the local stack's fixed keys); `client/.env.development`
  is in the repository. `npm run e2e:install` in `client/` for the Playwright smoke.
- Claude Code in the repository: the project's agents, skills, hooks and plugins come with it (`.claude/`); graphify is
  optional (its hooks skip when it is not installed). Nothing from the first machine's session or memory travels: the
  kickoff prompt below and the two plan files carry everything.

## Kickoff prompts

Paste one into a fresh Claude Code session on each machine; the same prompt resumes after a context reset.

**Lane A (first machine)**

```text
You are the lane A agent for P1. Read plans/P1_WORK_SPLIT.md and plans/P1_PLATFORM_CORE.md, and follow the split's
rules. Your lane, in order: 02, 02b, 03, 05, 06, 04, 08, 09, then closing P1. Take the first lane A PR whose "Merged" box
in P1_PLATFORM_CORE.md is unticked on origin/feat/P1, check its cross-lane waits with gh, build it on a fresh
feat/p1-<NN>-<slug> branch from origin/feat/P1, open the PR "P1 PR <NN> — <title>" into feat/P1, and stop until I say
it merged.
```

**Lane B (second machine)**

```text
You are the lane B agent for P1. Read plans/P1_WORK_SPLIT.md and plans/P1_PLATFORM_CORE.md, and follow the split's
rules. Your lane, in order: 01, 10, 11, 12, 15, 07, 13, 14. Take the first lane B PR whose "Merged" box in
P1_PLATFORM_CORE.md is unticked on origin/feat/P1, check its cross-lane waits with gh, build it on a fresh
feat/p1-<NN>-<slug> branch from origin/feat/P1, open the PR "P1 PR <NN> — <title>" into feat/P1, and stop until I say
it merged. You never push to staging.
```

## Closing P1

Once both lanes are done (every box but PR 16 ticked):

1. Lane A, on a fresh `origin/feat/P1`: the gate in both packages, `npm run e2e:chromium`, and `/break` (P1 changes
   auth, orders, money and the request pipeline). Fixes go into `feat/P1` as normal PRs.
2. Lane A opens the PR `feat/P1` → `dev` ("P1 — platform core"), exempt from the size limit; its description links the
   16 plan PRs. CI and CodeRabbit run on it as on any PR into `dev`.
3. The user merges it, then cuts the release as usual (`release.yml`).

## After P1

PR 16 (drop the rupee columns, ADR-004) goes straight into `dev` from `feat/p1-16-paise-contract`, once the user
confirms that the release containing P1 runs in production. Until then the deployed API still reads those columns.
