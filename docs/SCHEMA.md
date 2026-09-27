# Schema

The Postgres schema in the Supabase project, from `server/supabase/migrations/`. The ER diagram is in
[ARCHITECTURE.md](ARCHITECTURE.md#10-data-model). Who may read and call what is in [PERMISSIONS.md](PERMISSIONS.md).

- Generated TypeScript types: `server/src/types/database.ts` (`cd server && npm run db:types`, from the local
  database). `server/src/types/enums.ts` re-exports the enums from it.
- Money is whole rupees stored as `integer`.
- Every table is in the `public` schema. `profiles.id` references Supabase's `auth.users`.

## Migrations

Applied in file-name order. Once a migration is pushed to staging or production it is never edited; a change goes in
a new file (see [DEPLOYMENT.md](DEPLOYMENT.md#schema-changes)).

| File                      | What it does                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `20260925120000_init.sql` | the three enums, the five tables, indexes, RLS and grants, the triggers and the three RPCs below |

## Enums

| Enum             | Values                                                   |
| ---------------- | -------------------------------------------------------- |
| `user_role`      | `CUSTOMER`, `STAFF`                                      |
| `order_status`   | `PLACED`, `PREPARING`, `READY`, `COMPLETED`, `CANCELLED` |
| `payment_status` | `PENDING`, `PAID`                                        |

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

| Column               | Type             | Null | Default             | Constraints                                              |
| -------------------- | ---------------- | ---- | ------------------- | -------------------------------------------------------- |
| `id`                 | uuid             | no   | `gen_random_uuid()` | primary key                                              |
| `order_number`       | integer          | no   | identity            | `generated always as identity (start with 1001)`, unique |
| `user_id`            | uuid             | no   |                     | references `profiles (id)`                               |
| `store_id`           | uuid             | no   |                     | references `stores (id)`                                 |
| `customer_name`      | text             | no   |                     |                                                          |
| `customer_phone`     | text             | yes  |                     |                                                          |
| `note`               | text             | yes  |                     |                                                          |
| `total`              | integer          | no   |                     | computed in `place_order`                                |
| `payment_status`     | `payment_status` | no   | `PENDING`           |                                                          |
| `status`             | `order_status`   | no   | `PLACED`            |                                                          |
| `estimated_ready_at` | timestamptz      | no   |                     |                                                          |
| `created_at`         | timestamptz      | no   | `now()`             |                                                          |
| `updated_at`         | timestamptz      | no   | `now()`             | set on every update by `orders_set_updated_at`           |

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

## Indexes

| Index                              | Columns                                     |
| ---------------------------------- | ------------------------------------------- |
| `menu_items_store_id_category_idx` | `menu_items (store_id, category)`           |
| `orders_user_id_created_at_idx`    | `orders (user_id, created_at)`              |
| `orders_status_created_at_idx`     | `orders (status, created_at)`               |
| `order_items_menu_item_id_idx`     | `order_items (menu_item_id)`                |
| unique constraint                  | `order_items (order_id, line_number)`       |
| unique constraint                  | `profiles (email)`, `orders (order_number)` |

## Triggers

| Trigger                      | On                                                              | Function                     |
| ---------------------------- | --------------------------------------------------------------- | ---------------------------- |
| `orders_set_updated_at`      | before update on `orders`, each row                             | `set_updated_at()`           |
| `on_auth_user_created`       | after insert on `auth.users`                                    | `handle_new_user()`          |
| `on_auth_user_email_changed` | after update of `email` on `auth.users`, when the email changed | `handle_user_email_change()` |

## Functions

All functions set `search_path = ''` and use schema-qualified names. Each call is one transaction, so a function that
raises leaves nothing behind. Expected failures are raised with `message` = an API error code and `detail` = a JSON
object (SQLSTATE `P0001`). How the API maps them is in [API.md](API.md#database-errors-p0001).

| Function                     | Language | Security | Returns | Called by                         | `EXECUTE` granted to |
| ---------------------------- | -------- | -------- | ------- | --------------------------------- | -------------------- |
| `set_updated_at()`           | plpgsql  | invoker  | trigger | `orders_set_updated_at`           | nobody               |
| `handle_new_user()`          | plpgsql  | definer  | trigger | `on_auth_user_created`            | nobody               |
| `handle_user_email_change()` | plpgsql  | definer  | trigger | `on_auth_user_email_changed`      | nobody               |
| `place_order(...)`           | plpgsql  | invoker  | uuid    | `order.service.createOrder`       | `service_role`       |
| `update_order_status(...)`   | plpgsql  | invoker  | void    | `order.service.updateOrderStatus` | `service_role`       |
| `reset_demo_orders()`        | sql      | definer  | void    | `server/scripts/seed.ts`          | `service_role`       |

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
  p_note text default null
) returns uuid                -- the new order's id
```

The API has already checked and priced every line from the database. The function:

1. Loops over `p_lines` ordered by `menu_item_id`, so concurrent orders lock rows in the same order. For each line it
   runs `update menu_items set stock_quantity = stock_quantity - quantity where id = … and stock_quantity >= quantity`.
2. When no row was updated, it reads the item's `stock_quantity`:
   - row found with `null` stock: the item is not tracked, nothing to reserve;
   - otherwise (too few left, or the item does not exist): raises `INSUFFICIENT_STOCK` with detail
     `{ menuItemId, name, available }`, where `available` is the stock left (0 when the item is missing).
3. Inserts the `orders` row: `total = sum(unit_price * quantity)` over `p_lines`, `status = 'PLACED'`,
   `payment_status = p_payment_status`, `estimated_ready_at = now() + stores.prep_time_max_minutes` minutes.
4. Inserts one `order_items` row per line with `line_number` = the line's position in `p_lines` (1-based) and
   `line_total = unit_price * quantity`.

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
  p_from_statuses order_status[]   -- statuses allowed to move to p_next_status (from ALLOWED_TRANSITIONS)
) returns void
```

1. `update orders set status = p_next_status where id = p_order_id and status = any (p_from_statuses)`.
2. When no row was updated, it reads the order:
   - no order: raises `NOT_FOUND`;
   - otherwise: raises `INVALID_STATUS_TRANSITION` with detail `{ orderNumber, status }` (the current status).
3. When `p_next_status = 'CANCELLED'`: adds back the summed `order_items.quantity` per menu item to
   `menu_items.stock_quantity`, only where `stock_quantity is not null`. The conditional update in step 1 succeeds at
   most once per order, so stock is restored at most once.

The transition rules live in the API, not here. The function only enforces "the status is still one of these".

| Raises                      | Detail                    |
| --------------------------- | ------------------------- |
| `NOT_FOUND`                 | none                      |
| `INVALID_STATUS_TRANSITION` | `{ orderNumber, status }` |

### reset_demo_orders

`truncate public.order_items, public.orders restart identity`. The next order is #1001 again. `security definer`
because restarting the identity sequence needs its owner. Used only by the demo seed, which refuses to run against
production (see [DEPLOYMENT.md](DEPLOYMENT.md#seeding)).

## Row-level security and grants

- RLS is enabled on all five tables. There are no policies.
- `revoke all` on all five tables from `anon` and `authenticated`.
- Default privileges for role `postgres` in `public`: new tables grant nothing to `anon`/`authenticated`, and new
  functions grant no `EXECUTE` to `public`, `anon` or `authenticated`. A later migration must grant explicitly.
- `EXECUTE` on all six functions is revoked from `public`, `anon` and `authenticated`, then granted to `service_role`
  for `place_order`, `update_order_status` and `reset_demo_orders` only.
- The migration does not change `service_role`'s table privileges. The API connects as `service_role` (the secret
  key), which bypasses RLS.

What this means for callers is in [PERMISSIONS.md](PERMISSIONS.md#database).
