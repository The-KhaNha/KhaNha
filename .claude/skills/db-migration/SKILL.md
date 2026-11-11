---
name: db-migration
description: Recipe for any database change in food-pickup (Supabase Postgres) — new table, column, enum value, index, trigger or SQL function — from `pnpm run db:new` through grants, RLS, indexes, reset, seed, regenerated types, docs and schema-guard. Use it whenever the schema must change, when a feature needs to store something new, when an atomic multi-step write needs a SQL function, or when the user says "add a column", "new table", "migration", "change the RPC".
---

# Database migration

`$BASE` is the PR's base branch: `origin/dev` for features, `origin/main` for `hotfix/*` branches
(`BASE=origin/dev`; `BASE=origin/main` when `git branch --show-current` starts with `hotfix/`).

Migrations are the one thing in this repo that cannot be quietly fixed later: once pushed to staging or production
they are history. So check first, write carefully, and verify locally.

1. **Check** — run `/before-write` (schema-guard) with the intent. Prefer a column or enum value on an existing table
   over a new table.
2. **Create** — `cd server && pnpm run db:new <snake_case_name>`. This writes
   `server/supabase/migrations/<timestamp>_<name>.sql`. Never edit a migration that already exists on `$BASE`
   (`git ls-tree -r --name-only $BASE -- server/supabase/migrations/`); write a new one instead.
3. **Write the SQL**, following the init migration's patterns:
   - `alter table … enable row level security;` on every new table, no policies: the browser's publishable key must
     reach nothing. Revoke from `anon` and `authenticated` (the default privileges already do this for new objects;
     keep any explicit `revoke` in line with the init migration).
   - Functions: `security definer` only where needed, `set search_path = ''`, `p_`-prefixed parameters, expected
     failures as `raise exception using message = '<API_ERROR_CODE>', detail = jsonb_build_object(...)::text`
     (SQLSTATE P0001),
     `revoke execute … from public, anon, authenticated` and `grant execute … to service_role`.
   - An index on every foreign key and every column used to filter or sort.
   - `updated_at` columns use the existing `set_updated_at()` trigger.
4. **Apply locally** — `pnpm run db:reset` (reapplies every migration), then `pnpm run seed`. Both are local-only and
   destructive; never point them at staging or production.
5. **Types** — `pnpm run db:types` regenerates `server/src/types/database.ts`. Never hand-edit that file.
6. **Code** — update services, `utils/serializers.ts` and DTOs as needed (use `/new-endpoint` for API changes). Decode
   new P0001 errors with `raisedByDatabase(err, 'CODE')` and map them to `AppError`s.
7. **Docs** — `docs/SCHEMA.md` (tables, columns, enums, indexes, functions and their errors, migration list) and
   `docs/PERMISSIONS.md` (grants, RLS, who may call the function).
8. **Verify** — `pnpm run typecheck && pnpm run lint && pnpm test` in `server/`; run schema-guard on the new migration.
9. **Ship** — the user runs `pnpm run db:push:staging` when ready. `db:push:production` is only ever run by the user.

This is a major change: finish with `/post-change`.
