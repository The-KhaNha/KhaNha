---
name: break
description: Pre-release break test for food-pickup — runs the app-breaker agent over its four groups (security, data, flow, env) against the local servers, collects the ranked BREAK list with repros, evidence and fixes, and hands it to the main session to fix. Use it for "/break", "try to break it", "pentest this", "abuse test", before a release PR, and after a change to auth, orders, money, the request pipeline, uploads or the checkout flow. Read-only: the agents never edit source; the main session applies the fixes.
---

# /break — try to break the app before a release does

The `app-breaker` agent (`.claude/agents/app-breaker.md`) attacks the running app one group at a time. Two groups
need the shared Playwright browser, so they never run at the same time.

## 0. Preflight

1. Probe (never restart what answers): `curl -s -o /dev/null -w '%{http_code}'` on
   `http://localhost:8000/api/health`, `http://localhost:5173`, `http://127.0.0.1:54321/rest/v1/`. Start only what
   is down, in the background, and remember what you started: `cd server && npm run db:start` (+ `npm run seed` on
   a fresh stack), `cd server && npm run dev`, `cd client && npm run dev`. Never run `start.sh` while the user's
   servers are up.
2. Confirm the API points at local Supabase: `curl -s localhost:8000/api/config | jq -r .` and
   `grep -c 127.0.0.1 server/.env` (never print the file). If either names a hosted project, stop and ask.
3. `mkdir -p <scratchpad>/break` for the reports.
4. Run `claude-security:claude-security` first (a scan of the branch's changes after a change; the full codebase
   before a release) and save its findings as `<scratchpad>/break/static.md`. Pass them to the `security` group as
   leads to confirm live; the live run decides whether something is a BREAK.

## 1. Run the groups

Spawn `app-breaker` once per group. If the agent type is not registered yet (added this session), spawn
`general-purpose` with "Read `.claude/agents/app-breaker.md` and act as that agent for group `<group>`". Pass each
one: its group, the scratchpad path, and that the servers are already up.

- `security` and `data` in parallel (curl and scripts only; `security` at effort `xhigh`).
- Then `flow`, then `env` (both drive the browser: one at a time). If a group asks for the browser and another
  browser-driving agent is still running, wait.

Pair each with `Monitor` on `bash .claude/scripts/agent-progress-monitor.sh <output_file>` and show the
`## In-flight` block while they run.

## 2. Merge and rank

Each agent returns its report as its final message (it has no Write tool). Save each as
`<scratchpad>/break/<group>.md`, then combine the four into one list under `<scratchpad>/break/REPORT.md`: BREAKS ranked critical → high →
medium → low, then PASSED and UNTESTED (with reasons). Every BREAK keeps its repro, evidence and proposed fix.

## 3. Hand off

Classify with the handoff table in the agent (CONFIRM for critical/high and anything touching schema, API contract
or a shared atom; AUTO-EXECUTE for a low BREAK with one obvious fix; ADVISORY for the rest). Ask once, batched, then
fix the confirmed items yourself, one file at a time, and re-run only the failed items through a fresh
`app-breaker` on that group. A fix that touches `server/src/*` or `client/src/{pages,services,components}` is a
major change: run `/post-change` after it.

## 4. Finish

Stop what you started (TaskStop), confirm those ports answer `000`, delete every screenshot under the scratchpad and
`client/test-results/`, and report the ranked list with what was fixed, what is left and what stayed untested. No
`## In-flight` block on the final turn.
