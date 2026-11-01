# Schema

The Postgres schema in the Supabase project, from `server/supabase/migrations/`. The ER diagram is in
[ARCHITECTURE.md](ARCHITECTURE.md#10-data-model). Who may read and call what is in [PERMISSIONS.md](PERMISSIONS.md).

- Generated TypeScript types: `server/src/types/database.ts` (`cd server && npm run db:types`, from the local
  database). `server/src/types/enums.ts` re-exports the enums from it.
- Money is whole rupees stored as `integer`.
- Every table is in the `public` schema. `profiles.id` references Supabase's `auth.users`.
- Extensions: `pgmq` (queues, in its own `pgmq` schema) and `pg_cron` (schedules, in `cron`), both from
  `20261024181904_outbox.sql`. How the queues and schedules are used: [JOBS.md](JOBS.md).

## Migrations

Applied in file-name order. Once a migration is pushed to staging or production it is never edited; a change goes in
a new file (see [DEPLOYMENT.md](DEPLOYMENT.md#schema-changes)).

| File                                          | What it does                                                                                                                                                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260925120000_init.sql`                     | the three enums, the five tables, indexes, RLS and grants, the triggers and the three RPCs below                                                                                                                                             |
| `20260927094610_admin_settings_collected.sql` | adds `user_role` value `ADMIN`; renames `order_status` value `COMPLETED` to `COLLECTED`; adds `public.site_settings` (RLS, revoked, `set_updated_at` trigger)                                                                                |
| `20260927222002_min_client_version.sql`       | adds `site_settings.min_client_version` (the 426 gate's minimum)                                                                                                                                                                             |
| `20260928180445_site_settings_config.sql`     | adds `site_settings.max_lines_per_order`, `order_poll_ms`, `orders_poll_ms`, `staff_board_poll_ms` (the configuration registry, [CONFIGURATION.md](CONFIGURATION.md))                                                                        |
| `20260928193552_order_idempotency_key.sql`    | adds `orders.idempotency_key` and its partial unique index; drops and recreates `place_order` with `p_idempotency_key` (a function's argument list is its identity, so a new parameter cannot use `create or replace`), reissuing its grants |
| `20261024181904_outbox.sql`                   | enables `pgmq` and `pg_cron`; adds `domain_events`, `event_subscriptions`, `emit_event` and `purge_domain_events`; creates the `q_notifications` queue, its `order.*` subscription and the nightly purge schedule                            |
| `20261024192953_queue_wrappers.sql`           | adds `job_failures` and the five `queue_*` wrappers (the worker's only way into pgmq), granted to `service_role`                                                                                                                             |
| `20261101131925_transitions_emit_events.sql`  | drops and recreates `place_order` and `update_order_status` with `p_actor` and `p_request_id` (defaulted), which emit their events; `update_order_status` locks the row, returns boolean and treats a repeat as a no-op; grants reissued     |

## Enums

| Enum             | Values                                                   |
| ---------------- | -------------------------------------------------------- |
| `user_role`      | `CUSTOMER`, `STAFF`, `ADMIN`                             |
| `order_status`   | `PLACED`, `PREPARING`, `READY`, `COLLECTED`, `CANCELLED` |
| `payment_status` | `PENDING`, `PAID`                                        |

`ADMIN` was added with `alter type ... add value` (`20260927094610_admin_settings_collected.sql`); it is the
site-wide developer/operator role (the `/admin` dashboard), not a restaurant role — see
[PERMISSIONS.md](PERMISSIONS.md#roles). `COMPLETED` was renamed to `COLLECTED` with `alter type ... rename value` in
the same migration: the enum entry is relabelled in place, so existing rows read `COLLECTED` with no backfill, and no
other SQL object names the old literal. This was a breaking API change shipped together with the client
(see [API.md](API.md#routes)).

## Tables

### profiles

One row per Supabase Auth user, created by the `on_auth_user_created` trigger. The role lives here and nowhere else.

| Column       | Type        | Null | Default    | Constraints                                                 |
| ------------ | ----------- | ---- | ---------- | ----------------------------------------------------------- |
| `id`         | uuid        | no   |            | primary key; references `auth.users (id)` on delete cascade |
| `name`       | text        | no   |            |                                                             |
| `email`      | text        | no   |            | unique; kept in sync by `on_auth_user_email_changed`        |
| `phone`      | text        | yes  |            |                                                             |
| `role`       | `user_role` | no   | `CUSTOMER` |                                                             |
| `created_at` | timestamptz | no   | `now()`    |                                                             |

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

| Column           | Type    | Null | Default             | Constraints                                         |
| ---------------- | ------- | ---- | ------------------- | --------------------------------------------------- |
| `id`             | uuid    | no   | `gen_random_uuid()` | primary key                                         |
| `store_id`       | uuid    | no   |                     | references `stores (id)`                            |
| `category`       | text    | no   |                     |                                                     |
| `name`           | text    | no   |                     |                                                     |
| `description`    | text    | no   |                     |                                                     |
| `price`          | integer | no   |                     | `check (price >= 0)`; whole rupees                  |
| `image_url`      | text    | no   |                     |                                                     |
| `is_available`   | boolean | no   | `true`              |                                                     |
| `is_popular`     | boolean | no   | `false`             |                                                     |
| `sort_order`     | integer | no   | `0`                 |                                                     |
| `stock_quantity` | integer | yes  |                     | `check (stock_quantity >= 0)`; `null` = not tracked |

`stock_quantity` is decremented by `place_order` and restored when an order is cancelled.

### orders

| Column               | Type             | Null | Default             | Constraints                                                                                |
| -------------------- | ---------------- | ---- | ------------------- | ------------------------------------------------------------------------------------------ |
| `id`                 | uuid             | no   | `gen_random_uuid()` | primary key                                                                                |
| `order_number`       | integer          | no   | identity            | `generated always as identity (start with 1001)`, unique                                   |
| `user_id`            | uuid             | no   |                     | references `profiles (id)`                                                                 |
| `store_id`           | uuid             | no   |                     | references `stores (id)`                                                                   |
| `customer_name`      | text             | no   |                     |                                                                                            |
| `customer_phone`     | text             | yes  |                     |                                                                                            |
| `note`               | text             | yes  |                     |                                                                                            |
| `total`              | integer          | no   |                     | computed in `place_order`                                                                  |
| `payment_status`     | `payment_status` | no   | `PENDING`           |                                                                                            |
| `status`             | `order_status`   | no   | `PLACED`            |                                                                                            |
| `estimated_ready_at` | timestamptz      | no   |                     |                                                                                            |
| `created_at`         | timestamptz      | no   | `now()`             |                                                                                            |
| `updated_at`         | timestamptz      | no   | `now()`             | set on every update by `orders_set_updated_at`                                             |
| `idempotency_key`    | uuid             | yes  |                     | the client's per-attempt key; unique per `user_id` when set ([API.md](API.md#post-orders)) |

### order_items

| Column         | Type    | Null | Default             | Constraints                                            |
| -------------- | ------- | ---- | ------------------- | ------------------------------------------------------ |
| `id`           | uuid    | no   | `gen_random_uuid()` | primary key                                            |
| `order_id`     | uuid    | no   |                     | references `orders (id)` on delete cascade             |
| `line_number`  | integer | no   |                     | position in the cart; `unique (order_id, line_number)` |
| `menu_item_id` | uuid    | no   |                     | references `menu_items (id)`                           |
| `name`         | text    | no   |                     | snapshot at order time                                 |
| `unit_price`   | integer | no   |                     | snapshot at order time                                 |
| `quantity`     | integer | no   |                     | `check (quantity > 0)`                                 |
| `line_total`   | integer | no   |                     | `unit_price * quantity`                                |

Foreign keys without an `on delete` clause (`menu_items.store_id`, `orders.user_id`, `orders.store_id`,
`order_items.menu_item_id`) block deleting a row that is still referenced. `npm run seed` wipes orders first for that
reason.

### site_settings

Added by `20260927094610_admin_settings_collected.sql`. A singleton: `id` is always `true`, so the primary key caps
the table at one row (the migration seeds it with `insert ... values (true)`). Edited only from the admin dashboard
(`GET`/`PATCH /api/admin/settings`, see [API.md](API.md#get-adminsettings)); read on every `GET /api/orders`
(`order.service.listOrders`).

| Column                         | Type        | Null | Default   | Constraints                                                                                                                                                         |
| ------------------------------ | ----------- | ---- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                           | boolean     | no   | `true`    | primary key; `check (id)` — only `true` can ever be stored                                                                                                          |
| `customer_order_history_limit` | integer     | no   | `20`      | `check (customer_order_history_limit between 1 and 200)`                                                                                                            |
| `staff_order_list_limit`       | integer     | no   | `100`     | `check (staff_order_list_limit between 1 and 500)`                                                                                                                  |
| `min_client_version`           | text        | no   | `'0.0.0'` | `check (min_client_version ~ '^\d+\.\d+\.\d+$')`; the oldest client the API serves (older: 426 `CLIENT_OUTDATED`); added by `20260927222002_min_client_version.sql` |
| `max_lines_per_order`          | integer     | no   | `30`      | `check (max_lines_per_order between 1 and 100)`; most lines one order may have; added by `20260928180445_site_settings_config.sql`                                  |
| `order_poll_ms`                | integer     | no   | `4000`    | `check (order_poll_ms between 2000 and 60000)`; how often an open order's page polls                                                                                |
| `orders_poll_ms`               | integer     | no   | `8000`    | `check (orders_poll_ms between 2000 and 60000)`; how often the customer's order list polls                                                                          |
| `staff_board_poll_ms`          | integer     | no   | `4000`    | `check (staff_board_poll_ms between 2000 and 60000)`; how often the staff board polls                                                                               |
| `updated_at`                   | timestamptz | no   | `now()`   | set on every update by `site_settings_set_updated_at`                                                                                                               |
| `updated_by`                   | uuid        | yes  |           | references `profiles (id)` on delete **set null** — never cascade: deleting the admin who last saved must never delete the settings row                             |

Only these two limits are editable. The per-item quantity cap (`MAX_QUANTITY_PER_ITEM = 10` in
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

## Indexes

| Index                                | Columns                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `menu_items_store_id_category_idx`   | `menu_items (store_id, category)`                                                |
| `orders_user_id_created_at_idx`      | `orders (user_id, created_at)`                                                   |
| `orders_status_created_at_idx`       | `orders (status, created_at)`                                                    |
| `order_items_menu_item_id_idx`       | `order_items (menu_item_id)`                                                     |
| `orders_user_id_idempotency_key_idx` | `orders (user_id, idempotency_key)`, unique, `where idempotency_key is not null` |
| `domain_events_aggregate_idx`        | `domain_events (aggregate_type, aggregate_id, occurred_at)`                      |
| unique constraint                    | `order_items (order_id, line_number)`                                            |
| unique constraint                    | `profiles (email)`, `orders (order_number)`                                      |

`site_settings` has no indexes on purpose (one row), including on `updated_by`.

## Triggers

| Trigger                        | On                                                              | Function                     |
| ------------------------------ | --------------------------------------------------------------- | ---------------------------- |
| `orders_set_updated_at`        | before update on `orders`, each row                             | `set_updated_at()`           |
| `site_settings_set_updated_at` | before update on `site_settings`, each row                      | `set_updated_at()`           |
| `on_auth_user_created`         | after insert on `auth.users`                                    | `handle_new_user()`          |
| `on_auth_user_email_changed`   | after update of `email` on `auth.users`, when the email changed | `handle_user_email_change()` |

## Functions

All functions set `search_path = ''` and use schema-qualified names. Each call is one transaction, so a function that
raises leaves nothing behind. Expected failures are raised with `message` = an API error code and `detail` = a JSON
object (SQLSTATE `P0001`). How the API maps them is in [API.md](API.md#database-errors-p0001).

| Function                     | Language | Security | Returns | Called by                            | `EXECUTE` granted to |
| ---------------------------- | -------- | -------- | ------- | ------------------------------------ | -------------------- |
| `set_updated_at()`           | plpgsql  | invoker  | trigger | `orders_set_updated_at`              | nobody               |
| `handle_new_user()`          | plpgsql  | definer  | trigger | `on_auth_user_created`               | nobody               |
| `handle_user_email_change()` | plpgsql  | definer  | trigger | `on_auth_user_email_changed`         | nobody               |
| `place_order(...)`           | plpgsql  | invoker  | uuid    | `order.service.createOrder`          | `service_role`       |
| `update_order_status(...)`   | plpgsql  | invoker  | boolean | `order.service.updateOrderStatus`    | `service_role`       |
| `reset_demo_orders()`        | sql      | definer  | void    | `server/scripts/seed.ts`             | `service_role`       |
| `emit_event(...)`            | plpgsql  | definer  | uuid    | `place_order`, `update_order_status` | `service_role`       |
| `queue_read(...)`            | plpgsql  | definer  | table   | the worker (P1 PR 03)                | `service_role`       |
| `queue_delete(...)`          | sql      | definer  | boolean | the worker                           | `service_role`       |
| `queue_retry(...)`           | sql      | definer  | void    | the worker                           | `service_role`       |
| `queue_dead_letter(...)`     | sql      | definer  | boolean | the worker                           | `service_role`       |
| `queue_metrics(text)`        | sql      | definer  | table   | the worker's health report           | `service_role`       |
| `purge_domain_events(...)`   | sql      | invoker  | integer | pg_cron `purge-domain-events`        | `service_role`       |

### set_updated_at

Sets `new.updated_at := now()` and returns `new`.

### handle_new_user

Inserts a `profiles` row for the new `auth.users` row: `id`, `email`, and

- `name` = trimmed `raw_user_meta_data ->> 'name'`, or the part of the email before `@` when that is blank or missing;
- `phone` = trimmed `raw_user_meta_data ->> 'phone'`, or `null` when blank.

`role` takes its default, `CUSTOMER`. The API passes name and phone as `user_metadata` in `auth.admin.createUser`.
A user created elsewhere (the dashboard, `supabase.auth.signUp`) also gets a `CUSTOMER` profile, named from the email unless its metadata has a `name`.

### handle_user_email_change

Copies the new email to `profiles.email` for that user.

### place_order

```sql
place_order(
  p_user_id uuid,
  p_store_id uuid,
  p_customer_name text,
  p_payment_status payment_status,
  p_lines jsonb,              -- [{ menu_item_id, name, unit_price, quantity }] in cart order
  p_customer_phone text default null,
  p_note text default null,
  p_idempotency_key uuid default null, -- the client's per-attempt key (API.md "POST /orders")
  p_actor jsonb default null,          -- { type, id, role }: who asked (the controller's RequestContext)
  p_request_id text default null       -- the request's x-request-id
) returns uuid                -- the new order's id, or the id of the order this key already placed
```

The API has already checked and priced every line from the database. The function first sets `app.actor` and
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
3. Inserts the `orders` row: `total = sum(unit_price * quantity)` over `p_lines`, `status = 'PLACED'`,
   `payment_status = p_payment_status`, `estimated_ready_at = now() + stores.prep_time_max_minutes` minutes,
   `idempotency_key = p_idempotency_key`.
4. Inserts one `order_items` row per line with `line_number` = the line's position in `p_lines` (1-based) and
   `line_total = unit_price * quantity`.
5. Calls `emit_event('order.placed', 'order', id, store_id, { orderNumber }, p_actor, p_request_id)`. An idempotent
   replay returns at step 0 and emits nothing.

The conditional decrement means two customers can never both get the last unit. The loser's `update` waits for the
winner's row lock, then re-checks and finds too little stock.

| Raises               | Detail                            |
| -------------------- | --------------------------------- |
| `INSUFFICIENT_STOCK` | `{ menuItemId, name, available }` |

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
4. Updates the status. When `p_next_status = 'CANCELLED'`: adds back the summed `order_items.quantity` per menu item
   to `menu_items.stock_quantity`, only where `stock_quantity is not null`. A second cancel is a repeat (step 2), so
   stock is restored at most once.
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

## Row-level security and grants

- RLS is enabled on all nine tables (`site_settings` and the outbox tables included, each by the migration that
  creates it). There are no policies.
- `revoke all` on all nine tables from `anon` and `authenticated`.
- Default privileges for role `postgres` in `public`: new tables grant nothing to `anon`/`authenticated`, and new
  functions grant no `EXECUTE` to `public`, `anon` or `authenticated`. This is why the `20260927094610` migration did
  not need its own `revoke`/`grant` for functions — it adds no new function — but still revokes table privileges for
  `site_settings` explicitly, matching every other table.
- `EXECUTE` on every function is revoked from `public`, `anon` and `authenticated`, then granted to `service_role`
  for all but the three trigger functions.
- `anon` and `authenticated` have no `USAGE` on the `pgmq` or `cron` schema, and neither schema is exposed through
  the Data API (`api.schemas` in `server/supabase/config.toml`).
- `server/test/api/database-lockdown.test.ts` checks all of the above from the catalogs, for every table and function,
  so a migration that forgets its RLS or revoke fails CI.
- The migration does not change `service_role`'s table privileges. The API connects as `service_role` (the secret
  key), which bypasses RLS.

What this means for callers is in [PERMISSIONS.md](PERMISSIONS.md#database).
