---
name: break
description: "Pre-release break test for food-pickup — runs the app-breaker agent over its four groups (security, data, flow, env) against the local servers, collects the ranked BREAK list with repros, evidence and fixes, and hands it to the main session to fix. Use it for \"/break\", \"try to break it\", \"pentest this\", \"abuse test\", before a release PR, and after a change to auth, orders, money, the request pipeline, uploads or the checkout flow. Read-only: the agents never edit source; the main session applies the fixes."
---

Read docs/CODEX.md from the repository root, then read and follow ".claude/skills/break/SKILL.md".
