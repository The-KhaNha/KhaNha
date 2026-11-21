# P2 — Multi-store and multi-branch: implementation plan

The PR-by-PR plan for [ROADMAP.md P2](ROADMAP.md#p2--multi-store-and-multi-branch): many restaurants, some with
several branches, each with its own staff, hours, pause switch and settings, served by one app. The roadmap says what
P2 builds and why; this file says in which order, in which pull requests, with which files, tests, docs and checks,
and where P2 deliberately builds something different from the roadmap's text (each with its reason and the phase that
picks it up). When a PR merges, tick its box here and in the roadmap.

> **Status: done** (12 November 2026): every PR below merged into `feat/P2`, and `feat/P2` merged into `dev` as #75
> (7b53c34). P3 continues in [P3_CATALOG_AND_MEDIA.md](P3_CATALOG_AND_MEDIA.md).
>
> Written as a proposal (11 November 2026) when P1 was in `dev` (#40). The roadmap's P2 section predates
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
  clear (D7; the user extended it to P3 on 12 November 2026).
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
  email text not null check (email = lower(email) and char_length(email) between 3 and 320),
                                             -- the account that may accept it
  token_hash text not null unique,           -- sha-256 of the token; the token itself is shown once
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (accepted_at is null or revoked_at is null)
);
create unique index store_invites_open_email_key
  on public.store_invites (store_id, email) where accepted_at is null and revoked_at is null;
create index store_invites_store_id_idx on public.store_invites (store_id);
create index store_invites_created_by_idx on public.store_invites (created_by);
create index store_invites_accepted_by_idx on public.store_invites (accepted_by);
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

Merged pull requests are collapsed to a summary and links; their full specifications are in this file's history.

### PR 00 — The roadmap says what ADR-001 decided

- [x] Merged (into `feat/P2`, like every P2 PR)

Docs only: the roadmap now says what ADR-001 decided, and the P1 plan's last leftovers (paise, the P0 status) are closed (#46).

