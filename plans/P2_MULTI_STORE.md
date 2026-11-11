# P2 — Multi-store and multi-branch: implementation plan

The PR-by-PR plan for [ROADMAP.md P2](ROADMAP.md#p2--multi-store-and-multi-branch): many restaurants, some with
several branches, each with its own staff, hours, pause switch and settings, served by one app. The roadmap says what
P2 builds and why; this file says in which order, in which pull requests, with which files, tests, docs and checks,
and where P2 deliberately builds something different from the roadmap's text (each with its reason and the phase that
picks it up). When a PR merges, tick its box here and in the roadmap.

> **Status: proposal** (11 November 2026). P1 is in `dev` (#40). The roadmap's P2 section predates
> [ADR-001](../docs/adr/001-brands-own-stores.md) as amended (24 October 2026): where they disagree **the ADR wins**,
> this plan follows the ADR, and [PR 00](#pr-00--the-roadmap-says-what-adr-001-decided) rewrites the roadmap. The
> user decided D1 on 11 November 2026 (the single-store API is removed inside the phase) and amended ADR-001 to
> say so. The other [decisions](#decisions) are open; each has a default, and the plan is written for the defaults.
> P2 starts after [P1.8](P1_8_PNPM.md), so commands below are written for pnpm.

## How the team works P2

The P1 rules stand ([P1 plan](P1_PLATFORM_CORE.md#how-the-team-works-p1), CLAUDE.md §13–§21):

- **Every P2 PR, PR 00 included, goes into `feat/P2`**, cut from `dev` on 11 November 2026 and covered by
  the `ci-ok required` ruleset's `feat/P[0-9]` pattern. `feat/P2` goes into `dev` as one PR when P2 is done; the user merges it.
- **At most 38 changed files or 750 changed lines per PR** against `origin/feat/P2` (lockfiles,
  `server/src/types/database.ts` and Markdown do not count; tests do), one theme each. A PR that grows past the limit
  splits at the seam its section names.
- **One agent, one PR at a time,** in the [build order](#build-order). Each PR branches as `feat/p2-<NN>-<slug>` from
  a fresh `origin/feat/P2`, is finished (gate, `/post-change`, intent, owning docs, its box ticked here), opened as
  `P2 PR <NN> — <title>`, and then the agent merges it into `feat/P2` itself once `ci-ok` is green and CodeRabbit is
  clear (D7; this applies to P2 only, P3 PRs are merged by the user).
- **Migrations.** A new migration is newer than the newest on `feat/P2`. Staging takes migrations from `feat/P2`
  while P2 is open (`pnpm run db:push:staging`, a user step). When `dev` moves, merge `dev` into `feat/P2` before
  the next PR.
- **`/before-write` first** for every new table, function, endpoint, module or component, with the verdict in the PR
  description. The expected verdicts are noted per PR.
- **Every store route ships its isolation test** (PR 04 adds the helper): another store's member gets 403 on the
  route and 404 on the resource. A store route without it is not done.

## Where P2 starts

| Roadmap step    | Already in the code                                                                                                                                                                                                                                                                   | Left for P2                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| P2.1 stores     | one `stores` row (`name`, `tagline`, `description`, `image_url`, `is_open`, two prep-time columns; no timestamps, no audit trigger), read with `limit(1)` in `store.service.ts`; `GET /api/store` and `GET /api/menu`, cached under `store` and `menu` (`store` is never invalidated) | brands, the store columns, three public reads keyed per store          |
| P2.2 roles      | `profiles.role` is `CUSTOMER`, `STAFF` or `ADMIN`; `requireAuth` reads `id, role` on every request; `requireStaff` and `requireAdmin` compare the role; the client's `homeFor(role)` and `RequireRole` do the same                                                                    | memberships, the capability map, `requireStore`, the team API          |
| P2.3 orders     | `orders.store_id` and the `store_name` snapshot exist, with **no index on `store_id`**; `POST /api/orders` takes no `storeId`; a `STAFF` user lists and reads **every store's orders** (`listStaffOrders` has no store filter) and may move any of them                               | store-scoped lists and transitions, the index, the isolation matrix    |
| P2.3 settings   | `site_settings.staff_order_list_limit`; `MAX_QUANTITY_PER_ITEM = 10` in `order.schema.ts`, served as `MenuResponse.rules` next to a literal `lowStockThreshold: 5`; the client ignores `rules` and keeps its own `MAX_LINE_QUANTITY` and `LOW_STOCK_MAX` in `cartRules.ts`            | `store_settings`, one reader, the client reading `rules`               |
| P2.4 hours      | `stores.is_open`, checked by `createOrder` and again inside `place_order` (`STORE_CLOSED`)                                                                                                                                                                                            | all of it                                                              |
| P2.5 pause      | nothing                                                                                                                                                                                                                                                                               | all of it                                                              |
| P2.6 client     | routes `/` (Home), `/menu`, `/staff`, `/admin`; `useStore` and `useMenu` persist under `fp_cache:v1:`; `cartStore` (`fp_cart`, version 1) holds `{ lines }` with no store; `StoreCard` and `OpenPill` take one store and a boolean                                                    | the store list, per-store routes and cart, the staff switcher          |
| P1.3 (deferred) | `audit_log.store_id` with its `(store_id, id desc)` index; `GET /api/admin/audit`                                                                                                                                                                                                     | `GET /api/stores/:storeId/audit`                                       |
| P1.7 flags      | `feature_flags` with store, role and percent rules; flags are created by migration rows                                                                                                                                                                                               | nothing: P2 adds no flag ([below](#where-p2-differs-from-the-roadmap)) |
| Seed and tests  | one store, eleven menu items, three accounts (staff, admin, customer); `createTestUser(role)`, `testAuthMatrix`, `localSql`, `resetDemoData` in `server/test/setup/helpers.ts`                                                                                                        | two brands, three stores, their owners and teams; `testStoreIsolation` |

## Build order

| #   | PR                                            | Step       | Depends on | Size (files / lines) |
| --- | --------------------------------------------- | ---------- | ---------- | -------------------- |
| 00  | The roadmap says what ADR-001 decided         | docs       | –          | docs only            |
| 01  | Brands and stores: expand, and the seed       | P2.1       | 00         | 12 / 520             |
| 02  | Public store reads                            | P2.1       | 01         | 14 / 480             |
| 03  | Memberships and the capability map            | P2.2       | 01         | 16 / 600             |
| 04  | Store-scoped orders and the isolation matrix  | P2.3       | 02, 03     | 16 / 650             |
| 05  | Store settings                                | P2.3       | 04         | 18 / 560             |
| 06  | Opening hours: the rule and the reads         | P2.4       | 05         | 12 / 640             |
| 07  | Opening hours: editing                        | P2.4       | 06         | 12 / 480             |
| 08  | Pause and resume                              | P2.5       | 06         | 14 / 520             |
| 09  | Team: members and invites                     | P2.2       | 03         | 16 / 620             |
| 10  | The store's audit trail                       | P1.3       | 03         | 8 / 220              |
| 11  | Client: the store list and store pages        | P2.6       | 02, 06     | 22 / 700             |
| 12  | Client: one cart per store                    | P2.6       | 04, 11     | 14 / 560             |
| 13  | Client: the staff board per store             | P2.2, P2.5 | 04, 08, 11 | 16 / 560             |
| 14  | Client: `/manage` with the hours editor       | P2.4       | 07, 13     | 16 / 680             |
| 15  | Client: `/manage` settings and team           | P2.2, P2.3 | 09, 14     | 16 / 620             |
| 16  | Contract: the single-store API and `STAFF` go | P2.7       | all        | 20 / 380             |

Why this order: brands and stores first, because every later table hangs off a store. The public reads (02) and the
membership model (03) are independent and both feed the store-scoped orders (04), which is where a missed filter
would leak, so the isolation helper lands there and every later route uses it. Settings (05) come before hours (06)
because the last-order cutoff is a store setting. The server is complete (01–10) before the client moves (11–15), so
each client PR builds on a finished API; the contract (16) is last, once nothing calls the old routes.

## Cross-cutting decisions

- **ADR-001 as amended is the model.** A brand is the business and records its **owner** (`brands.owner_id`). The
  owner is treated as `OWNER` of every store of the brand, with no membership rows. Staff and managers are
  **memberships of one store**; nobody but the owner reaches across stores. The brand _template_ (the menu a new
  store is copied from) is P3's first step, not P2's: P2 creates stores through the seed.
- **Expand and contract inside the phase.** Nothing is deployed before P8 (user decision, 9 November 2026), so no
  released client depends on the single-store API. PRs 01–15 keep the old routes working, so every PR leaves a
  working app; PR 16 removes them, as P1's PR 16 did for the rupee columns. There is no contract release, no
  `default_store_id` and no `multi_store_ui` flag (D1).
- **Until PR 16, "the store" of an old route is the oldest one** (`order by created_at, id limit 1`): today's
  `limit(1)`, made deterministic.
- **Every store-scoped route names its store**: `/api/stores/:storeId/...` (a uuid) for members,
  `/api/stores/:storeRef/...` (an id or a slug) for the public reads. One middleware, `requireStore(capability)`,
  decides access; one helper, `scoped(req)`, adds the store filter to every query inside.
- **404 or 403.** A store the caller may not know about (not `ACTIVE`, and the caller is not its member, its
  brand's owner or an admin) is 404. A visible store where the caller lacks the capability is 403 `FORBIDDEN`. Inside
  a store route, a resource of another store (an order id from elsewhere) is 404, never 403 (CLAUDE.md §10).
- **Capabilities arrive with their routes.** `server/src/domain/permissions.ts` is one map from capability to the
  roles that hold it; P2 adds only the capabilities P2's routes check, and each later phase adds its own rows.
- **The database settles the races.** `place_order` re-checks the store's status, its manual switch and its pause
  inside the transaction. The weekly schedule is computed in the API only: an order one second after closing harms
  nobody, and the time-zone arithmetic stays in one tested TypeScript function.
- **Time is a parameter.** `openState(…, now)` is pure; SQL functions that read the clock take `p_now`. API tests
  that need a closed store build its hours around the current time; no test waits.
- **Cached public reads and their invalidation** (CLAUDE.md §2c). Server keys `stores:list`, `store:<id>` and
  `menu:<storeId>`. Every write that changes one invalidates it, and each key ships with the test that fails
  without the invalidation, as `menu-cache.test.ts` does today.
- **No `min_client_version` bump in the code.** The contract PR is safe because no client is deployed; the setting
  stays an operator's tool (see [User steps](#user-steps-cannot-be-done-from-the-repository)).

## The model P2 builds

The tables whose shape ADR-001 changed are given here in full. The tables the roadmap still describes correctly
(`store_settings`, `store_hours`, `store_schedule_exceptions`, the pause columns) are built as the roadmap has them,
with the differences in the [table below](#where-p2-differs-from-the-roadmap).

```sql
create type public.store_status as enum ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$'),
  description text not null default '',
  logo_url text,
  owner_id uuid references public.profiles (id) on delete set null,   -- ADR-001: the brand owner
  status public.store_status not null default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index brands_owner_id_idx on public.brands (owner_id);

alter table public.stores
  add column brand_id uuid not null references public.brands (id),   -- nullable, backfilled, then not null
  add column slug text not null unique,                              -- same pattern as brands.slug
  add column status public.store_status not null default 'ACTIVE',
  add column timezone text not null default 'Asia/Kolkata',
  add column area text,
  add column address_line text,
  add column contact_phone text,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();
create index stores_brand_id_idx on public.stores (brand_id);

create type public.store_role as enum ('MANAGER', 'STAFF');          -- OWNER is the brand's owner, not a row

create table public.store_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  role public.store_role not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  unique (user_id, store_id)
);
create index store_memberships_store_id_idx on public.store_memberships (store_id);

create table public.store_invites (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  role public.store_role not null,
  email text not null,                       -- the account that may accept it
  token_hash text not null unique,           -- sha-256 of the token; the token itself is shown once
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index store_invites_store_id_idx on public.store_invites (store_id);
```

**Capabilities in P2** (`domain/permissions.ts`, tested cell by cell):

| Capability                         | STAFF | MANAGER | OWNER (the brand's owner) | Platform ADMIN |
| ---------------------------------- | ----- | ------- | ------------------------- | -------------- |
| `orders.view`, `orders.transition` | ✓     | ✓       | ✓                         | ✗              |
| `store.pause`                      | ✓     | ✓       | ✓                         | ✓ (support)    |
| `hours.edit`, `settings.edit`      | ✗     | ✓       | ✓                         | ✗              |
| `team.manageStaff`                 | ✗     | ✓       | ✓                         | ✓              |
| `team.manageManagers`              | ✗     | ✗       | ✓                         | ✓              |
| `audit.store`                      | ✗     | ✓       | ✓                         | ✓              |

`ADMIN` keeps no kitchen powers (CLAUDE.md §2); its read-only support views across stores are P7.4's.

## Where P2 differs from the roadmap

Approved with the plan. PR 00 updates the roadmap to match.

| Roadmap says                                                                                                            | P2 does                                                                                                                                                                                                              | Picked up by                          |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| HLD: roles are memberships scoped to a store **or to a whole brand**; `OWNER` is a membership with no store             | memberships are per store only; the owner is `brands.owner_id` (ADR-001)                                                                                                                                             | –                                     |
| P2.1 `site_settings.default_store_id`; old endpoints serve it until a contract release, 14 days after the last old call | the oldest store until PR 16, which removes the old endpoints inside the phase; no column (D1)                                                                                                                       | –                                     |
| Flag `multi_store_ui`                                                                                                   | not created: with the contract inside the phase there is no old screen to switch back to, and with one active store `/` already opens that store                                                                     | –                                     |
| P2.1 backfill in one migration, `not null` in a second                                                                  | one migration (add nullable, backfill, set `not null`): no API runs between the two steps                                                                                                                            | –                                     |
| P2.1 `latitude`, `longitude`, `fssai_license_no`                                                                        | not added: nothing reads them yet                                                                                                                                                                                    | P12.2 (location), P9.4 (compliance)   |
| P2.1 `StoreDto.etaMinutes`, `rating`; the same two on the store card                                                    | not added                                                                                                                                                                                                            | P6.1, P7.5                            |
| P2.2 invites by email **or phone**, accepted on the next sign-in                                                        | an invite names an email and yields a link the inviter shares; accepting needs a signed-in account with that email. Nothing can send an email or an SMS before P6.3 (D3)                                             | P6.3 (delivery, phone invites)        |
| P2.2 "nobody can remove the brand's last owner"                                                                         | holds by construction: the owner is not a membership. Changing `brands.owner_id` is an admin action                                                                                                                  | P7.4 (onboarding)                     |
| P2.2 the full capability matrix                                                                                         | the six rows above; a capability is added with the route that checks it                                                                                                                                              | each route's phase                    |
| P2.2 `requireAuth` puts memberships on every request                                                                    | as written, in the same single profile read (an embedded select); measured in PR 03                                                                                                                                  | –                                     |
| P2.3 `acceptance_mode` enum, `staff_can_edit_stock`                                                                     | not added: nothing reads them                                                                                                                                                                                        | P5.5, P3 PR 04                        |
| P2.3 customer `GET /api/orders?storeId=`                                                                                | not built: no screen filters the customer's history by store                                                                                                                                                         | the first screen that does            |
| P2.4 a store with hours only                                                                                            | a store with **no weekly rows** follows its manual switch alone, as today; hours apply once a manager saves any. Existing stores keep working through the migration, and the test suite's default store has no hours | –                                     |
| P2.4 `date-fns-tz` "if a test shows a gap"                                                                              | `Intl.DateTimeFormat` only                                                                                                                                                                                           | a failing property test               |
| P2.5 a pg_cron sweep that emits `store.resumed` when `paused_until` passes                                              | not built: the resume is derived, and no consumer exists. `store.paused` and `store.resumed` are emitted by the two manual functions                                                                                 | P6.3 or P7.1, with the first consumer |
| P2.7 `UserDto.role = 'STAFF'` kept for old clients; `STAFF` profiles migrated at a contract release                     | `STAFF` profiles become memberships in PR 03 and `CUSTOMER` profiles in PR 16; the enum value stays, unused (Postgres cannot drop one cheaply)                                                                       | –                                     |
| P1.3 `GET /api/stores/:storeId/audit` (deferred from P1)                                                                | built, PR 10                                                                                                                                                                                                         | –                                     |
| P1.5 `orders.store_slug` snapshot (deferred from P1)                                                                    | not snapshotted: `OrderDto.store` gains `slug` from a live read, and a store is archived, never deleted                                                                                                              | –                                     |
| Testing strategy: SQL functions under pgTAP                                                                             | RPC tests in Vitest against local Supabase, as P1 decided (one runner)                                                                                                                                               | –                                     |

## The pull requests

### PR 00 — The roadmap says what ADR-001 decided

- [x] Merged (into `feat/P2`, like every P2 PR)

Docs only (`no-release`). `plans/ROADMAP.md`: the P2 design, P2.1, P2.2 and P2.7 follow
[the model above](#the-model-p2-builds) and the [differences table](#where-p2-differs-from-the-roadmap); P3.1
becomes the brand template (the [P3 plan](P3_CATALOG_AND_MEDIA.md#the-model-p3-builds) has the text); the roles
table and the ADR-001 row of the architecture-decisions table say "template" and "owner on the brand"; the P2 and P3
sections each gain their "How it is built" line. Also closes the P1 plan's other two leftovers: the roadmap's data
model, P5.1, P5.6 and the ADR-004 row of its architecture-decisions table say paise (ADR-004 as amended), and
`plans/P0_FOUNDATIONS.md` gets its "done" status and ticks.

The one ADR change P2 needed is **made**: the user amended [ADR-001](../docs/adr/001-brands-own-stores.md) on
11 November 2026, so the old endpoints serve the oldest store while P2 is built and are removed inside the phase,
with no configured default store (D1). This PR only brings the roadmap into line with the ADR as it now reads (see
[ADRs this plan touches](#adrs-this-plan-touches)).

### PR 01 — Brands and stores: expand, and the seed (P2.1)

- [x] Merged

`/before-write`: schema-guard, NEW TABLE (`brands`), EXTEND (`stores`).

Migration `<ts>_brands_and_stores.sql`: the enum, `brands` and the `stores` columns
[above](#the-model-p2-builds), added nullable, backfilled (one brand per existing store, named and slugged after it,
`ACTIVE`, no owner), then set `not null`. `set_updated_at` triggers on both. Audit triggers:
`brands_audit` (`'brand.changed', '*'`) and `stores_audit` (`'store.changed'` on `name`, `slug`, `status`, `is_open`,
`area`, `address_line`, `contact_phone`, `timezone`). RLS on, no policies, revoked from `anon` and `authenticated`
(the lockdown test covers it). Then `pnpm run db:types`.

Server: `store.service.ts` picks the oldest store deterministically; `toStoreDto` gains `slug`,
`brand: { id, name, slug }`, `area`, `address`; the client's `Store` type follows (additive). `server/scripts/`
`seed-data.ts` and `seed.ts` create two brands with their owners: "Campus Cafe" (today's store and menu) and a chain
with two branches in different areas, each branch with its own copy of a shorter menu. The seed stops assuming one
store (`seedStore`'s `limit(1)`, "delete every other item").

Tests: `test/api/stores-schema.test.ts` (the backfill leaves no store without a brand or a slug; a duplicate slug is
refused; a slug that breaks the pattern is refused; an update writes one audit row with the actor). The existing
`store.safe.test.ts` and `menu-cache.test.ts` pass unchanged: that is the proof the old routes still work.

Docs: `docs/SCHEMA.md`, `docs/API.md` (the new `StoreDto` fields), `docs/ARCHITECTURE.md` (the ER diagram),
`README.md` (the demo accounts). Intent: `--server minor --client patch`.

Verify: `pnpm run db:reset && pnpm run seed`; `curl :8000/api/store` returns Campus Cafe with its brand; three rows
in `stores`.

### PR 02 — Public store reads (P2.1)

- [x] Merged

`/before-write`: reuse-scout, expected EXTEND (`store.service.ts`, `menu.service.ts`, `cached()`).

Endpoints, all public, cached with `PUBLIC_READ_TTL_MS` and served with the ETag handling the menu has today:

- `GET /api/stores?area=` → `{ stores: StoreSummaryDto[] }` (`id`, `slug`, `name`, `tagline`, `imageUrl`, `area`,
  `brand`, `isOpen`), `ACTIVE` stores only, capped by a platform constant; key `stores:list`. The cache holds the
  whole list of `ACTIVE` stores under that one key; the `area` filter is applied to the cached list in memory, after
  the cache, so there is one key, one invalidation and no per-area variants.
- `GET /api/stores/:storeRef` → `{ store }`; key `store:<id>`. A store that is not `ACTIVE` is 404.
- `GET /api/stores/:storeRef/menu` → today's `MenuResponse` for that store; key `menu:<storeId>`.

`storeRef` resolves a uuid by id and anything else by slug (`resolveStoreRef` in `store.service.ts`, itself cached).
`getMenu()` takes a store id; the old `GET /api/menu` and `GET /api/store` call the same functions with the oldest
store. `order.service.ts` invalidates `menu:<storeId>` where it invalidates `menu` today.

Tests: `test/api/stores-read.test.ts` (list, by id, by slug, unknown → 404, a `DRAFT` store → 404 and absent from
the list, `area` filter, two requests in a row with different `area` values each return only their own stores, the
auth matrix shows the routes are public); `test/api/store-cache.test.ts` (each of the
three keys is served from cache, and a status change, an order that takes the last unit and a cancel each
invalidate the right one: every case seen failing with its `invalidate` removed).

Docs: `docs/API.md` (three routes, `StoreSummaryDto`, the caching table), `docs/BACKEND_STRUCTURE.md`,
`.claude/rules/backend.md` §2c (the keys). Intent: `--server minor`.

Verify: `curl :8000/api/stores`, then `/api/stores/<slug>/menu` twice: the second is a 304 with `If-None-Match`.

### PR 03 — Memberships and the capability map (P2.2)

- [x] Merged

`/before-write`: schema-guard, NEW TABLE (`store_memberships`); reuse-scout, NO MATCH (`domain/` is new).

Migration `<ts>_store_memberships.sql`: the enum and table above; every `profiles.role = 'STAFF'` user becomes a
`STAFF` member of the oldest store (their role stays `STAFF` until PR 16, so the old staff routes still admit
them); audit trigger `store_memberships_audit` on insert, update and delete (`'membership.changed'`).
`audit_row_change()` is update-only today (a delete has no new row, so it writes nothing): it is redefined to record
an insert as `[null, value]` pairs and a delete as `[value, null]` pairs, taking the store and the entity id from
whichever row exists. RLS on, revoked, lockdown test.

Server:

- `src/domain/permissions.ts`: the `Capability` union, the map [above](#the-model-p2-builds), and
  `can(access, capability)` where `access` is `'OWNER' | 'MANAGER' | 'STAFF' | 'ADMIN' | null`.
- `middleware/auth.ts`: `requireAuth`'s one profile read embeds the user's memberships and owned brands;
  `req.user` gains `memberships: { storeId, role }[]` and `ownedBrandIds: string[]`. New `requireStore(capability)`:
  loads the store (through the `store:<id>` cache), applies the 404-or-403 rule, sets `req.store`
  (`{ id, brandId, status, timezone }`) and `req.storeAccess`.
- `types/auth.ts`, `types/express.d.ts`: the new fields. `Actor` gains `storeRole` when the request is store-scoped,
  so the audit row says in which capacity someone acted.
- `GET /api/auth/me`: `UserDto` gains `memberships: { storeId, storeSlug, storeName, role }[]` and
  `ownedBrands: { id, name, slug }[]` (additive; the client's `User` type follows).
- `server/scripts/seed-data.ts`: a manager and a staff member per store; the chain's owner owns its brand.
- `test/setup/helpers.ts`: `createStoreMember(storeId, role)` and `createBrandOwner(brandId)` next to
  `createTestUser`.

Tests: `test/unit/permissions.safe.test.ts` (every cell of the matrix, and an unknown capability does not compile);
`test/api/require-store.test.ts` on a throwaway route mounted by the test (member with the capability → 200;
member without → 403; member of another store → 403; a `DRAFT` store for a stranger → 404; its owner → 200;
`ADMIN` on `store.pause` → 200 and on `orders.view` → 403; a deleted membership stops working on the next request);
`auth.test.ts` gains the `/me` fields.

Performance: `perf-auditor` compares `GET /api/auth/me` and `GET /api/orders` p95 before and after the embedded
read; a regression past the budget moves the membership read behind a short per-user cache with its invalidation on
every membership write.

Docs: `docs/PERMISSIONS.md` (memberships, the owner, the matrix, 404-or-403), `docs/SCHEMA.md`, `docs/API.md`
(`UserDto`), `docs/BACKEND_STRUCTURE.md` (`domain/`), `.claude/rules/backend.md` §4 and §10 and
`.claude/hooks/major-change-gate.js` (`server/src/domain/` is a major-change path), CLAUDE.md §2 (roles). Intent:
`--server minor --client patch`.

### PR 04 — Store-scoped orders and the isolation matrix (P2.3)

- [x] Merged (the split seam taken: the lint rule and `scoped` are PR 04b)

`/before-write`: reuse-scout, expected EXTEND (`order.service.ts`, the order routes).

Migration `<ts>_orders_store_index.sql`: `create index orders_store_id_status_created_at_idx on public.orders
(store_id, status, created_at desc)`.

Server:

- `utils/scoped.ts`: `scoped(req).from(table)` returns the supabase-js builder with `.eq('store_id', req.store.id)`
  already applied.
- `server/eslint.config.mjs`: a `no-restricted-syntax` rule flags `supabaseAdmin.from('orders' | 'order_items' |
'store_memberships' | …)` outside the service file that owns the table; store-scoped services take the scoped
  builder. The rule's own test file proves it fires.
- Routes: `GET /api/stores/:storeId/orders?status=` (`orders.view`; today's staff list, scoped) and
  `PATCH /api/stores/:storeId/orders/:orderId/status` (`orders.transition`; an order of another store is 404).
- `POST /api/orders` accepts `storeId` (optional until PR 16: without it, the oldest store). `createOrder` reads
  that store, and refuses a store that is not `ACTIVE` with 404.
- `GET /api/orders/:id`: the customer who placed it, or a caller with `orders.view` at the order's store.
- The old routes, until PR 16: `GET /api/orders` for a `STAFF` profile lists the stores the caller is a member of
  (no longer every store), and `PATCH /api/orders/:id/status` resolves the order's store and applies the same
  capability check. **This closes today's cross-store read**, so it is P2's first security fix, with its guard.
- `OrderDto.store` gains `slug`.
- `test/setup/helpers.ts`: `testStoreIsolation(label, makeRequest)`, the tenant matrix every later store route
  calls: staff of store A on store B's route → 403; store A's staff addressing store B's resource through store
  A's route → 404; the owner of the other brand → 403; a customer → 403; anonymous → 401.

Tests: `test/api/store-orders.test.ts` (the list holds only the store's orders; the 5×5 status matrix through the
new route; the isolation matrix on both routes; a staff member of two stores sees each separately); `orders.test.ts`
gains `storeId` cases (another store's item in the cart → `ITEM_UNAVAILABLE`, not a cross-store order); the old
suites pass unchanged except the one assertion that a `STAFF` user sees every store's orders, which becomes the
guard for the fix.

Lifecycle walk (CLAUDE.md §14) through the new routes, with `domain_events` and `audit_log` checked.
`claude-security` scan and `/break` security group: the PR changes who may read and move orders.

Docs: `docs/API.md`, `docs/PERMISSIONS.md` (the route matrix), `docs/TESTING.md` (`testStoreIsolation`, the lint
rule), `docs/BACKEND_STRUCTURE.md` (`scoped`), `.claude/rules/backend.md` §10. Intent: `--server minor`.

Split seam if over the limit: the lint rule and `scoped` adoption in existing services move to a PR 04b.

As built: another store's item stays 400 `ITEM_NOT_FOUND` (the stable code its existing test pins), not
`ITEM_UNAVAILABLE`. `createTestUser('STAFF')` is also a STAFF member of the oldest store, as the memberships backfill
made every STAFF profile, so the old suites pass unchanged; the guards are new tests in `store-orders.test.ts`.

### PR 04b — `scoped` and the table-ownership lint rule (P2.3)

- [x] Merged

PR 04's split seam: `utils/scoped.ts`, the `no-restricted-syntax` rule in `server/eslint.config.mjs` with its own test
file, and the adoption in existing services, as PR 04 describes them. Docs: `docs/TESTING.md` (the lint rule),
`docs/BACKEND_STRUCTURE.md` (`scoped`). Intent: `--server patch`.

As built: the lint rule only (`TABLE_OWNERS` in `server/eslint.config.mjs`, `table-ownership.safe.test.ts`). `scoped`
was dropped. A supabase-js `.from()` has no `.eq` before `.select()`/`.update()`, `order_items` has no `store_id`, and
the board reads several stores at once (`.in('store_id', …)`), so a generic wrapper needed casts and fitted no caller.
The owning services filter by store explicitly, and `testStoreIsolation` proves each store route. Nothing under
`server/src` changed, so there is no intent; the PR is `no-release`.

### PR 05 — Store settings (P2.3)

- [ ] Merged

`/before-write`: schema-guard, NEW TABLE (`store_settings`).

Migration `<ts>_store_settings.sql`: the roadmap's table with four columns (`max_quantity_per_item`,
`low_stock_threshold`, `staff_order_list_limit`, `last_order_minutes_before_close`), `updated_at`, `updated_by`; one
row per existing store, `staff_order_list_limit` copied from `site_settings`; a trigger on `stores` insert creates
the row, so a store never exists without one; `store_settings_audit` (`'store_settings.changed', '*'`).

Server: `services/storeSettings.service.ts` (`getStoreSettings(storeId)`, cached under `store_settings:<id>`,
`updateStoreSettings` with the `x-actor` headers, invalidating it and `menu:<storeId>`);
`PATCH /api/stores/:storeId/settings` and `GET` (`settings.edit`; zod bounds equal to the check constraints, with
a parity test in the style of `limits-parity.safe.test.ts`); `MenuResponse.rules` reads the store's row; `createOrder`
caps a line at the store's `max_quantity_per_item`; the store order list is capped by the store's
`staff_order_list_limit`. `MAX_QUANTITY_PER_ITEM` and the literal `5` go; zod keeps a sanity bound of 50.

Client: `cartRules.ts` takes the limits as arguments instead of `MAX_LINE_QUANTITY` and `LOW_STOCK_MAX`; `useMenu`
hands `rules` to the cart and the stock pill; the fallback when no menu is loaded lives in
`config/fallbacks.json` with its parity test.

Tests: `test/api/store-settings.test.ts` (bounds, the auth and isolation matrices, a write invalidates the menu's
`rules`, an order over the store's cap is refused while the same order at a store with a higher cap passes);
`cartRules.test.ts` (limits from arguments).

Docs: `docs/CONFIGURATION.md` (the new **store setting** tier and its four rows; `staff_order_list_limit` moves),
`docs/SCHEMA.md`, `docs/API.md`, `plans/ROADMAP.md` A1 (three rows resolved). Intent: `--server minor --client
patch`.

### PR 06 — Opening hours: the rule and the reads (P2.4)

- [ ] Merged

`/before-write`: schema-guard, NEW TABLE ×2; reuse-scout, NO MATCH (`domain/schedule.ts`).

Migration `<ts>_store_hours.sql`: `store_hours` and `store_schedule_exceptions` as in the roadmap, RLS on, revoked.

Server:

- `src/domain/schedule.ts`: `openState({ status, isOpen, pausedUntil, acceptingOrders, timezone }, hours,
exceptions, lastOrderMinutes, now) → { state, nextChangeAt, label }`, with the roadmap's states and flow. No
  weekly rows: `OPEN` or `CLOSED` by the manual switch alone. `PAUSED` is wired in PR 08 (the inputs are optional
  until then).
- `StoreDto` and `StoreSummaryDto` gain `openState`, `nextChangeAt`, `openLabel`; `isOpen` is now
  `state ∈ { OPEN, CLOSING_SOON }`. The cached entries are computed on read and live for `PUBLIC_READ_TTL_MS`, so a
  stale state is at most that old.
- `GET /api/stores/:storeRef/hours` (public; the week and the exceptions from today on; key `store_hours:<id>`).
- `createOrder` refuses by `openState` with `STORE_CLOSED`, whose message now names the next opening ("Campus Cafe
  opens at 9:00 AM") and whose details carry `nextChangeAt` (a new details shape, tagged `kind: 'storeClosed'`).
- `fast-check` as a server devDependency.

Tests: `test/unit/schedule.safe.test.ts`, property-based: intervals past midnight (yesterday's still counts),
`SPECIAL_HOURS` replacing the week, `CLOSED` over `SPECIAL_HOURS`, the cutoff to the minute, `nextChangeAt` always
after `now`, a zone with a clock change; `test/api/store-hours.test.ts` (the public read; an order at a store whose
only interval ended an hour ago is refused with the next opening; the same order at a store with no hours passes).

Docs: `docs/SCHEMA.md`, `docs/API.md` (the states, the route, the `STORE_CLOSED` details), `docs/ARCHITECTURE.md`
(the open-state flow), `docs/TESTING.md` (property tests). Intent: `--server minor --client patch`.

### PR 07 — Opening hours: editing (P2.4)

- [ ] Merged

Migration `<ts>_set_store_hours.sql`: `set_store_hours(p_store_id, p_hours jsonb, p_actor, p_request_id)` replaces
the week in one transaction (overlapping intervals on a day are refused with `P0001` `VALIDATION_ERROR`), sets the
actor and writes one audit row with the old and new week; audit trigger on `store_schedule_exceptions`.

Server: `PUT /api/stores/:storeId/hours`, `POST /api/stores/:storeId/schedule-exceptions`,
`DELETE /api/stores/:storeId/schedule-exceptions/:exceptionId` (`hours.edit`; bounds: at most 6 intervals a day and
50 upcoming exceptions, as platform constants in `schemas/limits.ts`). Each write invalidates `store:<id>`,
`stores:list`, `store_hours:<id>` and `menu:<storeId>`.

Tests: `test/api/store-hours-edit.test.ts` (auth and isolation matrices; an overlap is refused and leaves the old
week; a write flips `openState` on the next read, seen failing without the invalidation; an exception of another
store is 404).

Docs: `docs/API.md`, `docs/SCHEMA.md`, `docs/PERMISSIONS.md`, `docs/CONFIGURATION.md` (the two bounds). Intent:
`--server minor`.

### PR 08 — Pause and resume (P2.5)

- [ ] Merged

Migration `<ts>_store_pause.sql`: the four pause columns; `pause_store(p_store_id, p_until, p_reason, p_actor,
p_request_id, p_now default now())` and `resume_store(...)`, each setting the actor and emitting `store.paused` /
`store.resumed` (a repeat is a no-op that emits nothing); `place_order` re-created from its latest body with one
more check: a store that is not `ACTIVE`, or is paused at `p_now`, raises `STORE_PAUSED` (or `STORE_CLOSED` for the
status); and its stock update gains `and store_id = p_store_id`, so the database also refuses another store's item
(today only `createOrder` drops it, `ITEM_NOT_FOUND`; deferred here from the PR 01 review). `stores_audit` watches the pause columns.

Server: `POST /api/stores/:storeId/pause { minutes | until, reason? }` and `POST .../resume` (`store.pause`);
`storePaused(storeName, pausedUntil)` → 409 `STORE_PAUSED` ("Campus Cafe has paused new orders. Back at 3:40 PM.");
`openState` returns `PAUSED`; both writes invalidate the store's keys. The presets (15, 30, 60 minutes, "until I
resume") are the client's; the server bounds `minutes` at 1–720.

Tests: `test/api/store-pause.test.ts` (auth and isolation matrices; pause → the order is refused → resume → it
passes; a pause whose `paused_until` passed no longer refuses, with `p_now`; **the race**: `Promise.all` of a pause
and ten orders leaves every order either placed or refused with `STORE_PAUSED`, stock consistent with the placed
ones; a repeated pause is 200 with one event). The lifecycle walk checks `domain_events` for both events.

Docs: `docs/API.md` (routes, `STORE_PAUSED`), `docs/SCHEMA.md`, `docs/JOBS.md` (the two events; no subscription
yet), `plans/ROADMAP.md` A3 and A5. Intent: `--server minor --client patch` (the client learns the code in PR 11).

From PR 04's review (CodeRabbit on #50): `createOrder` checks `stores.status` on its own uncached read, so a store
suspended between that read and `place_order` can still take one order. The re-created `place_order` checks
`status = 'ACTIVE'` under its store lock as well, raising a code `createOrder` maps to 404 "Store not found.", with a
test that suspends the store mid-flight.

### PR 09 — Team: members and invites (P2.2)

- [ ] Merged

`/before-write`: schema-guard, NEW TABLE (`store_invites`).

Migration `<ts>_store_invites.sql`: the table above; `accept_store_invite(p_token_hash, p_user_id, p_email, p_actor,
p_request_id, p_now default now())` checks, in one transaction, that the invite exists, is not expired, revoked or
used, and names the caller's email (case-insensitive), then inserts the membership and marks the invite; a repeat by
the same user returns the membership; every other failure raises `NOT_FOUND` (one answer, so a token cannot be
probed). The audit trigger on `store_invites` watches `role`, `email`, `accepted_at` and `revoked_at`, never
`token_hash`.

Server:

- `GET /api/stores/:storeId/members` (members with name, email and role; pending invites) — `team.manageStaff`.
- `POST /api/stores/:storeId/invites { email, role }` → `{ invite, token }`, the token shown once. Inviting a
  `MANAGER` needs `team.manageManagers`. An existing member or an open invite for that email → 409
  `MEMBERSHIP_EXISTS`. Expiry: 7 days, a platform constant.
- `DELETE /api/stores/:storeId/invites/:inviteId` (revoke) and `DELETE /api/stores/:storeId/members/:membershipId`
  (removing a manager needs `team.manageManagers`; removing oneself is allowed).
- `POST /api/me/invites/accept { token }` (signed in; the token is a bounded string in zod; its own rate limiter
  through `createRateLimiter`, keyed by user). The token travels in the body, never in a path or query, because the
  access log keeps the request path and field redaction does not cover it.
- Tokens: 32 random bytes, base64url; only the hash is stored; the token is never logged (`REDACT_PATHS` gains the
  body field, with its logging test).

Tests: `test/api/team.test.ts` (auth and isolation matrices on all five routes; a manager cannot invite or remove a
manager; the owner can; accept with the wrong account, an expired, revoked or used token → 404; accept twice → one
membership; the access-log line of a successful accept and of a rejected one contains no token; removal takes effect on the next request; every change leaves an audit row naming the actor).
`claude-security` scan: the PR grants access.

Docs: `docs/API.md`, `docs/PERMISSIONS.md` (who may invite whom), `docs/SCHEMA.md`, `docs/LOGGING.md` (never logged:
invite tokens), `plans/ROADMAP.md` A3. Intent: `--server minor`.

### PR 10 — The store's audit trail (P1.3, deferred)

- [ ] Merged

`/before-write`: reuse-scout, expected EXTEND (`audit.service.ts`, `auditQuerySchema`).

`GET /api/stores/:storeId/audit` (`audit.store`): `audit.service.ts`'s existing cursor query with the store filter
forced from `req.store`, never from the query string. The rows a store can read hold no customer data: the audited
tables carry statuses, settings, hours and team changes. An invite's row carries the invited email, which the same
roles already see in the team list.

Tests: `test/api/store-audit.test.ts` (auth and isolation matrices; only the store's rows; the cursor; a `storeId`
in the query string is ignored).

Docs: `docs/API.md`, `docs/PERMISSIONS.md`. Intent: `--server minor`.

### PR 11 — Client: the store list and store pages (P2.6)

- [ ] Merged

`/before-write`: reuse-scout, expected EXTEND (`StoreCard`, `OpenPill`, `useStore`, `useMenu`). Skill:
`agent-skills:frontend-ui-engineering`; the store list is a new screen, so `frontend-design:frontend-design` first,
inside the `@theme` tokens (CLAUDE.md §7, §16).

- Routes (`App.tsx`, `appShell.ts`): `/` → the store list, grouped by `area`, or straight to the store page when
  one store is active; `/s/:storeSlug` → today's Home for that store; `/s/:storeSlug/menu` → its menu; `/menu` →
  a redirect to the cart's store, else `/`.
- `services/stores.ts` (`GET /stores`, `/stores/:ref`, `/stores/:ref/menu`, `/stores/:ref/hours`);
  `features/stores/useStores.ts` and `useStoreMenu(storeRef)`, both `useResource` with `persist: true`, keys
  `stores` and `menu:<storeId>`. `CACHE_PREFIX` is already
  `fp_cache:v2:` (bumped in PR 01, where the store DTO grew; old entries are dropped on every load, with a test).
- `StoreCard` gains `variant="compact"` (photo, name, area, open state); `OpenPill` takes `state` and `label`
  ("Closes at 9 PM", "Opens tomorrow at 8 AM", "Closed for Diwali", "Paused · back at 3:40 PM").
- Budgets (CLAUDE.md §2b): the first card's photo is the LCP candidate on `/` (eager, 400px `srcset`), the rest
  lazy; the list payload stays under about 8 KB for 20 stores; `perf-auditor` re-baselines `/`.

Tests: `StoreCard.test.tsx` (the variant, each state's copy), `Home.test.tsx` (list, single-store shortcut, loading,
empty, error with retry), `useResource.test.ts` (the prefix bump), e2e smoke: open the list, pick a store, see its
menu. Visual gate at 390px throttled and 1280px.

Docs: `docs/FRONTEND_STRUCTURE.md` (routes, `features/stores/`), `docs/COMPONENTS.md` (`StoreCard`, `OpenPill`),
`docs/PERF_BASELINE.md`, `.claude/rules/frontend.md` §2c (the keys). Intent: `--client minor`.

### PR 12 — Client: one cart per store (P2.6)

- [ ] Merged

- `cartStore` version 2: `{ storeId, storeSlug, storeName, lines }`; `migrate` gives a version-1 cart the store its
  first line belongs to, found through the menu it was added from, and empties it if that cannot be resolved (a
  cart is cheap to rebuild; a cart sent to the wrong store is not).
- Adding from another store opens `ReplaceCartSheet` ("Start a new cart? Your cart has items from Campus Cafe":
  Replace or Keep), built on the sheet pattern `ItemDetailSheet` uses (`useFocusTrap`, 44px targets).
- `useReorder` switches to the order's store (`order.store.slug`) after the same confirmation.
- `Checkout` sends `storeId`; `CartBar` and `Cart` name the store; `STORE_PAUSED` and the new `STORE_CLOSED`
  details show the reason and keep the cart.

Tests: `cartStore.test.ts` (migration from version 1, replace, keep), `useReorder.test.tsx`, `Checkout.test.tsx`
(the request carries `storeId`; a paused store disables Pay with its reason), `storageKeys.test.ts` unchanged
(`fp_cart` keeps its scope), e2e: two stores, the replace sheet, an order at the second store.

Docs: `docs/FRONTEND_STRUCTURE.md`, `docs/COMPONENTS.md` (`ReplaceCartSheet`). Intent: `--client minor`.

### PR 13 — Client: the staff board per store (P2.2, P2.5)

- [ ] Merged

- `features/auth/roles.ts`: `homeFor(user)` → `/admin` for an admin, `/manage` for an owner or manager, `/staff`
  for staff, `/` otherwise. `RequireMembership` (a store role at the route's store) replaces `RequireRole
role="STAFF"`; `RequireRole` stays for `/admin`.
- `/staff` → the store switcher when the user has several stores, else a redirect to `/staff/:storeSlug`, which is
  today's board reading `GET /api/stores/:storeId/orders` and patching through the store route
  (`services/orders.ts`, `useOrders({ storeId })`).
- `StaffHeader` gains the pause control: presets 15, 30 and 60 minutes and "until I resume", the remaining time, and
  Resume. The tap shows its result at once and rolls back on error (CLAUDE.md §2b).

Tests: `StaffDashboard.test.tsx` (the switcher, the scoped calls, pause and resume with a failing request),
`roles.test.ts`, `App.test.tsx` (a customer on `/staff/x` goes home; a member of another store too), e2e: staff of
one store never sees the other's orders.

Docs: `docs/FRONTEND_STRUCTURE.md`, `docs/PERMISSIONS.md` (the client section), `docs/COMPONENTS.md`. Intent:
`--client minor`.

### PR 14 — Client: `/manage` with the hours editor (P2.4)

- [ ] Merged

`frontend-design:frontend-design` for the direction (a new area), then `agent-skills:frontend-ui-engineering`.

- `/manage` (lazy): picks the store (the owner sees every store of the brand; a manager, their own);
  `/manage/:storeSlug` is the shell with tabs Hours, Settings and Team (P3 adds Menu and Stock).
- `/manage/:storeSlug/hours`: the week grid (add and remove an interval, copy a day to all days), the special-day
  list with presets ("Closed for …", "Late hours"), saved through `PUT …/hours` and the exception routes; every
  mutation reloads the store, the hours and the store list.
- Phone first: the grid is a list of days at 360px, a table from `md`.

Tests: `ManageHours.test.tsx` (edit, overlap error from the server shown inline, copy to all days, loading, empty,
error), e2e: a manager closes today and the store page says so. Visual gate, axe, focus order.

Docs: `docs/FRONTEND_STRUCTURE.md` (`/manage`, `features/manage/`), `docs/COMPONENTS.md`, CLAUDE.md §4. Intent:
`--client minor`.

Split seam: the `/manage` shell and store picker as PR 14a, the editor as 14b.

### PR 15 — Client: `/manage` settings and team (P2.2, P2.3)

- [ ] Merged

- `/manage/:storeSlug/settings`: the four store settings, with `settingsRules.ts`'s pattern from the admin page
  (bounds from the API's validation errors, not copied).
- `/manage/:storeSlug/team`: members, pending invites, invite by email with a role; the new invite's link is shown
  once with a Copy button and a share action (`navigator.share` where present); revoke and remove with a confirm.
- `/join`: the link a manager shares is `/join#<token>`; the token rides in the URL fragment, which a browser
  never sends to a server, so nginx, a CDN and the `Referer` header never see it. The page reads the fragment and
  removes it from the address bar (`history.replaceState`) before doing anything else, keeping the token in memory
  only. Signed out → sign in or register, then back; signed in → accept → the staff board or `/manage`. A failure says only that the link is no longer valid.

Tests: `ManageSettings.test.tsx`, `ManageTeam.test.tsx` (a manager sees no "Manager" role option; the token is not
kept in any store or storage: `storageKeys.test.ts` stays green), `Join.test.tsx`, e2e: owner invites a manager,
the manager accepts and edits the hours.

Docs: `docs/FRONTEND_STRUCTURE.md`, `docs/COMPONENTS.md`, `README.md` (the two-store demo script). Intent:
`--client minor`.

### PR 16 — Contract: the single-store API and `STAFF` go (P2.7)

- [ ] Merged

Branch `feat/p2-16-contract`, last into `feat/P2`.

Migration `<ts>_multi_store_contract.sql`: every `profiles.role = 'STAFF'` becomes `CUSTOMER` (their membership
holds their access since PR 03); `site_settings.staff_order_list_limit` is dropped; `profiles_audit` records the
role change with actor `SYSTEM`.

Server: removed — `GET /api/store`, `GET /api/menu`, `PATCH /api/orders/:id/status`, the staff branch of
`GET /api/orders`, the "oldest store" fallback (`storeId` is required on `POST /api/orders`), `requireStaff`, the
`store` and `menu` cache keys. `Role` in `types/enums.ts` keeps `STAFF` only as a database value.

Client: `services/store.ts` and `services/menu.ts`, `useStore`, `useMenu`'s single-store form, the `STAFF` branch of
`homeFor`; `SiteSettings` loses the moved field and the admin page its input.

Tests: the old routes answer 404 (one test, so they cannot come back by accident); the suites that used them move
to the store routes; a test user is made staff with `createStoreMember`, and `createTestUser('STAFF')` is removed.

Docs: `docs/API.md` (the routes leave; a "Removed in P2" note), `docs/PERMISSIONS.md`, `docs/SCHEMA.md`,
`docs/CONFIGURATION.md`, CLAUDE.md §2 (roles: `CUSTOMER` and `ADMIN` on the profile; `MANAGER` and `STAFF` as
memberships; the brand owner), the roadmap's P2.7 checklist ticked. Intent: `--server minor --client minor`, with
the CHANGELOG note the roadmap asks for.

## CLAUDE.md edits, aggregated

| Section | Change                                                                                                                                                  | PR         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| §2      | roles: `CUSTOMER` and `ADMIN` on the profile; `MANAGER` and `STAFF` as store memberships; the brand owner; the routes `/staff/:storeSlug` and `/manage` | 03, 16     |
| §2c     | the cached public reads `stores:list`, `store:<id>`, `menu:<storeId>`, `store_hours:<id>`, `store_settings:<id>` and their invalidations                | 02, 05, 06 |
| §4      | `server/src/domain/`; `/manage` on the client                                                                                                           | 03, 14     |
| §10     | every store-scoped query goes through `scoped(req)`; a store route checks a capability with `requireStore`; 404 or 403                                  | 03, 04     |
| §13     | every store route ships with `testStoreIsolation`                                                                                                       | 04         |
| §17     | major-change path `server/src/domain/`, in step with `major-change-gate.js`                                                                             | 03         |

## ADRs this plan touches

Only the user accepts or amends an ADR, and an accepted decision is never rewritten (`docs/adr/README.md`). So a
difference from an ADR's text is either an amendment the user approves or a change to this plan.

| ADR                     | What P2 does with it                                                                                                                                                                                        | Needs                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 001 brands as templates | implements its store half: the owner on the brand, per-store memberships, store-scoped routes, the scoping helper, the lint rule, the isolation matrix, and the old endpoints removed inside the phase (D1) | **resolved**: the ADR was amended by the user on 11 November 2026 |
| 001, where it is silent | invites (D3), who manages the team (D4), what a platform admin may do at a store (D5)                                                                                                                       | nothing: plan-level decisions                                     |
| 002 outbox              | `store.paused` and `store.resumed` are emitted with no queue, since a queue arrives with its first consumer                                                                                                 | nothing                                                           |
| 004 paise               | every new amount is paise; PR 00 fixes the roadmap rows that still say rupees                                                                                                                               | nothing (the ADR is right; the roadmap was stale)                 |
| 009 rate limits         | the invite-accept limiter is built with `createRateLimiter`, sized by env                                                                                                                                   | nothing                                                           |
| 011 free tiers          | small tables, two events per pause, no new service                                                                                                                                                          | nothing                                                           |

## Decisions

Open. The plan is written for the defaults; a different answer changes the PRs named.

| #   | Decision                                                                                       | Default                                                                                                                                                                | Applies to |
| --- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| D1  | Keep the single-store API until a contract release (the roadmap), or contract inside the phase | **answered (the user, 11 November 2026):** inside the phase; no `default_store_id`, no `multi_store_ui` flag (ADR-001 as amended)                                      | 01, 16     |
| D2  | A store with no weekly hours                                                                   | follows its manual switch alone (open all day while `is_open`)                                                                                                         | 06         |
| D3  | How an invite reaches a person before notifications exist (P6.3)                               | a link the inviter shares; accepting needs an account with the invited email                                                                                           | 09, 15     |
| D4  | Who manages the team                                                                           | a manager invites and removes staff; the owner (and a platform admin) also managers                                                                                    | 03, 09     |
| D5  | What a platform admin may do at a store in P2                                                  | pause and resume, manage the team, read the audit trail; no orders (read-only support views are P7.4's)                                                                | 03         |
| D6  | Who creates brands, stores and owners before the admin console (P7.4)                          | the seed, locally and on staging; no endpoint in P2                                                                                                                    | 01         |
| D7  | Who merges PRs into `feat/P2`                                                                  | **answered (the user, 11 November 2026):** the agent merges each PR into `feat/P2` once `ci-ok` is green and CodeRabbit is clear; the user merges `feat/P2` into `dev` | all        |
| D8  | Staging data when `feat/P2`'s first migration is pushed                                        | re-seeded (`pnpm run seed` against staging): the single store becomes Campus Cafe under its own brand, plus the demo chain                                             | 01         |

## Closing P2

Once every box is ticked: on a fresh `origin/feat/P2`, the gate in both packages, `pnpm run e2e:chromium`, the WebKit
smoke, and `/break` (P2 changes auth, who may read and move orders, and the request pipeline), with fixes as normal
PRs into `feat/P2`. Then the PR `feat/P2` → `dev` ("P2 — multi-store", exempt from the size limit,
`@coderabbitai ignore`, listing its migrations in order for the staging push); the user merges it. The milestone
check (M2) on staging: two brands, one with two branches, each with its own staff, hours and pause; a member of one
branch cannot see the other; a cart cannot mix stores.

## User steps (cannot be done from the repository)

- Answer the [decisions](#decisions), or accept the defaults.
- Merge `feat/P2` into `dev` when P2 is done (D7; the agent merges the PRs into `feat/P2`), and merge `dev` into
  `feat/P2` when `dev` has moved.
- Push `feat/P2`'s migrations to staging (`pnpm run db:push:staging`), then re-seed it (D8). The seed finds Campus
  Cafe by its slug (`campus-cafe`, backfilled from the store's name): if the staging store had been renamed, the seed
  adds a second Campus Cafe, and the leftover store should be archived or deleted. PR 16's migration goes
  to staging only when every client pointed at staging is on `feat/P2` (there is no hosted staging app before P8).
- Optional, once P2 is on staging: set `min_client_version` (Admin → site settings) to P2's client version, so a
  stray older build asks for a reload instead of calling routes that are gone.
- Merge `feat/P2` into `dev` when P2 is closed.

## Risks and gotchas

- **A missed store filter leaks another store's data.** `scoped(req)`, the lint rule and `testStoreIsolation` on
  every store route are the three layers; PR 04's security scan and the closing `/break` test them from outside.
- **`place_order` is rewritten twice** (PR 08 here, and P3 after). Each body starts from the previously merged one;
  a new parameter needs drop, create and the grants again (the P1 plan's "Redefining a transition function").
- **One more read on every signed-in request.** The memberships ride in the profile read as an embedded select;
  PR 03 measures it. The fallback is a short per-user cache with its invalidation on every membership write, not
  dropping the check.
- **A pause shows late, never acts late.** The badge can lag by the cache's TTL; `place_order`'s own check is what
  refuses the order.
- **Slugs are public and permanent enough to bookmark.** They are unique across all stores, lower-case, and a
  rename keeps the old order history reachable by id. Reserved words (`manage`, `staff`, `admin`, `api`) are
  refused by the check constraint's companion list in zod.
- **The seed deletes every profile it does not own** and resets orders: correct locally and on staging, never run
  against production (CLAUDE.md §2).
- **The persisted cache prefix changes** in PR 11: every device drops its cached menu once. No migration, by design.
- **`STAFF` stays in the `user_role` enum** after PR 16. Nothing writes it; `test/api/database-lockdown.test.ts`
  gains a check that no profile holds it.
- **Free tier** ([ADR-011](../docs/adr/011-free-tiers.md)): the new tables are small; the pause and resume events
  add two rows per pause to `domain_events`, inside its 30-day retention.

## What P2 leaves for P3

- The brand template: `create_store_from_template`, `menu_items.template_item_id`, the push to chosen stores
  ([P3 PR 01 and 07](P3_CATALOG_AND_MEDIA.md#build-order)). Until then the seed writes each store's menu.
- `/manage` gains Menu and Stock; the capability map gains `menu.edit`, `stock.update` and `template.push`.
- `store_settings.staff_can_edit_stock`.
