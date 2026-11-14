# P3 — Catalog, menu management and media: implementation plan

The PR-by-PR plan for [ROADMAP.md P3](ROADMAP.md#p3--catalog-menu-management-and-media): restaurants run their own
menus (items, photos, customisations and stock) from the dashboard, and a brand keeps a template that new branches
are copied from. The roadmap says what P3 builds and why; this file says in which order, in which pull requests, with
which files, tests, docs and checks, and where P3 deliberately builds something different from the roadmap's text
(each with its reason and the phase that picks it up). When a PR merges, tick its box here and in the roadmap.

> **Status: in progress** (12 November 2026): P2 is in `dev` (#75), `feat/P3` was cut from it, and the user answered
> every [decision](#decisions) (D6 differs from the default: owners open branches, PRs 01b and 07b).
>
> Written as a proposal (11 November 2026). The roadmap's P3.1
> ("a brand catalog with per-store listings and price overrides") was rejected in
> [ADR-001](../docs/adr/001-brands-own-stores.md) as amended: a store is a **copy** of its brand's template and then
> changes freely. This plan follows the ADR; [P2's PR 00](P2_MULTI_STORE.md#pr-00--the-roadmap-says-what-adr-001-decided)
> rewrites the roadmap's P3.1 from [the model below](#the-model-p3-builds).

## How the team works P3

The P2 rules stand ([P2 plan](P2_MULTI_STORE.md#how-the-team-works-p2), CLAUDE.md §13–§21), with `feat/P3` as the
phase branch (cut from `dev` once `feat/P2` is merged, and covered by the `ci-ok required` ruleset's `feat/P[0-9]` pattern),
work branches `feat/p3-<NN>-<slug>`, PR titles `P3 PR <NN> — <title>`. Changes from P2 (the user, 12 November 2026):
the size limit is **50 changed files or 1000 changed lines** (`.claude/rules/workflow.md` "PR size"); the agent merges
each PR into `feat/P3` once `ci-ok` is green and CodeRabbit is clear, and the user merges `feat/P3` into `dev`; PRs run
in parallel worktrees as late P2 did, with at most one schema-changing PR in flight. Two additions:

- **Every menu write invalidates `menu:<storeId>`** and ships the cache test that fails without it (CLAUDE.md §2c).
- **Every store route ships `testStoreIsolation`** (P2 PR 04); every upload path ships its refusal cases.

## Where P3 starts

What the code has when P2 is done (P1 and P2 as planned), and what P3 adds.

| Roadmap step     | Already in the code                                                                                                                                                                                                                                                                            | Left for P3                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| P3.1 catalog     | `menu_items` is one table per store: `store_id`, `category` (text), `name`, `description`, `price_paise`, `image_url` (not null), `is_available`, `is_popular`, `sort_order`, `stock_quantity` (null = untracked). Categories appear in first-`sort_order` order. Brands and stores exist (P2) | the brand template, the copy, the lineage, the push |
| P3.2 modifiers   | a cart line is keyed by `menuItemId` (`cartStore`, `mergeDuplicateItems`); `place_order` prices each line from `menu_items.price_paise` and checks the client's `unit_price_paise` (`PRICE_CHANGED`); `order_items` snapshots name, price, photo and category                                  | all of it                                           |
| P3.3 images      | 12 bundled photos with 400px thumbnails in `client/public/images/` (976 KB), made by `optimize-images.py`; `photoSrcSet()` only understands `/images/<name>.jpg`; the API returns `image_url` as stored; no `sharp`, no AWS SDK; the worker runs one queue (`q_notifications`)                 | all of it                                           |
| P3.3 hosts       | the web image's CSP is **Report-Only**: `img-src 'self' data:`, `connect-src 'self' ${SUPABASE_URL}`, no `form-action`; nginx caps request bodies at 100 KB; Vite proxies only `/api`; `compose.yaml` has a commented `minio` placeholder                                                      | the media host, `/media` routing                    |
| P3.4 admin       | **no endpoint edits a menu item**, and none changes stock: the only stock writes are inside `place_order` and the cancel path. `menu_items_audit` watches `name`, `price_paise`, `is_available`, `image_url`, `category`. `/manage` exists with Hours, Settings and Team (P2)                  | the menu and stock API, and their screens           |
| P3.5 staff stock | the staff board per store (P2 PR 13); its filters are toggle buttons, not tabs                                                                                                                                                                                                                 | the Stock view                                      |
| P3.6 deals       | nothing; the trigger the roadmap gives it (an order that expires uncollected) does not exist before P5.9                                                                                                                                                                                       | deferred ([below](#deferred-p36-surplus-and-deals)) |
| Flags            | `feature_flags` with store rules; flags are created by migration rows                                                                                                                                                                                                                          | the `modifiers` row                                 |
| Budgets          | `client/perf-budget.json`: 170 KB initial JS (gzip), LCP 3000 ms, INP 300 ms, CLS 0.15                                                                                                                                                                                                         | `/manage` stays out of the initial bundle           |

## Build order

| #   | PR                                                  | Step       | Depends on | Size (files / lines) |
| --- | --------------------------------------------------- | ---------- | ---------- | -------------------- |
| 01  | The brand template and its lineage                  | P3.1       | –          | 12 / 560             |
| 01b | Owner opens a branch: create, profile, publish      | P3.1       | 01         | 16 / 700             |
| 02  | Menu editing API                                    | P3.4       | 01         | 16 / 640             |
| 03  | Quick edits: availability, bulk, order              | P3.4       | 02         | 10 / 380             |
| 04  | Stock: one function, its trail, the staff setting   | P3.4, P3.5 | 02         | 14 / 560             |
| 05  | Client: the menu screen and the item editor         | P3.4       | 02, 03     | 20 / 720             |
| 06  | Client: stock in `/manage` and on the staff board   | P3.4, P3.5 | 04, 05     | 14 / 520             |
| 07  | Template push                                       | P3.1       | 05         | 14 / 560             |
| 07b | Client: open a branch, its profile, publish         | P3.1       | 01b, 05    | 14 / 600             |
| 08  | Media: the port, local storage, the uploads API     | P3.3       | 02         | 16 / 620             |
| 09  | Media: S3 and MinIO                                 | P3.3       | 08         | 14 / 480             |
| 10  | Media: the image pipeline in the worker             | P3.3       | 09         | 14 / 600             |
| 11  | Client: photo upload, and `FoodPhoto` with variants | P3.3       | 10         | 12 / 480             |
| 12  | The bundled photos move to media                    | P3.3       | 11         | 8 / 300              |
| 13  | Modifiers: schema, pricing, orders                  | P3.2       | 02         | 18 / 740             |
| 14  | Modifiers: editing API                              | P3.2       | 13         | 12 / 480             |
| 15  | Client: the modifier picker and the cart            | P3.2       | 13         | 18 / 700             |
| 16  | Client: modifiers on orders, and their editor       | P3.2       | 14, 15     | 16 / 600             |

Why this order: the template first, because it decides that the menu tables stay per store, which every later PR
relies on. Menu editing (02–06) next: it is the value restaurants see first and needs nothing external. The push
(07) waits for the editor it lives in. Media (08–12) is one chain, local storage first so the API and the editor
work before any bucket exists. Modifiers (13–16) last: they rewrite `place_order` and the cart, the two riskiest
places, on top of a menu API that is already settled. Three tracks (02–07, 08–12, 13–16) are independent after
PR 02, so the order between tracks can change if one is blocked.

## Cross-cutting decisions

- **A store's menu is its own** (ADR-001). There is no catalog/listing split, no price override and no "flattening"
  serializer: `menu_items` stays the full row it is today, and `MenuItemDto` keeps its shape.
- **The template is a store that is never public** (D1): a brand points at one `stores` row with
  `is_template = true`, which a check constraint keeps out of `ACTIVE`. Its menu, modifiers and settings live in the
  same tables as any store's, so there is no second set of tables, and the owner edits the template with the same
  `/manage` screens. Public reads already show only `ACTIVE` stores, and `place_order` already refuses any other.
- **Copy, lineage, push.** `create_store_from_template` copies the template's rows into a new store; each copied
  item keeps `template_item_id`. A later template edit reaches an existing store only through an explicit, audited
  push that overwrites the chosen fields.
- **Menu rows are written through the API's own routes, by store.** Simple edits are single-table writes carrying
  the `x-actor` and `x-request-id` headers (CLAUDE.md §10); anything multi-step (reorder, stock, copy, push, an item
  with its modifier groups) is one SQL function that sets `app.actor`.
- **Prices stay server-decided, in SQL.** `place_order` prices a line from the item and its chosen options itself
  and enforces every modifier rule; the API's pure `domain/pricing.ts` runs the same rules first, only to answer
  with a friendly, item-naming error. One table of cases runs through both, so they cannot drift.
- **Media sits behind a port** ([ADR-006](../docs/adr/006-media-s3-cloudfront.md)): `MEDIA_STORAGE=s3|local`. The
  upload response names the method, URL and any form fields or headers, and the client does what it says: with
  `s3` it is a `POST` of a multipart form to the bucket (presigned), with `local` a `PUT` of the raw bytes to an API
  route. The API gets no multipart parser. Photos are served at `/media/*` on the app's own origin in every environment.
- **An upload is not attached to anything until the editor saves.** The upload is processed on its own; the item
  write then names the processed upload. An abandoned upload is swept; a half-saved item never points at a missing
  photo.
- **`menu.changed` is emitted, with no subscriber yet.** Every menu, stock and modifier function calls `emit_event`
  in its transaction (CLAUDE.md §10). No queue is subscribed until a consumer exists (P7.7).
- **Free tier** ([ADR-011](../docs/adr/011-free-tiers.md)). Photos never enter the database. `stock_movements`
  holds manual changes only: a sale is already recorded by `order_items.reserved_quantity`.
- **Budgets.** `/manage` and everything under it is a lazy route. The customer bundle gains the modifier picker
  inside the already-lazy item sheet; the bundle check and `perf-auditor` gate PRs 05, 11 and 15.

## The model P3 builds

```sql
-- The template is a store row that can never be public (ADR-001).
alter table public.stores
  add column is_template boolean not null default false,
  add constraint stores_template_is_draft check (not is_template or status = 'DRAFT');
alter table public.brands
  add column template_store_id uuid references public.stores (id);

alter table public.menu_items
  add column template_item_id uuid references public.menu_items (id) on delete set null,   -- lineage
  add column diet public.diet_marker,                                 -- 'VEG' | 'NON_VEG' | 'EGG'
  add column archived_at timestamptz,
  add column image_variants jsonb,                                    -- { "400": url, "900": url }
  alter column image_url drop not null;                               -- a new item may have no photo yet
create index menu_items_template_item_id_idx on public.menu_items (template_item_id);
```

Modifier tables are the roadmap's, **scoped to a store** instead of a brand (`modifier_groups.store_id`), with the
link table named `menu_item_modifier_groups (menu_item_id, group_id, sort_order)`, money in paise
(`price_delta_paise`, whole rupees, like every money column since ADR-004), and `order_item_modifiers` as the
snapshot. `stock_movements` and `media_uploads` are given with their PRs.

**Capabilities P3 adds** to `domain/permissions.ts`:

| Capability                             | STAFF                       | MANAGER | OWNER | Platform ADMIN |
| -------------------------------------- | --------------------------- | ------- | ----- | -------------- |
| `menu.edit` (items, photos, modifiers) | ✗                           | ✓       | ✓     | ✗              |
| `stock.update`                         | when `staff_can_edit_stock` | ✓       | ✓     | ✗              |
| `template.push`                        | ✗                           | ✗       | ✓     | ✗              |
| `store.profile` (name, address, phone) | ✗                           | ✓       | ✓     | ✗              |
| `store.publish` (publish, unpublish)   | ✗                           | ✗       | ✓     | ✗              |

Opening a branch is a brand-level right, not a store capability: only the brand's owner (`ownedBrandIds`) may, and
anyone else gets 404 on the brand (D6).

A template store has no members: only its brand's owner reaches it, and an invite to it is refused.

## Where P3 differs from the roadmap

Approved with the plan. The roadmap's P3 section is updated in the PR named in the last column's row, or in P2's
PR 00 for P3.1.

| Roadmap says                                                                                                                 | P3 does                                                                                                                                                                                                    | Picked up by                                          |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| P3.1 `catalog_items` per brand, `menu_items` as a listing with `price_override`; a contract migration drops the item columns | not built (ADR-001): the brand template, copied into each store, with `template_item_id` and a push                                                                                                        | –                                                     |
| P3.1 `menu_categories` table, `PUT …/categories/order`                                                                       | `category` stays text on the item; one `reorder_menu` function sets the order of items, and a category's place is its first item's, as today                                                               | when a category needs data of its own                 |
| P3.1 `base_price` in whole rupees                                                                                            | paise (ADR-004 as amended), everywhere                                                                                                                                                                     | –                                                     |
| P3.1 `prep_offset_minutes`, `requires_acceptance` on the item, and their editor fields                                       | not added: nothing reads them                                                                                                                                                                              | P6.1, P5.5                                            |
| P3.2 modifier groups per brand; endpoints under `/api/brands/:brandId/…`                                                     | per store, under `/api/stores/:storeId/…`; the template's groups are copied with its items                                                                                                                 | –                                                     |
| P3.2 pricing in `domain/pricing.ts`, used by the checkout quote and by checkout                                              | the rules are enforced in `place_order`; `domain/pricing.ts` mirrors them for the API's error messages, with a shared case table                                                                           | P5.3 reuses both in `create_checkout`                 |
| P3.3 keys `brands/<brandId>/items/<catalogItemId>/<hash>-<width>.webp`                                                       | `stores/<storeId>/<hash>-<width>.webp`: a photo belongs to the store that uploaded it, and a copied or pushed item shares the same URL                                                                     | –                                                     |
| P3.3 input types JPEG, PNG, WebP **and HEIC**; the worker reads the original                                                 | JPEG, PNG and WebP. The editor already redraws every photo on a canvas at 2000px and sends a JPEG, which covers an iPhone's HEIC wherever the browser can show it; the prebuilt `sharp` cannot decode HEIC | a measured need                                       |
| P3.3 the worker sets the item's photo when processing ends                                                                   | the worker marks the upload processed with its variants; the item write names the upload                                                                                                                   | –                                                     |
| P3.3 endpoints under `/api/brands/:brandId/media/…`                                                                          | `/api/stores/:storeId/media/…`                                                                                                                                                                             | –                                                     |
| P3.4 `stock_movements` rows for every stock change, sales included                                                           | manual changes only (`MANUAL_SET`, `MANUAL_ADJUST`, `WASTE`); sales and cancels are in `order_items.reserved_quantity`                                                                                     | P7.1, if its reports need one table                   |
| P3.4, P3.5 stock changes in the audit log **and** in `stock_movements`                                                       | `stock_movements` is the trail (who, when, how much, why); no second row in `audit_log`                                                                                                                    | –                                                     |
| P3.4 routes `/deals`, `/analytics`, `/payouts`, `/reviews`, `/policy` under `/manage`                                        | Menu and Stock only                                                                                                                                                                                        | P5.8, P5.6, P7.3, P7.5, and P3.6 when built           |
| P7.4 the admin console creates stores                                                                                        | the brand's owner opens a branch (a copy of the template, `DRAFT`) and publishes it after a checklist (D6); brands are still created by the seed                                                           | P7.4 creates brands and owners                        |
| P3.4 drag to reorder                                                                                                         | up and down buttons (accessible, and no drag library in the bundle)                                                                                                                                        | a measured need                                       |
| P3.5 "Mark sold out" on an order line                                                                                        | not built: it lives in the order detail of staff dashboard v2                                                                                                                                              | P6.4                                                  |
| P3.6 surplus lots and deals                                                                                                  | deferred whole (D4)                                                                                                                                                                                        | after P5.9 ([below](#deferred-p36-surplus-and-deals)) |
| A5 `stock.low`, `media.processed` events                                                                                     | not emitted: no consumer                                                                                                                                                                                   | P6.3 (staff notifications)                            |
| P1.5 `order_items.base_unit_price` (deferred from P1)                                                                        | built in PR 13, as `base_unit_price_paise`                                                                                                                                                                 | –                                                     |
| P1.5 `menu_items.archived_at` (deferred from P1)                                                                             | the column in PR 01 (the template copy filters on it); the first delete path in PR 02                                                                                                                      | –                                                     |
| Step 2 of P1.8: a pnpm workspace "with the first shared package (P2 types, P3 media)"                                        | no shared package: media code is server-only, and the DTO copies keep their parity tests                                                                                                                   | the first real shared package                         |

## The pull requests

### PR 01 — The brand template and its lineage (P3.1)

- [x] Merged (#77, f313ff5)

`/before-write`: schema-guard, expected EXTEND (`stores`, `brands`, `menu_items`), no new table.

Migration `<ts>_brand_template.sql`:

- the `stores`, `brands` and `menu_items.template_item_id` changes [above](#the-model-p3-builds), and
  `menu_items.archived_at`, because the copy below filters on it (nothing sets it until PR 02);
- backfill, per brand: a template store (`<brand slug>-template`, `DRAFT`, `is_template`) whose menu and
  settings columns are copied from the brand's oldest store; that store's items get `template_item_id`, and the
  brand's other existing stores get no lineage (as built: a name match could link an item that was never copied, and the push in PR 07 would then overwrite it; staging's existing second Brew Lane branch is therefore not linked, and new branches are)
- `create_store_from_template(p_brand_id, p_name, p_slug, p_area, p_address_line, p_actor, p_request_id) returns
uuid`: inserts the store (`DRAFT`), copies the template's settings columns (P2 keeps them on `stores`), and copies the
  template's unarchived items with `template_item_id` set; emits `store.created`. Hours are not copied (a new
  branch sets its own). Granted to `service_role` only.

Server: public reads and `requireStore` treat a template as a `DRAFT` store (owner only); the team routes refuse a
template store (404). `server/scripts/seed.ts` builds the chain's second branch with the function instead of writing
its menu by hand, so the function runs on every seed.

Tests: `test/api/brand-template.test.ts` (the copy equals the template row for row; lineage is set; an archived
template item is not copied; a second store with the same slug is refused and leaves nothing behind; the template
never appears in `GET /api/stores` and its menu route is 404; an order naming the template store is refused;
activating a template is refused by the constraint; only the owner passes `requireStore` on it).

Docs: `docs/SCHEMA.md`, `docs/ARCHITECTURE.md` (template, copy, lineage), `docs/PERMISSIONS.md`. The ADR needs no
change here: the user amended [ADR-001](../docs/adr/001-brands-own-stores.md) on 11 November 2026 to store the
template as a never-public store row (D1). Intent: `--server minor`.

### PR 01b — Owner opens a branch: create, profile, publish (P3.1, D6)

- [x] Merged (#79, 6ed58df)

`/before-write`: reuse-scout, expected EXTEND (`store.service.ts`, `requireStore`, `toStoreDto`); schema-guard,
expected REUSE (`stores`, `store_hours`, `menu_items`), one new function. Skill: `/new-endpoint`. The main agent
implements it (permissions and who may make a store public).

Migration `<ts>_store_publish.sql`: `set_store_status(p_store_id, p_status, p_actor, p_request_id) returns text[]`
moves `DRAFT` → `ACTIVE` (publish) or `ACTIVE` → `DRAFT` (unpublish) under a row lock, sets `app.actor` and
`app.request_id`, and emits `store.changed`. Publish checks, in the same transaction, that the store is not a
template, has an `address_line`, at least one `store_hours` row and at least one available, unarchived item; it
returns what is missing (`{address, hours, menu}`) and changes nothing when any is. `SUSPENDED` and `ARCHIVED` stay
operator states (no route). A repeat is a no-op with no event. Granted to `service_role` only.

Server:

| Method + path                         | Guard                           | Does                                                                                                                                                   |
| ------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/brands/mine`                | `requireAuth`                   | the brands the caller owns, each with its stores (all statuses) and its template; `[]` for anyone else                                                 |
| `POST /api/brands/:brandId/stores`    | owner of the brand, else 404    | `create_store_from_template` (PR 01): `name`, `slug?` (from the name), `area?`, `addressLine?`; the store is `DRAFT`; a taken slug is 409 `SLUG_TAKEN` |
| `PATCH /api/stores/:storeId/profile`  | `requireStore('store.profile')` | `name`, `tagline`, `description`, `area`, `addressLine`, `contactPhone`; never `slug` or `status`                                                      |
| `POST /api/stores/:storeId/publish`   | `requireStore('store.publish')` | publish; 409 `STORE_NOT_READY` with `details.missing`                                                                                                  |
| `POST /api/stores/:storeId/unpublish` | `requireStore('store.publish')` | back to `DRAFT`: it leaves the store list and refuses new orders; orders already placed are still served on the staff board                            |

Writes use `writeLimiter`, and invalidate `stores:list` and `store:<id>`. Bounds go in `schemas/limits.ts` with their
check constraints and the parity test (name 2–60, slug `^[a-z0-9-]{3,48}$`, address ≤ 200, phone as P2's). The
client `StoreDto` copy and `docs/API.md` error codes are updated in the same change.

Tests: `test/api/store-lifecycle.test.ts`: create as the owner, as a manager of the brand's store, as another
brand's owner and as an admin (only the first succeeds; the rest 404); the copy is the template's menu; a taken slug
leaves nothing behind; each missing checklist item blocks publish alone; publish then shows the store in
`GET /api/stores` (seen failing without the invalidation); unpublish hides it, refuses a new order, and an order
placed before it can still move PLACED → COLLECTED; a template cannot be published; profile edits by staff are 403
and by another store's manager 404 (`testStoreIsolation`); every change leaves one `store.changed` event and a repeat
leaves none.

Docs: `docs/API.md`, `docs/PERMISSIONS.md`, `docs/SCHEMA.md` (the function), `docs/ARCHITECTURE.md` (a store's life:
draft, published, unpublished). Intent: `--server minor --client patch`.

As built: `store.changed` comes from a row trigger on `stores` (`stores_changed`), not from `set_store_status` itself,
so a profile edit, a publish, an unpublish and an operator's status change in SQL each emit one, and a write of the
same values none; its payload names the changed fields and the status, never their values. The store name's bound is
2–80, not 60, because a template takes its brand's name (`brands.name` allows 80). Tagline (≤ 120), description
(≤ 300) and area (≤ 60) are bounded in zod only. A suspended or archived store answers 409
`INVALID_STATUS_TRANSITION`.

### PR 02 — Menu editing API (P3.4)

- [x] Merged (#78, bb61db4)

`/before-write`: reuse-scout, expected EXTEND (`menu.service.ts`, `toMenuItemDto`); schema-guard, EXTEND
(`menu_items`). Skills: `/new-endpoint`, `agent-skills:api-and-interface-design`.

Migration `<ts>_menu_item_lifecycle.sql`: `diet`, `image_variants`, `image_url` nullable (on `menu_items` and on the
`order_items` snapshot); `archived_at` already exists (PR 01). `menu_items_audit` also fires on insert and on `archived_at`,
`description` and `diet`; `place_order` (from its latest body) refuses an archived item as `ITEM_UNAVAILABLE`.

Server, all under `requireStore('menu.edit')`, never cached:

| Method + path                                    | Does                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/stores/:storeId/menu-items`            | every item of the store, archived ones included, with stock                                                               |
| `POST /api/stores/:storeId/menu-items`           | create (`name`, `description`, `price`, `category`, `diet?`, `isPopular?`, `stockQuantity?`); placed last in its category |
| `PATCH /api/stores/:storeId/menu-items/:itemId`  | edit any of those except `stockQuantity`, and `isAvailable`                                                               |
| `DELETE /api/stores/:storeId/menu-items/:itemId` | archive (the row stays: order history and lineage point at it); a repeat is 204                                           |

As built: `place_order` is unchanged. A check constraint (`archived_at is null or not is_available`) keeps an archived
item switched off, and `place_order` already refuses an unavailable item. `menu.changed` comes from statement triggers
on `menu_items` (one event per store per statement; stock moves emit none), so direct table writes emit it in their own
transaction. The editor's list is `ManagedMenuItemDto` (`isEnabled`, `archivedAt`). PATCH takes no `stockQuantity`: PR 04's
stock function owns stock edits; create still sets the starting stock. The seed still matches its items by
name, which stays safe because it wipes orders and deletes duplicates.

`price` is whole rupees at the API and paise in the row (`utils/money.ts`). Bounds live in `schemas/limits.ts`
(name 2–80, description ≤ 300, category 1–40, price 1–100000) with their check constraints and the parity test. The
public menu skips archived items; `MenuItemDto` gains `diet`. Every write invalidates `menu:<storeId>` and emits
`menu.changed`. A second item with the same name in a store is allowed.

Tests: `test/api/menu-items.test.ts` (the edge-case matrix on four routes; auth and isolation matrices; an item of
another store is 404; an archived item leaves the public menu, stays in an old order, and cannot be ordered; a
price edit changes the public menu after the invalidation, seen failing without it; every write leaves its audit row
and one `menu.changed` event); `limits-parity` gains the new bounds.

Docs: `docs/API.md`, `docs/SCHEMA.md`, `docs/PERMISSIONS.md`, `docs/CONFIGURATION.md` (bounds). Intent:
`--server minor --client patch`.

### PR 03 — Quick edits: availability, bulk, order (P3.4)

- [x] Merged (#80, c655244)

Migration `<ts>_reorder_menu.sql`: `reorder_menu(p_store_id, p_item_ids uuid[], p_actor, p_request_id)` sets
`sort_order` to each id's position, refuses a list that is not exactly the store's unarchived items
(`VALIDATION_ERROR`), and emits one `menu.changed`.

Server: `POST /api/stores/:storeId/menu-items/bulk { itemIds | category, isAvailable }` ("sold out: all juices"),
capped at the menu's size; `PUT /api/stores/:storeId/menu-items/order { itemIds }`. Both `menu.edit`.

Tests: `test/api/menu-quick-edits.test.ts` (matrices; a list with another store's item is refused whole; two
concurrent reorders leave one complete order, never a mix; bulk by category touches only that store).

Docs: `docs/API.md`, `docs/SCHEMA.md`. Intent: `--server minor`.

As built: both quick edits are SQL functions (`reorder_menu`, `set_menu_availability`) that take the store's menu
lock (`lock_store_menu`, a transaction advisory lock: they queue and never deadlock; `place_order` takes no such lock,
but its stock update waits on an item row a quick edit holds until it commits) and
leave the event to the PR 02 statement trigger (none when nothing changed). An id that is not the store's item is
`NOT_FOUND` (404, as for any other store's resource); a stale reorder list is `VALIDATION_ERROR`. Bulk answers
`{ updated }`; a list with another store's or an archived item, or a category with no live item, is 404 and changes
nothing. `MANAGED_ITEMS_MAX` moved to `schemas/limits.ts`. Not handled: an item created while a reorder runs may tie
on `sort_order` (ties fall back to id).

### PR 04 — Stock: one function, its trail, the staff setting (P3.4, P3.5)

- [x] Merged (#82, 1ec75d2)

`/before-write`: schema-guard, NEW TABLE (`stock_movements`), EXTEND (`stores`, whose columns hold the settings since P2).

Migration `<ts>_adjust_stock.sql`:

- `stock_reason` enum (`MANUAL_SET`, `MANUAL_ADJUST`, `WASTE`) and `stock_movements` as in the roadmap, minus
  `order_id`; index `(menu_item_id, created_at desc)`;
- `stores.staff_can_edit_stock boolean not null default true` (roadmap decision 16);
- `adjust_stock(p_store_id, p_menu_item_id, p_set integer, p_delta integer, p_untracked boolean, p_reason, p_actor,
p_request_id) returns integer`: exactly one of set, delta or untracked; one conditional update that can never go
  below zero (`INSUFFICIENT_STOCK` otherwise); writes the movement with the resulting quantity; emits
  `menu.changed`.

Server: `PATCH /api/stores/:storeId/menu-items/:itemId/stock { set | adjust | untracked, reason? }` and
`GET /api/stores/:storeId/stock-movements?itemId=` (the newest 50), both `stock.update`. `can()` takes the store's
settings for the one conditional cell (`STAFF` with `staff_can_edit_stock`). The settings route and DTO gain the
field.

Tests: `test/api/stock.test.ts` (matrices, including staff with the setting on and off; **the race**: ten
`adjust: -1` calls and five orders under `Promise.all` on stock 8 never go below zero, and the movements plus the
orders' reserved quantities account for every unit; "set to N" while orders are placed; untracked and back).

Docs: `docs/API.md`, `docs/SCHEMA.md`, `docs/PERMISSIONS.md`, `docs/CONFIGURATION.md` (the setting). Intent:
`--server minor`.

As built: `stock_movements.delta` is nullable (null when tracking starts or stops: one side has no number), and the
function locks the item's row before its update. A change that leaves the stock as it was writes no movement and
emits nothing. An archived item is 404; an adjustment of an untracked item is `VALIDATION_ERROR` on `adjust`; below
zero is `INSUFFICIENT_STOCK` with its own staff-facing message (`stockBelowZero`). `can(access, capability, rules)`
denies STAFF `stock.update` unless `rules.staffCanEditStock` is true. A new branch starts with the setting on: the
copy functions do not carry it (redefining both for one flag was not worth it). The client settings form keeps to the
numeric settings; the staff-stock switch belongs to PR 06, which also needs a way for staff to learn the setting (the
settings route is `settings.edit`): add it to their membership in `/auth/me` there.

### PR 05 — Client: the menu screen and the item editor (P3.4)

- [x] Merged (#81, 94bd8d2)

`frontend-design:frontend-design` for the direction, then `agent-skills:frontend-ui-engineering`. `/before-write`:
reuse-scout (`ItemDetailSheet`'s sheet pattern, `Input`, `QuantityStepper`, `StockPill`, `Skeleton`, `EmptyState`,
`ErrorState`).

- `/manage/:storeSlug/menu` (lazy): search, category filter, an availability switch per item, up and down buttons
  to reorder, "Sold out: this category".
- `ItemEditor`: a sheet on phones and a side panel from `md`, with name, description, price, category (pick or
  type a new one), diet, popular, and the current photo (upload arrives in PR 11). Field errors come from the
  API's validation details.
- `services/manageMenu.ts`, `features/manage/useManageMenu.ts`. A switch flips at once and rolls back on error;
  every mutation reloads the manage list and the public `menu:<storeId>` resource (CLAUDE.md §8).
- The owner's store picker lists the brand template first, labelled "Brand template".

Tests: `ManageMenu.test.tsx` (loading, empty, error with retry; an optimistic switch that fails; reorder at the
edges), `ItemEditor.test.tsx` (server field errors, focus trap, 44px targets), e2e: a manager adds an item and a
customer sees it. Visual gate at 390px throttled and 1280px; the bundle check proves `/manage` is not in the
initial chunk.

Docs: `docs/FRONTEND_STRUCTURE.md`, `docs/COMPONENTS.md` (`ItemEditor`). Intent: `--client minor`.

Split seam: the list as 05a, the editor as 05b.

As built: one PR (no split). The Menu tab is the first `/manage` tab; the tab row wraps at large text sizes. Archived
items are not listed (read-only), and archiving has no button yet. The editor's bounds come from
`VALIDATION.menuItem`. The template in the owner's store picker moved to PR 07b, which adds the `/brands/mine` client
the picker needs (the store page reads the public store route, which never serves a template).

### PR 06 — Client: stock in `/manage` and on the staff board (P3.4, P3.5)

- [x] Merged (06a #83, 1f09d6e; 06b #84, 58621c3)

One `StockList` component (quick −/+, "Set", "Sold out", low-stock highlight from the store's
`low_stock_threshold`, the item's last movements on demand), used at `/manage/:storeSlug/stock` and as a Stock view
on `/staff/:storeSlug`, which staff see only when the store lets them. Both call PR 04's route.

Tests: `StockList.test.tsx` (each control, a refused adjustment rolls back and says why), `StaffDashboard.test.tsx`
(the view appears and disappears with the setting), e2e: staff marks an item sold out and the menu shows it.

Docs: `docs/COMPONENTS.md` (`StockList`), `docs/FRONTEND_STRUCTURE.md`. Intent: `--client minor`.

As built: split in two for size: 06a (#83, 1f09d6e) the server read and the setting in `/auth/me` (and the demo seed
now wipes `stock_movements`, whose rows blocked it), 06b the client. Both views read a new `GET /stores/:storeId/stock` (`stock.update`: the live items and the threshold, never
cached). Staff cannot read the editor's list (`menu.edit`), and the public menu is cached and never serves a draft
branch. `/auth/me` memberships carry `staffCanEditStock`, so the board offers its Stock view only where staff may use it
(a manager always). Staff learn a change of the setting on their next load; meanwhile the server's 403 shows as an
error. The "Staff can change stock" switch sits at the top of the `/manage` Stock tab, not on the Settings form. The
menu tab's switch became the shared `Switch` atom. An open history refetches after every write made on the screen.
Intent: 06a `--server minor`, 06b `--client minor`.

### PR 07 — Template push (P3.1)

- [x] Merged (#85, 44dfa98)

Migration `<ts>_push_template_items.sql`: `push_template_items(p_brand_id, p_template_item_ids uuid[], p_store_ids
uuid[], p_fields text[], p_actor, p_request_id) returns integer`. For each chosen store: an item whose
`template_item_id` matches gets the chosen fields (`name`, `description`, `price`, `category`, `diet`, `photo`)
overwritten; a store with no such item gets a new copy. Stock, availability, sort order and popularity are never
pushed. Every store and field must belong to the brand; one `menu.changed` per store; the audit rows carry the
push's request id, so one push reads as one change.

Server: `POST /api/brands/:brandId/template/push { itemIds, storeIds, fields }` (`template.push`: the brand's owner
only; `requireBrandOwner`, a ten-line sibling of `requireStore`). Invalidates each store's menu.

Client: on a template item in the editor, "Push to stores…" opens a sheet: choose stores, choose fields, see what
will be overwritten ("Price at North Gate: ₹120 → ₹140"), confirm.

Tests: `test/api/template-push.test.ts` (only chosen fields and stores change; a store that renamed its copy still
receives a price push, by lineage; a store of another brand is refused whole; a manager is 403; the audit rows share
one request id); `PushSheet.test.tsx`.

Docs: `docs/API.md`, `docs/SCHEMA.md`, `docs/PERMISSIONS.md`, `docs/ARCHITECTURE.md`. Intent:
`--server minor --client minor`.

As built: server only. The push sheet moves to PR 07b: `/manage` reads the public store route, which never serves a
template, so the template's item editor is not reachable until 07b adds the template to the store picker. No
`requireBrandOwner` and no `template.push` capability: like `POST /brands/:brandId/stores`, the service checks the brand
is in `ownedBrandIds`, and a manager or an admin gets 404 (not 403: a brand route is someone else's resource). A
branch whose copy was archived gets a new copy. Review round: the template items are locked `for update` (concurrent
pushes made duplicate copies, seen in the test), only copies that differ are written (`updated` counts real changes),
targets are `DRAFT` or `ACTIVE` branches, the template comes from `brands.template_store_id`, and one push reaches at
most `TEMPLATE_PUSH_COPIES_MAX` (5000) copies.

### PR 07b — Client: open a branch, its profile, publish (P3.1, D6)

- [x] Merged (07b-1 #86, 88344a9; 07b-2a #87, e649b36; 07b-2b #88, 8360bb0; 07c #89, 7899060)

Depends on PR 05 too: the checklist links to the menu screen. `/before-write`: reuse-scout (the `/manage` shell and store picker from P2 PR 14a, the Settings form from PR 15,
`Input`, `Button`, `Skeleton`, `EmptyState`, `ErrorState`).

- The owner's store picker lists the brand template first, labelled "Brand template" (moved from PR 05).
- The owner's store picker gains "Open a branch": a form (name, area, address; the slug shown, editable) that
  lands on the new store's `/manage` page.
- `/manage/:storeSlug/profile` (lazy): the profile form for managers and owners.
- A "Go live" card on the store's `/manage` home for the owner of a `DRAFT` store: the three checklist items, each
  linking to the screen that fixes it, and Publish (enabled once all pass; the server still decides). A published
  store shows Unpublish behind a confirm dialog that says new orders stop.
- `services/manageStores.ts`; every mutation reloads the picker's brands, the store, and the public store list.

Tests: `OpenBranch.test.tsx` (field errors from the API, a taken slug), `GoLive.test.tsx` (each checklist state,
`STORE_NOT_READY` from the server, the unpublish confirm), e2e: the owner opens a branch, adds hours and an item,
publishes it, and a customer finds it. Visual gate at 390px throttled and 1280px.

Docs: `docs/FRONTEND_STRUCTURE.md`, `docs/COMPONENTS.md` for any new component. Intent: `--client minor`.

As built: split in three. 07b-1 (server): `/manage` read the store and its hours through the public routes, which
serve only `ACTIVE` stores, so a `DRAFT` branch could not be managed at all. `GET /stores/:storeId/manage`
(`store.profile`: the store at any status, its brand, and `missing`, the go-live checklist) and
`GET /stores/:storeId/manage/hours` (`hours.edit`, uncached). `store_publish_missing` is the one checklist: the
manage screen reads it and `set_store_status` (redefined, same signature) publishes only when it is empty. 07b-2
(client): this section's screens on those reads. 07c (client): PR 07's push sheet, once the template is reachable.
07b-2 split again for size: 07b-2a the picker (template first, branches at every status, "Open a branch", which
lands on the new branch's page) and the store shell on the manage reads (the hours editor too); 07b-2b the Profile
tab and the Go live card (a new branch then lands on its Profile tab, where the address the checklist asks for
is filled in).
07c: the push sheet opens from a "Push to branches" button on each row of the template's Menu tab (not from inside
the item editor). Its preview reads each chosen branch's list fresh and finds the copy by lineage, so
`ManagedMenuItemDto` gained `templateItemId` (server, additive).

### PR 08 — Media: the port, local storage, the uploads API (P3.3)

- [x] Merged (#90, 823ac2b)

`/before-write`: schema-guard, NEW TABLE (`media_uploads`); reuse-scout, NO MATCH (`integrations/` is new). Skill:
`agent-skills:security-and-hardening` (the PR accepts files).

Migration `<ts>_media_uploads.sql`: `media_uploads (id, store_id, created_by, status 'PENDING' | 'UPLOADED' |
'PROCESSED' | 'FAILED', original_key, content_type, byte_size, variants jsonb, failure text, created_at,
processed_at)`; index `(status, created_at)`; RLS on, revoked.

Server:

- `src/integrations/media/port.ts`: `MediaStore { createUpload(key, contentType, maxBytes) → { method, url, fields?, headers? },
read(key), write(key, bytes, contentType), remove(key), publicPath(key) }`; `local.ts`, the folder-backed store.
- `utils/env.ts`: `MEDIA_STORAGE` (`s3` by default; `local` refused when `APP_ENV` is `production`),
  `MEDIA_LOCAL_DIR`. `local` is what `start.sh` uses until PR 09.
- `POST /api/stores/:storeId/media/uploads { contentType, byteSize }` → `{ uploadId, upload: { method, url, fields?, headers? } }`
  (`menu.edit`; JPEG, PNG or WebP; at most 8 MB; its own rate limiter).
- `POST /api/stores/:storeId/media/uploads/:uploadId/complete` → marks it `UPLOADED` and emits `media.uploaded`.
  `GET …/uploads/:uploadId` → its status and, once processed, its variants.
- Local mode only: `PUT /api/stores/:storeId/media/uploads/:uploadId/file` takes the raw bytes (`method: "PUT"` with
  `headers` in the upload response; a body limit of 8 MB on this one route), and the API serves `/media/*` from the folder with the immutable cache header.
- New error `UPLOAD_INVALID` (400), and `ErrorDetails` gains its tagged shape.

Tests: `test/api/media-uploads.test.ts` (matrices; a wrong type, a size over the limit, a declared size that does
not match the bytes, an upload of another store → refused; a second `complete` is 200 and emits nothing; the local
file route is 404 when `MEDIA_STORAGE=s3`); `test/unit/env-media.safe.test.ts` (`local` in production refuses to
start).

Docs: `docs/API.md`, `docs/SCHEMA.md`, `docs/DEPLOYMENT.md` and `server/.env.example` (the variables),
`docs/BACKEND_STRUCTURE.md` (`integrations/`), `docs/CONFIGURATION.md`, `.claude/hooks/major-change-gate.js` and
CLAUDE.md §17 (`server/src/integrations/` is a major-change path). Intent: `--server minor`.

As built: `MEDIA_STORAGE` defaults to `local` when `APP_ENV` is local and `s3` elsewhere (not `s3` everywhere: the S3
store arrives in PR 09, so a developer and the test suite would have no store at all); until PR 09 the `s3` store is a
placeholder that answers 503 to an upload. The major-change path list lives in `.claude/rules/workflow.md` §17, not
CLAUDE.md. `complete` is a SQL function (`complete_media_upload`: the transition and `media.uploaded` in one
transaction). The local PUT also checks the magic bytes, and the route is matched in `app.ts` to lift the 100 KB JSON
limit for it alone. `MEDIA_UPLOAD` is its own constant (not in `LIMITS`, which the client mirrors).

### PR 09 — Media: S3 and MinIO (P3.3)

- [ ] Merged

- `src/integrations/media/s3.ts` with `@aws-sdk/client-s3` and `@aws-sdk/s3-presigned-post`: a presigned POST that
  pins the exact key, the content type and a `content-length-range`, valid for five minutes. Env: `MEDIA_BUCKET`,
  `AWS_REGION`, `MEDIA_S3_ENDPOINT` (MinIO; unset on AWS, where the instance role signs).
- `compose.yaml`: the `minio` service and its bucket, replacing the placeholder comment; `ci.yml`'s server-tests
  job starts it. nginx (`default.conf.template`) proxies `/media/` to the media origin in compose; Vite proxies
  `/media` in development. On AWS, CloudFront does this ([P8 PR 05](P8_INFRASTRUCTURE.md#build-order)).
- CSP: `connect-src` gains `${MEDIA_UPLOAD_ORIGIN}` (the bucket endpoint the browser posts to), from the web
  image's runtime environment like `SUPABASE_URL`; `img-src 'self'` is unchanged, which the smoke test asserts.
- `start.sh` and `run.sh` keep working without Docker by leaving `MEDIA_STORAGE=local`.

Tests: `test/api/media-s3.test.ts` against MinIO (the presigned form uploads; a larger file, another key or another
content type is refused **by the bucket**; the object is not publicly readable); the port's contract test runs
against both stores.

Docs: `docs/DEPLOYMENT.md` (MinIO, the variables, the web image's new variable), `.claude/rules/frontend.md` §9 and
CLAUDE.md §9 (the upload host is the one new runtime host), `docs/TESTING.md`. Intent: `--server minor --client
patch`.

As built: **RustFS** (`rustfs/rustfs:1.0.4`) instead of MinIO, which no longer publishes images (Docker Hub and quay
refuse the pull); it passed the same checks (the POST policy's size, key and type; `If-None-Match` write-once; no
anonymous read; bucket CORS). The policy pins the exact declared size, not only a maximum. Without `MEDIA_BUCKET` the
`s3` store answers 503 and the API still starts (staging has no bucket until P8). `pnpm run media:bucket` makes the
local bucket and its CORS rule (refused on production). nginx's `/media/` upstream is the web image's required
`MEDIA_UPSTREAM` (the API in compose by default); the bucket is private, so serving variants publicly is PR 10's.

### PR 10 — Media: the image pipeline in the worker (P3.3)

- [x] Merged (10a #93, 6c37a09; 10b #94, 30027a6)

Migration `<ts>_q_media.sql`: `select pgmq.create('q_media')`; subscription `('media.*', 'q_media')`;
a nightly schedule calls `emit_event('media.sweep', …)`, because the sweep below deletes objects from the store,
which only the worker can reach. There is no SQL-only purge of upload rows: it would drop the row while the original
object stays in storage.

Server:

- `src/jobs/media.ts`, added to `worker.ts`'s handler list: first read the upload row; `PROCESSED` means
  acknowledge and return, so a redelivered message after a completed run never reads the store. Otherwise read the
  original (a missing original for an upload that is not `PROCESSED` is a `PermanentError` that marks it `FAILED`);
  the original is untrusted even after `complete` (its presigned form stays valid for five minutes and can replace
  the bytes at the same size), so `sharp` checks the real type from the bytes (anything but JPEG, PNG or WebP, or larger than 6000×6000, is a
  `PermanentError` that marks the upload `FAILED`); auto-rotate, strip metadata, write 400w and 900w WebP under
  `stores/<storeId>/<sha256 prefix>-<width>.webp` with `public, max-age=31536000, immutable`; mark the upload
  `PROCESSED` with its variants; delete the original last. A crash before the mark reruns the whole handler and
  writes the same keys (content-addressed), so it is idempotent.
- The item routes (PR 02) accept `imageUploadId`: a processed upload of the same store sets `image_url` (the 900w
  variant) and `image_variants`. `toMenuItemDto` gains `imageSrcSet`, built by the server from the variants.
- On `media.sweep`, the same handler first handles upload rows: for every upload that is `PENDING`, `UPLOADED` or
  `FAILED` and older than 24 hours it removes the original object, then deletes the row; a failure in between
  leaves the row, so the next sweep retries. The bucket's own lifecycle rule (originals expire after a day, [P8
  PR 05](P8_INFRASTRUCTURE.md#build-order)) is the backstop in S3. Then it removes every variant that no
  `menu_items` row, no `order_items` row **and no `media_uploads` row processed within the last 24 hours** points
  at. A processed upload nobody attached within 24 hours is swept with its variants and its row. An item write
  naming an upload that no longer exists answers 400 `UPLOAD_INVALID`, and the editor uploads again.
- `sharp` is a server dependency. It needs no install script: the platform binary is an optional package, which
  `--ignore-scripts` installs.
- The production host has 1 GB of memory ([P8 plan](P8_INFRASTRUCTURE.md#the-budget)), so the handler processes
  **one image at a time** (`concurrency: 1`), turns `sharp`'s cache off and caps its threads; an 8 MB photo at
  6000×6000 must process inside the worker container's memory limit, which the pipeline test asserts with the
  largest allowed input.

Tests: `test/api/media-pipeline.test.ts` (a real queue and the local store: a JPEG becomes two WebP variants
without EXIF; a renamed text file fails the upload and dead-letters nothing; the same message twice leaves one set
of variants; the same message delivered again after a completed run succeeds without reading the store; an item
saved with the upload serves `imageSrcSet`; a variant an old order still shows survives the sweep, seen failing
without the order check; an old pending upload that has an original leaves neither object nor row after the sweep;
with an injected clock, an unattached processed upload survives a sweep at 1 hour and is gone at 25 hours, and one
attached at 23 hours keeps its variants). The `images` CI job proves `sharp` loads in the Alpine runtime image
and the image stays under its 300 MB budget.

Docs: `docs/JOBS.md` (the queue, the handler, the sweep), `docs/SCHEMA.md`, `docs/API.md` (`imageSrcSet`,
`imageUploadId`), `docs/LOGGING.md`. Intent: `--server minor --client patch`.

As built, in two PRs. **10a**: the queue (`media.uploaded` only, not `media.*`, so the handler's own
`media.processed` / `media.failed` do not come back), `finish_media_upload` (the transition and its event, actor
`WORKER`), the handler with `sharp` 0.35 (the variants are `{ width, height, key }` under
`stores/<store>/variants/`, inside `MEDIA_KEY`), the S3 write's immutable `Cache-Control`, and the `images` job's
sharp check (the API image is 284 MB of its 300). **10b**: `imageUploadId` and `imageSrcSet` on the item routes, the
nightly `media.sweep`, and its tests.
10b as built: the candidates are chosen in SQL (`media_sweep_candidates`), since the reference checks span
`menu_items`, `order_items` and `media_uploads`, which only their owners may query; a processed upload's row stays while
anything shows it, so a replaced photo is found and swept later. The sweep reads its time from the event.

### PR 11 — Client: photo upload, and `FoodPhoto` with variants (P3.3)

- [ ] Merged

- `features/manage/usePhotoUpload.ts`: redraw the chosen file on a canvas at 2000px on its longer side and encode a
  JPEG (saves upload data on a metered connection, and turns any format the browser can show into one the server
  takes), request the upload, send it as the response says (`POST` of a multipart form of `fields` plus the file, or `PUT` of
  the raw bytes with `headers`), call `complete`, then poll the upload until it is processed (pausing
  while the tab is hidden), with progress, cancel and retry.
- `ItemEditor` gains the photo field; saving sends `imageUploadId`.
- `FoodPhoto` takes `srcSet`; menu surfaces pass `item.imageSrcSet`, and `photoSrcSet(src)` remains the fallback
  for bundled photos until PR 12. The `sizes` rules are unchanged.

Tests: `usePhotoUpload.test.ts` (both shapes, the form `POST` and the raw `PUT`; each failure leaves a retry; cancel stops
the poll), `FoodPhoto.test.tsx`,
`ItemEditor.test.tsx`, e2e against local storage: upload a photo, see it on the public menu at 400w on a phone
viewport.

Docs: `docs/COMPONENTS.md` (`FoodPhoto`'s `srcSet`), `docs/FRONTEND_STRUCTURE.md`. Intent: `--client minor`.

### PR 12 — The bundled photos move to media (P3.3)

- [ ] Merged

- `server/scripts/migrate-media.ts`: for one environment per run, push every photo under `client/public/images/`
  through the same pipeline and rewrite `menu_items.image_url`, `image_variants` and `stores.image_url`, and also rewrite the
  `order_items.image_url` snapshots that point at `/images/…` to the same media URL (the same photo at a new
  address), so order history keeps its photos. Safe to repeat. Refuses production without `--production` (the user
  runs that one). Its `--check` mode prints how many rows of `menu_items`, `stores` and `order_items` in that
  environment still point at `/images/` and exits non-zero unless the count is zero.
- The seed writes media URLs by running the same code, so a fresh local database never points at `/images/`.
- Once local and staging are migrated, and `--check` reports zero in each (12b): the bundled menu photos, `photoSrcSet`'s `/images/` rule,
  `optimize-images.py` and nginx's `/images/` location go, and `photo.test.ts` becomes a variant check. The
  storefront cover stays bundled until a store can upload its own (the settings screen gains it in this PR).

Tests: the script against the local store, twice; an old order shows its photo after the migration; `--check` exits
non-zero while a row still points at `/images/`; the client suite without the bundled files.

Docs: `docs/DEPLOYMENT.md` (the migration, replacing "Compressing photos"), `.claude/rules/frontend.md` §9,
`README.md`. Intent: `--server patch --client patch`.

Split seam: the script and seed as 12a, the removal as 12b after staging has migrated.

12a as built: `scripts/media-migration.ts` (shared by `migrate:media` and the seed) runs each (store, photo) through
the worker's `makeVariants`, and two SQL functions find and repoint the rows (`bundled_photo_refs`,
`move_bundled_photo`: the items and the order lines in one transaction). Store covers are not moved yet: the cover
stays bundled until a store can upload its own, which 12b brings with the settings screen's cover upload. The seed
leaves the photos bundled where no media store is available (staging has no bucket until P8), so **12b waits for P8**:
staging can only migrate once it has a bucket.

### PR 13 — Modifiers: schema, pricing, orders (P3.2)

- [x] Merged

`/before-write`: schema-guard, NEW TABLE ×4. Skill: `agent-skills:test` (rules first, as failing tests).

Migration `<ts>_modifiers.sql`:

- `modifier_groups`, `modifier_options`, `menu_item_modifier_groups`, `order_item_modifiers` (the roadmap's
  columns, store-scoped, deltas in paise) and `order_items.base_unit_price_paise`;
- `place_order`, from its latest body, gains `p_modifiers_enabled boolean default false`; the API passes the
  store's evaluated `modifiers` flag. When it is false, lines are priced from the item alone, no group is enforced,
  and a line that carries `modifier_option_ids` is refused with `MODIFIER_INVALID`. When it is true, each line may
  carry `modifier_option_ids`. Per line it loads the item's
  groups and options, applies a group's default option when the group is required and nothing was chosen, enforces
  `min_select ≤ chosen ≤ max_select`, that every option belongs to one of the item's groups and is available and
  unarchived, and that the unit price (item + deltas) is not negative; raises `MODIFIER_REQUIRED` or
  `MODIFIER_INVALID` with the item in the details; compares the result with the line's expected price
  (`PRICE_CHANGED`); writes `unit_price_paise` (modifiers included), `base_unit_price_paise` and the
  `order_item_modifiers` snapshots. Stock is still taken per menu item, across all its lines;
- `create_store_from_template` and `push_template_items` copy an item's groups and options with it;
- the flag row `('modifiers', enabled false, client_visible true)`.

Server: `src/domain/pricing.ts` (`priceLine(item, groups, chosenIds, modifiersEnabled) → { unitPrice, applied } |
error`, the same switch as the function), called by
`order.service.ts` before the RPC; `createOrderSchema` items gain `modifierOptionIds?` (at most 20), and
`mergeDuplicateItems` merges by line key (`menuItemId` + sorted option ids); the public menu gains a top-level
`modifierGroups: { [id]: group }` and `MenuItemDto.modifierGroupIds`, both empty while the flag is off for the
store; `OrderItemDto` gains `baseUnitPrice` and `modifiers: { groupName, optionName, priceDelta }[]`.

Tests: `test/unit/pricing.safe.test.ts`, property-based (the price is the base plus the chosen deltas; never
negative; min and max; defaults); `test/api/order-modifiers.test.ts` (**the shared case table** through
`priceLine` and through `place_order`, asserting the same outcome, including the flag-off cases: a required group with no default is accepted at the
base price, and options sent are refused; two lines of one item with different options
share its stock limit, under `Promise.all`; an option of another item, an unavailable one, a stale price; an order
with no `modifierOptionIds` for an item whose required group has a default is accepted with the default; the
snapshot survives a later rename and delete of the option); the menu payload for 60 items sharing three groups
stays under about 25 KB.

Lifecycle walk and a `claude-security` scan: the PR changes how an order is priced.

Docs: `docs/SCHEMA.md`, `docs/API.md` (request, menu, order, two error codes), `docs/ARCHITECTURE.md` (pricing),
`plans/ROADMAP.md` A3. Intent: `--server minor --client patch`.

Split seam: the schema and menu payload as 13a, `place_order` and the order DTO as 13b.

As built, in three: **13a** the tables, the flag row, the menu payload, `domain/pricing.ts` with the shared case table
(`test/setup/modifierCases.ts`); **13b** `place_order` and the order DTO; **13c** the copies in
`create_store_from_template` and `push_template_items`. 13a also makes `reset_demo_orders` truncate the snapshots
(the seed failed on the new foreign key), and filters the menu's links by the groups' store rather than `in(itemIds)`
(500 ids overflow the request URL). The menu budget became two numbers: the modifiers add under 9 KB raw to 60 items
sharing three groups, and the whole menu goes out under 8 KB gzipped (nginx); the plain 60-item menu of the test is
already ~22 KB raw, so a 25 KB raw total measured content, not modifiers. The link table is not audited
(`audit_log.entity_id` needs an id); its writes are events. 13c copies by lineage (`template_group_id`, `template_option_id`) in
`copy_template_modifiers`; a push carries the item's groups when it has the new `modifiers` field, and a branch's new
copy of an item always does. A branch's own groups and its options' availability are never pushed. The push sheet's
`modifiers` checkbox is PR 16's (the editor).

13b as built: `price_order_line()` is the SQL half of `priceLine`; `place_order` is dropped and created again with
`p_modifiers_enabled` (an added defaulted parameter would be a second overload, and named calls ambiguous);
`order_item_modifiers.position` keeps the snapshots in the order applied. The replay check compares line by line, each requested line matching a stored line of the same item, quantity and requested options
(`order_items.requested_modifier_option_ids`, as named, without the defaults applied). **The flag stays off until PR 15's client ships with a
`min_client_version` bump**: an older client prices a required group's default at the item's base price and would
loop on `PRICE_CHANGED`. A line naming a default and one leaving it out stay two lines (the merge happens before the
groups are known); advisory.

### PR 14 — Modifiers: editing API (P3.2)

- [x] Merged

`GET/POST/PATCH/DELETE /api/stores/:storeId/modifier-groups[/:groupId]` (a group with its options in one body;
delete archives) and `PUT /api/stores/:storeId/menu-items/:itemId/modifier-groups { groupIds }`, all `menu.edit`.
A group write is one function, `save_modifier_group`, so a group never exists half-edited; bounds in
`schemas/limits.ts` (20 groups a store, 20 options a group, deltas within ±₹10,000). Every write invalidates
`menu:<storeId>`.

Tests: `test/api/modifier-groups.test.ts` (matrices; a group of another store cannot be attached; `min_select`
above the number of available options is refused; archiving a group leaves old orders intact and removes it from
the menu, after the invalidation).

Docs: `docs/API.md`, `docs/SCHEMA.md`, `docs/CONFIGURATION.md`. Intent: `--server minor`.

As built: archive is its own function too (`archive_modifier_group`), so every write emits its `menu.changed` under the
caller; `GET` also answers `itemGroupIds` (the editor's one read); `groupsPerStore` reaches the function as
`p_max_groups` (one copy of the number). The client mirror of `MODIFIER_LIMITS` waits for PR 16, the editor that reads
it.

### PR 15 — Client: the modifier picker and the cart (P3.2)

- [x] Merged

- `ModifierPicker` in `ItemDetailSheet`: radio buttons when a group allows one choice, checkboxes otherwise, a live
  price, "Choose one" inline, 44px targets, keyboard and screen-reader labels.
- An item with a required group shows "Customisable" under its price, and its `AddControl` opens the sheet instead
  of adding directly.
- `cartStore` version 3: a line has `lineKey` and `options: { id, groupName, name, priceDelta }[]`; `migrate` gives
  each old line `lineKey = menuItemId`. `cartRules.lineLimit` works from the **item's** remaining allowance across
  all its lines.
- `Cart`, `CartItem` and the checkout summary list the options under the line; the order request sends
  `modifierOptionIds`; `MODIFIER_REQUIRED` and `MODIFIER_INVALID` reload the menu and reopen the item.
- Everything renders only when the menu carries groups, so the flag is the store's switch.

Tests: `ModifierPicker.test.tsx`, `cartStore.test.ts` (the migration; two lines of one item; the shared limit),
`cartRules.test.ts`, `Checkout.test.tsx`, e2e: customise, pay, see the options on the order. Visual gate; the
bundle check (the picker rides in the item sheet's chunk); `perf-auditor` on the menu's INP.

Docs: `docs/COMPONENTS.md` (`ModifierPicker`), `docs/FRONTEND_STRUCTURE.md`. Intent: `--client minor`.

Split seam: **15a** the cart's data (version 3: `lineKey`, `options`, the item's limit shared by its lines,
`syncPrices` with deltas, `orderItems` sending `modifierOptionIds`), invisible while menus carry no groups; **15b** the
picker, "Customisable", the cart and checkout showing options, and the `MODIFIER_*` recovery. As built in 15b: any item
with groups is "Customisable" and its card's Add opens the sheet (decided from `modifierGroupIds`, so the memoised
cards need no groups); every group starts at its available defaults; a `MODIFIER_*` refusal at checkout reloads the
menu and shows the server's message, which names the group. The customise-pay-see-it e2e moves to PR 16, whose
manager → customer → kitchen e2e covers it once orders show their options.

### PR 16 — Client: modifiers on orders, and their editor (P3.2)

- [ ] Merged

- `OrderCard`, the order page and `StaffOrderCard` list each line's options (the kitchen must see them: the staff
  card shows them at full size, not as a footnote).
- `useReorder` re-adds the same options where they still exist and names the ones it had to drop.
- `/manage/:storeSlug/menu` gains the modifier-group editor and, in `ItemEditor`, the groups attached to the item.

Tests: `OrderCard.test.tsx`, `StaffOrderCard.test.tsx`, `useReorder.test.tsx`, `ModifierGroupEditor.test.tsx`, e2e:
a manager adds "Extra cheese +₹20", a customer orders it, the kitchen ticket shows it.

Docs: `docs/COMPONENTS.md`, `docs/FRONTEND_STRUCTURE.md`, `README.md` (the demo script). Intent: `--client minor`.

## Deferred: P3.6 surplus and deals

The roadmap's P3.6 exists to resell the food of an order that was paid and never collected (R4.2.1). That order
state, `EXPIRED`, and the payment that makes the resale fair, arrive with P5.9. Before then a surplus lot has no
source, and a deal on regular stock is a promotion nobody asked for, which would still cost a third rewrite of
`place_order`, a second cart line identity and a new menu section. So P3 builds none of it (D4), and the milestone
M3 reads "catalog, modifiers, photos and stock".

When P5.9 lands, P3.6 is three PRs on top of it, sketched here so the P5 plan can pick them up:

1. **Surplus lots**: `surplus_lots`, created by the expiry function per line; the staff prompt (use for the next
   order, list as a deal, discard); `WASTE` as a `stock_movements` reason; `expire_surplus_and_deals()` on pg_cron.
2. **Deals**: `deals`, reserved by the same conditional decrement as stock, priced inside `create_checkout`, with
   `list_unit_price_paise` snapshotted for "You saved ₹X"; `DEAL_UNAVAILABLE`; the settings `surplus_shelf_minutes`,
   `create_surplus_on_no_show`, `max_active_deals`.
3. **Client**: the "Limited-time deals" section, the deal line in the cart, `/manage/:storeSlug/deals`.

## CLAUDE.md edits, aggregated

| Section | Change                                                                                                                                           | PR     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| §2c     | every menu, stock and modifier write invalidates `menu:<storeId>`; photos are immutable, content-addressed URLs                                  | 02, 10 |
| §4      | `server/src/integrations/`; `/manage` gains Menu and Stock                                                                                       | 05, 08 |
| §9      | photos come from `/media` through `FoodPhoto` with server-built variants; the upload host is the one new runtime host; `optimize-images.py` goes | 09, 12 |
| §10     | menu rows are written through the store's routes; stock only through `adjust_stock`; an order's modifiers are priced in `place_order`            | 04, 13 |
| §17     | major-change path `server/src/integrations/`, in step with `major-change-gate.js`                                                                | 08     |

## ADRs this plan touches

Only the user accepts or amends an ADR, and an accepted decision is never rewritten (`docs/adr/README.md`).

| ADR                     | What P3 does with it                                                                                                                                                                                                                                                                               | Needs                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 001 brands as templates | implements its template half: the template as a never-public store row (D1), copy at creation, `template_item_id`, an audited push by the owner. What a push may overwrite (D2) is finer than the ADR goes                                                                                         | **resolved**: the ADR was amended by the user on 11 November 2026 |
| 006 media               | implements it as accepted: presigned uploads, `MEDIA_STORAGE=s3\|local` with `local` refused in production, MinIO as the `s3` target in compose and CI, variants by the worker, `/media` on the app's origin. Keys per store and no HEIC are below the ADR's level (they change roadmap text only) | nothing                                                           |
| 002 outbox              | `q_media` is created with its consumer; the nightly sweep is a pg_cron schedule that enqueues work for the worker, the ADR's own pattern                                                                                                                                                           | nothing                                                           |
| 004 paise               | modifier deltas and `base_unit_price_paise` are paise, whole rupees                                                                                                                                                                                                                                | nothing                                                           |
| 009 rate limits         | the upload limiter is built with `createRateLimiter`                                                                                                                                                                                                                                               | nothing                                                           |
| 011 free tiers          | photos stay out of the database; one more queue in the same Postgres                                                                                                                                                                                                                               | nothing                                                           |

## Decisions

Answered by the user on 12 November 2026 (D1 on 11 November). Every answer is the default except D6.

| #   | Decision                                                         | Default                                                                                                                                                                                                                                                      | Applies to   |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| D1  | How the brand template is stored                                 | **answered (the user, 11 November 2026):** as a never-public store row (`is_template`), sharing every menu table (ADR-001 as amended)                                                                                                                        | 01, 07, 13   |
| D2  | What a push may overwrite                                        | **answered:** name, description, price, category, diet and photo; never stock, availability, order or popularity                                                                                                                                             | 07           |
| D3  | Where stock changes are recorded                                 | **answered:** `stock_movements` for manual changes only; sales stay on the order lines; no duplicate in `audit_log`                                                                                                                                          | 04           |
| D4  | P3.6 (surplus and deals) in P3, or after P5.9                    | **answered:** after P5.9, whole                                                                                                                                                                                                                              | –            |
| D5  | HEIC uploads                                                     | **answered:** not accepted by the server; the editor converts what the browser can show                                                                                                                                                                      | 08, 11       |
| D6  | Who creates a brand's next store before the admin console (P7.4) | **answered (not the default):** the brand's owner, through the API and `/manage`; the store starts `DRAFT` and the owner publishes it once it has an address, weekly hours and an available item, and may unpublish it. Brands are still created by the seed | 01, 01b, 07b |
| D7  | When the bundled photos are deleted                              | **answered:** after local and staging have migrated (PR 12b); production starts on media, since it first deploys in P8                                                                                                                                       | 12           |
| D8  | Staff may edit stock by default (roadmap decision 16)            | **answered:** yes                                                                                                                                                                                                                                            | 04           |

## Closing P3

Once every box is ticked: on a fresh `origin/feat/P3`, the gate in both packages, `pnpm run e2e:chromium`, the
WebKit smoke, and `/break` (P3 changes how orders are priced and adds file uploads), with fixes as normal PRs into
`feat/P3`. Then the PR `feat/P3` → `dev` ("P3 — catalog and media", exempt from the size limit,
`@coderabbitai ignore`, listing its migrations in order); the user merges it. The milestone check (M3) on staging: a
manager edits an item, its photo and its stock from a phone; a customer orders a customised item and the kitchen
sees the options; the owner pushes a price from the template to one branch and not the other; the owner opens a new
branch, publishes it from a phone, and a customer orders from it.

## User steps (cannot be done from the repository)

- ~~Answer the [decisions](#decisions)~~ (done 12 November 2026).
- ~~Create `feat/P3` from `dev`~~ (cut by the agent from 7b53c34 on 12 November 2026).
- Merge `feat/P3` into `dev` when P3 closes; push its migrations to staging (`pnpm run db:push:staging`).
- Photos on staging: staging is not hosted on AWS until after the first release
  ([P8 plan](P8_INFRASTRUCTURE.md#later-staging-on-aws)), so a local stack pointed at staging uses
  `MEDIA_STORAGE=local`, and the presigned flow is exercised against MinIO locally and in CI. Production's bucket
  and its CloudFront route come from [P8 PR 05](P8_INFRASTRUCTURE.md#build-order).
- Run `migrate-media` for staging after PR 12a; for production, with `--production`, at P8's first release.
- Turn `modifiers` on per store with `PATCH /api/admin/flags/modifiers` and an admin token.

## Risks and gotchas

- **`place_order` again.** PRs 02 and 13 both redefine it (after P2's PR 08). Each starts from the previously merged
  body. PR 13 adds the parameter `p_modifiers_enabled`, a new signature, so it drops and recreates `place_order`
  and grants it again.
- **Two implementations of one pricing rule.** The shared case table in PR 13 is the guard; a rule added to one
  side without a case fails review, and a case added without the other side fails the test.
- **Uploads are the first place the app accepts bytes.** The type is checked three times (the presign policy, the
  bucket, the worker reading the bytes), the size twice, the image is re-encoded, and nothing an upload names is
  ever used as a path. PR 08 and PR 10 each get a `claude-security` scan.
- **`sharp` in the Alpine image.** The runtime image copies a Node binary into plain Alpine with `libstdc++`;
  `sharp`'s musl package must load there, for the architecture P8 builds (arm64). The `images` job is the check;
  if it fails, the fallback is a Debian-slim runtime stage for the server image, which costs image size.
- **The worker cannot clear the API's cache.** Each process has its own; a processed photo shows on the menu after
  the item is saved (which invalidates) or after `PUBLIC_READ_TTL_MS`, never instantly from the worker.
- **A template's photo is shared by its copies.** Content-addressed keys make that free, and the sweep keeps a
  variant while any item or order line of any store points at it.
- **CSP is Report-Only today.** The new `connect-src` host is added now; turning the policy on is decided on the
  hosted app while production is dark ([P8](P8_INFRASTRUCTURE.md#closing-p8)), and the upload flow is on that
  checklist.
- **Cart version 3** follows P2's version 2. Each `migrate` step is tested from every older version.
- **Free tier.** `q_media` messages carry ids only; originals are deleted after processing; `media_uploads` and
  `stock_movements` are purged or small. Watch `pg_total_relation_size` as the `docs/JOBS.md` runbook says.
