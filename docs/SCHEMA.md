# Schema

The Postgres schema in the Supabase project, from `server/supabase/migrations/`. The ER diagram is in
[ARCHITECTURE.md](ARCHITECTURE.md#10-data-model). Who may read and call what is in [PERMISSIONS.md](PERMISSIONS.md).

- Generated TypeScript types: `server/src/types/database.ts` (`cd server && pnpm run db:types`, from the local
  database). `server/src/types/enums.ts` re-exports the enums from it.
- Money is paise in `bigint` columns named `…_paise` ([ADR-004](adr/004-rupees-and-paise.md)); the API sends whole
  rupees, converted only by `server/src/utils/money.ts`. While a rupee API field exists for a column, its paise column
  has a `check (… % 100 = 0)`, so the rupee field never rounds. The old whole-rupee `integer` columns (`price`,
  `total`, `unit_price`, `line_total`) were dropped by `20261109094725_money_paise_contract.sql` (P1 PR 16).
- Every table is in the `public` schema. `profiles.id` references Supabase's `auth.users`.
- Extensions: `pgmq` (queues, in its own `pgmq` schema) and `pg_cron` (schedules, in `cron`), both from
  `20261024181904_outbox.sql`. How the queues and schedules are used: [JOBS.md](JOBS.md).

## Migrations

Applied in file-name order. Once a migration is pushed to staging or production it is never edited; a change goes in
a new file (see [DEPLOYMENT.md](DEPLOYMENT.md#schema-changes)).

| File                                               | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260925120000_init.sql`                          | the three enums, the five tables, indexes, RLS and grants, the triggers and the three RPCs below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `20260927094610_admin_settings_collected.sql`      | adds `user_role` value `ADMIN`; renames `order_status` value `COMPLETED` to `COLLECTED`; adds `public.site_settings` (RLS, revoked, `set_updated_at` trigger)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `20260927222002_min_client_version.sql`            | adds `site_settings.min_client_version` (the 426 gate's minimum)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `20260928180445_site_settings_config.sql`          | adds `site_settings.max_lines_per_order`, `order_poll_ms`, `orders_poll_ms`, `staff_board_poll_ms` (the configuration registry, [CONFIGURATION.md](CONFIGURATION.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `20260928193552_order_idempotency_key.sql`         | adds `orders.idempotency_key` and its partial unique index; drops and recreates `place_order` with `p_idempotency_key` (a function's argument list is its identity, so a new parameter cannot use `create or replace`), reissuing its grants                                                                                                                                                                                                                                                                                                                                                                                           |
| `20261024181904_outbox.sql`                        | enables `pgmq` and `pg_cron`; adds `domain_events`, `event_subscriptions`, `emit_event` and `purge_domain_events`; creates the `q_notifications` queue, its `order.*` subscription and the nightly purge schedule                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `20261024192953_queue_wrappers.sql`                | adds `job_failures` and the five `queue_*` wrappers (the worker's only way into pgmq), granted to `service_role`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `20261101131925_transitions_emit_events.sql`       | drops and recreates `place_order` and `update_order_status` with `p_actor` and `p_request_id` (defaulted), which emit their events; `update_order_status` locks the row, returns boolean and treats a repeat as a no-op; grants reissued                                                                                                                                                                                                                                                                                                                                                                                               |
| `20261101201251_audit_log.sql`                     | adds `actor_type`, the append-only `audit_log` (read-only to `service_role`) and `audit_row_change()` with its triggers on `site_settings`, `orders`, `profiles` and `menu_items`                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `20261102101707_audit_log_id_indexes.sql`          | rebuilds the `audit_log` indexes to end in `id desc` (plus `(entity_type, id desc)`), the order `GET /api/admin/audit` pages in                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `20261102110820_order_snapshots.sql`               | adds the snapshots `order_items.image_url`, `order_items.category` and `orders.store_name`, backfilled from today's `menu_items` and `stores` (without touching `orders.updated_at`), then `not null`; `place_order` (same signature) writes them                                                                                                                                                                                                                                                                                                                                                                                      |
| `20261102110856_feature_flags.sql`                 | adds `feature_flags` (RLS, revoked, `set_updated_at` and `audit_row_change('feature_flag.changed', '*')` triggers, no rows); `audit_row_change()` takes `entity_id` from `key` when the row has no `id`                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `20261102110929_session_activity.sql`              | adds `session_activity`, `touch_session` and `purge_session_activity` (the server-side idle sign-out, ADR-011) and the nightly `purge-session-activity` schedule                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `20261102183749_client_error_sample_percent.sql`   | adds `site_settings.client_error_sample_percent` (the share of page loads that report their errors, [CONFIGURATION.md](CONFIGURATION.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `20261102183832_money_paise.sql`                   | adds `menu_items.price_paise`, `orders.total_paise`, `order_items.unit_price_paise` and `line_total_paise` (`bigint`, backfilled ×100 without touching `orders.updated_at`, `not null`, `>= 0`, whole rupees); `place_order` (same signature) prices every line from `menu_items.price_paise`, refuses a line whose `unit_price_paise` is no longer the price (`PRICE_CHANGED`) and writes both units; `menu_items_audit` also watches `price_paise`; `menu_items_sync_price` keeps `price` and `price_paise` in step until PR 16                                                                                                      |
| `20261103172932_reserved_stock_on_order_items.sql` | adds `order_items.reserved_quantity` (`check (reserved_quantity in (0, quantity))`), set to `quantity` for orders still `PLACED`, `PREPARING` or `READY`; `place_order` (same signature) records what each line reserved, by line number; `update_order_status` (same signature) gives back the sum of `reserved_quantity`, not of `quantity`                                                                                                                                                                                                                                                                                          |
| `20261103173300_profile_name_bounds.sql`           | adds `profile_name(text, text)` and `profile_phone(text)`; `handle_new_user` (same signature) passes the Auth metadata through them; cleans legacy rows, then adds the checks `profiles_name_length` and `profiles_phone_format`                                                                                                                                                                                                                                                                                                                                                                                                       |
| `20261109094725_money_paise_contract.sql`          | drops `menu_items.price`, `orders.total`, `order_items.unit_price` and `line_total`, and the `menu_items_sync_price` trigger and function first; `place_order` (same signature) stops writing the rupee columns; `menu_items_audit` watches `price_paise` and no longer `price`                                                                                                                                                                                                                                                                                                                                                        |
| `20261109122051_order_integrity.sql`               | `place_order` (same signature, grants kept) reads `stores.is_open` `for share` before stock (`STORE_CLOSED`) and refuses an item with `is_available = false` in its pricing read (`ITEM_UNAVAILABLE`); `menu_items_price_paise_check` becomes `price_paise > 0`                                                                                                                                                                                                                                                                                                                                                                        |
| `20261111094853_brands_and_stores.sql`             | adds `store_status`, `brands` (RLS, revoked) and the `stores` columns `brand_id`, `slug`, `status`, `timezone`, `area`, `address_line`, `contact_phone`, `created_at`, `updated_at`, backfilled (one `ACTIVE` brand per store, slugged after its name) and then `not null`; `set_updated_at` and audit triggers on both                                                                                                                                                                                                                                                                                                                |
| `20261112053921_store_settings_on_stores.sql`      | adds the four store settings columns (with checks) to `stores`, copies `staff_order_list_limit` from `site_settings` once without audit rows, and `stores_settings_audit`                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `20261112063852_store_hours.sql`                   | adds `schedule_exception_kind`, `store_hours` and `store_schedule_exceptions` (RLS on, revoked, cascade from `stores`) with `store_hours_audit` and `store_schedule_exceptions_audit`                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `20261111123222_store_memberships.sql`             | adds `store_role`, `store_memberships` (RLS, revoked) with its backfill of `STAFF` profiles into the oldest store and `store_memberships_audit`; redefines `audit_row_change()` to record inserts and deletes and the actor's `storeRole`                                                                                                                                                                                                                                                                                                                                                                                              |
| `20261112083000_store_invites.sql`                 | adds `store_invites` (RLS on, revoked; two CHECKs, `store_invites_open_email_key` and three more indexes) with `store_invites_audit`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `20261112140000_multi_store_contract.sql`          | sets every `profiles.role = 'STAFF'` to `CUSTOMER` (audited as SYSTEM) and drops `site_settings.staff_order_list_limit`; the enum value stays, unused                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `20261112093000_accept_store_invite.sql`           | adds `accept_store_invite()` (`service_role` only): accepts an invite in one transaction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `20261112120000_set_store_hours.sql`               | adds `set_store_hours()` (`service_role` only) and drops `store_hours_audit`: one audit row and one event per saved week                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `20261112130000_store_pause.sql`                   | adds the `stores` pause columns (`accepting_orders`, `paused_until`, `pause_reason`, `paused_by`, `stores_paused_by_idx`), `pause_store()` and `resume_store()` (`service_role` only), and re-creates `stores_audit` and `place_order` (same signature, grants kept)                                                                                                                                                                                                                                                                                                                                                                   |
| `20261112144103_brand_template.sql`                | adds `stores.is_template` (`stores_template_is_draft`, `stores_one_template_per_brand`), `brands.template_store_id`, `menu_items.template_item_id` and `archived_at`; `ensure_brand_template()` and `create_store_from_template()`; backfills a template for every brand (below [stores](#stores))                                                                                                                                                                                                                                                                                                                                     |
| `20261112173552_store_publish.sql`                 | adds the checks `stores_name_length`, `stores_address_line_length` and `stores_contact_phone_format`; `stores_audit` also watches `tagline` and `description`; the trigger `stores_changed` (`stores_emit_changed()`, emits `store.changed`); `set_store_status()` (`service_role` only)                                                                                                                                                                                                                                                                                                                                               |
| `20261112163716_menu_item_lifecycle.sql`           | adds the `diet_marker` enum, `menu_items.diet` and `image_variants`; `menu_items.image_url` and `order_items.image_url` become nullable; the menu item bounds as check constraints; `menu_items_archived_unavailable` (an archived item is switched off, so `place_order` refuses it as `ITEM_UNAVAILABLE`); `menu_items_audit` also fires on insert and watches `description`, `diet`, `archived_at`, `is_popular` and `sort_order`; `menu_items_emit_changed()` and its two statement triggers emit `menu.changed`; `ensure_brand_template` and `create_store_from_template` (same signatures) also copy `diet` and `image_variants` |
| `20261112183242_reorder_menu.sql`                  | adds `lock_store_menu()`, `reorder_menu()` and `set_menu_availability()` (`service_role` only): the menu editor's quick edits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `20261113085219_adjust_stock.sql`                  | adds `stock_reason`, `stock_movements` (RLS, revoked), `stores.staff_can_edit_stock` (also watched by `stores_settings_audit`) and `adjust_stock()` (`service_role` only): stock by hand, with its trail                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `20261113140540_push_template_items.sql`           | `push_template_items()` (`service_role` only): the template push                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `20261113142425_store_readiness.sql`               | `store_publish_missing()` (`service_role` only), the go-live checklist; `set_store_status` (same signature) reads it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `20261113174022_media_sweep.sql`                   | subscribes `media.sweep` to `q_media`, adds `media_upload_shown()` and `media_sweep_candidates()` (`service_role` only), the partial index `order_items_media_image_idx` and the nightly `media-sweep` schedule (P3.3)                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `20261113170333_media_pipeline.sql`                | creates the `q_media` queue, subscribes `media.uploaded` to it, and adds `finish_media_upload()` (`service_role` only): the image pipeline (P3.3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `20261113151317_media_uploads.sql`                 | adds `media_upload_status`, `media_uploads` (RLS, revoked) and `complete_media_upload()` (`service_role` only): photo uploads (P3.3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Enums

| Enum             | Values                                                           |
| ---------------- | ---------------------------------------------------------------- |
| `user_role`      | `CUSTOMER`, `STAFF`, `ADMIN`                                     |
| `order_status`   | `PLACED`, `PREPARING`, `READY`, `COLLECTED`, `CANCELLED`         |
| `payment_status` | `PENDING`, `PAID`                                                |
| `actor_type`     | `USER`, `WORKER`, `RECONCILER`, `WEBHOOK`, `SCHEDULER`, `SYSTEM` |
| `store_status`   | `DRAFT`, `ACTIVE`, `SUSPENDED`, `ARCHIVED`                       |
| `store_role`     | `MANAGER`, `STAFF`                                               |
| `stock_reason`   | `MANUAL_SET`, `MANUAL_ADJUST`, `WASTE`                           |

`ADMIN` was added with `alter type ... add value` (`20260927094610_admin_settings_collected.sql`); it is the
site-wide developer/operator role (the `/admin` dashboard), not a restaurant role — see
[PERMISSIONS.md](PERMISSIONS.md#roles). `COMPLETED` was renamed to `COLLECTED` with `alter type ... rename value` in
the same migration: the enum entry is relabelled in place, so existing rows read `COLLECTED` with no backfill, and no
other SQL object names the old literal. This was a breaking API change shipped together with the client
(see [API.md](API.md#routes)).

## Tables

### profiles

One row per Supabase Auth user, created by the `on_auth_user_created` trigger. The role lives here and nowhere else.
The two checks keep the API's name and phone bounds ([`profile_name`](#profile_name-and-profile_phone)) whichever way
the account was made.

| Column       | Type        | Null | Default    | Constraints                                                           |
| ------------ | ----------- | ---- | ---------- | --------------------------------------------------------------------- |
| `id`         | uuid        | no   |            | primary key; references `auth.users (id)` on delete cascade           |
| `name`       | text        | no   |            | `profiles_name_length`: 1 to 60 characters                            |
| `email`      | text        | no   |            | unique; kept in sync by `on_auth_user_email_changed`                  |
| `phone`      | text        | yes  |            | `profiles_phone_format`: null, or an optional `+` and 10 to 15 digits |
| `role`       | `user_role` | no   | `CUSTOMER` | `STAFF` is unused since P2 PR 16 (store roles are memberships)        |
| `created_at` | timestamptz | no   | `now()`    |                                                                       |

### brands

A brand is the business; it records its owner (ADR-001), who is treated as owner of every store of the brand. Created
through the seed until P7.4. Each brand points at its template store (`template_store_id`, below).

| Column              | Type           | Null | Default             | Notes                                                                                                          |
| ------------------- | -------------- | ---- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `id`                | uuid           | no   | `gen_random_uuid()` | primary key                                                                                                    |
| `name`              | text           | no   |                     | 2 to 80 characters                                                                                             |
| `slug`              | text           | no   |                     | unique; `^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$`                                                               |
| `description`       | text           | no   | `''`                |                                                                                                                |
| `logo_url`          | text           | yes  |                     |                                                                                                                |
| `owner_id`          | uuid           | yes  |                     | references `profiles (id)` on delete set null; indexed (`brands_owner_id_idx`)                                 |
| `status`            | `store_status` | no   | `DRAFT`             |                                                                                                                |
| `created_at`        | timestamptz    | no   | `now()`             |                                                                                                                |
| `updated_at`        | timestamptz    | no   | `now()`             | `brands_set_updated_at`                                                                                        |
| `template_store_id` | uuid           | yes  |                     | unique; references `stores (id)` on delete set null: the brand template (P3.1); set by `ensure_brand_template` |

### store_memberships

Who works at which store (ADR-001; `20261111123222_store_memberships.sql`). A row is a `STAFF` or `MANAGER` at one
store. The brand's owner has **no row**: `brands.owner_id` makes them OWNER of every store of the brand, so the last
owner cannot be removed by construction. What each role may do: [PERMISSIONS.md](PERMISSIONS.md#store-roles). The
memberships migration backfilled every `profiles.role = 'STAFF'` account as a `STAFF` member of the oldest store; `20261112140000_multi_store_contract.sql` then made those profiles `CUSTOMER`.

| Column       | Type         | Null | Default             | Notes                                                  |
| ------------ | ------------ | ---- | ------------------- | ------------------------------------------------------ |
| `id`         | uuid         | no   | `gen_random_uuid()` | primary key                                            |
| `user_id`    | uuid         | no   |                     | references `profiles (id)` on delete cascade           |
| `store_id`   | uuid         | no   |                     | references `stores (id)` on delete cascade; indexed    |
| `role`       | `store_role` | no   |                     |                                                        |
| `created_at` | timestamptz  | no   | `now()`             |                                                        |
| `created_by` | uuid         | yes  |                     | references `profiles (id)` on delete set null; indexed |

`unique (user_id, store_id)`: one role per person per store. Audited by `store_memberships_audit`
(`membership.changed`: `user_id`, `store_id`, `role`).

### store_invites

An open invitation to join a store's team (`20261112083000_store_invites.sql`). The API creates one with a random token
and keeps only the token's sha-256 (`token_hash`). `accept_store_invite` turns it into a `store_memberships` row.
Nothing but the API (secret key) reads or writes it. Who may invite and remove: [PERMISSIONS.md](PERMISSIONS.md#team-invites-and-removals).

| Column        | Type         | Null | Default             | Notes                                                                             |
| ------------- | ------------ | ---- | ------------------- | --------------------------------------------------------------------------------- |
| `id`          | uuid         | no   | `gen_random_uuid()` | primary key                                                                       |
| `store_id`    | uuid         | no   |                     | references `stores (id)` on delete cascade; indexed                               |
| `role`        | `store_role` | no   |                     |                                                                                   |
| `email`       | text         | no   |                     | the account that may accept it; CHECK `email = lower(email)` and 3–320 characters |
| `token_hash`  | text         | no   |                     | unique; never audited                                                             |
| `expires_at`  | timestamptz  | no   |                     | the API sets now + `INVITE_EXPIRY_DAYS` (7)                                       |
| `accepted_at` | timestamptz  | yes  |                     |                                                                                   |
| `accepted_by` | uuid         | yes  |                     | references `profiles (id)` on delete set null; indexed                            |
| `revoked_at`  | timestamptz  | yes  |                     |                                                                                   |
| `created_by`  | uuid         | yes  |                     | references `profiles (id)` on delete set null; indexed                            |
| `created_at`  | timestamptz  | no   | `now()`             |                                                                                   |

Table CHECKs: `expires_at > created_at`, and `accepted_at is null or revoked_at is null` (never both). The partial
unique index `store_invites_open_email_key` on `(store_id, email) where accepted_at is null and revoked_at is null`
allows one open invite per email per store, so a second is 409 `MEMBERSHIP_EXISTS`. An expired invite still counts as
open there, so the API revokes a store's expired invites for that email before it inserts. RLS is on and all privileges
are revoked from `anon` and `authenticated`. Audited by `store_invites_audit` (`invite.changed`: `role`, `email`,
`accepted_at`, `revoked_at`; never `token_hash`).

### stores

Five rows in the demo seed: Campus Cafe, two branches of Brew Lane, and each brand's template (`DRAFT`, never public).

| Column                            | Type           | Null | Default             | Notes                                                                                                                                               |
| --------------------------------- | -------------- | ---- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                              | uuid           | no   | `gen_random_uuid()` | primary key                                                                                                                                         |
| `name`                            | text           | no   |                     |                                                                                                                                                     |
| `brand_id`                        | uuid           | no   |                     | references `brands (id)`; indexed (`stores_brand_id_idx`)                                                                                           |
| `slug`                            | text           | no   |                     | unique; same pattern as `brands.slug`                                                                                                               |
| `status`                          | `store_status` | no   | `ACTIVE`            |                                                                                                                                                     |
| `timezone`                        | text           | no   | `Asia/Kolkata`      |                                                                                                                                                     |
| `area`                            | text           | yes  |                     | the neighbourhood a customer filters by                                                                                                             |
| `address_line`                    | text           | yes  |                     | `StoreDto.address`                                                                                                                                  |
| `contact_phone`                   | text           | yes  |                     |                                                                                                                                                     |
| `tagline`                         | text           | no   |                     |                                                                                                                                                     |
| `description`                     | text           | no   |                     |                                                                                                                                                     |
| `image_url`                       | text           | yes  |                     |                                                                                                                                                     |
| `is_open`                         | boolean        | no   | `true`              | false makes `POST /orders` return `STORE_CLOSED`                                                                                                    |
| `prep_time_min_minutes`           | integer        | no   | `10`                |                                                                                                                                                     |
| `prep_time_max_minutes`           | integer        | no   | `15`                | drives `orders.estimated_ready_at`                                                                                                                  |
| `max_quantity_per_item`           | integer        | no   | `10`                | store setting; check 1–50; most of one item per order                                                                                               |
| `low_stock_threshold`             | integer        | no   | `5`                 | store setting; check 0–50; "only N left" at or below it                                                                                             |
| `staff_order_list_limit`          | integer        | no   | `100`               | store setting; check 1–500; finished orders on the board                                                                                            |
| `last_order_minutes_before_close` | integer        | no   | `0`                 | store setting; check 0–240; stored only until P2 PR 06                                                                                              |
| `staff_can_edit_stock`            | boolean        | no   | `true`              | store setting; whether STAFF hold `stock.update` here; not copied to a new branch                                                                   |
| `created_at`                      | timestamptz    | no   | `now()`             |                                                                                                                                                     |
| `updated_at`                      | timestamptz    | no   | `now()`             | `stores_set_updated_at`                                                                                                                             |
| `accepting_orders`                | boolean        | no   | `true`              | false = paused; see `pause_store`                                                                                                                   |
| `paused_until`                    | timestamptz    | yes  |                     | when the pause ends; null while paused = until resumed                                                                                              |
| `pause_reason`                    | text           | yes  |                     | check: at most 120 characters                                                                                                                       |
| `paused_by`                       | uuid           | yes  |                     | FK `profiles(id)`, on delete set null; `stores_paused_by_idx`                                                                                       |
| `is_template`                     | boolean        | no   | `false`             | the brand template; check `stores_template_is_draft`: a template is always `DRAFT`; one per brand (`stores_one_template_per_brand`, partial unique) |

**Profile checks and publishing** (P3.1 PR 01b; `20261112173552_store_publish.sql`). `stores_name_length` (2–80
characters; 80 like `brands.name`, since a template takes its brand's name), `stores_address_line_length` (1–200) and
`stores_contact_phone_format` (`^\+?[0-9]{10,15}$`) mirror `LIMITS.store`. `stores_emit_changed()` (trigger
`stores_changed`, after update of `name`, `tagline`, `description`, `area`, `address_line`, `contact_phone`, `status`,
each row; no `EXECUTE` for anyone) emits `store.changed` (aggregate `store`, payload `{ fields, status }`: the changed
column names, sorted, never their values) when an update really changes one of them, so a profile edit, a publish, an
unpublish and an operator's status change in SQL each emit one, and a same-value write emits none.

`set_store_status(p_store_id, p_status, p_actor, p_request_id) returns text[]` (plpgsql, invoker, `service_role` only)
moves a store between `DRAFT` and `ACTIVE` under its row lock. Publishing returns what is missing among `address`
(non-blank `address_line`), `hours` (at least one `store_hours` row) and `menu` (at least one available, unarchived
item with `stock_quantity` null or above 0) and changes nothing when any is; otherwise it returns `{}`. The list comes
from `store_publish_missing(p_store_id)` (sql, stable, `service_role` only), which the manage screen also reads
(`GET /stores/:storeId/manage`), so the checklist an owner sees is the rule the publish applies. A store already
in `p_status` changes nothing and emits nothing.

The menu editor's quick edits each take `lock_store_menu(p_store_id)` (`NOT_FOUND` for a missing store, then a
transaction advisory lock on the store's menu), so two on one store run one after the other and never deadlock;
`place_order` takes no such lock, though its stock update waits for an item row a quick edit is changing until that
edit commits. `reorder_menu(p_store_id, p_item_ids, p_actor, p_request_id)
returns void` sets each item's `sort_order` to its position in `p_item_ids` in one statement. The list must be every
unarchived item of the store, each once: an id that is not the store's item raises `NOT_FOUND`, any other mismatch
`VALIDATION_ERROR`, and nothing changes. `set_menu_availability(p_store_id, p_is_available, p_item_ids, p_category,
p_actor, p_request_id) returns integer` switches the listed items or a category's unarchived items on or off in one
statement and returns how many it covered; a list naming anything else, or a category with none, is `NOT_FOUND`. All
three are plpgsql, invoker, `service_role` only. `menu_items_changed_on_update` emits the one `menu.changed`; an edit
that changes nothing emits none.

`adjust_stock(p_store_id, p_menu_item_id, p_set, p_delta, p_untracked, p_reason, p_actor, p_request_id) returns
integer` changes one unarchived item's stock by exactly one of `p_set` (N available now), `p_delta` (±n) or
`p_untracked` (stop counting), anything else `VALIDATION_ERROR`. `p_reason` defaults to `MANUAL_SET` (set, untracked)
or `MANUAL_ADJUST`; `WASTE` must be a negative delta. It locks the item's row first, so it and `place_order`'s
conditional update queue on it: a delta that would go below zero raises `INSUFFICIENT_STOCK` (`detail`: `menuItemId`,
`name`, `available`), a delta on an untracked item `STOCK_UNTRACKED`, another store's or an archived item `NOT_FOUND`.
A real change writes one `stock_movements` row (the actor's id from `p_actor`) and emits one `menu.changed` itself
(the statement trigger ignores stock); a change that leaves the stock as it was writes and emits nothing. Returns the
stock afterwards (`null`: untracked). plpgsql, invoker, `service_role` only.

| Message                     | When                                                               |
| --------------------------- | ------------------------------------------------------------------ |
| `NOT_FOUND`                 | unknown store, or a template                                       |
| `INVALID_STATUS_TRANSITION` | the store is `SUSPENDED` or `ARCHIVED` (only an operator moves it) |
| `VALIDATION_ERROR`          | `p_status` is not `ACTIVE` or `DRAFT`                              |

**The brand template** (P3.1, ADR-001 as amended) is one store row per brand that is never public: `is_template`, kept
`DRAFT` by its check constraint, so the public reads and `place_order` already refuse it. Its menu and settings live in
the same tables as any store's. A new branch is a copy of it (`create_store_from_template`); each copied item keeps
`menu_items.template_item_id`. Hours are never copied. Only the brand's owner reaches a template, and only for settings,
its menu and the audit trail ([PERMISSIONS.md](PERMISSIONS.md#store-roles)).

`ensure_brand_template(p_brand_id, p_actor, p_request_id) returns uuid` (plpgsql, invoker, `service_role` only;
`20261112144103_brand_template.sql`) returns the brand's template, making it on the first call from the brand's oldest
store: the store row `<brand slug>-template` (with an 8-character suffix from the brand id when that slug is taken) with that store's settings, prep times and timezone, its unarchived items with no stock and available, and lineage set on that store's items. Other existing stores get none: lineage comes only from a real copy, never a guess by name. A brand with no store gets an empty template on the column defaults. It emits `store.created` (`{ brandId, isTemplate: true }`);
a repeat returns the same id and emits nothing; an unknown brand raises `NOT_FOUND`. The migration ran it for every
existing brand; the seed runs it after a brand's first store.

`create_store_from_template(p_brand_id, p_name, p_slug, p_area, p_address_line, p_actor, p_request_id) returns uuid`
(same kind) inserts a `DRAFT` store with the template's settings, prep times, timezone, tagline, description and
photo, copies the template's unarchived items with `template_item_id` set, and emits `store.created`
(`{ brandId, templateStoreId }`). A taken slug fails the whole call (`23505`), leaving nothing behind. The seed opens
each brand's later branches with it.

`push_template_items(p_brand_id, p_template_item_ids uuid[], p_store_ids uuid[], p_fields text[], p_actor, p_request_id)
returns integer` (same kind) is the template push (P3.1, D2). Every item must be a live item of the brand's template and
every store one of its live branches (`DRAFT` or `ACTIVE`; never the template), or it raises `NOT_FOUND` and nothing changes; fields are a
subset of `name`, `description`, `price`, `category`, `diet` and `photo` (`image_url` and `image_variants`), else
`VALIDATION_ERROR`. A branch's live copy, found by `template_item_id` (a renamed copy still matches), gets the chosen
fields; a branch with no live copy gets a whole new one at the end of its menu, untracked. Stock, availability, sort
order and popularity of an existing copy are never touched, and a copy that already matches in every chosen field is
not written. The template is read from `brands.template_store_id`, and its chosen items are locked (`for update`): a
second push of the same items waits, then sees the copies made here (no duplicates), and an archive of one waits too. The update and the insert are one statement each, so
`menu_items_emit_changed` emits one `menu.changed` per changed store and every audit row carries the push's request
id. Returns the copies changed or created (0 for a push that changed nothing, which leaves no event and no audit row).

The store settings are edited through `PATCH /api/stores/:storeId/settings` ([API.md](API.md#patch-storesstoreidsettings)); their bounds are
the check constraints (`stores_<column>_check`), mirrored by `STORE_SETTING_BOUNDS`. A new store takes the constant defaults
(no insert trigger); the migration copied each existing store's `staff_order_list_limit` from `site_settings` once, writing no audit rows.
Audited by `stores_settings_audit` (`store_settings.changed`), apart from `stores_audit`.

A pause is `accepting_orders = false` and `paused_until` in the future or null; it is derived, so a pause whose
`paused_until` has passed no longer refuses orders and nothing has to clear it. `pause_store(p_store_id, p_until default
null, p_reason default null, p_actor, p_request_id, p_now default now())` (plpgsql, invoker, `service_role` only) sets
the columns and `paused_by` (the actor's id) and emits `store.paused` (`{ pausedUntil }`; the reason stays out of the
event); a `p_until` not after `p_now` raises `VALIDATION_ERROR`, an unknown store `NOT_FOUND`; the same pause again
(same end and reason) returns false and emits nothing. `resume_store(p_store_id, p_actor, p_request_id, p_now default
now())` (same kind) clears the four columns and emits `store.resumed` (`{}`); a store not paused returns false, and a
pause that already ran out is cleared without an event. Both return a boolean (changed).

### store_hours

Weekly opening intervals of a store, several a day. `day_of_week` is ISO (1 = Monday); `closes_at` before `opens_at`
means the interval runs past midnight into the next day; `opens_at <> closes_at` and both are before 24:00 (checks).
Index `(store_id, day_of_week)`. No rows means "open all day": the manual `stores.is_open` switch decides. Written only by
`set_store_hours(p_store_id, p_hours, p_actor, p_request_id)` (security definer, `service_role` only): it replaces the week in
one transaction, refuses overlapping intervals (overnight and Sunday-into-Monday included) with `P0001`
`VALIDATION_ERROR`, writes one `store_hours.changed` audit row (`changes.week` = `[old, new]`) and emits
`store.hours_changed`; an unchanged week returns false and writes neither. The per-row audit trigger is dropped.

### store_schedule_exceptions

Date ranges (`starts_on` to `ends_on`, store-local dates) that replace the week: `kind` `CLOSED` (no times) or
`SPECIAL_HOURS` (both times, same checks as `store_hours`), with a `label` of 2 to 60 characters ("Diwali"). A `CLOSED`
exception beats `SPECIAL_HOURS` on the same day. Index `(store_id, ends_on, starts_on)`. The rule that reads both is
[ARCHITECTURE.md](ARCHITECTURE.md#44-the-open-state).

### menu_items

| Column             | Type          | Null | Default             | Constraints                                                                                                                                            |
| ------------------ | ------------- | ---- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`               | uuid          | no   | `gen_random_uuid()` | primary key                                                                                                                                            |
| `store_id`         | uuid          | no   |                     | references `stores (id)`                                                                                                                               |
| `category`         | text          | no   |                     | 1–40 characters (`menu_items_category_length`)                                                                                                         |
| `name`             | text          | no   |                     | 2–80 characters (`menu_items_name_length`); not unique within a store                                                                                  |
| `description`      | text          | no   |                     | at most 300 characters (`menu_items_description_length`)                                                                                               |
| `price_paise`      | bigint        | no   |                     | `> 0` (`menu_items_price_paise_check`), `<= 10000000` (`menu_items_price_paise_max`), `% 100 = 0`; the price in paise                                  |
| `image_url`        | text          | yes  |                     | `null`: no photo yet                                                                                                                                   |
| `image_variants`   | jsonb         | yes  |                     | `{ "400": url, "900": url }`, written by the image pipeline (P3 PR 10)                                                                                 |
| `diet`             | `diet_marker` | yes  |                     | `VEG`, `NON_VEG` or `EGG`; `null`: not marked                                                                                                          |
| `is_available`     | boolean       | no   | `true`              |                                                                                                                                                        |
| `is_popular`       | boolean       | no   | `false`             |                                                                                                                                                        |
| `sort_order`       | integer       | no   | `0`                 |                                                                                                                                                        |
| `stock_quantity`   | integer       | yes  |                     | `check (stock_quantity >= 0)`; `null` = not tracked                                                                                                    |
| `template_item_id` | uuid          | yes  |                     | references `menu_items (id)` on delete set null; the template item it was copied from; `menu_items_template_item_id_idx`                               |
| `archived_at`      | timestamptz   | yes  |                     | set by `DELETE /api/stores/:storeId/menu-items/:itemId`; off the public menu and never copied; `menu_items_archived_unavailable` keeps it switched off |

`stock_quantity` is decremented by `place_order` and restored when an order is cancelled, by what the order's lines
reserved (`order_items.reserved_quantity`), not by what they ordered.
Any other change goes through `adjust_stock` (below), which writes a `stock_movements` row.

### stock_movements

Every stock change made by hand (P3.4, P3.5), written only by `adjust_stock`. Sales and cancels are not here: an
order's lines record what they reserved. RLS enabled, no policies, revoked from `anon` and `authenticated`.

| Column               | Type         | Null | Default             | Notes                                                                 |
| -------------------- | ------------ | ---- | ------------------- | --------------------------------------------------------------------- |
| `id`                 | bigint       | no   | identity            | primary key                                                           |
| `store_id`           | uuid         | no   |                     | references `stores (id)`                                              |
| `menu_item_id`       | uuid         | no   |                     | references `menu_items (id)`                                          |
| `delta`              | integer      | yes  |                     | units added (negative: removed); `null` when tracking starts or stops |
| `resulting_quantity` | integer      | yes  |                     | the stock after the change; `null` = no longer tracked                |
| `reason`             | stock_reason | no   |                     | `MANUAL_SET`, `MANUAL_ADJUST` or `WASTE`                              |
| `actor_id`           | uuid         | yes  |                     | references `profiles (id)` on delete set null; who made it            |
| `created_at`         | timestamptz  | no   | `clock_timestamp()` | when the row is written (it may wait on the item lock)                |

### media_uploads

One row per photo a store's manager or owner uploads (P3.3). The API makes the row and the storage key
(`original_key`, `stores/<store id>/uploads/<upload id>.<jpg|png|webp>`, unique), never the client. `status` is
`PENDING` (started), `UPLOADED` (the bytes are in storage at the declared size), then `PROCESSED` or `FAILED` (the image
pipeline fills `variants`, an array of `{ width, height, key }`, or `failure`, and `processed_at`). `content_type` is `image/jpeg`, `image/png` or
`image/webp`, `byte_size` 1 to 8 MB (CHECK constraints, mirrored by `MEDIA_UPLOAD`). `created_by` →
`profiles` on delete set null. Indexes `(status, created_at)` and `(store_id, created_at desc)`. RLS on, revoked from
`anon` and `authenticated`; read and written only by `media.service.ts` (`TABLE_OWNERS`).

`complete_media_upload(p_store_id, p_upload_id, p_actor, p_request_id) returns boolean` (plpgsql, invoker,
`service_role` only) moves one of the store's uploads from `PENDING` to `UPLOADED` under its row lock and emits
`media.uploaded` (`{ key, contentType, byteSize }`); another store's or an unknown one is `NOT_FOUND`; one already past
`PENDING` changes nothing, emits nothing and returns false.

`finish_media_upload(p_upload_id, p_status, p_variants, p_failure, p_actor, p_request_id) returns boolean` (plpgsql,
invoker, `service_role` only; the worker's `media.service.finishUpload`, actor `{ type: 'WORKER' }`) moves an
`UPLOADED` upload to `PROCESSED` with `variants` (a JSON array) or to `FAILED` with `failure` (cut to 500 characters),
sets `processed_at`, and emits `media.processed` (`{ variants }`) or `media.failed` (`{ failure }`); any other status
or a missing variants array or reason is `VALIDATION_ERROR`, an unknown upload `NOT_FOUND`, and an upload not
`UPLOADED` changes nothing, emits nothing and returns false.

`media_upload_shown(p_upload_id) returns boolean` (sql, stable, invoker, `service_role` only): whether a
`menu_items` row (`image_url` or `image_variants`) or an `order_items.image_url` shows one of the upload's variants; the
sweep's test, and its re-check just before it removes anything.

`media_sweep_candidates(p_now default now(), p_limit default 50) returns table (upload_id, original_key, remove_keys)`
(sql, stable, invoker, `service_role` only; the worker's nightly sweep, [JOBS.md](JOBS.md#media-events)): the uploads
the sweep may delete, oldest first, and for each the variant keys no upload that stays lists. A processed upload is a
candidate only when `media_upload_shown` is false; the partial index `order_items_media_image_idx` (`image_url like '/media/%'`) keeps the order check cheap.

### orders

| Column               | Type             | Null | Default             | Constraints                                                                                |
| -------------------- | ---------------- | ---- | ------------------- | ------------------------------------------------------------------------------------------ |
| `id`                 | uuid             | no   | `gen_random_uuid()` | primary key                                                                                |
| `order_number`       | integer          | no   | identity            | `generated always as identity (start with 1001)`, unique                                   |
| `user_id`            | uuid             | no   |                     | references `profiles (id)`                                                                 |
| `store_id`           | uuid             | no   |                     | references `stores (id)`                                                                   |
| `store_name`         | text             | no   |                     | snapshot of `stores.name` at order time                                                    |
| `customer_name`      | text             | no   |                     |                                                                                            |
| `customer_phone`     | text             | yes  |                     |                                                                                            |
| `note`               | text             | yes  |                     |                                                                                            |
| `total_paise`        | bigint           | no   |                     | computed in `place_order`; `>= 0`, `% 100 = 0`                                             |
| `payment_status`     | `payment_status` | no   | `PENDING`           |                                                                                            |
| `status`             | `order_status`   | no   | `PLACED`            |                                                                                            |
| `estimated_ready_at` | timestamptz      | no   |                     |                                                                                            |
| `created_at`         | timestamptz      | no   | `now()`             |                                                                                            |
| `updated_at`         | timestamptz      | no   | `now()`             | set on every update by `orders_set_updated_at`                                             |
| `idempotency_key`    | uuid             | yes  |                     | the client's per-attempt key; unique per `user_id` when set ([API.md](API.md#post-orders)) |

### order_items

| Column              | Type    | Null | Default             | Constraints                                                                                                                                                                                                                                                                                                           |
| ------------------- | ------- | ---- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | uuid    | no   | `gen_random_uuid()` | primary key                                                                                                                                                                                                                                                                                                           |
| `order_id`          | uuid    | no   |                     | references `orders (id)` on delete cascade                                                                                                                                                                                                                                                                            |
| `line_number`       | integer | no   |                     | position in the cart; `unique (order_id, line_number)`                                                                                                                                                                                                                                                                |
| `menu_item_id`      | uuid    | no   |                     | references `menu_items (id)`                                                                                                                                                                                                                                                                                          |
| `name`              | text    | no   |                     | snapshot at order time                                                                                                                                                                                                                                                                                                |
| `unit_price_paise`  | bigint  | no   |                     | snapshot of `menu_items.price_paise`; `>= 0`, `% 100 = 0`                                                                                                                                                                                                                                                             |
| `quantity`          | integer | no   |                     | `check (quantity > 0)`                                                                                                                                                                                                                                                                                                |
| `line_total_paise`  | bigint  | no   |                     | `unit_price_paise * quantity`; `>= 0`, `% 100 = 0`                                                                                                                                                                                                                                                                    |
| `image_url`         | text    | yes  |                     | snapshot of `menu_items.image_url` at order time                                                                                                                                                                                                                                                                      |
| `category`          | text    | no   |                     | snapshot at order time; for analytics (P7.1), not sent                                                                                                                                                                                                                                                                |
| `reserved_quantity` | integer | no   | none                | what `place_order` took from stock for this line: `quantity`, or `0` for an item without a stock count; `check (reserved_quantity in (0, quantity))`. A cancel returns exactly this. No default: an insert from a `place_order` that predates the column fails and rolls back its stock change instead of recording 0 |

Foreign keys without an `on delete` clause (`menu_items.store_id`, `orders.user_id`, `orders.store_id`,
`order_items.menu_item_id`) block deleting a row that is still referenced. `pnpm run seed` wipes orders first for that
reason.

### site_settings

Added by `20260927094610_admin_settings_collected.sql`. A singleton: `id` is always `true`, so the primary key caps
the table at one row (the migration seeds it with `insert ... values (true)`). Edited only from the admin dashboard
(`GET`/`PATCH /api/admin/settings`, see [API.md](API.md#get-adminsettings)); read on every `GET /api/orders`
(`order.service.listOrders`) and by the public `GET /api/config` (`config.service`), which carries the poll intervals,
the minimum client version and `client_error_sample_percent` to anonymous clients: never add a private column here.

| Column                         | Type        | Null | Default   | Constraints                                                                                                                                                                 |
| ------------------------------ | ----------- | ---- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                           | boolean     | no   | `true`    | primary key; `check (id)` — only `true` can ever be stored                                                                                                                  |
| `customer_order_history_limit` | integer     | no   | `20`      | `check (customer_order_history_limit between 1 and 200)`                                                                                                                    |
| `min_client_version`           | text        | no   | `'0.0.0'` | `check (min_client_version ~ '^\d+\.\d+\.\d+$')`; the oldest client the API serves (older: 426 `CLIENT_OUTDATED`); added by `20260927222002_min_client_version.sql`         |
| `max_lines_per_order`          | integer     | no   | `30`      | `check (max_lines_per_order between 1 and 100)`; most lines one order may have; added by `20260928180445_site_settings_config.sql`                                          |
| `order_poll_ms`                | integer     | no   | `4000`    | `check (order_poll_ms between 2000 and 60000)`; how often an open order's page polls                                                                                        |
| `orders_poll_ms`               | integer     | no   | `8000`    | `check (orders_poll_ms between 2000 and 60000)`; how often the customer's order list polls                                                                                  |
| `staff_board_poll_ms`          | integer     | no   | `4000`    | `check (staff_board_poll_ms between 2000 and 60000)`; how often the staff board polls                                                                                       |
| `client_error_sample_percent`  | integer     | no   | `100`     | `check (client_error_sample_percent between 0 and 100)`; the share of page loads whose errors the client reports; added by `20261102183749_client_error_sample_percent.sql` |
| `updated_at`                   | timestamptz | no   | `now()`   | set on every update by `site_settings_set_updated_at`                                                                                                                       |
| `updated_by`                   | uuid        | yes  |           | references `profiles (id)` on delete **set null** — never cascade: deleting the admin who last saved must never delete the settings row                                     |

Every column but `id` and `updated_*` is editable. The per-item quantity cap (`MAX_QUANTITY_PER_ITEM = 10` in
`server/src/schemas/order.schema.ts`) is a fixed constant, not a site setting (see [API.md](API.md#post-orders)).

### domain_events

The outbox's event log, written only by `emit_event` and kept 30 days (`purge_domain_events`). See
[JOBS.md](JOBS.md#the-outbox).

| Column           | Type        | Null | Default             | Notes                                                |
| ---------------- | ----------- | ---- | ------------------- | ---------------------------------------------------- |
| `id`             | uuid        | no   | `gen_random_uuid()` | primary key; the message's `eventId`                 |
| `type`           | text        | no   |                     | `order.ready`; the family is the part before the dot |
| `aggregate_type` | text        | no   |                     | `order`                                              |
| `aggregate_id`   | uuid        | no   |                     | no foreign key: it may name a row of any table       |
| `store_id`       | uuid        | yes  |                     | references `stores (id)`                             |
| `payload`        | jsonb       | no   |                     | ids and statuses only, never an amount               |
| `actor`          | jsonb       | yes  |                     | `{ type, id }` of who caused it                      |
| `request_id`     | text        | yes  |                     | the API request that caused it                       |
| `occurred_at`    | timestamptz | no   | `now()`             |                                                      |

### event_subscriptions

Which queues get which events: `event_type` is an exact type (`order.ready`) or a family (`order.*`). Primary key
`(event_type, queue_name)`. Rows are added by the migration that creates their queue.

### job_failures

Dead letters, written by `queue_dead_letter` (`20261024192953_queue_wrappers.sql`).

| Column        | Type        | Null | Default  | Notes                                           |
| ------------- | ----------- | ---- | -------- | ----------------------------------------------- |
| `id`          | bigint      | no   | identity | primary key                                     |
| `queue_name`  | text        | no   |          |                                                 |
| `message`     | jsonb       | no   |          | the queue message as it was read                |
| `attempts`    | integer     | no   |          | reads before it was given up                    |
| `last_error`  | text        | no   |          |                                                 |
| `failed_at`   | timestamptz | no   | `now()`  |                                                 |
| `resolved_at` | timestamptz | yes  |          | set by the operator who replays or dismisses it |
| `resolved_by` | uuid        | yes  |          | references `profiles (id)` on delete set null   |

### audit_log

Who changed what: the business record, kept 13 months (the retention job is P9.5). Written only by
`audit_row_change()`, never by the API; append-only (see [Row-level security and grants](#row-level-security-and-grants)).
No foreign keys: deleting a profile must not touch its rows. Read by admins through [`GET /api/admin/audit`](API.md#get-adminaudit), keyset-paged on `id`. The P9.5
retention purge needs a sanctioned way past the append-only triggers, never a dropped trigger. `site_settings` is
audited with `*`, so it never holds a secret: every column it gains is copied here for 13 months.

| Column        | Type         | Null | Default  | Notes                                                                                                                |
| ------------- | ------------ | ---- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `id`          | bigint       | no   | identity | primary key                                                                                                          |
| `occurred_at` | timestamptz  | no   | `now()`  | the transaction's start                                                                                              |
| `actor_type`  | `actor_type` | no   |          | `USER` for a signed-in caller, `SYSTEM` for the SQL editor, the seed, a migration                                    |
| `actor_id`    | uuid         | yes  |          | `profiles.id` for `USER`                                                                                             |
| `actor_role`  | text         | yes  |          | the actor's role at the time                                                                                         |
| `store_id`    | uuid         | yes  |          | the row's `store_id`, or a `stores` row's own `id`                                                                   |
| `action`      | text         | no   |          | `site_settings.changed`, `order.status_changed`, `profile.role_changed`, `menu_item.changed`, `feature_flag.changed` |
| `entity_type` | text         | no   |          | the action's first part: `site_settings`, `order`, `profile`, `menu_item`, `feature_flag`, `invite`                  |
| `entity_id`   | text         | no   |          | the row's `id` as text (`true` for `site_settings`), or its `key` for `feature_flags`                                |
| `changes`     | jsonb        | yes  |          | `{ column: [old, new] }`, the watched columns that changed                                                           |
| `reason`      | text         | yes  |          | unused until a transition takes a reason                                                                             |
| `request_id`  | text         | yes  |          | the API request behind it                                                                                            |

### feature_flags

Added by `20261102110856_feature_flags.sql`. One row per flag, evaluated by the API (`flags.service.isEnabled`) and
read through the server read cache. No rows yet: each flag ships in the migration of the phase that uses it. Flipped
by an admin through [`PATCH /api/admin/flags/:key`](API.md#patch-adminflagskey); every change is audited with `*`.

| Column           | Type        | Null | Default | Constraints                                                                                                                                             |
| ---------------- | ----------- | ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`            | text        | no   |         | primary key; `check (key ~ '^[a-z][a-z0-9_]{2,63}$')`                                                                                                   |
| `description`    | text        | no   |         | what the flag turns on                                                                                                                                  |
| `enabled`        | boolean     | no   | `false` | off means off for everyone, whatever the rules                                                                                                          |
| `client_visible` | boolean     | no   | `false` | served to the client through `GET /api/config` (P1 PR 14)                                                                                               |
| `rules`          | jsonb       | no   | `'{}'`  | `{ storeIds?, roles?, percent? }`, each optional; a rule that does not parse (`flagRulesSchema`, strict) turns the flag off, logged once per cache load |
| `updated_at`     | timestamptz | no   | `now()` | set on every update by `feature_flags_set_updated_at`                                                                                                   |
| `updated_by`     | uuid        | yes  |         | references `profiles (id)` on delete set null; the admin who last flipped it                                                                            |

Evaluation, in order: `enabled`; then `storeIds` (the caller's store must be listed); then `roles`; then `percent`, a
stable share of signed-in users (`sha256(key + ':' + userId)`, first four bytes, mod 100; no user is never in it). No
index on `updated_by`: nothing filters on it, and the whole table is read at once.

### session_activity

When each sign-in was last used, for the server-side idle sign-out ([PERMISSIONS.md](PERMISSIONS.md#session-lifetime)).
One row per Supabase Auth session, written only by `touch_session`; a row is purged nightly once its `auth.sessions` row is gone.

| Column         | Type        | Null | Default | Notes                                                       |
| -------------- | ----------- | ---- | ------- | ----------------------------------------------------------- |
| `session_id`   | uuid        | no   |         | primary key; the access token's `session_id` claim          |
| `user_id`      | uuid        | no   |         | references `profiles (id)` on delete cascade                |
| `last_seen_at` | timestamptz | no   |         | the last recorded use (at most every 5 min per API process) |

## Indexes

| Index                                   | Columns                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `brands_owner_id_idx`                   | `brands (owner_id)`                                                                         |
| `store_memberships_store_id_idx`        | `store_memberships (store_id)`, the team list                                               |
| `store_memberships_created_by_idx`      | `store_memberships (created_by)`                                                            |
| `stock_movements_item_time_idx`         | `stock_movements (menu_item_id, created_at desc)`, an item's trail                          |
| `stock_movements_store_time_idx`        | `stock_movements (store_id, created_at desc)`, the store's trail                            |
| `store_invites_open_email_key`          | unique `store_invites (store_id, email)` where `accepted_at is null and revoked_at is null` |
| `store_invites_store_id_idx`            | `store_invites (store_id)`                                                                  |
| `store_invites_created_by_idx`          | `store_invites (created_by)`                                                                |
| `store_invites_accepted_by_idx`         | `store_invites (accepted_by)`                                                               |
| `stores_brand_id_idx`                   | `stores (brand_id)`                                                                         |
| `menu_items_store_id_category_idx`      | `menu_items (store_id, category)`                                                           |
| `orders_user_id_created_at_idx`         | `orders (user_id, created_at)`                                                              |
| `orders_status_created_at_idx`          | `orders (status, created_at)`                                                               |
| `orders_store_id_status_created_at_idx` | `orders (store_id, status, created_at desc)`: one store's board (P2.3)                      |
| `order_items_menu_item_id_idx`          | `order_items (menu_item_id)`                                                                |
| `orders_user_id_idempotency_key_idx`    | `orders (user_id, idempotency_key)`, unique, `where idempotency_key is not null`            |
| `domain_events_aggregate_idx`           | `domain_events (aggregate_type, aggregate_id, occurred_at)`                                 |
| `audit_log_entity_idx`                  | `audit_log (entity_type, entity_id, id desc)`                                               |
| `audit_log_entity_type_idx`             | `audit_log (entity_type, id desc)`                                                          |
| `audit_log_store_idx`                   | `audit_log (store_id, id desc)`                                                             |
| `audit_log_actor_idx`                   | `audit_log (actor_id, id desc)`                                                             |
| `session_activity_user_id_idx`          | `session_activity (user_id)`, for the cascade from `profiles`                               |
| unique constraint                       | `order_items (order_id, line_number)`                                                       |
| unique constraint                       | `profiles (email)`, `orders (order_number)`, `store_memberships (user_id, store_id)`        |

`site_settings` has no indexes on purpose (one row), including on `updated_by`. `session_activity.last_seen_at` has
none either: the API moves it every few minutes per session, and an index would cost each of those updates an index
write for one small nightly scan.

## Triggers

| Trigger                                                        | On                                                                                                                                                                                                                                                             | Function                                                                                                                                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orders_set_updated_at`                                        | before update on `orders`, each row                                                                                                                                                                                                                            | `set_updated_at()`                                                                                                                                                                                        |
| `site_settings_set_updated_at`                                 | before update on `site_settings`, each row                                                                                                                                                                                                                     | `set_updated_at()`                                                                                                                                                                                        |
| `feature_flags_set_updated_at`                                 | before update on `feature_flags`, each row                                                                                                                                                                                                                     | `set_updated_at()`                                                                                                                                                                                        |
| `on_auth_user_created`                                         | after insert on `auth.users`                                                                                                                                                                                                                                   | `handle_new_user()`                                                                                                                                                                                       |
| `on_auth_user_email_changed`                                   | after update of `email` on `auth.users`, when the email changed                                                                                                                                                                                                | `handle_user_email_change()`                                                                                                                                                                              |
| `site_settings_audit`                                          | after update on `site_settings`, each row                                                                                                                                                                                                                      | `audit_row_change('site_settings.changed', '*')`                                                                                                                                                          |
| `orders_audit`                                                 | after update of `status` on `orders`, each row                                                                                                                                                                                                                 | `audit_row_change('order.status_changed', 'status')`                                                                                                                                                      |
| `profiles_audit`                                               | after update of `role` on `profiles`, each row                                                                                                                                                                                                                 | `audit_row_change('profile.role_changed', 'role')`                                                                                                                                                        |
| `menu_items_audit`                                             | after insert, or update of `name`, `price_paise`, `is_available`, `image_url`, `category`, `description`, `diet`, `archived_at`, `is_popular`, `sort_order` on `menu_items`, each row (never `stock_quantity`; not `image_variants`, derived from `image_url`) | `audit_row_change('menu_item.changed', <those columns>)`                                                                                                                                                  |
| `menu_items_changed_on_insert`, `menu_items_changed_on_update` | after insert / after update on `menu_items`, each statement (transition tables)                                                                                                                                                                                | `menu_items_emit_changed()`: one `menu.changed` (`store`, `{ itemIds }`) per store whose rows changed in more than `stock_quantity` or `template_item_id`; actor and request id as for `audit_row_change` |
| `brands_set_updated_at`                                        | before update on `brands`, each row                                                                                                                                                                                                                            | `set_updated_at()`                                                                                                                                                                                        |
| `stores_set_updated_at`                                        | before update on `stores`, each row                                                                                                                                                                                                                            | `set_updated_at()`                                                                                                                                                                                        |
| `brands_audit`                                                 | after update on `brands`, each row                                                                                                                                                                                                                             | `audit_row_change('brand.changed', '*')`                                                                                                                                                                  |
| `stores_changed`                                               | after update of `name`, `tagline`, `description`, `area`, `address_line`, `contact_phone`, `status` on `stores`, each row                                                                                                                                      | `stores_emit_changed()` (`store.changed` event)                                                                                                                                                           |
| `stores_settings_audit`                                        | after update of `max_quantity_per_item`, `low_stock_threshold`, `staff_order_list_limit`, `last_order_minutes_before_close`, `staff_can_edit_stock` on `stores`, each row                                                                                      | `audit_row_change('store_settings.changed', …)`                                                                                                                                                           |
| `store_schedule_exceptions_audit`                              | after insert, update or delete on `store_schedule_exceptions`, each row                                                                                                                                                                                        | `audit_row_change('schedule_exception.changed', …)`                                                                                                                                                       |
| `stores_audit`                                                 | after update of `name`, `slug`, `status`, `is_open`, `area`, `address_line`, `contact_phone`, `timezone`, `accepting_orders`, `paused_until`, `pause_reason`, `tagline`, `description` on `stores`, each row (its audit row has `store_id = stores.id`)        | `audit_row_change('store.changed', …)`                                                                                                                                                                    |
| `store_invites_audit`                                          | after insert or update or delete on `store_invites`, each row (`invite.changed`: `role`, `email`, `accepted_at`, `revoked_at`; never `token_hash`)                                                                                                             | `audit_row_change('invite.changed', 'role', 'email', 'accepted_at', 'revoked_at')`                                                                                                                        |
| `store_memberships_audit`                                      | after insert or update or delete on `store_memberships`, each row (`membership.changed`: `user_id`, `store_id`, `role`)                                                                                                                                        | `audit_row_change('membership.changed', 'user_id', 'store_id', 'role')`                                                                                                                                   |
| `feature_flags_audit`                                          | after update on `feature_flags`, each row                                                                                                                                                                                                                      | `audit_row_change('feature_flag.changed', '*')`                                                                                                                                                           |
| `audit_log_no_change`                                          | before update or delete on `audit_log`, each row                                                                                                                                                                                                               | `audit_log_append_only()`                                                                                                                                                                                 |
| `audit_log_no_truncate`                                        | before truncate on `audit_log`, each statement                                                                                                                                                                                                                 | `audit_log_append_only()`                                                                                                                                                                                 |

## Functions

All functions set `search_path = ''` and use schema-qualified names. Each call is one transaction, so a function that
raises leaves nothing behind. Expected failures are raised with `message` = an API error code and `detail` = a JSON
object (SQLSTATE `P0001`). How the API maps them is in [API.md](API.md#database-errors-p0001).

| Function                      | Language | Security | Returns             | Called by                                                                                                     | `EXECUTE` granted to |
| ----------------------------- | -------- | -------- | ------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------- |
| `set_updated_at()`            | plpgsql  | invoker  | trigger             | `orders_set_updated_at`, `site_settings_set_updated_at`, `feature_flags_set_updated_at`                       | nobody               |
| `handle_new_user()`           | plpgsql  | definer  | trigger             | `on_auth_user_created`                                                                                        | nobody               |
| `handle_user_email_change()`  | plpgsql  | definer  | trigger             | `on_auth_user_email_changed`                                                                                  | nobody               |
| `profile_name(text, text)`    | plpgsql  | invoker  | text                | `handle_new_user()`, `20261103173300_profile_name_bounds.sql`                                                 | nobody               |
| `profile_phone(text)`         | sql      | invoker  | text                | `handle_new_user()`, `20261103173300_profile_name_bounds.sql`                                                 | nobody               |
| `place_order(...)`            | plpgsql  | invoker  | uuid                | `order.service.createOrder`                                                                                   | `service_role`       |
| `update_order_status(...)`    | plpgsql  | invoker  | boolean             | `order.service.updateOrderStatus`                                                                             | `service_role`       |
| `reset_demo_orders()`         | sql      | definer  | void                | `server/scripts/seed.ts`                                                                                      | `service_role`       |
| `emit_event(...)`             | plpgsql  | definer  | uuid                | `place_order`, `update_order_status`, `accept_store_invite`, `menu_items_emit_changed`, `stores_emit_changed` | `service_role`       |
| `accept_store_invite(...)`    | plpgsql  | invoker  | `store_memberships` | `team.service.acceptInvite`                                                                                   | `service_role`       |
| `set_store_hours(...)`        | plpgsql  | definer  | boolean             | `storeHours.service.setStoreHours`                                                                            | `service_role`       |
| `lock_store_menu(...)`        | plpgsql  | invoker  | void                | `reorder_menu`, `set_menu_availability`                                                                       | `service_role`       |
| `reorder_menu(...)`           | plpgsql  | invoker  | void                | `menu.service.reorderMenu`                                                                                    | `service_role`       |
| `set_menu_availability(...)`  | plpgsql  | invoker  | integer             | `menu.service.setAvailability`                                                                                | `service_role`       |
| `adjust_stock(...)`           | plpgsql  | invoker  | integer             | `stock.service.adjustStock`                                                                                   | `service_role`       |
| `push_template_items(...)`    | plpgsql  | invoker  | integer             | `brand.service.pushTemplate`                                                                                  | `service_role`       |
| `set_store_status(...)`       | plpgsql  | invoker  | `text[]`            | `store.service.setStoreStatus`                                                                                | `service_role`       |
| `store_publish_missing(uuid)` | sql      | invoker  | `text[]`            | `store.service.getManagedStore`, `set_store_status`                                                           | `service_role`       |
| `media_upload_shown(...)`     | sql      | invoker  | boolean             | `media.service.uploadShown` (the sweep's re-check)                                                            | `service_role`       |
| `media_sweep_candidates(...)` | sql      | invoker  | table               | `media.service.sweepCandidates` (the worker's sweep)                                                          | `service_role`       |
| `finish_media_upload(...)`    | plpgsql  | invoker  | boolean             | `media.service.finishUpload` (the worker)                                                                     | `service_role`       |
| `complete_media_upload(...)`  | plpgsql  | invoker  | boolean             | `media.service.completeUpload`                                                                                | `service_role`       |
| `stores_emit_changed()`       | plpgsql  | invoker  | trigger             | `stores_changed`                                                                                              | nobody               |
| `pause_store(...)`            | plpgsql  | invoker  | boolean             | `storePause.service.pauseStore`                                                                               | `service_role`       |
| `resume_store(...)`           | plpgsql  | invoker  | boolean             | `storePause.service.resumeStore`                                                                              | `service_role`       |
| `queue_read(...)`             | plpgsql  | definer  | table               | the worker (P1 PR 03)                                                                                         | `service_role`       |
| `queue_delete(...)`           | sql      | definer  | boolean             | the worker                                                                                                    | `service_role`       |
| `queue_retry(...)`            | sql      | definer  | void                | the worker                                                                                                    | `service_role`       |
| `queue_dead_letter(...)`      | sql      | definer  | boolean             | the worker                                                                                                    | `service_role`       |
| `queue_metrics(text)`         | sql      | definer  | table               | the worker's health report                                                                                    | `service_role`       |
| `purge_domain_events(...)`    | sql      | invoker  | integer             | pg_cron `purge-domain-events`                                                                                 | `service_role`       |
| `audit_row_change()`          | plpgsql  | definer  | trigger             | the `*_audit` triggers                                                                                        | nobody               |
| `audit_log_append_only()`     | plpgsql  | invoker  | trigger             | `audit_log_no_change`, `_no_truncate`                                                                         | nobody               |

### set_updated_at

Sets `new.updated_at := now()` and returns `new`.

### handle_new_user

Inserts a `profiles` row for the new `auth.users` row: `id`, `email`, and

- `name` = [`profile_name`](#profile_name-and-profile_phone)(`raw_user_meta_data ->> 'name'`, email);
- `phone` = [`profile_phone`](#profile_name-and-profile_phone)(`raw_user_meta_data ->> 'phone'`).

`role` takes its default, `CUSTOMER`. The API passes name and phone as `user_metadata` in `auth.admin.createUser`.
A user created elsewhere (the dashboard) also gets a `CUSTOMER` profile, with the same bounds: the metadata is never
copied as it came. Direct sign-up with the publishable key is off (see
[PERMISSIONS.md](PERMISSIONS.md#sign-ups)).

### profile_name and profile_phone

Immutable helpers (`search_path = ''`, `EXECUTE` revoked from `public`, `anon` and `authenticated`) that hold the
API's rules once, for the trigger and for the clean-up in `20261103173300_profile_name_bounds.sql`.

- `profile_name(p_name, p_email)` (plpgsql): removes control characters from the name and trims it. A result shorter
  than 2 falls back to the email's local part, then to `'Customer'`; then it is cut to 60 (`LIMITS.nameMax`) and
  trimmed again. Lengths are UTF-16 units, as the API and the forms count them (an emoji is 2), and the cut never
  leaves half of a surrogate pair. The floor here is 1, not the API's 2: a one-letter local part is still a name.
  `profiles_name_length` counts the same units inline (a check calling a function would need `EXECUTE` for every
  role that writes `profiles`).
- `profile_phone(p_phone)`: removes spaces, dashes and brackets; returns the result when it is an optional `+` and 10
  to 15 digits (`phoneField`, `LIMITS.phoneDigits`), otherwise `null`.

The migration first rewrote legacy rows outside the bounds with these functions, then added the two checks on
`profiles`.

### handle_user_email_change

Copies the new email to `profiles.email` for that user.

### place_order

```sql
place_order(
  p_user_id uuid,
  p_store_id uuid,
  p_customer_name text,
  p_payment_status payment_status,
  p_lines jsonb,              -- [{ menu_item_id, name, quantity, unit_price_paise }] in cart order
  p_customer_phone text default null,
  p_note text default null,
  p_idempotency_key uuid default null, -- the client's per-attempt key (API.md "POST /orders")
  p_actor jsonb default null,          -- { type, id, role }: who asked (the controller's RequestContext)
  p_request_id text default null       -- the request's x-request-id
) returns uuid                -- the new order's id, or the id of the order this key already placed
```

The API has already checked every line and charged for it. The function prices them itself, from
`menu_items.price_paise`, and each line's `unit_price_paise` is the price the API charged: a line whose price has
changed since refuses the order (step 3), so nothing is stored at a price other than the one charged. A line without
`unit_price_paise` is refused the same way (PR 09 let it through for the pre-paise API, which no longer runs), and any
other key in a line (a rupee `unit_price`) is ignored.
It first sets `app.actor` and
`app.request_id` for the transaction (`set_config(..., true)`; PR 06's audit trigger reads them). Then:

0. With a `p_idempotency_key`: takes `pg_advisory_xact_lock` on a hash of `(user_id, key)` (held until the
   transaction ends, so two simultaneous repeats run one after the other), then returns the id of the order this
   user already placed under that key, if any, without touching stock. The partial unique index is the backstop.
1. Reads `stores.status`, `is_open`, `accepting_orders` and `paused_until` for `p_store_id` with `for share` (a pause,
   a close or a suspension waits for this order, or this order sees it). A missing store or one not `ACTIVE` raises
   `NOT_FOUND` (no detail); a store paused at `now()` (`accepting_orders` false and `paused_until` null or in the
   future) raises `STORE_PAUSED` with detail `{ storeId, pausedUntil }`; a closed one (`is_open` false) raises
   `STORE_CLOSED` with detail `{ storeId }`, in that order. The API checked all of this before charging; this settles
   a store that changed in between.
   Then loops over `p_lines` ordered by `menu_item_id`, so concurrent orders lock rows in the same order. For each
   line it runs `update menu_items set stock_quantity = stock_quantity - quantity where id = … and store_id = p_store_id and stock_quantity >= quantity`.
2. When no row was updated, it reads the item's `stock_quantity` and `is_available`:
   - row found with `is_available = false`: raises `ITEM_UNAVAILABLE` with detail `{ menuItemId, name, available: 0 }`
     (switched off is reported before too little stock, as the API's checks do);
   - row found with `null` stock: the item is not tracked, nothing to reserve;
   - otherwise (too few left, or the item does not exist or belongs to another store: the stock re-read and the pricing
     join in step 3 are limited to `store_id = p_store_id` too): raises `INSUFFICIENT_STOCK` with detail
     `{ menuItemId, name, available }`, where `available` is the stock left (0 when the item is missing).
3. Reads every line's `menu_items` row once (price, name, photo, category), so the total and the lines come from the
   same versions even if a price changes meanwhile. If any line's item has `is_available = false` (switched off after
   the API's check), raises `ITEM_UNAVAILABLE` with detail `{ menuItemId, name, available: 0 }` (the first in cart
   order). If any line's `unit_price_paise` is missing or differs from that read's `price_paise`, raises
   `PRICE_CHANGED` with detail `{ menuItemId, name, price }` (the first such line in cart order; `price` is the current price in rupees), which rolls back the stock reserved in step 1. Otherwise inserts the
   `orders` row: `total_paise = sum(price_paise * quantity)`, `status = 'PLACED'`,
   `payment_status = p_payment_status`, `estimated_ready_at = now() + stores.prep_time_max_minutes` minutes,
   `idempotency_key = p_idempotency_key`, and the snapshot `store_name = stores.name`.
4. Inserts one `order_items` row per line with `line_number` = the line's position in `p_lines` (1-based),
   `unit_price_paise = price_paise`, `line_total_paise = unit_price_paise * quantity`, and the snapshots `name`,
   `image_url` and `category`, all from that read. `reserved_quantity` is
   `quantity` for a line whose decrement in step 1 succeeded and `0` for an untracked item. It is decided in the
   step 1 loop, where tracked rows are locked, so an item that becomes tracked in between is not counted.
5. Calls `emit_event('order.placed', 'order', id, store_id, { orderNumber }, p_actor, p_request_id)`. An idempotent
   replay returns at step 0 and emits nothing.

The conditional decrement means two customers can never both get the last unit. The loser's `update` waits for the
winner's row lock, then re-checks and finds too little stock.

| Raises               | Detail                            |
| -------------------- | --------------------------------- |
| `INSUFFICIENT_STOCK` | `{ menuItemId, name, available }` |
| `PRICE_CHANGED`      | `{ menuItemId, name, price }`     |
| `ITEM_UNAVAILABLE`   | `{ menuItemId, name, available }` |
| `STORE_CLOSED`       | `{ storeId }`                     |
| `STORE_PAUSED`       | `{ storeId, pausedUntil }`        |
| `NOT_FOUND`          | none                              |

When several apply, the first in this order wins: `NOT_FOUND`, `STORE_PAUSED`, `STORE_CLOSED`, `ITEM_UNAVAILABLE`, `INSUFFICIENT_STOCK`,
`PRICE_CHANGED` (the order of the steps above; within the step 2 loop, lines are checked in `menu_item_id` order, so
an earlier line short of stock is reported before a later line switched off).

### update_order_status

```sql
update_order_status(
  p_order_id uuid,
  p_next_status order_status,
  p_from_statuses order_status[],  -- statuses allowed to move to p_next_status (from ALLOWED_TRANSITIONS)
  p_actor jsonb default null,      -- { type, id, role }
  p_request_id text default null   -- the request's x-request-id
) returns boolean                  -- true: the status changed; false: a repeat, nothing changed
```

It sets `app.actor` and `app.request_id` for the transaction (as `place_order` does), then:

1. Selects the order `for update` (a second request for it waits, then sees the first one's status). No order: raises
   `NOT_FOUND`.
2. When the order already has `p_next_status` and `p_from_statuses` is not empty (some transition leads there; never
   `PLACED`): returns `false`. No update, no stock change, no event.
3. When its status is not in `p_from_statuses`: raises `INVALID_STATUS_TRANSITION` with detail
   `{ orderNumber, status }` (the current status).
4. Updates the status. When `p_next_status = 'CANCELLED'`: adds back the summed `order_items.reserved_quantity` per
   menu item to `menu_items.stock_quantity`, only where `stock_quantity is not null`. An item that had no stock count
   when ordered reserved `0`, so tracking it later never creates stock on a cancel. A second cancel is a repeat
   (step 2), so stock is restored at most once.
5. Calls `emit_event('order.<status lower>', 'order', id, store_id, { orderNumber, from, to }, p_actor,
p_request_id)` and returns `true`.

The transition rules live in the API, not here. The function only enforces "the status is still one of these".

| Raises                      | Detail                    |
| --------------------------- | ------------------------- |
| `NOT_FOUND`                 | none                      |
| `INVALID_STATUS_TRANSITION` | `{ orderNumber, status }` |

### accept_store_invite

`accept_store_invite(p_token_hash, p_user_id, p_email, p_actor, p_request_id, p_now)` (security invoker, `EXECUTE` for
`service_role` only; `20261112093000_accept_store_invite.sql`) accepts an invite in one transaction and returns the
`store_memberships` row. It locks the invite by `token_hash`, inserts the membership (`created_by` is the inviter) and
sets `accepted_at` and `accepted_by`, then emits `store.member_joined` (`store_invite`, ids and the role only) with the
actor and request id. A repeat by the account that accepted it returns the membership and changes nothing. An existing
member with the same role consumes the invite; one with another role is refused, since an invite never changes a role.

| Message     | When                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NOT_FOUND` | every refusal, with no detail: unknown token, another account's email, expired, revoked, accepted by someone else, a member of another role (it stays open) |

### reset_demo_orders

`truncate public.order_items, public.orders restart identity`. The next order is #1001 again. `security definer`
because restarting the identity sequence needs its owner. Used only by the demo seed, which refuses to run against
production (see [DEPLOYMENT.md](DEPLOYMENT.md#seeding)).

### emit_event

```sql
emit_event(
  p_type text,              -- 'order.ready'
  p_aggregate_type text,    -- 'order'
  p_aggregate_id uuid,
  p_store_id uuid,
  p_payload jsonb,          -- ids and statuses only
  p_actor jsonb,            -- { type, id, role }
  p_request_id text
) returns uuid              -- the new domain_events id
```

Inserts the `domain_events` row, then `pgmq.send`s
`{ eventId, type, aggregateId, storeId, payload, actor, requestId, occurredAt }` once to each distinct queue
subscribed to `p_type` or to its family (`split_part(p_type, '.', 1) || '.*'`). It runs in the caller's transaction.
`security definer` because the queue tables belong to the migration's role, not to `service_role`.

### Queue wrappers

`security definer`, schema-qualified `pgmq.*` calls, the only way into the queues ([JOBS.md](JOBS.md)).

| Function                                                               | Does                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queue_read(p_queue, p_vt_seconds, p_qty, p_poll_seconds)`             | up to `p_qty` messages `(msg_id, read_ct, enqueued_at, message)`, each hidden for `p_vt_seconds`; waits up to `p_poll_seconds` for the first (`pgmq.read_with_poll`), `0` returns at once (`pgmq.read`) |
| `queue_delete(p_queue, p_msg_id)`                                      | deletes a handled message; `false` if it was already gone                                                                                                                                               |
| `queue_retry(p_queue, p_msg_id, p_delay_seconds)`                      | hides the message for `p_delay_seconds` more (`pgmq.set_vt`); its next read has `read_ct + 1`                                                                                                           |
| `queue_dead_letter(p_queue, p_msg_id, p_message, p_attempts, p_error)` | deletes the message and, only if it was still there, inserts a `job_failures` row and returns whether it did (a message another reader already handled is never dead-lettered)                          |
| `queue_metrics(p_queue)`                                               | `(queue_length, oldest_msg_age_sec)` from `pgmq.metrics`                                                                                                                                                |

### purge_domain_events

`purge_domain_events(p_now timestamptz default now(), p_keep interval default '30 days') returns integer` deletes
the events older than `p_now - p_keep` and returns how many. pg_cron runs it nightly at 21:17 UTC (02:47 IST) as job
`purge-domain-events`; tests pass `p_now` instead of back-dating rows.

### touch_session

`touch_session(p_session_id uuid, p_user_id uuid, p_idle interval, p_now timestamptz default now()) returns boolean`
records a use of a sign-in. A live session (one in `auth.sessions`) never seen (one signed in before the table
existed starts its clock here) or last seen within `p_idle` returns true and moves `last_seen_at` to `p_now` (never
backwards). One idle longer returns false and is left as it was, so it stays refused. A session gone from
`auth.sessions` (signed out, revoked or removed by Supabase Auth) returns false and writes nothing, row or no row: its
access token is valid for up to an hour after its refresh token dies, and once the purge drops its row it would
otherwise count as never seen. Security definer, because `auth.sessions` is readable by the owner (`postgres`) and not
by `service_role`. `requireAuth` passes `SESSION_IDLE_DAYS` as `p_idle` and revokes a refused session
([API.md](API.md#authentication)).

### purge_session_activity

`purge_session_activity() returns integer` deletes the rows whose session is no longer in `auth.sessions` (signed out,
revoked or cleaned up by Supabase Auth, so it can never be refreshed again) and returns how many. It never purges by
age: a live session without a row counts as never seen, so dropping a live session's row would accept its refresh token again
after any idle time. Security definer, because `auth.sessions` is readable by the owner (`postgres`) and not by
`service_role`. pg_cron runs it nightly at 21:27 UTC (02:57 IST) as job `purge-session-activity`.

### audit_row_change

The audit trigger (`20261101201251_audit_log.sql`). Its arguments are the action, then the watched columns, or `*` for
every column but `updated_at` and `updated_by`. It writes one `audit_log` row holding `{ column: [old, new] }` for the
watched columns that changed, and none when nothing watched changed (a save of the same values, a repeated
transition). The actor, first match wins:

1. `app.actor` / `app.request_id`, set by a transition function (`place_order`, `update_order_status`);
2. the `x-actor` / `x-request-id` headers of a table write through the Data API: PostgREST hands each request's headers
   to its transaction as `request.headers`, and `settings.service.updateSettings` and `flags.service.setFlag` set both. Only the secret key can
   write an audited table, so the browser cannot claim an actor;
3. otherwise `SYSTEM`, with no request id: the SQL editor, the seed, a migration.

`entity_id` is the row's `id`, or its `key` when the row has none (`feature_flags`; `20261102110856_feature_flags.sql`
redefines the function with `coalesce(id, key)`, same signature, so the revokes stay).

`store_id` is the row's `store_id`, or, for a `stores` row, its own `id` (`20261111094853_brands_and_stores.sql` redefines the function again, same signature).

`20261111123222_store_memberships.sql` redefines it once more (same signature) so inserts and deletes are audited too: an insert is recorded as `[null, value]` pairs and a delete as `[value, null]` pairs, and the store and entity id come from whichever row exists. `actor_role` is the actor's `storeRole` (the store role of a store-scoped request) when present, else its `role`.

The actor is parsed only for a real change; one that does not parse, or names an unknown `actor_type`, fails the write
on purpose. The API vouches for the actor it sends: the secret key cannot write `audit_log`, but it chooses whom a
change is attributed to. An audited table is therefore written through a transition function or with those two headers; `updated_by` is
never read (a later SQL edit would carry the last admin's id).

## Row-level security and grants

- RLS is enabled on every table (`site_settings`, the outbox tables, `audit_log`, `feature_flags` and `session_activity` included, each by the migration
  that creates it). There are no policies.
- `revoke all` on every table from `anon` and `authenticated`.
- Default privileges for role `postgres` in `public`: new tables grant nothing to `anon`/`authenticated`, and new
  functions grant no `EXECUTE` to `public`, `anon` or `authenticated`. This is why the `20260927094610` migration did
  not need its own `revoke`/`grant` for functions — it adds no new function — but still revokes table privileges for
  `site_settings` explicitly, matching every other table.
- `EXECUTE` on every function is revoked from `public`, `anon` and `authenticated`, then granted to `service_role`
  for all but the trigger functions.
- `anon` and `authenticated` have no `USAGE` on the `pgmq` or `cron` schema, and neither schema is exposed through
  the Data API (`api.schemas` in `server/supabase/config.toml`).
- `server/test/api/database-lockdown.test.ts` checks all of the above from the catalogs, for every table and function,
  so a migration that forgets its RLS or revoke fails CI.
- `service_role`'s table privileges are left as Supabase grants them, except on `audit_log`: `select` only. The
  trigger writes it as the owner, so the secret key can neither forge, change nor delete a row, and the
  `audit_log_no_change` / `audit_log_no_truncate` triggers refuse even the owner (`server/test/api/audit.test.ts`). The
  API connects as `service_role` (the secret key), which bypasses RLS.

What this means for callers is in [PERMISSIONS.md](PERMISSIONS.md#database).
