---
name: before-write
description: Reuse-first preflight for food-pickup — runs reuse-scout (and schema-guard when data is stored) and returns REUSE / EXTEND / BUILD NEW before any new file exists. Use it at the start of every non-trivial feature, and self-trigger it mid-task the moment you are about to create a new component, hook, util, service, endpoint, table, column or migration ("I'll add a new … for …"), even if the user never asked. Also for "/before-write", "does something like this already exist", "can we reuse".
---

# /before-write

Duplicated atoms and near-duplicate tables are the most common quality problem in a codebase like this, and they
are cheap to prevent and expensive to undo. This check takes a minute.

## 1. Intent

Use the arguments as the description of what is about to be built. If there are none, ask one question: "What are
you about to build? (1–2 sentences)".

## 2. Spawn in parallel (one message)

- Always `reuse-scout`: "About to build: <intent>. Search docs/COMPONENTS.md, docs/BACKEND_STRUCTURE.md,
  client/src/{components,lib,features,services}, server/src/{services,utils,schemas,middleware}. Verdict REUSE /
  EXTEND / NO MATCH with exact paths."
- `schema-guard` too when the intent stores, tracks, records, persists or reads new data, or mentions a table,
  column, enum, function or migration: "About to build: <intent>. Check server/supabase/migrations/*.sql and
  server/src/types/database.ts. Verdict REUSE / EXTEND / NEW TABLE."

## 3. Verdict

```text
# /before-write — "<intent>"
## Reuse Scout      <verdict, exact import paths>
## Schema Guard     <verdict, exact tables/functions>   (omit if not run)
## Path forward     - [ ] concrete step …
## Read first       - `client/src/components/<X>.tsx` …
```

Handoff: REUSE → proceed with it; EXTEND and NO MATCH / NEW TABLE → confirm with the user before writing, because
changing a shared atom or adding a table is a design decision. If both agents say NO MATCH, check the justification
is real (a genuinely new concept, not a shallow search).

When this ran as a standalone command, stop after the verdict. When you self-triggered it mid-task, carry on with the
confirmed path.