Now documented in: [ADR-001](../docs/adr/001-brands-own-stores.md), [docs/PERMISSIONS.md "Store roles"](../docs/PERMISSIONS.md#store-roles).

### PR 01 — Brands and stores: expand, and the seed (P2.1)

- [x] Merged

`brands` and the new `stores` columns, backfilled (one brand per existing store), plus a seed with two brands and three stores (#47).

Now documented in: [docs/SCHEMA.md "brands"](../docs/SCHEMA.md#brands), [docs/SCHEMA.md "stores"](../docs/SCHEMA.md#stores).

### PR 02 — Public store reads (P2.1)

- [x] Merged

The three public store reads (list, one store, its menu) with their cache keys and invalidation (#48).

Now documented in: [docs/API.md "Caching"](../docs/API.md#caching), [docs/API.md "Server read cache"](../docs/API.md#server-read-cache-serversrcutilscachets).

### PR 03 — Memberships and the capability map (P2.2)

- [x] Merged

`store_memberships`, the capability map (`domain/permissions.ts`) and `requireStore(capability)`; `/auth/me` carries the user's memberships and owned brands (#49).

Now documented in: [docs/PERMISSIONS.md "Store roles"](../docs/PERMISSIONS.md#store-roles), [docs/SCHEMA.md "store_memberships"](../docs/SCHEMA.md#store_memberships).

### PR 04 — Store-scoped orders and the isolation matrix (P2.3)

- [x] Merged (the split seam taken: the lint rule and `scoped` are PR 04b)

Orders are store-scoped: the store order list and status routes, `storeId` on `POST /api/orders`, and the old staff routes limited to the caller's own stores, which closed the cross-store read. `testStoreIsolation` is the tenant matrix every store route runs (#50). The split seam was taken: the lint rule is PR 04b.

Now documented in: [docs/API.md "GET /stores/:storeId/orders"](../docs/API.md#get-storesstoreidorders), [docs/PERMISSIONS.md "Route matrix"](../docs/PERMISSIONS.md#route-matrix), [docs/TESTING.md "Helpers"](../docs/TESTING.md#helpers-servertestsetuphelpersts).

### PR 04b — `scoped` and the table-ownership lint rule (P2.3)

- [x] Merged

The table-ownership lint rule (`TABLE_OWNERS`) with its own test (#51).

Now documented in: [docs/TESTING.md "Table ownership"](../docs/TESTING.md#table-ownership).

### PR 05 — Store settings (P2.3)

- [x] Merged

Per-store settings (`max_quantity_per_item`, `low_stock_threshold`, `staff_order_list_limit`, `last_order_minutes_before_close`) as columns on `stores`, with `GET`/`PATCH /api/stores/:storeId/settings` and the store's cap enforced in `createOrder` (#52).

Now documented in: [docs/CONFIGURATION.md "Store settings"](../docs/CONFIGURATION.md#store-settings), [docs/API.md "PATCH /stores/:storeId/settings"](../docs/API.md#patch-storesstoreidsettings), [docs/SCHEMA.md "stores"](../docs/SCHEMA.md#stores).

### PR 05c — Client: the store's limits (P2.3)

- [x] Merged

The cart takes its limits from the store's menu `rules`, with `storeDefaults` as the fallback (#54).

Now documented in: [docs/CONFIGURATION.md "Store settings"](../docs/CONFIGURATION.md#store-settings), [docs/COMPONENTS.md "features/cart"](../docs/COMPONENTS.md#featurescart).

### PR 06 — Opening hours: the rule and the reads (P2.4)

- [x] Merged

Opening hours tables and the pure `openState` rule; the store reads carry `openState`, `nextChangeAt` and `openLabel`, `GET /api/stores/:storeRef/hours` is public, and `createOrder` refuses a closed store with the next opening (#55, #56).

Now documented in: [docs/SCHEMA.md "store_hours"](../docs/SCHEMA.md#store_hours), [docs/ARCHITECTURE.md "The open state"](../docs/ARCHITECTURE.md#44-the-open-state), [docs/API.md "Caching"](../docs/API.md#caching).

### PR 07 — Opening hours: editing (P2.4)

- [x] Merged

Editing hours: `set_store_hours` replaces the week in one transaction, plus the exception routes, with every write invalidating the store's keys (#60).

Now documented in: [docs/API.md "PUT /stores/:storeId/hours"](../docs/API.md#put-storesstoreidhours), [docs/SCHEMA.md "store_hours"](../docs/SCHEMA.md#store_hours), [docs/CONFIGURATION.md "Platform constants"](../docs/CONFIGURATION.md#platform-constants).

### PR 08 — Pause and resume (P2.5)

- [x] Merged

Pause and resume: `pause_store` and `resume_store`, the store routes, `STORE_PAUSED`, the `PAUSED` open state, and `place_order` refusing a paused or non-`ACTIVE` store and another store's item (#62).

Now documented in: [docs/API.md "POST /stores/:storeId/pause"](../docs/API.md#post-storesstoreidpause), [docs/SCHEMA.md "stores"](../docs/SCHEMA.md#stores), [docs/SCHEMA.md "place_order"](../docs/SCHEMA.md#place_order), [docs/JOBS.md "Store events"](../docs/JOBS.md#store-events).

### PR 09 — Team: members and invites (P2.2)

- [x] Merged

Team: `store_invites`, the member and invite routes, and `accept_store_invite` with its own limiter and token handling, shipped as 09a (#57) and 09b (#59).

Now documented in: [docs/PERMISSIONS.md "Team invites and removals"](../docs/PERMISSIONS.md#team-invites-and-removals), [docs/API.md "POST /stores/:storeId/invites"](../docs/API.md#post-storesstoreidinvites), [docs/SCHEMA.md "accept_store_invite"](../docs/SCHEMA.md#accept_store_invite), [docs/LOGGING.md "Never logged"](../docs/LOGGING.md#never-logged).

### PR 10 — The store's audit trail (P1.3, deferred)

- [x] Merged

`GET /api/stores/:storeId/audit`: the store's own audit trail, with the store filter forced from the route (#53).

Now documented in: [docs/API.md "GET /stores/:storeId/audit"](../docs/API.md#get-storesstoreidaudit), [docs/PERMISSIONS.md "Route matrix"](../docs/PERMISSIONS.md#route-matrix).

### PR 11 — Client: the store list and store pages (P2.6)

- [x] Merged

The client's store list (`/`, grouped by area) and store pages (`/s/:storeSlug`, `/s/:storeSlug/menu`), with `StoreCard` and `OpenPill` carrying the open state (#58).

Now documented in: [docs/FRONTEND_STRUCTURE.md "Routes"](../docs/FRONTEND_STRUCTURE.md#routes), [docs/COMPONENTS.md "features/stores"](../docs/COMPONENTS.md#featuresstores).

### PR 12 — Client: one cart per store (P2.6)

- [x] Merged

One cart per store: `cartStore` v2 with its migration, `ReplaceCartSheet`, store-aware reorder and checkout (#61).

Now documented in: [docs/COMPONENTS.md "features/cart"](../docs/COMPONENTS.md#featurescart), [docs/FRONTEND_STRUCTURE.md "Stores"](../docs/FRONTEND_STRUCTURE.md#stores).

### PR 13 — Client: the staff board per store (P2.2, P2.5)

- [x] Merged

The staff board per store: `RequireMembership`, the store switcher, `/staff/:storeSlug` on the store routes, and the pause control (#68).

Now documented in: [docs/FRONTEND_STRUCTURE.md "Routes"](../docs/FRONTEND_STRUCTURE.md#routes), [docs/PERMISSIONS.md "Client"](../docs/PERMISSIONS.md#client), [docs/ARCHITECTURE.md "Staff dashboard and order status changes"](../docs/ARCHITECTURE.md#8-staff-dashboard-and-order-status-changes).

### PR 14 — Client: `/manage` with the hours editor (P2.4)

- [x] Merged

`/manage` (the store picker and shell) and its opening-hours editor (#63, #70).

Now documented in: [docs/FRONTEND_STRUCTURE.md "Routes"](../docs/FRONTEND_STRUCTURE.md#routes), [docs/COMPONENTS.md "features/manage"](../docs/COMPONENTS.md#featuresmanage).

### PR 15 — Client: `/manage` settings and team (P2.2, P2.3)

- [x] Merged

`/manage` settings and team tabs, and `/join`, where an invited person accepts a store invite (#65, #72).

Now documented in: [docs/FRONTEND_STRUCTURE.md "Routes"](../docs/FRONTEND_STRUCTURE.md#routes), [docs/COMPONENTS.md "features/manage"](../docs/COMPONENTS.md#featuresmanage), [docs/PERMISSIONS.md "Team invites and removals"](../docs/PERMISSIONS.md#team-invites-and-removals).

### PR 16 — Contract: the single-store API and `STAFF` go (P2.7)

- [x] Merged

The contract: the single-store routes (`GET /api/store`, `GET /api/menu`, `PATCH /api/orders/:id/status`, the staff branch of `GET /api/orders`), `requireStaff`, the "oldest store" fallback and the `STAFF` profile role are gone; access is by membership only. Shipped as 16a (#69, #71), 16b (#73) and 16c (#74).

Now documented in: [docs/API.md "Routes"](../docs/API.md#routes), [docs/PERMISSIONS.md "Roles"](../docs/PERMISSIONS.md#roles), [docs/SCHEMA.md "Migrations"](../docs/SCHEMA.md#migrations).

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
