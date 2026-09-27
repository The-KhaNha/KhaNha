---
name: fix-coderabbit
description: Apply CodeRabbit (or any automated reviewer's) comments on food-pickup by dispatching one background coderabbit-fixer per file. Use it for "/fix-coderabbit", a PR number with "fix / apply / address the review comments", or ANY pasted text with CodeRabbit markers (@coderabbitai, "Potential issue", "Refactor suggestion", "Nitpick", "Actionable comments posted", "Outside diff range", a ```suggestion block) — even when the user does not name the skill. Not for a human reviewer's design discussion that needs a conversation instead of edits.
---

# /fix-coderabbit — dispatcher

The fixing itself happens in `coderabbit-fixer` (`.claude/agents/coderabbit-fixer.md`). This skill only collects the
comments, groups them by file and dispatches, so the main agent stays free while fixers work.

## 1. Input

- A PR number (`123`, `#123`, or a PR URL) → Mode B: fetch the comments.
- Pasted comment text → Mode A: use it directly.
- Nothing → ask once: "Paste the CodeRabbit comments or give me a PR number."

## 2. Mode B: pull both layers

CodeRabbit writes in two places; missing either drops real findings.

1. Unresolved, non-outdated inline threads:
   ```bash
   REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner); OWNER=${REPO%/*}; NAME=${REPO#*/}
   gh api graphql -F owner=$OWNER -F name=$NAME -F pr=<n> -f query='
     query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){pullRequest(number:$pr){
       reviewThreads(first:100){nodes{isResolved isOutdated path line
         comments(first:20){nodes{databaseId author{login} body}}}}}}}'
   ```
   Keep `isResolved == false && isOutdated == false`. Each keeps its `databaseId` so the fixer can reply.
2. Review bodies by `coderabbitai[bot]` (`gh api repos/$REPO/pulls/<n>/reviews`): parse the
   `Outside diff range comments` and `Nitpick comments` `<details>` sections into `{file, lines, severity, body}`.
   These have no thread, so no reply. Skip `Duplicate comments` (the inline thread is the canonical copy).

## 3. Group by file and dispatch

- One fixer per file: two fixers on one file would race on the same `old_string`s. Different files are safe in
  parallel, so spawn all new fixers in ONE message, each `run_in_background: true`.
- More comments for a file whose fixer is still running → `SendMessage` to that fixer. If it has already returned,
  spawn a new one; a finished agent cannot receive messages.
- A comment whose file cannot be parsed → its own fixer as `unknown-<n>`.

Per-fixer prompt: the PR number (Mode B) or "pasted" (Mode A), the file path, its comments (with `databaseId` or
null), and: "Follow your full workflow. Run the gate before posting any 'Applied' reply. Do not commit, do not
resolve threads."

Announce each dispatch in one line ("Spawning coderabbit-fixer #2 for `server/src/services/order.service.ts` — 3
comments"), then show the `## In-flight` block on every turn while any fixer runs.

## 4. When fixers return

Act on the reports with the handoff classes: SAFE was applied (accept it); STRUCTURAL and FLAGGED go to the user in
one batched `AskUserQuestion`; AMBIGUOUS is listed. FLAGGED (branch-intent) regions are never changed without an
answer. Apply the answers yourself or re-spawn a fixer with the answer; do not SendMessage a finished fixer.

Never commit. The user reviews and commits.
