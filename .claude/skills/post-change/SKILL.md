---
name: post-change
description: Verification pipeline for a MAJOR change in food-pickup — runs the gate, then refactorer → responsive-fixer → logging-auditor, then test-generator + docs-writer, then ui-verifier → perf-auditor, acts on every verdict, refreshes graphify and records the change as verified. Use it whenever a "[post-change] unverified major change" reminder appears, when a feature, endpoint, migration, page or dependency change is finished, before saying a substantial piece of work is done, or when the user says "/post-change", "run the pipeline", "verify everything", "is this ready". Do not use it after a docs-only change, a copy edit or a one-line fix.
---

# /post-change — the major-change pipeline

`$BASE` is the PR's base branch: `origin/dev` for features, `origin/main` for `hotfix/*` branches
(`BASE=origin/dev`; `BASE=origin/main` when `git branch --show-current` starts with `hotfix/`).

A major change (see CLAUDE.md "What counts as a major change") gets the full treatment once, when the piece of work
is finished — not after every edit. The stages run in a fixed order because the early agents rewrite source and the
later ones must check the final state. Report progress one line per stage as you go.

## 0. Preflight

1. Scope: `git diff --name-only $BASE...HEAD` plus `git status --porcelain` (tracked edits and untracked
   files). Also run `node .claude/hooks/major-change-gate.js --status` to see which files are unverified. Note
   whether UI changed (`client/src/**/*.tsx`, `client/src/index.css`) and which packages are touched.
2. If the scope is not major (the gate says `minor`) and the user did not ask explicitly, say so and stop.
3. Probe services; start only what is down, in the background, and remember what you started:
   - `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:54321/rest/v1/` → down: `cd server && npm run db:start`
     (needs Docker; `open -a Docker` first if the daemon is off)
   - `http://localhost:8000/api/health` → down: `cd server && npm run dev`
   - `http://localhost:5173` → down: `cd client && npm run dev`
   Never run `start.sh` while the user's servers are up: it kills whatever holds 8000/5173.

## 1. Gate

In every touched package: `npm run typecheck && npm run lint && npm test`. Fix failures inside the scope before
going on; the agents assume a green baseline. A failure outside the scope is reported, not fixed.

## 2. Source editors — one at a time

These three all edit source, so running them together would make their edits collide. Run each in the foreground
and pass it the scope list:

1. `refactorer`
2. `responsive-fixer` — only if UI changed
3. `logging-auditor`

## 3. Tests and docs — in parallel

`test-generator` (writes `server/test/`, `client/src/**/*.test.ts(x)`) and `docs-writer` (writes `README.md`,
`docs/`, `.env.example`) never touch the same files. Spawn both in one message.

## 4. Verifiers — read-only, one after the other

`ui-verifier`, then `perf-auditor`. They check the final state, so they run last. They cannot run in parallel: the
Playwright MCP is ONE shared browser, and two agents switching tabs or throttling it would corrupt each other's
results (the same reason `responsive-fixer` never overlaps them). Skip `ui-verifier` only when nothing under
`client/` changed AND no response shape changed (`server/src/types/api.ts`, `utils/serializers.ts`).
`perf-auditor` always runs.

## 5. Act on every verdict

Classify each item with the agent's handoff table (CLAUDE.md "Verdict handoff"):
- AUTO-EXECUTE: apply it now.
- CONFIRM: batch all of them into one `AskUserQuestion` (file:line and the concrete change in each option). Apply
  the answers yourself, or spawn a fresh agent of the same type with the answer; the original agent has exited, so
  never SendMessage it.
- ADVISORY: list it in the final report.

If anything changed after step 1, run the gate again for the touched packages.

## 6. Finish

1. Record the change intent if missing: when `git diff --name-status $BASE...HEAD` plus `git status --porcelain`
   touch `client/src`, `server/src`, `server/scripts`, `server/supabase/migrations` or a `package.json` and add no
   `.changes/*.md`, pick the levels from `.changes/README.md` and run
   `npm run change -- --client <level> --server <level> "summary"` (CLAUDE.md "Versioning and branches").
2. `graphify update .`
3. `node .claude/hooks/major-change-gate.js --mark` — records the verified state so the Stop hook and the prompt
   reminder go quiet.
4. Stop every server you started (TaskStop), then confirm those ports answer `000`. Leave the user's servers alone.
5. Delete every screenshot or trace the agents wrote (`find . -maxdepth 3 -newer CLAUDE.md \( -name '*.png' -o -name '*.jpeg' \) -not -path '*/node_modules/*' -not -path './client/public/*'`, then check each against git before `rm`).
6. Report: a table with one row per stage (agent, verdict, what changed), the CONFIRM answers applied, the ADVISORY
   list, and the final gate result. No `## In-flight` block on the final turn.

## If an agent type is not registered

Agents added during the current session are not in the Agent tool's list until the next session. Spawn
`general-purpose` with: "Read `.claude/agents/<name>.md` and act as that agent on this scope: …".

## If an agent stalls

Run `bash .claude/scripts/extract-last-agent-state.sh <output_file> 6`, then finish its plan yourself, re-spawn it
with the extracted state, or show it to the user. Never let the stage silently disappear from the report.
