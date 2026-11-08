# Schema

The Postgres schema in the Supabase project, from `server/supabase/migrations/`. The ER diagram is in
[ARCHITECTURE.md](ARCHITECTURE.md#10-data-model). Who may read and call what is in [PERMISSIONS.md](PERMISSIONS.md).

- Generated TypeScript types: `server/src/types/database.ts` (`cd server && npm run db:types`, from the local
  database). `server/src/types/enums.ts` re-exports the enums from it.
- Money is paise in `bigint` columns named `…_paise` ([ADR-004](adr/004-rupees-and-paise.md)); the API sends whole
  rupees, converted only by `server/src/utils/money.ts`. While a rupee API field exists for a column, its paise column
  has a `check (… % 100 = 0)`, so the rupee field never rounds. The old whole-rupee `integer` columns (`price`,
  `total`, `unit_price`, `line_total`) are still written, for the API deployed before the move, and are dropped by
  the contract migration (P1 PR 16); nothing in the current API reads them.
- Every table is in the `public` schema. `profiles.id` references Supabase's `auth.users`.
- Extensions: `pgmq` (queues, in its own `pgmq` schema) and `pg_cron` (schedules, in `cron`), both from
  `20261024181904_outbox.sql`. How the queues and schedules are used: [JOBS.md](JOBS.md).

## Migrations

Applied in file-name order. Once a migration is pushed to staging or production it is never edited; a change goes in
a new file (see [DEPLOYMENT.md](DEPLOYMENT.md#schema-changes)).

| File                                               | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260925120000_init.sql`                          | the three enums, the five tables, indexes, RLS and grants, the triggers and the three RPCs below                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `20260927094610_admin_settings_collected.sql`      | adds `user_role` value `ADMIN`; renames `order_status` value `COMPLETED` to `COLLECTED`; adds `public.site_settings` (RLS, revoked, `set_updated_at` trigger)                                                                                                                                                                                                                                                                                                                                                                     |
| `20260927222002_min_client_version.sql`            | adds `site_settings.min_client_version` (the 426 gate's minimum)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `20260928180445_site_settings_config.sql`          | adds `site_settings.max_lines_per_order`, `order_poll_ms`, `orders_poll_ms`, `staff_board_poll_ms` (the configuration registry, [CONFIGURATION.md](CONFIGURATION.md))                                                                                                                                                                                                                                                                                                                                                             |
| `20260928193552_order_idempotency_key.sql`         | adds `orders.idempotency_key` and its partial unique index; drops and recreates `place_order` with `p_idempotency_key` (a function's argument list is its identity, so a new parameter cannot use `create or replace`), reissuing its grants                                                                                                                                                                                                                                                                                      |
| `20261024181904_outbox.sql`                        | enables `pgmq` and `pg_cron`; adds `domain_events`, `event_subscriptions`, `emit_event` and `purge_domain_events`; creates the `q_notifications` queue, its `order.*` subscription and the nightly purge schedule                                                                                                                                                                                                                                                                                                                 |
| `20261024192953_queue_wrappers.sql`                | adds `job_failures` and the five `queue_*` wrappers (the worker's only way into pgmq), granted to `service_role`                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `20261101131925_transitions_emit_events.sql`       | drops and recreates `place_order` and `update_order_status` with `p_actor` and `p_request_id` (defaulted), which emit their events; `update_order_status` locks the row, returns boolean and treats a repeat as a no-op; grants reissued                                                                                                                                                                                                                                                                                          |
| `20261101201251_audit_log.sql`                     | adds `actor_type`, the append-only `audit_log` (read-only to `service_role`) and `audit_row_change()` with its triggers on `site_settings`, `orders`, `profiles` and `menu_items`                                                                                                                                                                                                                                                                                                                                                 |
| `20261102101707_audit_log_id_indexes.sql`          | rebuilds the `audit_log` indexes to end in `id desc` (plus `(entity_type, id desc)`), the order `GET /api/admin/audit` pages in                                                                                                                                                                                                                                                                                                                                                                                                   |
| `20261102110820_order_snapshots.sql`               | adds the snapshots `order_items.image_url`, `order_items.category` and `orders.store_name`, backfilled from today's `menu_items` and `stores` (without touching `orders.updated_at`), then `not null`; `place_order` (same signature) writes them                                                                                                                                                                                                                                                                                 |
| `20261102110856_feature_flags.sql`                 | adds `feature_flags` (RLS, revoked, `set_updated_at` and `audit_row_change('feature_flag.changed', '*')` triggers, no rows); `audit_row_change()` takes `entity_id` from `key` when the row has no `id`                                                                                                                                                                                                                                                                                                                           |
| `20261102110929_session_activity.sql`              | adds `session_activity`, `touch_session` and `purge_session_activity` (the server-side idle sign-out, ADR-011) and the nightly `purge-session-activity` schedule                                                                                                                                                                                                                                                                                                                                                                  |
| `20261102183749_client_error_sample_percent.sql`   | adds `site_settings.client_error_sample_percent` (the share of page loads that report their errors, [CONFIGURATION.md](CONFIGURATION.md))                                                                                                                                                                                                                                                                                                                                                                                         |
| `20261102183832_money_paise.sql`                   | adds `menu_items.price_paise`, `orders.total_paise`, `order_items.unit_price_paise` and `line_total_paise` (`bigint`, backfilled ×100 without touching `orders.updated_at`, `not null`, `>= 0`, whole rupees); `place_order` (same signature) prices every line from `menu_items.price_paise`, refuses a line whose `unit_price_paise` is no longer the price (`PRICE_CHANGED`) and writes both units; `menu_items_audit` also watches `price_paise`; `menu_items_sync_price` keeps `price` and `price_paise` in step until PR 16 |
| `20261103172932_reserved_stock_on_order_items.sql` | adds `order_items.reserved_quantity` (`check (reserved_quantity in (0, quantity))`), set to `quantity` for orders still `PLACED`, `PREPARING` or `READY`; `place_order` (same signature) records what each line reserved, by line number; `update_order_status` (same signature) gives back the sum of `reserved_quantity`, not of `quantity`                                                                                                                                                                                     |
| `20261103173300_profile_name_bounds.sql`           | adds `profile_name(text, text)` and `profile_phone(text)`; `handle_new_user` (same signature) passes the Auth metadata through them; cleans legacy rows, then adds the checks `profiles_name_length` and `profiles_phone_format`                                                                                                                                                                                                                                                                                                  |

## Enums

| Enum             | Values                                                           |
| ---------------- | ---------------------------------------------------------------- |
| `user_role`      | `CUSTOMER`, `STAFF`, `ADMIN`                                     |
| `order_status`   | `PLACED`, `PREPARING`, `READY`, `COLLECTED`, `CANCELLED`         |
| `payment_status` | `PENDING`, `PAID`                                                |
| `actor_type`     | `USER`, `WORKER`, `RECONCILER`, `WEBHOOK`, `SCHEDULER`, `SYSTEM` |

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
| `role`       | `user_role` | no   | `CUSTOMER` |                                                                       |
| `created_at` | timestamptz | no   | `now()`    |                                                                       |

### stores

V0 has exactly one row, created by `npm run seed`.

| Column                  | Type    | Null | Default             | Notes                                            |
| ----------------------- | ------- | ---- | ------------------- | ------------------------------------------------ |
| `id`                    | uuid    | no   | `gen_random_uuid()` | primary key                                      |
| `name`                  | text    | no   |                     |                                                  |
| `tagline`               | text    | no   |                     |                                                  |
| `description`           | text    | no   |                     |                                                  |
| `image_url`             | text    | yes  |                     |                                                  |
| `is_open`               | boolean | no   | `true`              | false makes `POST /orders` return `STORE_CLOSED` |
| `prep_time_min_minutes` | integer | no   | `10`                |                                                  |
| `prep_time_max_minutes` | integer | no   | `15`                | drives `orders.estimated_ready_at`               |

### menu_items

| Column           | Type    | Null | Default             | Constraints                                                                                                              |
| ---------------- | ------- | ---- | ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `id`             | uuid    | no   | `gen_random_uuid()` | primary key                                                                                                              |
| `store_id`       | uuid    | no   |                     | references `stores (id)`                                                                                                 |
| `category`       | text    | no   |                     |                                                                                                                          |
| `name`           | text    | no   |                     |                                                                                                                          |
| `description`    | text    | no   |                     |                                                                                                                          |
| `price`          | integer | no   |                     | `check (price >= 0)`; whole rupees; until PR 16                                                                          |
| `price_paise`    | bigint  | no   |                     | `>= 0`, `% 100 = 0` (whole rupees); the price in paise, kept in step with `price` by `menu_items_sync_price` until PR 16 |
| `image_url`      | text    | no   |                     |                                                                                                                          |
| `is_available`   | boolean | no   | `true`              |                                                                                                                          |
| `is_popular`     | boolean | no   | `false`             |                                                                                                                          |
| `sort_order`     | integer | no   | `0`                 |                                                                                                                          |
| `stock_quantity` | integer | yes  |                     | `check (stock_quantity >= 0)`; `null` = not tracked                                                                      |

Until PR 16 drops `price`, the `menu_items_sync_price` trigger keeps the two price columns in step: a write that sets
only one (an insert with the other null, or an update that changes one) derives the other (`price_paise = price *
100`, `price = price_paise / 100`); a write that changes both to values that disagree is refused. An update counts a
column as written when its value changes.

`stock_quantity` is decremented by `place_order` and restored when an order is cancelled, by what the order's lines
reserved (`order_items.reserved_quantity`), not by what they ordered.

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
| `total`              | integer          | no   |                     | `total_paise / 100`; until PR 16                                                           |
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
| `unit_price`        | integer | no   |                     | `unit_price_paise / 100`; until PR 16                                                                                                                                                                                                                                                                                 |
| `unit_price_paise`  | bigint  | no   |                     | snapshot of `menu_items.price_paise`; `>= 0`, `% 100 = 0`                                                                                                                                                                                                                                                             |
| `quantity`          | integer | no   |                     | `check (quantity > 0)`                                                                                                                                                                                                                                                                                                |
| `line_total`        | integer | no   |                     | `line_total_paise / 100`; until PR 16                                                                                                                                                                                                                                                                                 |
| `line_total_paise`  | bigint  | no   |                     | `unit_price_paise * quantity`; `>= 0`, `% 100 = 0`                                                                                                                                                                                                                                                                    |
| `image_url`         | text    | no   |                     | snapshot of `menu_items.image_url` at order time                                                                                                                                                                                                                                                                      |
| `category`          | text    | no   |                     | snapshot at order time; for analytics (P7.1), not sent                                                                                                                                                                                                                                                                |
| `reserved_quantity` | integer | no   | none                | what `place_order` took from stock for this line: `quantity`, or `0` for an item without a stock count; `check (reserved_quantity in (0, quantity))`. A cancel returns exactly this. No default: an insert from a `place_order` that predates the column fails and rolls back its stock change instead of recording 0 |

Foreign keys without an `on delete` clause (`menu_items.store_id`, `orders.user_id`, `orders.store_id`,
`order_items.menu_item_id`) block deleting a row that is still referenced. `npm run seed` wipes orders first for that
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
| `staff_order_list_limit`       | integer     | no   | `100`     | `check (staff_order_list_limit between 1 and 500)`                                                                                                                          |
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
| `store_id`    | uuid         | yes  |          | the row's `store_id`, when it has one                                                                                |
| `action`      | text         | no   |          | `site_settings.changed`, `order.status_changed`, `profile.role_changed`, `menu_item.changed`, `feature_flag.changed` |
| `entity_type` | text         | no   |          | the action's first part: `site_settings`, `order`, `profile`, `menu_item`, `feature_flag`                            |
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

| Index                                | Columns                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `menu_items_store_id_category_idx`   | `menu_items (store_id, category)`                                                |
| `orders_user_id_created_at_idx`      | `orders (user_id, created_at)`                                                   |
| `orders_status_created_at_idx`       | `orders (status, created_at)`                                                    |
| `order_items_menu_item_id_idx`       | `order_items (menu_item_id)`                                                     |
| `orders_user_id_idempotency_key_idx` | `orders (user_id, idempotency_key)`, unique, `where idempotency_key is not null` |
| `domain_events_aggregate_idx`        | `domain_events (aggregate_type, aggregate_id, occurred_at)`                      |
| `audit_log_entity_idx`               | `audit_log (entity_type, entity_id, id desc)`                                    |
| `audit_log_entity_type_idx`          | `audit_log (entity_type, id desc)`                                               |
| `audit_log_store_idx`                | `audit_log (store_id, id desc)`                                                  |
| `audit_log_actor_idx`                | `audit_log (actor_id, id desc)`                                                  |
| `session_activity_user_id_idx`       | `session_activity (user_id)`, for the cascade from `profiles`                    |
| unique constraint                    | `order_items (order_id, line_number)`                                            |
| unique constraint                    | `profiles (email)`, `orders (order_number)`                                      |

`site_settings` has no indexes on purpose (one row), including on `updated_by`. `session_activity.last_seen_at` has
none either: the API moves it every few minutes per session, and an index would cost each of those updates an index
write for one small nightly scan.

## Triggers

| Trigger                        | On                                                                                                                                         | Function                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `orders_set_updated_at`        | before update on `orders`, each row                                                                                                        | `set_updated_at()`                                       |
| `site_settings_set_updated_at` | before update on `site_settings`, each row                                                                                                 | `set_updated_at()`                                       |
| `feature_flags_set_updated_at` | before update on `feature_flags`, each row                                                                                                 | `set_updated_at()`                                       |
| `on_auth_user_created`         | after insert on `auth.users`                                                                                                               | `handle_new_user()`                                      |
| `on_auth_user_email_changed`   | after update of `email` on `auth.users`, when the email changed                                                                            | `handle_user_email_change()`                             |
| `site_settings_audit`          | after update on `site_settings`, each row                                                                                                  | `audit_row_change('site_settings.changed', '*')`         |
| `orders_audit`                 | after update of `status` on `orders`, each row                                                                                             | `audit_row_change('order.status_changed', 'status')`     |
| `profiles_audit`               | after update of `role` on `profiles`, each row                                                                                             | `audit_row_change('profile.role_changed', 'role')`       |
| `menu_items_sync_price`        | before insert or update of `price`, `price_paise` on `menu_items`, each row; dropped by PR 16                                              | `menu_items_sync_price()`                                |
| `menu_items_audit`             | after update of `name`, `price`, `price_paise`, `is_available`, `image_url`, `category` on `menu_items`, each row (never `stock_quantity`) | `audit_row_change('menu_item.changed', <those columns>)` |
| `feature_flags_audit`          | after update on `feature_flags`, each row                                                                                                  | `audit_row_change('feature_flag.changed', '*')`          |
| `audit_log_no_change`          | before update or delete on `audit_log`, each row                                                                                           | `audit_log_append_only()`                                |
| `audit_log_no_truncate`        | before truncate on `audit_log`, each statement                                                                                             | `audit_log_append_only()`                                |

## Functions

All functions set `search_path = ''` and use schema-qualified names. Each call is one transaction, so a function that
raises leaves nothing behind. Expected failures are raised with `message` = an API error code and `detail` = a JSON
object (SQLSTATE `P0001`). How the API maps them is in [API.md](API.md#database-errors-p0001).

| Function                     | Language | Security | Returns | Called by                                                                               | `EXECUTE` granted to |
| ---------------------------- | -------- | -------- | ------- | --------------------------------------------------------------------------------------- | -------------------- |
| `set_updated_at()`           | plpgsql  | invoker  | trigger | `orders_set_updated_at`, `site_settings_set_updated_at`, `feature_flags_set_updated_at` | nobody               |
| `handle_new_user()`          | plpgsql  | definer  | trigger | `on_auth_user_created`                                                                  | nobody               |
| `handle_user_email_change()` | plpgsql  | definer  | trigger | `on_auth_user_email_changed`                                                            | nobody               |
| `profile_name(text, text)`   | plpgsql  | invoker  | text    | `handle_new_user()`, `20261103173300_profile_name_bounds.sql`                           | nobody               |
| `profile_phone(text)`        | sql      | invoker  | text    | `handle_new_user()`, `20261103173300_profile_name_bounds.sql`                           | nobody               |
| `place_order(...)`           | plpgsql  | invoker  | uuid    | `order.service.createOrder`                                                             | `service_role`       |
| `update_order_status(...)`   | plpgsql  | invoker  | boolean | `order.service.updateOrderStatus`                                                       | `service_role`       |
| `reset_demo_orders()`        | sql      | definer  | void    | `server/scripts/seed.ts`                                                                | `service_role`       |
| `emit_event(...)`            | plpgsql  | definer  | uuid    | `place_order`, `update_order_status`                                                    | `service_role`       |
| `queue_read(...)`            | plpgsql  | definer  | table   | the worker (P1 PR 03)                                                                   | `service_role`       |
| `queue_delete(...)`          | sql      | definer  | boolean | the worker                                                                              | `service_role`       |
| `queue_retry(...)`           | sql      | definer  | void    | the worker                                                                              | `service_role`       |
| `queue_dead_letter(...)`     | sql      | definer  | boolean | the worker                                                                              | `service_role`       |
| `queue_metrics(text)`        | sql      | definer  | table   | the worker's health report                                                              | `service_role`       |
| `purge_domain_events(...)`   | sql      | invoker  | integer | pg_cron `purge-domain-events`                                                           | `service_role`       |
| `audit_row_change()`         | plpgsql  | definer  | trigger | the five `*_audit` triggers                                                             | nobody               |
| `audit_log_append_only()`    | plpgsql  | invoker  | trigger | `audit_log_no_change`, `_no_truncate`                                                   | nobody               |
| `menu_items_sync_price()`    | plpgsql  | invoker  | trigger | `menu_items_sync_price`                                                                 | nobody               |

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
`unit_price_paise` (the API deployed before the paise move sends rupees in `unit_price`) is not checked, and its
`unit_price` is ignored.
It first sets `app.actor` and
`app.request_id` for the transaction (`set_config(..., true)`; PR 06's audit trigger reads them). Then:

0. With a `p_idempotency_key`: takes `pg_advisory_xact_lock` on a hash of `(user_id, key)` (held until the
   transaction ends, so two simultaneous repeats run one after the other), then returns the id of the order this
   user already placed under that key, if any, without touching stock. The partial unique index is the backstop.
1. Loops over `p_lines` ordered by `menu_item_id`, so concurrent orders lock rows in the same order. For each line it
   runs `update menu_items set stock_quantity = stock_quantity - quantity where id = … and stock_quantity >= quantity`.
2. When no row was updated, it reads the item's `stock_quantity`:
   - row found with `null` stock: the item is not tracked, nothing to reserve;
   - otherwise (too few left, or the item does not exist): raises `INSUFFICIENT_STOCK` with detail
     `{ menuItemId, name, available }`, where `available` is the stock left (0 when the item is missing).
3. Reads every line's `menu_items` row once (price, name, photo, category), so the total and the lines come from the
   same versions even if a price changes meanwhile. If any line's `unit_price_paise` differs from that read's
   `price_paise`, raises `PRICE_CHANGED` with detail `{ menuItemId, name, price }` (the first such line in cart order;
   `price` is the current price in rupees), which rolls back the stock reserved in step 1. Otherwise inserts the
   `orders` row: `total_paise = sum(price_paise * quantity)` (and `total = total_paise / 100`), `status = 'PLACED'`,
   `payment_status = p_payment_status`, `estimated_ready_at = now() + stores.prep_time_max_minutes` minutes,
   `idempotency_key = p_idempotency_key`, and the snapshot `store_name = stores.name`.
4. Inserts one `order_items` row per line with `line_number` = the line's position in `p_lines` (1-based),
   `unit_price_paise = price_paise`, `line_total_paise = unit_price_paise * quantity` (and the rupee columns, each
   paise value / 100), and the snapshots `name`, `image_url` and `category`, all from that read. `reserved_quantity` is
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

The actor is parsed only for a real change; one that does not parse, or names an unknown `actor_type`, fails the write
on purpose. The API vouches for the actor it sends: the secret key cannot write `audit_log`, but it chooses whom a
change is attributed to. An audited table is therefore written through a transition function or with those two headers; `updated_by` is
never read (a later SQL edit would carry the last admin's id).

## Row-level security and grants

- RLS is enabled on all twelve tables (`site_settings`, the outbox tables, `audit_log`, `feature_flags` and `session_activity` included, each by the migration
  that creates it). There are no policies.
- `revoke all` on all twelve tables from `anon` and `authenticated`.
- Default privileges for role `postgres` in `public`: new tables grant nothing to `anon`/`authenticated`, and new
  functions grant no `EXECUTE` to `public`, `anon` or `authenticated`. This is why the `20260927094610` migration did
  not need its own `revoke`/`grant` for functions — it adds no new function — but still revokes table privileges for
  `site_settings` explicitly, matching every other table.
- `EXECUTE` on every function is revoked from `public`, `anon` and `authenticated`, then granted to `service_role`
  for all but the six trigger functions.
- `anon` and `authenticated` have no `USAGE` on the `pgmq` or `cron` schema, and neither schema is exposed through
  the Data API (`api.schemas` in `server/supabase/config.toml`).
- `server/test/api/database-lockdown.test.ts` checks all of the above from the catalogs, for every table and function,
  so a migration that forgets its RLS or revoke fails CI.
- `service_role`'s table privileges are left as Supabase grants them, except on `audit_log`: `select` only. The
  trigger writes it as the owner, so the secret key can neither forge, change nor delete a row, and the
  `audit_log_no_change` / `audit_log_no_truncate` triggers refuse even the owner (`server/test/api/audit.test.ts`). The
  API connects as `service_role` (the secret key), which bypasses RLS.

What this means for callers is in [PERMISSIONS.md](PERMISSIONS.md#database).
