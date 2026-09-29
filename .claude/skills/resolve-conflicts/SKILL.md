---
name: resolve-conflicts
description: Resolve git merge/rebase conflicts in food-pickup without losing either side's intent, plus the Supabase migration check git cannot see. Use it for "/resolve-conflicts", "fix the merge conflicts", "I merged main and it broke", conflict markers (<<<<<<<) in files, "both modified" in git status, a conflicted package-lock.json or database.ts, or two branches that each added a migration.
---

# /resolve-conflicts

`$BASE` is the PR's base branch: `origin/dev` for features, `origin/main` for `hotfix/*` branches
(`BASE=origin/dev`; `BASE=origin/main` when `git branch --show-current` starts with `hotfix/`).

The work happens in `merge-conflict-resolver` (`.claude/agents/merge-conflict-resolver.md`). This skill checks what
needs resolving and hands over.

## 1. Probe both kinds of problem

```bash
git diff --name-only --diff-filter=U                       # (a) git-level conflicts, every unmerged combo
ls server/supabase/migrations/ | sort                      # (b) migration order
git ls-tree -r --name-only $BASE -- server/supabase/migrations/
```

(b) matters because git merges two new migration files without a conflict, yet the result can be broken: two files
with the same timestamp, or a branch migration timestamped before one already on `$BASE` (Supabase would
apply it out of order, or refuse it on `db push`).

- (a) empty and (b) in order → "No conflicts and the migrations are in order", stop.
- Otherwise continue.

## 2. Delegate

Spawn `merge-conflict-resolver` (foreground; its questions come back through you) with: the unmerged file list, the
migration listing for both sides, and: "Follow your full workflow. Ask about every FLAGGED region. Regenerate
`server/src/types/database.ts` with `npm run db:types` and lockfiles with `npm install` instead of hand-merging.
Never edit or re-timestamp a migration that exists on $BASE. Run the gate on touched packages."

## 3. Report and stop

Pass the agent's summary back as written: the user needs the exact decisions. If a branch migration was
re-timestamped, tell the user to run `cd server && npm run db:reset && npm run seed`. Do not commit.
