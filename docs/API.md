# API

The HTTP contract of the Express API in `server/`. Every statement here can be checked against the files named in
each section. Flows (who calls what, in which order) are in [ARCHITECTURE.md](ARCHITECTURE.md). Roles and ownership
rules are in [PERMISSIONS.md](PERMISSIONS.md).

- Base URL: `http://localhost:8000/api` locally. In the browser the client calls `/api` on its own origin and the Vite
  dev server proxies it to port 8000 (`client/vite.config.ts`).
- All bodies are JSON. Send `Content-Type: application/json` on requests with a body.
- Routes: `server/src/routes/*.routes.ts`, mounted in `server/src/routes/index.ts`.
- Request schemas: `server/src/schemas/*.ts`. Response DTOs: `server/src/types/api.ts`. The client's copies of the
  DTOs are in `client/src/types/api.ts` (kept in sync by hand).
- Error codes: `ErrorCode` in `server/src/utils/errors.ts`.

## Authentication

Authenticated routes take `Authorization: Bearer <token>`. The token is a Supabase Auth access token. The web app
gets it from `supabase.auth.signInWithPassword` and supabase-js refreshes it (`jwt_expiry = 3600` seconds in
`server/supabase/config.toml` for the local stack).

`requireAuth` (`server/src/middleware/auth.ts`):

1. Reads the bearer token. The scheme is matched case-insensitively. No token: 401 `UNAUTHORIZED`
   "Please sign in to continue."
2. Verifies it against the project's JWKS with `verifyCredentials` from `@supabase/server` (audience `authenticated`).
   A 5xx from the verifier (for example the JWKS cannot be fetched) becomes 500 `INTERNAL`. Any other failure (bad
   signature, expired, another project) is 401 `UNAUTHORIZED` "Your session has expired. Please sign in again."
3. Loads `id, role` from `profiles`. No profile: 401 `UNAUTHORIZED` "That account no longer exists. Please sign in
   again."
4. Sets `req.user = { id, role }`.

`requireStaff` must run after `requireAuth`. A role other than `STAFF` is 403 `FORBIDDEN` "Only staff can do that."

The API has no sign-in or sign-out route. The browser signs in and out with supabase-js directly
(`client/src/services/auth.ts`).

## Routes

