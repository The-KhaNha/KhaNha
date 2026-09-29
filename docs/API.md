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
   If the signing keys cannot be fetched (`JWKS_FETCH_FAILED`), 503 `UPSTREAM_UNAVAILABLE`; any other 5xx from the
   verifier (a misconfiguration: no JWKS, no keys) becomes 500 `INTERNAL`. Any other failure (bad
   signature, expired, another project) is 401 `UNAUTHORIZED` "Your session has expired. Please sign in again."
3. Loads `id, role` from `profiles`. No profile: 401 `UNAUTHORIZED` "That account no longer exists. Please sign in
   again."
4. Sets `req.user = { id, role }`.

`requireStaff` must run after `requireAuth`. A role other than `STAFF` is 403 `FORBIDDEN` "Only staff can do that."

`requireAdmin` (guards `/api/admin/*`) must run after `requireAuth`. A role other than `ADMIN` is 403 `FORBIDDEN`
"Only admins can do that." `ADMIN` is a separate, site-wide developer/operator role: it has no staff powers, so it
still gets 403 from `requireStaff` (see [PERMISSIONS.md](PERMISSIONS.md#roles)).

The API has no sign-in or sign-out route. The browser signs in and out with supabase-js directly
(`client/src/services/auth.ts`).

## Routes

| Method | Path                 | Auth         | Request                                                  | Success                                         |
| ------ | -------------------- | ------------ | -------------------------------------------------------- | ----------------------------------------------- |
| GET    | `/health`            | none         | none                                                     | 200 `{ ok: true, version, commit }`             |
| GET    | `/ready`             | none         | none                                                     | 200 `{ ready: true }` or 503 `{ ready: false }` |
| GET    | `/config`            | none         | none                                                     | 200 `ConfigDto`                                 |
| POST   | `/auth/register`     | none         | body: [`registerSchema`](#post-authregister)             | 201 `{ user: UserDto }`                         |
| GET    | `/auth/me`           | user         | none                                                     | 200 `{ user: UserDto }`                         |
| GET    | `/store`             | none         | none                                                     | 200 `{ store: StoreDto }`                       |
| GET    | `/menu`              | none         | none                                                     | 200 `MenuResponse`                              |
| POST   | `/orders`            | user         | body: [`createOrderSchema`](#post-orders)                | 201 `{ order: OrderDto }`                       |
| GET    | `/orders`            | user         | query: [`listOrdersQuerySchema`](#get-orders)            | 200 `{ orders: OrderDto[] }`                    |
| GET    | `/orders/:id`        | user         | path: `id`                                               | 200 `{ order: OrderDto }`                       |
| PATCH  | `/orders/:id/status` | user + STAFF | body: [`updateOrderStatusSchema`](#patch-ordersidstatus) | 200 `{ order: OrderDto }`                       |
| GET    | `/admin/settings`    | user + ADMIN | none                                                     | 200 `{ settings: SiteSettingsDto }`             |
| PATCH  | `/admin/settings`    | user + ADMIN | body: [`updateSettingsSchema`](#patch-adminsettings)     | 200 `{ settings: SiteSettingsDto }`             |

`orderRouter.use(requireAuth)` runs before any `/orders` route matches. So any path under `/api/orders`, including
one that matches no route, returns 401 without a valid token. `adminRouter.use(requireAuth, requireAdmin)` does the
same for every path under `/api/admin`.

### GET /health

Code: `server/src/controllers/health.controller.ts`. Liveness: always 200
`{ "ok": true, "version": "0.1.0", "commit": "1a2b3c4…" }`. `version` is `server/package.json`'s (bumped only by the
release PR); `commit` is `GIT_COMMIT` (`unknown` outside an image build). It does not touch the database, so a
database outage never restarts a healthy container.

### GET /config

Code: `server/src/services/config.service.ts`. Public (no token), registered before the [client version
gate](#client-version-gate) so an outdated client can still read the minimum it must reach. Derived from the cached
site settings (no cache key of its own, so an admin's `PATCH /admin/settings` reaches it at once through
`invalidate('site_settings')`) plus `SESSION_IDLE_DAYS`. `ConfigDto`:

```json
{
  "serverVersion": "0.1.0",
  "minClientVersion": "0.0.0",
  "features": {},
  "payment": null,
  "limits": { "maxLinesPerOrder": 30 },
  "polling": { "orderMs": 4000, "ordersMs": 8000, "staffBoardMs": 4000 },
  "session": { "idleDays": 7 }
}
```

`features` stays empty until P1.7 and `payment` null until P5. The client's defaults for this shape are
`client/src/config/fallbacks.json`; `server/test/api/config.test.ts` fails when they differ from a freshly seeded
database.

### GET /ready

Code: `server/src/controllers/health.controller.ts`. Readiness: one `site_settings` select with a 1-second
`AbortSignal.timeout`. 200 `{ "ready": true }` when it answers, else 503 `{ "ready": false }`. The failure is the
answer, not an error: it never reaches the error handler or the error log. Load balancers and compose use this to
hold traffic back from an instance that cannot reach the database.

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

- `rules`: `{ maxQuantityPerItem: 10, lowStockThreshold: 5 }`, the cart rules (server constants until P2.3 makes
  them per store; the client still applies its own copies in `cartRules.ts` until then).
- `store`: `StoreDto`.
- `popular`: the items with `isPopular` true, in `sortOrder` order.
- `categories`: `{ name, items }[]`. A category is placed by its first (lowest `sortOrder`) item.

Each item's `isAvailable` is `is_available AND (stock_quantity IS NULL OR stock_quantity > 0)` (`isPurchasable` in
`server/src/utils/serializers.ts`). `stockQuantity` is `null` when the item does not track stock. Same 404 as
`GET /store` when there is no store.

### POST /orders

Code: `requireAuth` → `writeLimiter` → `validate(createOrderSchema)` → `order.controller.createOrder` →
`order.service.createOrder` → `place_order` RPC.

Body (`server/src/schemas/order.schema.ts`):

| Field                | Type   | Rules                                                                                       |
| -------------------- | ------ | ------------------------------------------------------------------------------------------- |
| `items`              | array  | required, 1–30 entries (counted before duplicates are merged)                               |
| `items[].menuItemId` | string | required, at least 1 character                                                              |
| `items[].quantity`   | number | required, whole number, at least 1                                                          |
| `customerName`       | string | optional, trimmed, at most 60 characters; blank or missing falls back to the profile name   |
| `customerPhone`      | string | optional; see [phone numbers](#shared-field-rules)                                          |
| `note`               | string | optional, trimmed, at most 200 characters                                                   |
| `idempotencyKey`     | string | optional, a UUID; one per checkout attempt, resent unchanged on every retry of that attempt |

- Entries with the same `menuItemId` are merged into one line with the quantities summed (`mergeDuplicateItems`).
- Unknown keys (`price`, `unitPrice`, `total`, …) are dropped by `z.object`. Prices come from the database only.
- **Idempotency:** a request whose `idempotencyKey` already placed an order for this user is answered with that
  order again (201, the same body), without touching stock or payment: the service checks first, and `place_order`
  settles two simultaneous repeats under an advisory lock ([SCHEMA.md](SCHEMA.md#place_order)). The key is per
  user (two users may send the same value), never echoed back, and a request without one always places a new
  order (the deployed V0 client sends none). The client (`features/checkout/checkoutDraftStore.ts`) keeps one key
  per checkout attempt in `sessionStorage`, so a refresh during "Processing payment…" cannot create a second order.
- **A repeated key must carry the same order:** the same merged items and quantities, name, phone and note. A
  different request under a key that already placed an order (the cart changed after a Pay whose answer was lost) is
  409 `IDEMPOTENCY_KEY_REUSED` with `details: { orderId, orderNumber }`, never a silent replay, so the customer is
  never told they paid for items the kitchen will not see. The client then links to that order, keeps the cart, and
  pays the next time under a new key.

What the service checks, in this order:

1. The store is open (`stores.is_open`), else 400 `STORE_CLOSED` "<store name> is closed right now. Please come back
   when it opens."
2. For each line, in cart order (`priceLines`):
   - the item exists (ids that are not UUIDs are never queried and count as missing), else 400 `ITEM_NOT_FOUND`
     "One of the items is no longer on the menu." with `details: { menuItemId, available: 0 }`;
   - `is_available` is true, else 400 `ITEM_UNAVAILABLE` "<name> is currently unavailable. Please remove it from your
     cart." with `details: { menuItemId, name, available: 0 }`;
   - the merged quantity is at most 10 (`MAX_QUANTITY_PER_ITEM`, a fixed constant — not a `site_settings` value), else
     400 `VALIDATION_ERROR` "You can order at most 10 of <name>. Please reduce the quantity in your cart."
3. `total = Σ unit_price × quantity` from the database prices, then `simulatePayment(total)` returns `PAID`
   (`server/src/services/payment.service.ts`).
4. `place_order` reserves stock and writes the order in one transaction. Not enough stock: 400
   `INSUFFICIENT_STOCK` with `details: { menuItemId, name, available }` and the message "Only <n> <name> left. Reduce
   the quantity in your cart." or, when `available` is 0, "<name> just sold out." A refused order leaves no rows and
   no stock changes behind (see [SCHEMA.md](SCHEMA.md#place_order)).

A new order is `paymentStatus: "PAID"`, `status: "PLACED"`, `estimatedReadyAt = now() + store.prep_time_max_minutes`.

| Status | Code                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------- |
| 201    | `{ order: OrderDto }`                                                                                    |
| 400    | `VALIDATION_ERROR`, `ITEM_NOT_FOUND`, `ITEM_UNAVAILABLE`, `INSUFFICIENT_STOCK`, `STORE_CLOSED`           |
| 401    | `UNAUTHORIZED`                                                                                           |
| 404    | `NOT_FOUND` (no store row)                                                                               |
| 409    | `IDEMPOTENCY_KEY_REUSED` (the key already placed a different order; `details: { orderId, orderNumber }`) |
| 413    | `PAYLOAD_TOO_LARGE`                                                                                      |
| 429    | `RATE_LIMITED` (the per-user write limit, [Headers and limits](#headers-and-limits))                     |

### GET /orders

Code: `requireAuth` → `validate(listOrdersQuerySchema, 'query')` → `order.controller.listOrders` →
`order.service.listOrders`.

Query: `status` (optional), one of `PLACED`, `PREPARING`, `READY`, `COLLECTED`, `CANCELLED`. Anything else is 400
`VALIDATION_ERROR` "Status must be one of PLACED, PREPARING, READY, COLLECTED, CANCELLED."

- Customers get their newest `customerOrderHistoryLimit` orders (a `site_settings` row, default 20).
- Staff get the newest `staffOrderListLimit` orders across all customers (a `site_settings` row, default 100).
- Both limits are read fresh on every call (`order.service.listOrders` calls `settings.service.getSettings()`, which
  goes through the same 10 s read cache as the menu and store — see [Caching](#caching)) and are edited only from the
  admin dashboard, [GET/PATCH /admin/settings](#get-adminsettings). Neither is a fixed constant any more.
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
| `READY`     | `COLLECTED`              |
| `COLLECTED` | none                     |
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

### GET /admin/settings

Code: `requireAuth` → `requireAdmin` → `admin.controller.getSettings` → `settings.service.getSettings`. Returns the
single `site_settings` row as `{ settings: SiteSettingsDto }`. Read through the same 10 s process cache as the menu
and store (key `'site_settings'`; see [Caching](#caching)).

| Status | Code           | When                                  |
| ------ | -------------- | ------------------------------------- |
| 200    |                | `{ settings: SiteSettingsDto }`       |
| 401    | `UNAUTHORIZED` | see [Authentication](#authentication) |
| 403    | `FORBIDDEN`    | caller is not `ADMIN`                 |

### PATCH /admin/settings

Code: `requireAuth` → `requireAdmin` → `validate(updateSettingsSchema)` → `admin.controller.updateSettings` →
`settings.service.updateSettings`.

Body (`server/src/schemas/admin.schema.ts`), every field optional but at least one required:

| Field                                             | Type   | Rules                                                                                                |
| ------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| `customerOrderHistoryLimit`                       | number | whole number, 1–200                                                                                  |
| `staffOrderListLimit`                             | number | whole number, 1–500                                                                                  |
| `maxLinesPerOrder`                                | number | whole number, 1–100 ("Items per order must be …")                                                    |
| `orderPollMs`, `ordersPollMs`, `staffBoardPollMs` | number | whole number, 2000–60000 ("Order page refresh / Order list refresh / Staff board refresh must be …") |
| `minClientVersion`                                | string | `^\d+\.\d+\.\d+$` ("Minimum client version must look like 1.2.3.")                                   |

- An out-of-range or non-integer value is 400 `VALIDATION_ERROR` ("Customer order history limit must be at least
  1."/"...at most 200."/"...must be a whole number.", and the equivalent messages for the staff limit).
- Sending neither field is 400 `VALIDATION_ERROR` "Send at least one setting to change."
- The bounds mirror the `site_settings` check constraints exactly (see [SCHEMA.md](SCHEMA.md#site_settings)), so a
  bad value is always a 400 here, never a database error.
- Only the fields sent are written (`settings.service.ts` maps each defined field to its column).
- On success, `updated_by` is set to the calling admin's id, `updated_at` advances, and the process cache key
  `'site_settings'` is invalidated at once, so the very next `GET /api/orders` (on this API instance) uses the new
  limit. The controller logs `Site settings changed` at `info` with the new values and `by: admin.id`.

| Status | Code               | When                                                     |
| ------ | ------------------ | -------------------------------------------------------- |
| 200    |                    | `{ settings: SiteSettingsDto }`                          |
| 400    | `VALIDATION_ERROR` | a field out of bounds, wrong type, or neither field sent |
| 401    | `UNAUTHORIZED`     | see [Authentication](#authentication)                    |
| 403    | `FORBIDDEN`        | caller is not `ADMIN`                                    |

## Response DTOs

From `server/src/types/api.ts`. The serializers in `server/src/utils/serializers.ts` turn snake_case rows into these
camelCase shapes and every timestamp into ISO 8601 (`new Date(ts).toISOString()`). Money is whole rupees as integers.

`UserDto`

| Field       | Type                                   |
| ----------- | -------------------------------------- |
| `id`        | string (uuid)                          |
| `name`      | string                                 |
| `email`     | string                                 |
| `phone`     | string \| null                         |
| `role`      | `'CUSTOMER'` \| `'STAFF'` \| `'ADMIN'` |
| `createdAt` | string (ISO 8601)                      |

`ADMIN` is the site-wide developer/operator role (the `/admin` dashboard), not a restaurant role — see
[PERMISSIONS.md](PERMISSIONS.md#roles).

`SiteSettingsDto`

| Field                       | Type              | Notes                                                                                      |
| --------------------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| `customerOrderHistoryLimit` | number            | 1–200, default 20; caps `GET /orders` for a customer                                       |
| `staffOrderListLimit`       | number            | 1–500, default 100; caps `GET /orders` for staff                                           |
| `maxLinesPerOrder`          | number            | 1–100, default 30; most lines one order may have                                           |
| `orderPollMs`               | number            | 2000–60000, default 4000; an open order's page poll interval (ms)                          |
| `ordersPollMs`              | number            | 2000–60000, default 8000; the customer's order list poll interval (ms)                     |
| `staffBoardPollMs`          | number            | 2000–60000, default 4000; the staff board poll interval (ms)                               |
| `minClientVersion`          | string            | default `0.0.0`; clients below it get 426 `CLIENT_OUTDATED` ([gate](#client-version-gate)) |
| `updatedAt`                 | string (ISO 8601) | set whenever a setting is saved                                                            |

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
| `stockQuantity` | number \| null | units left; `null` = not tracked (only the 10-per-order cap) |

`MenuResponse`: `{ rules: { maxQuantityPerItem, lowStockThreshold }, store: StoreDto, popular: MenuItemDto[], categories: { name: string, items: MenuItemDto[] }[] }`.

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
- `details` takes one of three shapes. On the three cart-line errors (`INSUFFICIENT_STOCK`, `ITEM_UNAVAILABLE`,
  `ITEM_NOT_FOUND`): `{ menuItemId: string, name?: string, available: number }` (`ItemErrorDetails`), where
  `available` is 0 for a sold-out, unavailable or missing item. On `IDEMPOTENCY_KEY_REUSED`: `{ orderId, orderNumber }`
  (`ReplayedOrderDetails`). On a `VALIDATION_ERROR` about one request field, and on `EMAIL_TAKEN`: `{ field }`, the
  top-level field at fault (`customerPhone`, `email`, `items` for `items[2].quantity`) (`FieldErrorDetails`), so a
  form shows the message on that field; a rule with no single field (the lines limit) carries no `details`.

### Error codes

| Status | Code                        | Raised by                                                                                                                                                                                                                                                                                                  |
| ------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`          | zod schemas; the 10-per-item cap; the `site_settings` bounds (`GET`/`PATCH /admin/settings`); malformed JSON ("Malformed request body."); Postgres `22001` ("One of the values is too long."), `22021` / `22P05` ("Invalid characters in input."); Supabase Auth `email_address_invalid` / `weak_password` |
| 400    | `BAD_REQUEST`               | bad percent-encoding in the URL ("The request URL is malformed."); any other 4xx from body-parser ("The request could not be processed.")                                                                                                                                                                  |
| 400    | `ITEM_NOT_FOUND`            | `POST /orders`                                                                                                                                                                                                                                                                                             |
| 400    | `ITEM_UNAVAILABLE`          | `POST /orders`                                                                                                                                                                                                                                                                                             |
| 400    | `INSUFFICIENT_STOCK`        | `POST /orders` (from `place_order`)                                                                                                                                                                                                                                                                        |
| 400    | `STORE_CLOSED`              | `POST /orders`                                                                                                                                                                                                                                                                                             |
| 401    | `UNAUTHORIZED`              | `requireAuth`                                                                                                                                                                                                                                                                                              |
| 403    | `FORBIDDEN`                 | `requireStaff`, `requireAdmin`                                                                                                                                                                                                                                                                             |
| 429    | `RATE_LIMITED`              | `middleware/rateLimit.ts`: more requests than the window allows from one account (writes) or one address (all of `/api`, `POST /auth/register`); "Too many requests. Please wait a minute and try again." with `Retry-After`, `RateLimit-Policy` and `RateLimit` headers. Logged at `warn`                 |
| 426    | `CLIENT_OUTDATED`           | every route mounted after the [client version gate](#client-version-gate): the client's `X-Client-Version` is below `site_settings.min_client_version`. "A new version of Food Pickup is available. Refresh the page to continue." Logged at `debug`                                                       |
| 404    | `NOT_FOUND`                 | missing store, order or profile; an unmatched route ("No route matches <METHOD> <path>.")                                                                                                                                                                                                                  |
| 409    | `EMAIL_TAKEN`               | `POST /auth/register`                                                                                                                                                                                                                                                                                      |
| 409    | `INVALID_STATUS_TRANSITION` | `PATCH /orders/:id/status` (from `update_order_status`)                                                                                                                                                                                                                                                    |
| 409    | `IDEMPOTENCY_KEY_REUSED`    | `POST /orders`: the `idempotencyKey` already placed an order that differs from this request. "Your earlier order #<n> already went through. Pay again to order what is in your cart now." with `details: { orderId, orderNumber }` (`ReplayedOrderDetails`)                                                |
| 413    | `PAYLOAD_TOO_LARGE`         | JSON body over 100 kB (`JSON_BODY_LIMIT_BYTES`), refused on the declared `Content-Length` before the body is read, with `Connection: close`; a chunked body when it passes the limit ("The request body is too large.")                                                                                    |
| 500    | `INTERNAL`                  | anything else ("Something went wrong. Please try again."), logged with its stack                                                                                                                                                                                                                           |
| 503    | `UPSTREAM_UNAVAILABLE`      | any route when the database or Supabase Auth cannot be reached (an `IntegrationError`): "The service is temporarily unavailable. Please try again in a moment.", with `Retry-After: 5`; logged once at `error` with the cause chain                                                                        |

The client also creates codes the server never sends: `INVALID_CREDENTIALS` for a failed Supabase sign-in, together with `UNREACHABLE` and `UNKNOWN` (and `RATE_LIMITED` for Supabase Auth's own 429, the same code the API uses)
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

## Client version gate

`clientVersionGate` (`server/src/middleware/clientVersion.ts`) runs on every route mounted after it in
`server/src/routes/index.ts`. It reads `X-Client-Version` (missing or malformed counts as `0.1.0`, the deployed V0
client that sends none), compares its numeric triple with `site_settings.min_client_version` (read through the
settings cache: no database round trip per request) and answers 426 `CLIENT_OUTDATED` when it is lower. A prerelease
label is ignored, so a staging build is never older than its own release.

- **Exempt by mount order, not a path list:** `/health` and `/ready` are registered before the gate (later
  `/config` and the payment webhooks join them). CORS preflights never reach the router (`cors()` answers them), and
  the same-origin client sends none.
- **Before auth:** the gate runs before any router's `requireAuth`, so a stale tab gets 426, not 401.
- **The client:** `services/api.ts` sets the `outdated` flag on any 426 and `App` shows a "New version available"
  banner with Refresh; `useResource` stops polling after a 426. The V0 client has no banner, but it shows the
  envelope's message in `ErrorState`, which is the intended fallback for the first gated release.
- Raise the minimum with `PATCH /admin/settings` `{ "minClientVersion": "x.y.z" }` when a change ships that the
  deployed client cannot survive (CLAUDE.md §2); `0.0.0` gates nothing.

## Headers and limits

| Item                   | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Source                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `X-Client-Version`     | sent by the client on every request (`client/package.json` version); logged as `clientVersion` on the access line (`none` when missing, or not `^\d+\.\d+\.\d+(-[\w.]+)?$` up to 32 chars)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `client/src/services/api.ts`, `server/src/middleware/clientVersion.ts` |
| `x-request-id`         | echoed on every response; a caller's value is kept if it matches `^[\w.-]{1,64}$`, else a new UUID                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `server/src/app.ts`                                                    |
| CORS                   | one allowed origin, `CLIENT_ORIGIN` (default `http://localhost:5173`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `server/src/app.ts`, `utils/env.ts`                                    |
| `x-powered-by`         | disabled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `server/src/app.ts`                                                    |
| Security headers       | every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`; `Strict-Transport-Security: max-age=86400` only on a request that arrived over TLS (`req.secure`, honouring `X-Forwarded-Proto` through `trust proxy`). The web image's nginx adds the page's own headers ([DEPLOYMENT.md](DEPLOYMENT.md#web-image-headers))                                                                                                                                                                                                                                     | `server/src/middleware/securityHeaders.ts`                             |
| Rate limits            | fixed windows of `RATE_LIMIT_WINDOW_MS` (default 60 s), counted per process: `RATE_LIMIT_IP_MAX` (600) requests per address on all of `/api`; `RATE_LIMIT_WRITE_MAX` (30) per signed-in user on `POST /orders`, `PATCH /orders/:id/status`, `PATCH /admin/settings`; `RATE_LIMIT_REGISTER_MAX` (10) per address on `POST /auth/register`. Over the limit: 429 `RATE_LIMITED` with `Retry-After` and the draft-7 `RateLimit-Policy` / `RateLimit` headers; 0 turns a limit off. Per user, not per address, because campus Wi-Fi puts many customers behind one address ([CONFIGURATION.md](CONFIGURATION.md#deployment-settings), [ADR-009](adr/009-rate-limiting-token-buckets.md)) | `server/src/middleware/rateLimit.ts`, `utils/env.ts`                   |
| JSON body size         | 100 kB (`JSON_BODY_LIMIT_BYTES`); larger is 413, refused on the declared `Content-Length` before the body is read (`Connection: close`), so a slow phone learns at once. The web image's nginx caps bodies at the same 100 kB with the same JSON envelope and drops a client silent mid-body for 15 s (`client_body_timeout`)                                                                                                                                                                                                                                                                                                                                                       | `server/src/app.ts`                                                    |
| Lines per order        | site setting `max_lines_per_order`, default 30 (1–100, `PATCH /admin/settings`), counted before merging duplicates; enforced by `createOrder` ("An order can have at most N items."); the schema's hard cap is 100 (`MAX_ITEM_LINES_HARD`). Through the settings cache, another instance may apply a new value up to 10 s late                                                                                                                                                                                                                                                                                                                                                      | `order.service.ts`, `order.schema.ts`, `site_settings`                 |
| Quantity per item      | 1–10 after merging duplicates, a fixed constant (`MAX_QUANTITY_PER_ITEM`), not editable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `order.schema.ts`, `order.service.ts`                                  |
| Customer order history | site setting, default 20 (1–200), editable at `PATCH /admin/settings`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `settings.service.ts`, `site_settings`                                 |
| Staff order list       | site setting, default 100 (1–500), editable at `PATCH /admin/settings`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `settings.service.ts`, `site_settings`                                 |
| Name                   | 2–60 (register); at most 60 (`customerName`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `auth.schema.ts`, `order.schema.ts`                                    |
| Note                   | at most 200                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `order.schema.ts`                                                      |
| Password               | 6–72                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `auth.schema.ts`                                                       |
| Phone                  | optional `+` and 10–15 digits after stripping spaces, dashes, parentheses                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `common.ts`                                                            |

The client logs the `x-request-id` of a failed call so it can be matched to the server's log line. See
[LOGGING.md](LOGGING.md#request-ids).

## Caching

A stale copy must never mislead about stock, money or order status, so caching happens deliberately, at two layers.
The client's caching is [FRONTEND_STRUCTURE.md#caching](FRONTEND_STRUCTURE.md#caching); the policy behind both is
[CLAUDE.md](../CLAUDE.md) §2c.

### HTTP layer (every `/api` response)

`server/src/app.ts` sets these before `pino-http`, `cors` and `express.json()`, so a CORS preflight or a
malformed-JSON error response — neither of which reaches the router below — still carries them:

| Header          | Value           | Why                                                                                                                                       |
| --------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Cache-Control` | `no-cache`      | the caller always revalidates before reusing a cached body; never a `max-age` — stock, the menu and order status can change at any moment |
| `Vary`          | `Authorization` | one account's cached response can never answer another account's request                                                                  |

Express's default ETag support turns this into a real saving: when the client sends back `If-None-Match` and the
body has not changed, the response is a bodiless `304 Not Modified` instead of the full JSON — on every poll
(customer 8 s, staff 4 s), on a metered connection.

### Server read cache (`server/src/utils/cache.ts`)

`GET /api/menu`, `GET /api/store` and the `site_settings` row (read by every `GET /api/orders`, by
`GET /api/admin/settings`, by `GET /api/config` and by the client version gate) are additionally held in an in-process cache, so concurrent requests during a cold cache
share one database round-trip instead of repeating it:

| Export                        | What                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cached<T>(key, ttlMs, load)` | returns the cached value while younger than `ttlMs`; otherwise calls `load()` once and shares the pending promise between every concurrent miss, however long it takes — the `ttlMs` clock only starts once the load settles, so a slow load is never re-triggered mid-flight. A failed load is dropped, never cached |
| `invalidate(key?)`            | drops one key, or every key with no argument                                                                                                                                                                                                                                                                          |
| `PUBLIC_READ_TTL_MS`          | the TTL used by the reads below: env `PUBLIC_READ_TTL_MS`, default 10000 ms (0 turns the cache off)                                                                                                                                                                                                                   |

| Cached endpoint                                                 | Key               | Loader                                      | Invalidated by                                                                                                                                                        |
| --------------------------------------------------------------- | ----------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/menu`                                                 | `'menu'`          | `menu.service.getMenu` → `loadMenu`         | `order.service.createOrder` (in a `finally`, so a placed order and a stock-refused one both invalidate it) and `updateOrderStatus` when the new status is `CANCELLED` |
| `GET /api/store`                                                | `'store'`         | `store.service.getCachedStore` → `getStore` | nothing today; a future store-editing endpoint must call `invalidate('store')`                                                                                        |
| `GET /api/orders`, `GET /api/admin/settings`, `GET /api/config` | `'site_settings'` | `settings.service.getSettings`              | `settings.service.updateSettings` (`PATCH /api/admin/settings`), at once                                                                                              |

`createOrder`'s own `is_open` check calls the uncached `getStore()` directly, never `getCachedStore()` — a write
path never trusts a stale read of the data it is about to act on. Nothing user-specific (orders, profiles) is ever
put through `cached()`; the cache is per-process (see the `ponytail:` note in `cache.ts` for the multi-instance
ceiling — a shared cache such as Redis, or LISTEN/NOTIFY, is the upgrade if edits from a second API instance or the
Supabase dashboard ever need to show up faster than the TTL).

Tests: `server/test/unit/cache.safe.test.ts` (the cache primitive), `server/test/api/caching.safe.test.ts` (the HTTP
headers and the 304), `server/test/api/menu-cache.test.ts` (the menu cache tracks a real order and its
cancellation), `server/test/api/admin.test.ts` (settings bounds, `requireAdmin`, and the cache invalidation on
save). See also [TESTING.md](TESTING.md).
