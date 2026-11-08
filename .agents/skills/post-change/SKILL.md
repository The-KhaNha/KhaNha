---
name: post-change
description: "Verification pipeline for a MAJOR change in food-pickup — runs the gate, then refactorer → responsive-fixer → logging-auditor, then test-generator + docs-writer, then ui-verifier → perf-auditor, then code-review (and a claude-security scan when auth, orders, money or middleware changed), acts on every verdict, refreshes graphify and records the change as verified. Use it whenever a \"[post-change] unverified major change\" reminder appears, when a feature, endpoint, migration, page or dependency change is finished, before saying a substantial piece of work is done, or when the user says \"/post-change\", \"run the pipeline\", \"verify everything\", \"is this ready\". Do not use it after a docs-only change, a copy edit or a one-line fix."
---

Read docs/CODEX.md from the repository root, then read and follow ".claude/skills/post-change/SKILL.md".