| Method | Path                 | Auth         | Request                                                  | Success                      |
| ------ | -------------------- | ------------ | -------------------------------------------------------- | ---------------------------- |
| GET    | `/health`            | none         | none                                                     | 200 `{ ok: true }`           |
| POST   | `/auth/register`     | none         | body: [`registerSchema`](#post-authregister)             | 201 `{ user: UserDto }`      |
| GET    | `/auth/me`           | user         | none                                                     | 200 `{ user: UserDto }`      |
| GET    | `/store`             | none         | none                                                     | 200 `{ store: StoreDto }`    |
| GET    | `/menu`              | none         | none                                                     | 200 `MenuResponse`           |
| POST   | `/orders`            | user         | body: [`createOrderSchema`](#post-orders)                | 201 `{ order: OrderDto }`    |
| GET    | `/orders`            | user         | query: [`listOrdersQuerySchema`](#get-orders)            | 200 `{ orders: OrderDto[] }` |
| GET    | `/orders/:id`        | user         | path: `id`                                               | 200 `{ order: OrderDto }`    |
| PATCH  | `/orders/:id/status` | user + STAFF | body: [`updateOrderStatusSchema`](#patch-ordersidstatus) | 200 `{ order: OrderDto }`    |

`orderRouter.use(requireAuth)` runs before any `/orders` route matches. So any path under `/api/orders`, including
one that matches no route, returns 401 without a valid token.

### GET /health

Code: `server/src/routes/index.ts`. Always 200 `{ "ok": true }`. It does not touch the database.

### POST /auth/register

Code: `auth.routes.ts` → `validate(registerSchema)` → `auth.controller.register` → `auth.service.register`.

Body (`server/src/schemas/auth.schema.ts`):

| Field      | Type   | Rules                                                            |
| ---------- | ------ | ---------------------------------------------------------------- |
| `name`     | string | required, trimmed, 2–60 characters                               |
| `email`    | string | required, trimmed, lowercased, must be an email                  |
| `password` | string | required, 6–72 characters (bcrypt reads only the first 72 bytes) |
| `phone`    | string | optional; see [phone numbers](#shared-field-rules)               |

The service calls `auth.admin.createUser` with `email_confirm: true` and `user_metadata: { name, phone }`. The
`on_auth_user_created` trigger creates a `CUSTOMER` profile (see [SCHEMA.md](SCHEMA.md#handle_new_user)). No email is
sent. The response is the new profile. The client then signs in with supabase-js.

| Status | Code               | When                                                                                    |
| ------ | ------------------ | --------------------------------------------------------------------------------------- |
| 201    |                    | `{ user: UserDto }`                                                                     |
| 400    | `VALIDATION_ERROR` | a field fails the schema; Supabase Auth says `email_address_invalid` or `weak_password` |
| 409    | `EMAIL_TAKEN`      | Supabase Auth says `email_exists` or `user_already_exists`                              |

### GET /auth/me

Code: `requireAuth` → `auth.controller.me` → `auth.service.getProfile`. Returns the caller's profile as
`{ user: UserDto }`. `getProfile` throws 404 `NOT_FOUND` "Account not found." when the profile is missing, but
`requireAuth` has already returned 401 in that case.

### GET /store

Code: `store.controller.getStore` → `store.service.getStore`. Returns the first row of `stores` (V0 has exactly one)
as `{ store: StoreDto }`. With no store row: 404 `NOT_FOUND` "The store has not been set up yet. Run `npm run seed` in
server/."

### GET /menu

Code: `menu.controller.getMenu` → `menu.service.getMenu`. Returns every menu item of the store, including unavailable
ones (the client greys them out), ordered by `sort_order`:

- `store`: `StoreDto`.
- `popular`: the items with `isPopular` true, in `sortOrder` order.
- `categories`: `{ name, items }[]`. A category is placed by its first (lowest `sortOrder`) item.

Each item's `isAvailable` is `is_available AND (stock_quantity IS NULL OR stock_quantity > 0)` (`isPurchasable` in
`server/src/utils/serializers.ts`). `stockQuantity` is `null` when the item does not track stock. Same 404 as
`GET /store` when there is no store.

### POST /orders

Code: `requireAuth` → `validate(createOrderSchema)` → `order.controller.createOrder` →
`order.service.createOrder` → `place_order` RPC.

Body (`server/src/schemas/order.schema.ts`):

| Field                | Type   | Rules                                                                                     |
| -------------------- | ------ | ----------------------------------------------------------------------------------------- |
| `items`              | array  | required, 1–30 entries (counted before duplicates are merged)                             |
| `items[].menuItemId` | string | required, at least 1 character                                                            |
| `items[].quantity`   | number | required, whole number, at least 1                                                        |
| `customerName`       | string | optional, trimmed, at most 60 characters; blank or missing falls back to the profile name |
| `customerPhone`      | string | optional; see [phone numbers](#shared-field-rules)                                        |
| `note`               | string | optional, trimmed, at most 200 characters                                                 |

- Entries with the same `menuItemId` are merged into one line with the quantities summed (`mergeDuplicateItems`).
- Unknown keys (`price`, `unitPrice`, `total`, …) are dropped by `z.object`. Prices come from the database only.

What the service checks, in this order:

1. The store is open (`stores.is_open`), else 400 `STORE_CLOSED` "<store name> is closed right now. Please come back
   when it opens."
2. For each line, in cart order (`priceLines`):
   - the item exists (ids that are not UUIDs are never queried and count as missing), else 400 `ITEM_NOT_FOUND`
     "One of the items is no longer on the menu." with `details: { menuItemId, available: 0 }`;
   - `is_available` is true, else 400 `ITEM_UNAVAILABLE` "<name> is currently unavailable. Please remove it from your
     cart." with `details: { menuItemId, name, available: 0 }`;
   - the merged quantity is at most 20 (`MAX_QUANTITY_PER_ITEM`), else 400 `VALIDATION_ERROR` "You can order at most
     20 of <name>. Please reduce the quantity in your cart."
3. `total = Σ unit_price × quantity` from the database prices, then `simulatePayment(total)` returns `PAID`
   (`server/src/services/payment.service.ts`).
4. `place_order` reserves stock and writes the order in one transaction. Not enough stock: 400
   `INSUFFICIENT_STOCK` with `details: { menuItemId, name, available }` and the message "Only <n> <name> left. Reduce
   the quantity in your cart." or, when `available` is 0, "<name> just sold out." A refused order leaves no rows and
   no stock changes behind (see [SCHEMA.md](SCHEMA.md#place_order)).

A new order is `paymentStatus: "PAID"`, `status: "PLACED"`, `estimatedReadyAt = now() + store.prep_time_max_minutes`.

| Status | Code                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------- |
| 201    | `{ order: OrderDto }`                                                                          |
| 400    | `VALIDATION_ERROR`, `ITEM_NOT_FOUND`, `ITEM_UNAVAILABLE`, `INSUFFICIENT_STOCK`, `STORE_CLOSED` |
| 401    | `UNAUTHORIZED`                                                                                 |
| 404    | `NOT_FOUND` (no store row)                                                                     |
| 413    | `PAYLOAD_TOO_LARGE`                                                                            |

### GET /orders

Code: `requireAuth` → `validate(listOrdersQuerySchema, 'query')` → `order.controller.listOrders` →
`order.service.listOrders`.

Query: `status` (optional), one of `PLACED`, `PREPARING`, `READY`, `COMPLETED`, `CANCELLED`. Anything else is 400
`VALIDATION_ERROR` "Status must be one of PLACED, PREPARING, READY, COMPLETED, CANCELLED."

- Customers get their newest 50 orders (`CUSTOMER_LIST_LIMIT`).
- Staff get the newest 100 orders across all customers (`STAFF_LIST_LIMIT`).
- Newest first (`created_at desc`). Lines within each order are in cart order (`line_number`).

### GET /orders/:id

Code: `requireAuth` → `order.controller.getOrder` → `order.service.getOrder`.

- `id` that is not a UUID: 404 `NOT_FOUND` "Order not found."
- Customers only see their own orders. Someone else's order returns the same 404 as a missing one.
- Staff see any order.
- A path segment with bad percent-encoding (for example `/api/orders/%E0`) is 400 `BAD_REQUEST`.

### PATCH /orders/:id/status

Code: `requireAuth` → `requireStaff` → `validate(updateOrderStatusSchema)` → `order.controller.updateOrderStatus` →
`order.service.updateOrderStatus` → `update_order_status` RPC.

Body: `{ status }`, one of the five statuses (same message as the list filter). `requireStaff` runs before
validation, so a customer gets 403 whatever the body.

Allowed transitions (`ALLOWED_TRANSITIONS` in `server/src/services/order.service.ts`, the single source of truth):

| From        | To                       |
| ----------- | ------------------------ |
| `PLACED`    | `PREPARING`, `CANCELLED` |
| `PREPARING` | `READY`, `CANCELLED`     |
| `READY`     | `COMPLETED`              |
| `COMPLETED` | none                     |
| `CANCELLED` | none                     |

The service passes every status that may move to the requested one as `p_from_statuses`. The database does one
conditional update, so two staff devices pressing at once get one 200 and one 409. Cancelling puts the order's
tracked stock back in the same transaction (see [SCHEMA.md](SCHEMA.md#update_order_status)).

| Status | Code                        | When                                                                                                                     |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 200    |                             | `{ order: OrderDto }` with the new status                                                                                |
| 400    | `VALIDATION_ERROR`          | `status` missing or not one of the five                                                                                  |
| 401    | `UNAUTHORIZED`              | see [Authentication](#authentication)                                                                                    |
| 403    | `FORBIDDEN`                 | caller is not `STAFF`                                                                                                    |
| 404    | `NOT_FOUND`                 | `id` not a UUID, or no such order                                                                                        |
| 409    | `INVALID_STATUS_TRANSITION` | "Order #<number> cannot move from <current status> to <requested status>." The status quoted is the order's current one. |

## Response DTOs

From `server/src/types/api.ts`. The serializers in `server/src/utils/serializers.ts` turn snake_case rows into these
camelCase shapes and every timestamp into ISO 8601 (`new Date(ts).toISOString()`). Money is whole rupees as integers.

`UserDto`

| Field       | Type                      |
| ----------- | ------------------------- |
| `id`        | string (uuid)             |
| `name`      | string                    |
| `email`     | string                    |
| `phone`     | string \| null            |
| `role`      | `'CUSTOMER'` \| `'STAFF'` |
| `createdAt` | string (ISO 8601)         |

`StoreDto`

| Field                | Type           |
| -------------------- | -------------- |
| `id`                 | string (uuid)  |
| `name`               | string         |
| `tagline`            | string         |
| `description`        | string         |
| `imageUrl`           | string \| null |
| `isOpen`             | boolean        |
| `prepTimeMinMinutes` | number         |
| `prepTimeMaxMinutes` | number         |

`MenuItemDto`

| Field           | Type           | Notes                                                        |
| --------------- | -------------- | ------------------------------------------------------------ |
| `id`            | string (uuid)  |                                                              |
| `category`      | string         |                                                              |
| `name`          | string         |                                                              |
| `description`   | string         |                                                              |
| `price`         | number         | whole rupees                                                 |
| `imageUrl`      | string         |                                                              |
| `isAvailable`   | boolean        | false when switched off or tracked stock is 0                |
| `isPopular`     | boolean        |                                                              |
| `sortOrder`     | number         |                                                              |
| `stockQuantity` | number \| null | units left; `null` = not tracked (only the 20-per-order cap) |

`MenuResponse`: `{ store: StoreDto, popular: MenuItemDto[], categories: { name: string, items: MenuItemDto[] }[] }`.

`OrderDto`

| Field              | Type                           | Notes                                      |
| ------------------ | ------------------------------ | ------------------------------------------ |
| `id`               | string (uuid)                  |                                            |
| `orderNumber`      | number                         | starts at 1001                             |
| `status`           | `OrderStatus`                  |                                            |
| `paymentStatus`    | `'PENDING'` \| `'PAID'`        | new orders are `PAID`                      |
| `total`            | number                         | whole rupees                               |
| `customerName`     | string                         |                                            |
| `customerPhone`    | string \| null                 |                                            |
| `note`             | string \| null                 |                                            |
| `estimatedReadyAt` | string (ISO 8601)              |                                            |
| `createdAt`        | string (ISO 8601)              |                                            |
| `updatedAt`        | string (ISO 8601)              | set by the `orders_set_updated_at` trigger |
| `store`            | `{ id: string, name: string }` |                                            |
| `items`            | `OrderItemDto[]`               | cart order                                 |

`OrderItemDto`

| Field        | Type          | Notes                                          |
| ------------ | ------------- | ---------------------------------------------- |
| `id`         | string (uuid) |                                                |
| `menuItemId` | string (uuid) |                                                |
| `name`       | string        | snapshot at order time                         |
| `unitPrice`  | number        | snapshot at order time                         |
| `quantity`   | number        |                                                |
| `lineTotal`  | number        | `unitPrice × quantity`                         |
| `imageUrl`   | string        | the menu item's current photo (not a snapshot) |

## Shared field rules

From `server/src/schemas/common.ts` and `server/src/middleware/validate.ts`:

- **NUL bytes** are removed from every string in the body or query before validation.
- **Optional fields** (`optionalField`): a blank or whitespace-only string counts as not sent.
- **Phone numbers** (`phone`, `customerPhone`): spaces, dashes and parentheses are stripped, then the value must match
  `^\+?\d{10,15}$` ("Enter a valid phone number."). The normalised value is stored.
- **Validation messages** name the field: a missing field gives "<Field label> is required.", a wrong type gives
  "<Field label> is invalid.", otherwise the schema's own message. Only the first problem is reported. A missing body
  gives "Request body is required."

## Errors

Every error response has this shape (`server/src/middleware/errorHandler.ts`):

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Only 1 Cheese Toast left. Reduce the quantity in your cart.",
    "details": { "menuItemId": "…", "name": "Cheese Toast", "available": 1 }
  }
}
```

- `message` is always safe to show to the user. No stack trace or SQL text is sent.
- `details` is present only on the three cart-line errors (`INSUFFICIENT_STOCK`, `ITEM_UNAVAILABLE`,
  `ITEM_NOT_FOUND`): `{ menuItemId: string, name?: string, available: number }` (`ItemErrorDetails`). `available` is
  0 for a sold-out, unavailable or missing item.

### Error codes

| Status | Code                        | Raised by                                                                                                                                                                                                                                      |
| ------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`          | zod schemas; the 20-per-item cap; malformed JSON ("Malformed request body."); Postgres `22001` ("One of the values is too long."), `22021` / `22P05` ("Invalid characters in input."); Supabase Auth `email_address_invalid` / `weak_password` |
| 400    | `BAD_REQUEST`               | bad percent-encoding in the URL ("The request URL is malformed."); any other 4xx from body-parser ("The request could not be processed.")                                                                                                      |
| 400    | `ITEM_NOT_FOUND`            | `POST /orders`                                                                                                                                                                                                                                 |
| 400    | `ITEM_UNAVAILABLE`          | `POST /orders`                                                                                                                                                                                                                                 |
| 400    | `INSUFFICIENT_STOCK`        | `POST /orders` (from `place_order`)                                                                                                                                                                                                            |
| 400    | `STORE_CLOSED`              | `POST /orders`                                                                                                                                                                                                                                 |
| 401    | `UNAUTHORIZED`              | `requireAuth`                                                                                                                                                                                                                                  |
| 403    | `FORBIDDEN`                 | `requireStaff`                                                                                                                                                                                                                                 |
| 404    | `NOT_FOUND`                 | missing store, order or profile; an unmatched route ("No route matches <METHOD> <path>.")                                                                                                                                                      |
| 409    | `EMAIL_TAKEN`               | `POST /auth/register`                                                                                                                                                                                                                          |
| 409    | `INVALID_STATUS_TRANSITION` | `PATCH /orders/:id/status` (from `update_order_status`)                                                                                                                                                                                        |
| 413    | `PAYLOAD_TOO_LARGE`         | JSON body over the `express.json()` default limit of 100 kB ("The request body is too large.")                                                                                                                                                 |
| 500    | `INTERNAL`                  | anything else ("Something went wrong. Please try again."), logged with its stack                                                                                                                                                               |

`INVALID_CREDENTIALS` is listed in the server's `ErrorCode` union but the server never raises it. The client creates
it itself for a failed Supabase sign-in, together with `UNREACHABLE`, `RATE_LIMITED` and `UNKNOWN`
(`client/src/services/auth.ts`, `client/src/services/api.ts`, `client/src/lib/useResource.ts`). The client treats
`ApiError.code` as a plain string.

### Database errors (`P0001`)

The database functions report expected failures with `raise exception`: the message is an API error code and the
detail is a JSON object. `raisedByDatabase(err, code)` in `server/src/utils/supabase.ts` matches PostgREST errors with
SQLSTATE `P0001` and that message. `order.service.ts` maps them:

| Function              | Message                     | Detail                            | API response                       |
| --------------------- | --------------------------- | --------------------------------- | ---------------------------------- |
| `place_order`         | `INSUFFICIENT_STOCK`        | `{ menuItemId, name, available }` | 400 `INSUFFICIENT_STOCK` + details |
| `update_order_status` | `NOT_FOUND`                 | none                              | 404 `NOT_FOUND` "Order not found." |
| `update_order_status` | `INVALID_STATUS_TRANSITION` | `{ orderNumber, status }`         | 409 `INVALID_STATUS_TRANSITION`    |

Any other `P0001` or database error is a 500.

## Headers and limits

| Item              | Value                                                                                              | Source                                |
| ----------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `x-request-id`    | echoed on every response; a caller's value is kept if it matches `^[\w.-]{1,64}$`, else a new UUID | `server/src/app.ts`                   |
| CORS              | one allowed origin, `CLIENT_ORIGIN` (default `http://localhost:5173`)                              | `server/src/app.ts`, `utils/env.ts`   |
| `x-powered-by`    | disabled                                                                                           | `server/src/app.ts`                   |
| JSON body size    | 100 kB (the `express.json()` default); larger is 413                                               | `server/src/app.ts`                   |
| Lines per order   | 1–30, counted before merging duplicates                                                            | `order.schema.ts`                     |
| Quantity per item | 1–20 after merging duplicates                                                                      | `order.schema.ts`, `order.service.ts` |
| Staff order list  | newest 100                                                                                         | `order.service.ts`                    |
| Name              | 2–60 (register); at most 60 (`customerName`)                                                       | `auth.schema.ts`, `order.schema.ts`   |
| Note              | at most 200                                                                                        | `order.schema.ts`                     |
| Password          | 6–72                                                                                               | `auth.schema.ts`                      |
| Phone             | optional `+` and 10–15 digits after stripping spaces, dashes, parentheses                          | `common.ts`                           |

The client logs the `x-request-id` of a failed call so it can be matched to the server's log line. See
[LOGGING.md](LOGGING.md#request-ids).

## Caching

A stale copy must never mislead about stock, money or order status, so caching happens deliberately, at two layers.
The client's caching is [FRONTEND_STRUCTURE.md#caching](FRONTEND_STRUCTURE.md#caching); the policy behind both is
[CLAUDE.md](../CLAUDE.md) §2c.

### HTTP layer (every `/api` response)

`server/src/app.ts` sets, before the router runs:

| Header          | Value           | Why                                                                                                                                       |
| --------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Cache-Control` | `no-cache`      | the caller always revalidates before reusing a cached body; never a `max-age` — stock, the menu and order status can change at any moment |
| `Vary`          | `Authorization` | one account's cached response can never answer another account's request                                                                  |

Express's default ETag support turns this into a real saving: when the client sends back `If-None-Match` and the
body has not changed, the response is a bodiless `304 Not Modified` instead of the full JSON — on every poll
(customer 8 s, staff 4 s), on a metered connection.

### Server read cache (`server/src/utils/cache.ts`)

`GET /api/menu` and `GET /api/store` are additionally held in an in-process cache, so concurrent requests during a
cold cache share one database round-trip instead of repeating it:

| Export                        | What                                                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cached<T>(key, ttlMs, load)` | returns the cached value while younger than `ttlMs`; otherwise calls `load()` once and shares the pending promise between every concurrent miss. A failed load is dropped, never cached |
| `invalidate(key?)`            | drops one key, or every key with no argument                                                                                                                                            |
| `PUBLIC_READ_TTL_MS = 10_000` | the 10 s TTL used by both reads below                                                                                                                                                   |

| Cached endpoint  | Key       | Loader                                      | Invalidated by                                                                                                                                                        |
| ---------------- | --------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/menu`  | `'menu'`  | `menu.service.getMenu` → `loadMenu`         | `order.service.createOrder` (in a `finally`, so a placed order and a stock-refused one both invalidate it) and `updateOrderStatus` when the new status is `CANCELLED` |
| `GET /api/store` | `'store'` | `store.service.getCachedStore` → `getStore` | nothing today; a future store-editing endpoint must call `invalidate('store')`                                                                                        |

`createOrder`'s own `is_open` check calls the uncached `getStore()` directly, never `getCachedStore()` — a write
path never trusts a stale read of the data it is about to act on. Nothing user-specific (orders, profiles) is ever
put through `cached()`; the cache is per-process (see the `ponytail:` note in `cache.ts` for the multi-instance
ceiling — a shared cache such as Redis, or LISTEN/NOTIFY, is the upgrade if edits from a second API instance or the
Supabase dashboard ever need to show up faster than the TTL).

Tests: `server/test/unit/cache.safe.test.ts` (the cache primitive), `server/test/api/caching.safe.test.ts` (the HTTP
headers and the 304), `server/test/api/menu-cache.test.ts` (the menu cache tracks a real order and its
cancellation). See also [TESTING.md](TESTING.md).
