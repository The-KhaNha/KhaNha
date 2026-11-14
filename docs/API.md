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
4. Records the use of the sign-in (the token's `session_id`) with `touch_session`, at most once per session per
   5 minutes per API process. A sign-in unused for `SESSION_IDLE_DAYS` is 401 `UNAUTHORIZED` "Your session has
   expired. Please sign in again." and is revoked (`auth.admin.signOut(token, 'local')`), so its refresh token stops
   working too ([PERMISSIONS.md](PERMISSIONS.md#session-lifetime)). The same 401 answers a sign-in no longer live in
   Supabase Auth (signed out or revoked) whose access token has not expired yet; a process that already checked that
   session in the last 5 minutes lets it through until its window ends. A refusal is remembered for 5 minutes per
   process, so a replayed token is refused without a database call. If the check itself fails, the request goes on
   (fail-open, logged `error` "Session idle check failed").
5. Sets `req.user = { id, role }`.

`requireAdmin` (guards `/api/admin/*`) must run after `requireAuth`. A role other than `ADMIN` is 403 `FORBIDDEN`
"Only admins can do that." `ADMIN` is a separate, site-wide developer/operator role: it has no staff powers, so it
reads and moves orders only through a store membership (see [PERMISSIONS.md](PERMISSIONS.md#roles)).

The API has no sign-in or sign-out route. The browser signs in and out with supabase-js directly
(`client/src/services/auth.ts`).

## Routes

| Method | Path                                                  | Auth                                | Request                                                                    | Success                                                        |
| ------ | ----------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| GET    | `/health`                                             | none                                | none                                                                       | 200 `{ ok: true, version, commit }`                            |
| GET    | `/ready`                                              | none                                | none                                                                       | 200 `{ ready: true }` or 503 `{ ready: false }`                |
| GET    | `/config`                                             | none                                | none                                                                       | 200 `ConfigDto`                                                |
| POST   | `/client-errors`                                      | none                                | body: [`clientErrorsSchema`](#post-client-errors)                          | 204, no body                                                   |
| POST   | `/auth/register`                                      | none                                | body: [`registerSchema`](#post-authregister)                               | 201 `{ user: UserDto }`                                        |
| GET    | `/auth/me`                                            | user                                | none                                                                       | 200 `{ user: UserDto }`                                        |
| GET    | `/stores`                                             | none                                | query `area?`                                                              | 200 `{ stores: StoreSummaryDto[] }`                            |
| GET    | `/stores/:storeRef`                                   | none                                | none                                                                       | 200 `{ store: StoreDto }`                                      |
| GET    | `/stores/:storeRef/menu`                              | none                                | none                                                                       | 200 `MenuResponse`                                             |
| POST   | `/orders`                                             | user                                | body: [`createOrderSchema`](#post-orders)                                  | 201 `{ order: OrderDto }`                                      |
| GET    | `/orders`                                             | user                                | query: [`listOrdersQuerySchema`](#get-orders)                              | 200 `{ orders: OrderDto[] }`                                   |
| GET    | `/orders/:id`                                         | user                                | path: `id`                                                                 | 200 `{ order: OrderDto }`                                      |
| GET    | `/stores/:storeId/orders`                             | user + `orders.view`                | query: [`listOrdersQuerySchema`](#get-storesstoreidorders)                 | 200 `{ orders: OrderDto[] }`                                   |
| PATCH  | `/stores/:storeId/orders/:orderId/status`             | user + `orders.transition`          | body: [`updateOrderStatusSchema`](#patch-storesstoreidordersorderidstatus) | 200 `{ order: OrderDto }`                                      |
| GET    | `/stores/:storeId/menu-items`                         | user + `menu.edit`                  | none                                                                       | 200 `{ items: ManagedMenuItemDto[] }`                          |
| POST   | `/stores/:storeId/menu-items`                         | user + `menu.edit`                  | body: [`createMenuItemSchema`](#post-storesstoreidmenu-items)              | 201 `{ item: ManagedMenuItemDto }`                             |
| PATCH  | `/stores/:storeId/menu-items/:itemId`                 | user + `menu.edit`                  | body: [`updateMenuItemSchema`](#patch-storesstoreidmenu-itemsitemid)       | 200 `{ item: ManagedMenuItemDto }`                             |
| DELETE | `/stores/:storeId/menu-items/:itemId`                 | user + `menu.edit`                  | path: `itemId`                                                             | 204                                                            |
| POST   | `/stores/:storeId/menu-items/bulk`                    | user + `menu.edit`                  | body: [`bulkAvailabilitySchema`](#post-storesstoreidmenu-itemsbulk)        | 200 `{ updated: number }`                                      |
| PUT    | `/stores/:storeId/menu-items/order`                   | user + `menu.edit`                  | body: [`reorderMenuSchema`](#put-storesstoreidmenu-itemsorder)             | 204                                                            |
| GET    | `/stores/:storeId/modifier-groups`                    | user + `menu.edit`                  | none                                                                       | 200 `{ groups: ModifierGroupDto[], itemGroupIds }`             |
| POST   | `/stores/:storeId/modifier-groups`                    | user + `menu.edit`                  | body: [`saveModifierGroupSchema`](#modifier-groups-p32)                    | 201 `{ group: ModifierGroupDto }`                              |
| PATCH  | `/stores/:storeId/modifier-groups/:groupId`           | user + `menu.edit`                  | body: [`saveModifierGroupSchema`](#modifier-groups-p32)                    | 200 `{ group: ModifierGroupDto }`                              |
| DELETE | `/stores/:storeId/modifier-groups/:groupId`           | user + `menu.edit`                  | path: `groupId`                                                            | 204                                                            |
| PUT    | `/stores/:storeId/menu-items/:itemId/modifier-groups` | user + `menu.edit`                  | body: [`setItemModifierGroupsSchema`](#modifier-groups-p32)                | 200 `{ groupIds }`                                             |
| PATCH  | `/stores/:storeId/menu-items/:itemId/stock`           | user + `stock.update`               | body: [`adjustStockSchema`](#patch-storesstoreidmenu-itemsitemidstock)     | 200 `{ stockQuantity }`                                        |
| GET    | `/stores/:storeId/stock`                              | user + `stock.update`               | none                                                                       | 200 `{ items: ManagedMenuItemDto[], lowStockThreshold }`       |
| GET    | `/stores/:storeId/stock-movements`                    | user + `stock.update`               | query `itemId?`                                                            | 200 `{ movements: StockMovementDto[] }`                        |
| POST   | `/stores/:storeId/media/uploads`                      | user + `menu.edit`                  | body: [`createUploadSchema`](#photo-uploads)                               | 201 `{ uploadId, upload: { method, url, fields?, headers? } }` |
| PUT    | `/stores/:storeId/media/uploads/:uploadId/file`       | user + `menu.edit`, local mode only | the raw bytes (at most 8 MB)                                               | 204                                                            |
| POST   | `/stores/:storeId/media/uploads/:uploadId/complete`   | user + `menu.edit`                  | none                                                                       | 200 `{ upload: MediaUploadDto }`                               |
| GET    | `/stores/:storeId/media/uploads/:uploadId`            | user + `menu.edit`                  | none                                                                       | 200 `{ upload: MediaUploadDto }`                               |
| PUT    | `/stores/:storeId/hours`                              | user + `hours.edit`                 | body: [`setStoreHoursSchema`](#put-storesstoreidhours)                     | 200 `StoreScheduleResponse`                                    |
| POST   | `/stores/:storeId/schedule-exceptions`                | user + `hours.edit`                 | body: [`createExceptionSchema`](#post-storesstoreidschedule-exceptions)    | 201 `{ exception: ScheduleExceptionDto }`                      |
| DELETE | `/stores/:storeId/schedule-exceptions/:exceptionId`   | user + `hours.edit`                 | path: `exceptionId`                                                        | 204                                                            |
| GET    | `/brands/mine`                                        | user                                | none                                                                       | 200 `{ brands: MyBrandDto[] }`                                 |
| POST   | `/brands/:brandId/template/push`                      | user, owner of the brand            | body: [`pushTemplateSchema`](#post-brandsbrandidtemplatepush)              | 200 `{ updated: number }`                                      |
| POST   | `/brands/:brandId/stores`                             | user, owner of the brand            | body: [`createStoreSchema`](#post-brandsbrandidstores)                     | 201 `{ store: ManagedStoreDto }`                               |
| GET    | `/stores/:storeId/manage`                             | user + `store.profile`              | none                                                                       | 200 `ManageStoreResponseDto`                                   |
| GET    | `/stores/:storeId/manage/hours`                       | user + `hours.edit`                 | none                                                                       | 200 `StoreScheduleResponse`                                    |
| PATCH  | `/stores/:storeId/profile`                            | user + `store.profile`              | body: [`updateStoreProfileSchema`](#patch-storesstoreidprofile)            | 200 `{ store: ManagedStoreDto }`                               |
| POST   | `/stores/:storeId/publish`                            | user + `store.publish`              | none                                                                       | 200 `{ store: ManagedStoreDto }`                               |
| POST   | `/stores/:storeId/unpublish`                          | user + `store.publish`              | none                                                                       | 200 `{ store: ManagedStoreDto }`                               |
| GET    | `/stores/:storeId/members`                            | user + `team.manageStaff`           | none                                                                       | 200 `{ members: MemberDto[], invites: InviteDto[] }`           |
| POST   | `/stores/:storeId/invites`                            | user + `team.manageStaff`           | body: [`createInviteSchema`](#post-storesstoreidinvites)                   | 201 `{ invite: InviteDto, token: string }`                     |
| DELETE | `/stores/:storeId/invites/:inviteId`                  | user + `team.manageStaff`           | path: `inviteId`                                                           | 204, no body                                                   |
| DELETE | `/stores/:storeId/members/:membershipId`              | user + `team.manageStaff`           | path: `membershipId`                                                       | 204, no body                                                   |
| POST   | `/me/invites/accept`                                  | user                                | body: [`acceptInviteSchema`](#post-meinvitesaccept)                        | 200 `{ membership: { id, role, store: { id, slug, name } } }`  |
| GET    | `/admin/settings`                                     | user + ADMIN                        | none                                                                       | 200 `{ settings: SiteSettingsDto }`                            |
| PATCH  | `/admin/settings`                                     | user + ADMIN                        | body: [`updateSettingsSchema`](#patch-adminsettings)                       | 200 `{ settings: SiteSettingsDto }`                            |
| GET    | `/stores/:storeId/audit`                              | user + `audit.store`                | query: [`auditQuerySchema`](#get-storesstoreidaudit)                       | 200 `AuditPageDto`                                             |
| GET    | `/admin/audit`                                        | user + ADMIN                        | query: [`auditQuerySchema`](#get-adminaudit)                               | 200 `AuditPageDto`                                             |
| PATCH  | `/admin/flags/:key`                                   | user + ADMIN                        | path: `key`; body: [`updateFlagSchema`](#patch-adminflagskey)              | 200 `{ flag: FeatureFlagDto }`                                 |

`orderRouter.use(requireAuth)` runs before any `/orders` route matches. So any path under `/api/orders`, including
one that matches no route, returns 401 without a valid token. `adminRouter.use(requireAuth, requireAdmin)` does the
same for every path under `/api/admin`.

**Removed in P2.** `GET /api/store`, `GET /api/menu` and `PATCH /api/orders/:id/status` answer 404; use
`GET /api/stores/:storeRef`, `GET /api/stores/:storeRef/menu` and `PATCH /api/stores/:storeId/orders/:orderId/status`.
`GET /api/orders` returns the caller's own orders for everyone (a store's board is `GET /api/stores/:storeId/orders`),
`POST /api/orders` requires `storeId` (400 without), and `SiteSettingsDto` has no `staffOrderListLimit` (the per-store
setting stays). The `STAFF` profile role is gone: staff are store memberships.

### GET /health

Code: `server/src/controllers/health.controller.ts`. Liveness: always 200
`{ "ok": true, "version": "0.1.0", "commit": "1a2b3c4…" }`. `version` is `server/package.json`'s (bumped only by the
release PR); `commit` is `GIT_COMMIT` (`unknown` outside an image build). It does not touch the database, so a
database outage never restarts a healthy container.

### GET /config

Code: `server/src/services/config.service.ts`. Public (no token), registered before the [client version
gate](#client-version-gate) so an outdated client can still read the minimum it must reach. Derived from the cached
site settings (no cache key of its own, so an admin's `PATCH /admin/settings` reaches it at once through
`invalidate('site_settings')`), the cached feature flags (a flip reaches it through `invalidate('feature_flags')`) and
`SESSION_IDLE_DAYS`. `ConfigDto`:

```json
{
  "serverVersion": "0.1.0",
  "minClientVersion": "0.0.0",
  "features": {},
  "payment": null,
  "limits": { "maxLinesPerOrder": 30 },
  "polling": { "orderMs": 4000, "ordersMs": 8000, "staffBoardMs": 4000 },
  "session": { "idleDays": 7 },
  "clientErrors": { "samplePercent": 100 }
}
```

`features` holds every `client_visible` [feature flag](CONFIGURATION.md#feature-flags) by key: an untargeted flag as
its `enabled`, a targeted one (`storeIds`, `roles` or `percent`) as `false`, since it needs to know the caller; a flag
that is not `client_visible` never appears. If the flags cannot be read, `features` is `{}` and the response is still
200 (a feature the client cannot confirm stays off). `payment` stays null until P5. The client's defaults for this shape are
`client/src/config/fallbacks.json`; `server/test/api/config.test.ts` fails when they differ from a freshly seeded
database.

`clientErrors.samplePercent` is `site_settings.client_error_sample_percent` (0–100): the share of page loads that send
their errors to [`POST /client-errors`](#post-client-errors).

### GET /ready

Code: `server/src/controllers/health.controller.ts`. Readiness: one `site_settings` select with a 1-second
`AbortSignal.timeout`. 200 `{ "ready": true }` when it answers, else 503 `{ "ready": false }`. The failure is the
answer, not an error: it never reaches the error handler or the error log. Load balancers and compose use this to
hold traffic back from an instance that cannot reach the database.

### POST /client-errors

Code: `server/src/controllers/clientErrors.controller.ts`, schema `server/src/schemas/clientErrors.schema.ts`. The
browser's own error reports (self-reported, not Sentry: P1 decision D5). Public (no token: errors happen before
sign-in) and registered before the [client version gate](#client-version-gate), because a stale tab's errors are the
ones worth seeing. `clientErrorLimiter` counts requests per address (`RATE_LIMIT_CLIENT_ERRORS_MAX`, 30 per window;
[Headers and limits](#headers-and-limits)).

```json
{
  "reports": [
    {
      "kind": "error",
      "message": "Cannot read properties of undefined",
      "stack": "TypeError: …",
      "route": "/menu",
      "at": "2026-11-02T10:00:00.000Z"
    }
  ]
}
```

| Field     | Rules                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `reports` | 1–5 reports                                                                                                                     |
| `kind`    | `error`, `unhandledrejection` or `render`                                                                                       |
| `message` | string, at most 500 characters                                                                                                  |
| `stack`   | optional string, at most 3500 characters                                                                                        |
| `route`   | string, at most 4000 characters sent; its query string and hash are dropped, the rest scrubbed and cut to 200 (the page's path) |
| `at`      | ISO 8601 date-time with `Z` or an offset: when it happened                                                                      |

Both objects are strict: an unknown field is 400 `VALIDATION_ERROR`, as is a sixth report or a bound exceeded.
Anything shaped like a JWT (also one cut short), an `sb_…` key, a `Bearer` value, a token, code or password in a URL parameter (`refresh_token=…`, also with the `=` encoded as `%3D`), an email address (also `%40`- or `%2B`-encoded, or with an apostrophe) or a phone number (10 to 15 digits, with up to three spaces, dashes, dots, slashes or parentheses between each two) in `message`, `stack` or `route` becomes `[Redacted]` before it is
logged. Answers 204 with no body; each report is one `warn` `Client error` log line ([LOGGING.md](LOGGING.md#client-error-reports)).
Five reports at their bounds fit a `keepalive` request's 64 KB.

### POST /auth/register

Code: `auth.routes.ts` → `validate(registerSchema)` → `auth.controller.register` → `auth.service.register`.

Body (`server/src/schemas/auth.schema.ts`):

| Field      | Type   | Rules                                                                                                                                                   |
| ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`     | string | required, typed text ([Shared field rules](#shared-field-rules)), 2–60 characters                                                                       |
| `email`    | string | required, trimmed, lowercased, must be an email                                                                                                         |
| `password` | string | required, 6–72 characters (bcrypt reads only the first 72 bytes), never trimmed, not only spaces ("Password cannot be only spaces."), no lone surrogate |
| `phone`    | string | optional; see [phone numbers](#shared-field-rules)                                                                                                      |

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

### GET /stores, /stores/:storeRef, /stores/:storeRef/menu, /stores/:storeRef/hours

Public, cached (see Caching) and ETag'd. Code: `store.controller` → `store.service` (`listStores`,
`resolveStoreRef`, `getActiveStore`) and `menu.service.getStoreMenu`.

- `GET /stores?area=` lists `ACTIVE` stores (`stores.status`, the brand's status is not checked) ordered by `name`, `id`,
  capped at `STORE_LIST_MAX` (200). `area` is an exact match applied to the cached list (empty means every area); longer than 60 characters
  is 400; a warning is logged when the cap bites.
- `:storeRef` is a store id (uuid, any case) or a slug. A ref that cannot be a slug (the `stores.slug` pattern) is 404
  without a database read; an unknown ref, or a store that is not `ACTIVE`, is 404 `NOT_FOUND` "Store not found." (the same for both, so a draft store does not leak).
- `/stores/:storeRef/menu` returns the store's `MenuResponse`: every menu item including unavailable ones (the client
  greys them out), ordered by `sort_order`: `rules` (`{ maxQuantityPerItem, lowStockThreshold }`, the store's settings,
  [PATCH /stores/:storeId/settings](#patch-storesstoreidsettings) changes them and drops the cached menu), `store`
  (`StoreDto`), `popular` (the items with `isPopular`, in `sortOrder` order), `categories` (`{ name, items }[]`, a
  category placed by its first item) and `modifierGroups` (P3.2: every group the items offer, once, by id; each item
  names its own in order as `modifierGroupIds`; archived groups and options are left out, unavailable options stay
  with `isAvailable: false`). While the store's `modifiers` flag is off, `modifierGroups` is `{}` and every
  `modifierGroupIds` is `[]`, whatever is configured; the flag is read on every request, after the cached menu. An item's `isAvailable` is `is_available AND (stock_quantity IS NULL OR
stock_quantity > 0)` (`isPurchasable` in `server/src/utils/serializers.ts`); `stockQuantity` is `null` when the
  item does not track stock.
- `/stores/:storeRef/hours` returns `{ timezone, hours: [{ dayOfWeek, opensAt, closesAt }], exceptions: [{ id, startsOn,
endsOn, kind, opensAt, closesAt, label }] }`: `HH:MM` wall times in the store's zone, ISO weekdays (1 = Monday), and
  only the exceptions that have not ended (store-local today). Cached under `store_hours:<id>`.
- **Open state.** `StoreDto` and `StoreSummaryDto` carry `openState` (`OPEN`, `CLOSING_SOON`, `CLOSED`, `PAUSED`,
  `UNAVAILABLE`), `nextChangeAt` (ISO 8601: the last-order time while open (the closing time when the store has no cutoff), the next opening while closed; null when
  unknown) and `openLabel` ("Last orders at 8:30 PM", "Closes at 9:00 PM", "Opens tomorrow at 8:00 AM", "Closed for Diwali", "Paused, back at 3:40 PM", "Paused"). `isOpen` keeps its
  meaning for the deployed client: `openState` is `OPEN` or `CLOSING_SOON`. A store with no weekly hours is `OPEN`
  unless `is_open` is off. The single-store and menu reads compute it on each call; the list's entry is built once per
  `PUBLIC_READ_TTL_MS`, so a listed state is at most that old. `CLOSING_SOON` is display only (the last
  `CLOSING_SOON_MINUTES` before the last order); orders stop `last_order_minutes_before_close` before closing.
  `PAUSED` is a [pause](#post-storesstoreidpause) that has not ended; it wins over the hours, and `nextChangeAt` is
  `pausedUntil` (null for a pause until resumed). `isOpen` is false.

### POST /orders

Code: `requireAuth` → `writeLimiter` → `validate(createOrderSchema)` → `order.controller.createOrder` →
`order.service.createOrder` → `place_order` RPC.

Body (`server/src/schemas/order.schema.ts`):

| Field                       | Type     | Rules                                                                                                                                                               |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `items`                     | array    | required, 1–30 entries (counted before duplicates are merged)                                                                                                       |
| `items[].menuItemId`        | string   | required, at least 1 character                                                                                                                                      |
| `items[].quantity`          | number   | required, whole number, at least 1                                                                                                                                  |
| `items[].expectedUnitPrice` | number   | optional, whole rupees, at least 1: the price the customer was shown for this line; never charged, only compared                                                    |
| `items[].modifierOptionIds` | string[] | optional, at most 20 UUIDs: the options chosen for this line (P3.2). A required group left out takes its default; `expectedUnitPrice` is the price with the options |
| `customerName`              | string   | optional, typed text, at most 60 characters; blank (also invisible-only) or missing falls back to the profile name                                                  |
| `customerPhone`             | string   | optional; see [phone numbers](#shared-field-rules)                                                                                                                  |
| `note`                      | string   | optional, typed text, at most 200 characters                                                                                                                        |
| `idempotencyKey`            | string   | optional, a UUID; one per checkout attempt, resent unchanged on every retry of that attempt                                                                         |
| `storeId`                   | string   | required, a UUID: the store the order is for (no default store); missing is 400 `VALIDATION_ERROR`, field `storeId`                                                 |

- Entries with the same `menuItemId` and the same `modifierOptionIds` (in any order) are merged into one line with the
  quantities summed (`mergeDuplicateItems`); the same item with other options stays its own line, and the store's
  per-item cap counts all of an item's lines.
- **Options (P3.2):** with the store's `modifiers` flag off, a line is the item alone and a line that names options is
  400 `MODIFIER_INVALID`. With it on, a line's price is the item's plus its options' (`domain/pricing.ts`, then
  `place_order` again under its locks): an option that is not the item's, not available, or twice, too many in a
  group, or a price below zero is 400 `MODIFIER_INVALID`; a required group with nothing chosen and no default is 400
  `MODIFIER_REQUIRED`. Both have `details: { kind: 'modifier', menuItemId, name, group }` (`group` null when the
  refusal is about the line as a whole). Stock is still the item's, taken across all its lines (`INSUFFICIENT_STOCK`'s
  `available` is the item's stock, whichever line ran out). The flag is evaluated for the store alone, as the menu
  evaluates it. **Turning `modifiers` on for a store needs the client of P3 PR 15 and a `min_client_version` bump**: a
  client from before it sends the item's base price as `expectedUnitPrice`, which a required group's priced default
  turns into `PRICE_CHANGED` on every checkout.
- A replay (the same `idempotencyKey`) must ask for the same lines: each requested line needs a stored line of the
  same item, quantity and requested options (`order_items.requested_modifier_option_ids`, as named, without the
  defaults applied). Other options, fewer or more, are `IDEMPOTENCY_KEY_REUSED`.
- Unknown keys (`price`, `unitPrice`, `total`, …) are dropped by `z.object`. Prices come from the database only;
  `expectedUnitPrice` can only refuse an order, never change what is charged. Merged duplicates keep every
  `expectedUnitPrice` sent, and each one is compared.
- **Idempotency:** a request whose `idempotencyKey` already placed an order for this user is answered with that
  order again (201, the same body), without touching stock or payment: the service checks first, and `place_order`
  settles two simultaneous repeats under an advisory lock ([SCHEMA.md](SCHEMA.md#place_order)). The key is per
  user (two users may send the same value), never echoed back, and a request without one always places a new
  order (the deployed V0 client sends none). The client (`features/checkout/checkoutDraftStore.ts`) keeps one key
  per checkout attempt in `sessionStorage`, so a refresh during "Processing payment…" cannot create a second order.
- **A repeated key must carry the same order:** the same merged items and quantities, name, phone and note
  (`expectedUnitPrice` is not compared: a replay answers the order placed, at the price it was placed at). A
  different request under a key that already placed an order (the cart changed after a Pay whose answer was lost) is
  409 `IDEMPOTENCY_KEY_REUSED` with `details: { orderId, orderNumber }`, never a silent replay, so the customer is
  never told they paid for items the kitchen will not see. The client then links to that order, keeps the cart, and
  pays the next time under a new key.

What the service checks, in this order:

1. The store (`storeId`, read uncached) exists and is `ACTIVE`, else 404 `NOT_FOUND` "Store not found.". Only a
   replay of the same order at the same store is answered before this check, so no other answer (a reused key, too
   many lines) tells a store that is not trading from an unknown id. Then a paused store is 409 `STORE_PAUSED` "<store name> has paused new orders. Back at 3:40 PM." (without the last sentence when the pause lasts until resumed) with `details` `{ kind: 'storePaused', pausedUntil }`. Then its open state accepts orders (`OPEN` or `CLOSING_SOON`: the `is_open` switch, the weekly hours and exceptions), else 400 `STORE_CLOSED` "<store name> opens at 9:00 AM." with `details` `{ kind: 'storeClosed', nextChangeAt }`; when no opening is known the message is "<store name> is closed right now. Please come back
   when it opens." with no details.
2. For each line, in cart order (`priceLines`):
   - the item exists **at the order's store** (ids that are not UUIDs are never queried and count as missing; another
     store's item counts as missing too, so an order never mixes stores), else 400 `ITEM_NOT_FOUND`
     "One of the items is no longer on the menu." with `details: { menuItemId, available: 0 }`;
   - `is_available` is true, else 400 `ITEM_UNAVAILABLE` "<name> is currently unavailable. Please remove it from your
     cart." with `details: { menuItemId, name, available: 0 }`;
   - the merged quantity is at most the store's `max_quantity_per_item` (default 10; a store setting), else
     400 `VALIDATION_ERROR` "You can order at most <cap> of <name>. Please reduce the quantity in your cart.";
   - every `expectedUnitPrice` sent for the item equals its current price, else 409 `PRICE_CHANGED` (the message in
     step 4) before any charge. A cart keeps the price an item was added at (`client/src/features/cart/cartStore.ts`),
     so this is how a cart older than a price change is caught. The client sends each line's shown `unitPrice`.
3. The total in paise, `Σ menu_items.price_paise × quantity`, then `simulatePayment(totalPaise)` returns `PAID`
   (`server/src/services/payment.service.ts`; a total of 0 or less is 400 `BAD_REQUEST` "The order total must be
   more than ₹0.", unreachable while `menu_items.price_paise > 0`). `place_order` prices the stored order itself from
   `menu_items`, never from its arguments; the API sends each line's charged price only for `place_order` to compare.
4. `place_order` reserves stock and writes the order in one transaction. Not enough stock: 400
   `INSUFFICIENT_STOCK` with `details: { menuItemId, name, available }` and the message "Only <n> <name> left. Reduce
   the quantity in your cart." or, when `available` is 0, "<name> just sold out." A refused order leaves no rows and
   no stock changes behind (see [SCHEMA.md](SCHEMA.md#place_order)). `place_order` checks the store's `status`, pause and `is_open` flag and
   step 2's items again under its own locks, so a store suspended, paused or closed, or an item switched off, between
   step 1 and the order is the same 404 `NOT_FOUND`, 409 `STORE_PAUSED`, 400 `STORE_CLOSED` or `ITEM_UNAVAILABLE` (same
   message and details) with nothing placed. A line whose price changed
   after step 3 read it: 409 `PRICE_CHANGED` "The price of <name> just changed to ₹<price>. Please review your order." (no `details`), and
   nothing is placed. The client shows the message, reloads the menu and takes the new price into the cart, so the
   next Pay shows the amount it charges.

A new order is `paymentStatus: "PAID"`, `status: "PLACED"`, `estimatedReadyAt = now() + store.prep_time_max_minutes`.

| Status | Code                                                                                                                          |
| ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 201    | `{ order: OrderDto }`                                                                                                         |
| 400    | `VALIDATION_ERROR`, `ITEM_NOT_FOUND`, `ITEM_UNAVAILABLE`, `INSUFFICIENT_STOCK`, `STORE_CLOSED`, `BAD_REQUEST` (a ₹0 total)    |
| 401    | `UNAUTHORIZED`                                                                                                                |
| 404    | `NOT_FOUND` (no such store, or it is not `ACTIVE`)                                                                            |
| 409    | `STORE_PAUSED` (the store paused new orders; `details: { kind: 'storePaused', pausedUntil }`)                                 |
| 409    | `IDEMPOTENCY_KEY_REUSED` (the key already placed a different order; `details: { orderId, orderNumber }`)                      |
| 409    | `PRICE_CHANGED` (a stale `expectedUnitPrice`, or a price changed after the charge; no `details`; the client reloads the menu) |
| 413    | `PAYLOAD_TOO_LARGE`                                                                                                           |
| 429    | `RATE_LIMITED` (the per-user write limit, [Headers and limits](#headers-and-limits))                                          |

### GET /orders

Code: `requireAuth` → `validate(listOrdersQuerySchema, 'query')` → `order.controller.listOrders` →
`order.service.listOrders`.

Query: `status` (optional), one of `PLACED`, `PREPARING`, `READY`, `COLLECTED`, `CANCELLED`. Anything else is 400
`VALIDATION_ERROR` "Status must be one of PLACED, PREPARING, READY, COLLECTED, CANCELLED."

- Every caller gets their own orders only, newest first (`created_at desc`), capped at the newest
  `customerOrderHistoryLimit` (a `site_settings` row, default 20, read through the 10 s read cache and edited at
  [GET/PATCH /admin/settings](#get-adminsettings)). A store's board is [GET /stores/:storeId/orders](#get-storesstoreidorders).
- Lines within each order are in cart order (`line_number`).

### GET /orders/:id

Code: `requireAuth` → `order.controller.getOrder` → `order.service.getOrder`.

- `id` that is not a UUID: 404 `NOT_FOUND` "Order not found."
- The customer who placed it sees it, and so does a caller whose access at the order's store holds `orders.view`
  (its staff and managers, the brand's owner; [PERMISSIONS.md](PERMISSIONS.md#store-roles)). Anyone else gets the same
  404 as a missing order.
- A path segment with bad percent-encoding (for example `/api/orders/%E0`) is 400 `BAD_REQUEST`.

### GET /stores/:storeId/orders

Code: `requireAuth` → `requireStore('orders.view')` → `validate(listOrdersQuerySchema, 'query')` →
`order.controller.listStoreOrders` → `order.service.listStoreOrders`.

One store's board: **every active order** (`PLACED`, `PREPARING`, `READY`) across all customers, oldest first up to a safety bound of 500 (`ACTIVE_ORDERS_HARD_MAX`), plus the newest `staffOrderListLimit` finished ones (`COLLECTED`, `CANCELLED`; the store's own setting, default 100), newest first overall; `?status=` as in [GET /orders](#get-orders) (an active status returns all of it, a finished one the newest `staffOrderListLimit`). `requireStore` answers 404 for a store the caller may not know about (unknown, or not `ACTIVE` with
no access there) and 403 `FORBIDDEN` for a visible store where their access does not hold `orders.view`
([PERMISSIONS.md](PERMISSIONS.md#store-roles)). A `:storeId` that is not a UUID is 404.

### GET /stores/:storeId/settings

Code: `requireAuth` → `requireStore('settings.edit')` → `store.controller.getStoreSettings` →
`storeSettings.service.getStoreSettings`. Returns `{ settings: StoreSettingsDto }`: `maxQuantityPerItem` (1–50, default
10), `lowStockThreshold` (0–50, 5), `staffOrderListLimit` (1–500, 100), `lastOrderMinutesBeforeClose` (0–240, 0;
stored only, enforced from P2 PR 06) and `staffCanEditStock` (boolean, default true: whether staff may change stock). Read through the 10 s cache (`store_settings:<id>`). `settings.edit` is held by
MANAGER and OWNER (staff: 403; a store the caller may not know: 404). The public store (`GET /stores`) never shows them;
only `MenuResponse.rules` carries two.

### PATCH /stores/:storeId/settings

Code: `requireAuth` → `requireStore('settings.edit')` → `writeLimiter` → `validate(updateStoreSettingsSchema)` →
`store.controller.updateStoreSettings` → `storeSettings.service.updateStoreSettings`.

Body: any of the fields above (at least one); a value outside its bounds, not a whole number or not a number (not a boolean for `staffCanEditStock`) is 400
`VALIDATION_ERROR`. Answers `{ settings: StoreSettingsDto }`. The write goes through the Data API with the `x-actor` and
`x-request-id` headers, so `stores_settings_audit` records one `store_settings.changed` row with the actor and their store
role, and drops `store_settings:<id>`, `store:<id>`, `store` and the store's menus, so the next menu shows the new rules.

### PATCH /stores/:storeId/orders/:orderId/status

Code: `requireAuth` → `requireStore('orders.transition')` → `writeLimiter` → `validate(updateOrderStatusSchema)` →
`order.controller.updateStoreOrderStatus` → `order.service.updateOrderStatus` → `update_order_status` RPC.

Body: `{ status }`, one of the five statuses. `requireStore` answers first (404 or 403, as above). An order of another store is 404 through this store's route, even for a member of both stores. The caller's standing is recorded as the actor's `storeRole` with the event and the audit row.

Allowed transitions (`ALLOWED_TRANSITIONS` in `server/src/services/order.service.ts`, the single source of truth):

| From        | To                       |
| ----------- | ------------------------ |
| `PLACED`    | `PREPARING`, `CANCELLED` |
| `PREPARING` | `READY`, `CANCELLED`     |
| `READY`     | `COLLECTED`              |
| `COLLECTED` | none                     |
| `CANCELLED` | none                     |

The service passes every status that may move to the requested one as `p_from_statuses`. The database locks the
order row, so two staff devices pressing at once are served one after the other. Cancelling puts the order's
tracked stock back in the same transaction (see [SCHEMA.md](SCHEMA.md#update_order_status)).

A repeat is not an error. When the order already has the requested status and some transition leads to that status
(anything but `PLACED`), the answer is 200 with the order unchanged: nothing is written, no stock moves and no event is
emitted. This makes a retry after a lost answer, and two devices pressing the same button, safe. Only a real invalid
move is a 409, `PLACED` → `PLACED` included. The request's `x-request-id` is recorded with the event of a change
([JOBS.md](JOBS.md#order-events)).

| Status | Code                        | When                                                                                                                     |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 200    |                             | `{ order: OrderDto }` with the new status, or unchanged for a repeat of a transition that already happened               |
| 400    | `VALIDATION_ERROR`          | `status` missing or not one of the five                                                                                  |
| 401    | `UNAUTHORIZED`              | see [Authentication](#authentication)                                                                                    |
| 403    | `FORBIDDEN`                 | a visible store where the caller's access does not hold `orders.transition`                                              |
| 404    | `NOT_FOUND`                 | `:storeId` or the order id not a UUID, no such order, or an order of another store                                       |
| 409    | `INVALID_STATUS_TRANSITION` | "Order #<number> cannot move from <current status> to <requested status>." The status quoted is the order's current one. |

### GET /stores/:storeId/menu-items

The menu editor's list (P3.4). Code: `requireAuth` → `requireStore('menu.edit')` → `menu.controller.listMenuItems` →
`menu.service.listManagedItems`. Returns `{ items: ManagedMenuItemDto[] }`: every item of the store, archived ones
included (unarchived first, each part in menu order), at most 1000 (`MANAGED_ITEMS_MAX`): archived rows never push a
live item out of the list. Never cached. `menu.edit` is held by MANAGER and OWNER
(staff: 403); the brand's owner also reaches the brand template's menu ([PERMISSIONS.md](PERMISSIONS.md#store-roles)).

### POST /stores/:storeId/menu-items

Code: `requireAuth` → `requireStore('menu.edit')` → `writeLimiter` → `validate(createMenuItemSchema)` →
`menu.controller.createMenuItem` → `menu.service.createMenuItem`.

Body: `name` (2–80), `description?` (at most 300, default `""`), `price` (whole rupees, 1–100000), `category` (1–40),
`diet?` (`VEG`, `NON_VEG`, `EGG` or `null`), `isPopular?`, `stockQuantity?` (0–100000, or `null` for not tracked),
`imageUploadId?` (a `PROCESSED` upload of this store, [Photo uploads](#photo-uploads): the item shows its 900w variant as
`imageUrl` and offers every size as `imageSrcSet`; anything else, including an upload swept after 24 hours unattached,
is 400 `UPLOAD_INVALID` `state` and nothing is written; `null` removes the photo). Text
is trimmed and counted as in [Shared field rules](#shared-field-rules); an unknown field is 400 `VALIDATION_ERROR`. The
item goes last in its category (a new category last on the menu), with no photo (`imageUrl: null`) unless it names an
upload. A store may hold
two items with the same name. Answers 201 `{ item: ManagedMenuItemDto }`.

### PATCH /stores/:storeId/menu-items/:itemId

Code: as above with `validate(updateMenuItemSchema)` → `menu.service.updateMenuItem`. Body: any of the create fields but
`stockQuantity` (a stock edit is the stock function's, with its trail: P3 PR 04), and `isAvailable` (the switch), at
least one. A new `category` puts the item last in it, so the categories keep their places. Answers
`{ item: ManagedMenuItemDto }`. Another store's item, an unknown or malformed id, and an archived item (read-only) are 404.

### DELETE /stores/:storeId/menu-items/:itemId

Archives the item: `archived_at` is set and the item is switched off (`menu_items_archived_unavailable`), so it leaves
the public menu, is never copied to a new branch, and `POST /orders` refuses it as `ITEM_UNAVAILABLE`. The row stays:
orders and lineage point at it, and the editor's list still shows it. 204; a repeat is 204 and changes nothing. Another
store's item or an unknown id is 404.

### POST /stores/:storeId/menu-items/bulk

"Sold out: all juices". Code: as above with `validate(bulkAvailabilitySchema)` → `menu.controller.setAvailability` →
`menu.service.setAvailability` → `set_menu_availability` RPC. Body: `isAvailable`, and either `itemIds` (1–1000 UUIDs,
`MANAGED_ITEMS_MAX`) or a `category` (matched exactly), not both. Switches the listed items, or every item of the
category, on or off in one statement; archived items are never touched. A list naming anything but this store's
unarchived items (another store's item, an archived one, an unknown id), or a category with no unarchived item, is 404
and changes nothing. Answers `{ updated }`, how many items the edit covered (a repeat counts them again but emits no
event).

### PUT /stores/:storeId/menu-items/order

The editor's up and down buttons. Code: as above with `validate(reorderMenuSchema)` → `menu.controller.reorderMenu` →
`menu.service.reorderMenu` → `reorder_menu` RPC. Body `{ itemIds }`: every unarchived item of the store, each once, in
the new order; each item's `sort_order` becomes its position. An id that is not this store's item is 404; any other
mismatch (an item left out, an archived one, a repeat: usually a list loaded before someone else's edit) is 400
`VALIDATION_ERROR` on `itemIds`, "The menu changed since you opened it. Reload it and try again." Either changes
nothing. Quick edits of one store run one after the other, so two reorders at once leave one of them whole. 204; the same order again
is 204 with no event.

Create, edit and archive go through the Data API with the `x-actor` and `x-request-id` headers; the two quick edits
call their SQL function with `p_actor` and `p_request_id`. Every write leaves one `menu_item.changed` audit row per
item it changed and one `menu.changed` event ([JOBS.md](JOBS.md#menu-events)), none when it changed nothing (a repeated
bulk switch or the same order again), and drops the store's cached menu, so the next `GET /stores/:storeRef/menu`
shows it.

### Modifier groups (P3.2)

Code: `requireAuth` → `requireStore('menu.edit')` → `writeLimiter` (writes) → `validate(...)` →
`modifier.controller` → `modifier.service` → `save_modifier_group`, `archive_modifier_group`,
`set_item_modifier_groups` ([SCHEMA.md](SCHEMA.md#modifiers-p32)). Bounds are `MODIFIER_LIMITS`
([CONFIGURATION.md](CONFIGURATION.md)). Every change drops the store's cached menu and emits one `menu.changed` with
the caller as actor; a repeat changes nothing and emits nothing. Another store's group or item, an archived group, and
a malformed id are 404.

- `GET /stores/:storeId/modifier-groups`: the live groups in order, each with its live options
  (`ModifierGroupDto`, deltas in whole rupees), and `itemGroupIds: { [itemId]: groupId[] }`, each item's groups in
  order.
- `POST /stores/:storeId/modifier-groups` and `PATCH /stores/:storeId/modifier-groups/:groupId`: the whole group,
  `saveModifierGroupSchema`: `name` (1–40), `minSelect` (0–20, 0 = optional) ≤ `maxSelect` (1–20), `options` (1–20, in
  order) of `{ id?, name (1–40), priceDelta (whole rupees, −10000 to 10000), isDefault, isAvailable }`. An option with
  an `id` updates that option of this group (another group's is 404); one without is new; an option left out is
  archived (orders keep their snapshots). 400 `VALIDATION_ERROR` on `name` past `groupsPerStore` (20) live groups, on
  `minSelect` when fewer options are available than it requires, and on `options` when more are default than
  `maxSelect`; the group is then unchanged. Answers the group as saved.
- `DELETE /stores/:storeId/modifier-groups/:groupId`: archives; the menu stops offering it at once. 204; a repeat is 204.
- `PUT /stores/:storeId/menu-items/:itemId/modifier-groups`: `{ groupIds }` (at most 20, each once), the item's groups
  in order; `[]` removes them all. Every group must be a live group of this store (404 otherwise, and nothing changes).
  Answers `{ groupIds }`.

### PATCH /stores/:storeId/menu-items/:itemId/stock

Stock by hand (P3.4, P3.5). Code: `requireAuth` → `requireStore('stock.update')` → `writeLimiter` →
`validate(adjustStockSchema)` → `stock.controller.adjustStock` → `stock.service.adjustStock` → `adjust_stock` RPC.
`stock.update` is MANAGER and OWNER, and STAFF while the store's `staffCanEditStock` is on (the default; off: staff get
403). A brand template has no stock (404).

Body: exactly one of `set` (0–100000: the number available now; starts tracking an untracked item), `adjust` (±1 to
±100000, not 0) or `untracked: true` (stop counting), and `reason?`: `MANUAL_SET` for a set or untracked (the default),
`MANUAL_ADJUST` for an adjustment (the default), or `WASTE` for a negative adjustment; anything else is 400
`VALIDATION_ERROR`. An adjustment of an untracked item is 400 `VALIDATION_ERROR` on `adjust`. An adjustment that would
take stock below zero is 400 `INSUFFICIENT_STOCK` with `details: { menuItemId, name, available }` and changes nothing.
Another store's, an unknown or an archived item is 404. Answers `{ stockQuantity }` (null: not tracked).

The item's row is locked for the change, so adjustments and orders at once never take stock below zero. A change writes
one `stock_movements` row (who, when, the delta, the stock after, the reason) and one `menu.changed` event, and drops
the store's cached menu; a change that leaves the stock as it was writes neither. Stock is not in the audit log: the
movements are its trail.

### GET /stores/:storeId/stock

Code: `requireAuth` → `requireStore('stock.update')` → `stock.controller.listStock` (`menu.service.listManagedItems`
and the store row). The store's live (unarchived) items in menu order, as `ManagedMenuItemDto`, and its
`lowStockThreshold`: the stock screen's one read, for `/manage` and the staff board alike. Never cached (stock is
always the server's word), and a draft branch's stock is readable too (the public menu serves only `ACTIVE` stores).
Staff get 403 here while the store's `staffCanEditStock` is off.

### Photo uploads

P3.3, ADR-006. Every route runs `requireAuth` → `requireStore('menu.edit')` (managers and the owner; the owner on the
brand template too) → `media.controller` → `media.service`; another store's upload, an unknown or a malformed id is 404. The bytes never pass through the JSON API: the client sends them where the start answer says.

1. `POST /stores/:storeId/media/uploads` (`uploadLimiter`, `RATE_LIMIT_UPLOAD_MAX`), body `{ contentType, byteSize }`
   (`image/jpeg`, `image/png` or `image/webp`; 1 byte to 8 MB, `MEDIA_UPLOAD`; unknown fields 400): a `PENDING`
   `media_uploads` row whose key the API makes, and `{ uploadId, upload: { method, url, fields?, headers? } }`, how
   to send the bytes. In S3 mode `{ method: "POST", url, fields }`: a
   presigned form for the bucket, valid five minutes, posted as `multipart/form-data` with `fields` first and the file
   last; the bucket itself refuses another key, content type or size than declared. With no bucket configured (or one
   unreachable) it is 503 `UPSTREAM_UNAVAILABLE`, and no row is left.
2. Local mode only (`MEDIA_STORAGE=local`, development): `PUT /stores/:storeId/media/uploads/:uploadId/file` with
   the raw bytes and the declared `Content-Type` (the start answer's `headers`). This route alone takes a body past
   the 100 KB JSON limit, up to 8 MB. The bytes must be exactly the declared size (`sizeMismatch`), of the declared
   type (`type`), and start the way that type does (`content`, the magic bytes); a key is written once, so a second PUT, or one for a
   finished upload, is `state`. A body declared past 8 MB is 413 before it is read; `writeLimiter` applies. All
   400 `UPLOAD_INVALID`, nothing written. 204. In S3 mode it is 404.
3. `POST …/uploads/:uploadId/complete`: checks the bytes arrived at the declared size (`notUploaded`, or
   `sizeMismatch` and the object is removed), then `complete_media_upload` marks it `UPLOADED` and emits
   `media.uploaded` ([SCHEMA.md](SCHEMA.md#media_uploads)). A repeat is 200 and emits nothing. Answers
   `{ upload: MediaUploadDto }`.
4. `GET …/uploads/:uploadId`: `{ upload: MediaUploadDto }` (`id`, `status`, `contentType`, `byteSize`, `url`,
   `variants`, `failure`, `createdAt`). The worker then makes the photo's WebP variants ([JOBS.md](JOBS.md#media-events)):
   `PROCESSED` with `variants` (`[{ width, height, url }]`, narrowest first) and `url` the largest of them (the
   original is deleted), or `FAILED` with `failure`, a short reason such as `not a photo` or `larger than 6000 pixels on
a side`. Before that `variants` is null and `url` the original's path. Poll this route for the outcome.

In local mode the API serves `/media/<key>` from `MEDIA_LOCAL_DIR` with `Cache-Control: public, max-age=31536000,
immutable` (keys never change); in S3 mode `/media` is not served by the API.

### GET /stores/:storeId/stock-movements

Code: `requireAuth` → `requireStore('stock.update')` → `validate(stockMovementsQuerySchema, 'query')` →
`stock.controller.listStockMovements` → `stock.service.listStockMovements`. The store's newest 50 hand-made stock
changes, of one item with `?itemId=`, newest first: `{ movements: [{ id, menuItemId, delta, resultingQuantity, reason,
actor: { id, name } | null, createdAt }] }`. `delta` is null when tracking started or stopped. Sales and cancels are
not movements: an order's lines carry what they reserved.

### PUT /stores/:storeId/hours

Code: `requireAuth` → `requireStore('hours.edit')` → `writeLimiter` → `validate(setStoreHoursSchema)` →
`store.controller.setStoreHours` → `storeHours.service.setStoreHours` → `set_store_hours` RPC.

Body `{ hours: [{ dayOfWeek, opensAt, closesAt }] }`: the whole week (`[]` clears it), `HH:MM` times, ISO weekdays, at most 6
intervals a day, `opensAt` different from `closesAt`; a `closesAt` before `opensAt` runs past midnight. Intervals that
overlap (an overnight one over the next morning, Sunday night over Monday included) are 400 `VALIDATION_ERROR` and the
old week stays. Answers the saved schedule. A repeat of the saved week is 200 and leaves no audit row and no event; a real
change writes one `store_hours.changed` audit row (`changes.week` = `[old week, new week]`), emits `store.hours_changed`
and drops `store_hours:<id>`, `stores:list`, `store:<id>`, `store` and the store's menus, so `openState` is right on the
next read.

### POST /stores/:storeId/schedule-exceptions

Code: as above with `validate(createExceptionSchema)` → `store.controller.createScheduleException` →
`storeHours.service.createException`.

Body `{ startsOn, endsOn, kind: 'CLOSED' | 'SPECIAL_HOURS', opensAt?, closesAt?, label }` (dates `YYYY-MM-DD`, label 2-60
characters; `CLOSED` takes no times, `SPECIAL_HOURS` needs both). A store holds at most 50 upcoming exceptions (ending
today or later in its zone): the 51st is 400. 201 `{ exception }`. Audited by `store_schedule_exceptions_audit`
(`schedule_exception.changed`, via the `x-actor` and `x-request-id` headers); invalidates the same keys.

### DELETE /stores/:storeId/schedule-exceptions/:exceptionId

Code: as above, no body. 204; an unknown id, or one of another store, is 404. Audited and invalidated like the POST.

### POST /stores/:storeId/pause

Code: `requireAuth` → `requireStore('store.pause')` → `writeLimiter` → `validate(pauseStoreSchema)` →
`store.controller.pauseStore` → `storePause.service.pauseStore` → `pause_store` RPC. `store.pause` is held by STAFF,
MANAGER, OWNER and ADMIN ([PERMISSIONS.md](PERMISSIONS.md)).

Body `{ minutes?, until?, reason? }`: `minutes` a whole number 1 to 720, or `until` an ISO 8601 time with an offset, in the
future; not both (400 `VALIDATION_ERROR`, `field` `until`). With neither, the store is paused until someone resumes.
`reason` is at most 120 characters. Answers 200 `{ store: StoreDto }`, read uncached: `openState` `PAUSED`, `openLabel`
"Paused, back at 3:40 PM" ("Paused" without an end). While paused, `POST /orders` is 409 `STORE_PAUSED`; paid orders and
carts are untouched. The pause is derived: it ends by itself at `until`, and nothing lifts it. A repeat of the same
pause (same end and reason) is 200 and emits no event; a new end or reason is a change. Emits `store.paused` and drops
`store:<id>`, `store`, `stores:list` and the store's menus.

### POST /stores/:storeId/resume

Code: as above without a body schema → `store.controller.resumeStore` → `storePause.service.resumeStore` →
`resume_store` RPC. Answers 200 `{ store: StoreDto }`. A store that is not paused is 200 and emits nothing; resuming a
pause that already ran out clears its columns without an event. Otherwise emits `store.resumed`. Same invalidation.

### GET /brands/mine

Code: `requireAuth` → `brand.controller.listMyBrands` → `brand.service.listMyBrands`. Returns
`{ brands: MyBrandDto[] }`: the brands the caller owns (`req.user.ownedBrandIds`), by name, each with its branches of
every status (oldest first, at most `STORE_LIST_MAX` stores in all) and its template. `[]` for everyone who owns none.
Never cached.

### POST /brands/:brandId/stores

Code: `requireAuth` → `writeLimiter` → `validate(createStoreSchema)` → `brand.controller.createStore` →
`brand.service.createStore` → `create_store_from_template` RPC ([SCHEMA.md](SCHEMA.md#stores)). Only the brand's owner
may open a branch: anyone else, an admin included, and a malformed or unknown id get 404 `NOT_FOUND` "Brand not found.".

Body (unknown fields are 400): `name` (2–80), `slug?` (3–48 lower-case letters, digits and dashes, no dash at either
end), `area?` (at most 60) and `addressLine?` (at most 200); a blank `area` or `addressLine` is stored as null. Without a
`slug` it is made from the name: NFKD-folded to ASCII, lower-cased, every other run one dash, cut to 48. A name that
makes no slug is 400 `VALIDATION_ERROR` (`field` `slug`). A slug another store uses is 409 `SLUG_TAKEN` with `details`
`{ field: 'slug' }`; nothing is left behind. Answers 201 `{ store: ManagedStoreDto }`: a `DRAFT` copy of the brand's
template (menu, settings, tagline, description, photo; no hours), emitting `store.created`. Limits: [`LIMITS.store`](CONFIGURATION.md#platform-constants).

### POST /brands/:brandId/template/push

Code: `requireAuth` → `writeLimiter` → `validate(pushTemplateSchema)` → `brand.controller.pushTemplate` →
`brand.service.pushTemplate` → `push_template_items` RPC ([SCHEMA.md](SCHEMA.md#stores)). Only the brand's owner may
push: anyone else, a manager of a branch or an admin included, and a malformed or unknown id get 404 `NOT_FOUND`
"Brand not found.".

Body (unknown fields are 400): `itemIds` (1–1000 template item ids), `storeIds` (1–200 branch ids), `fields` (1–7 of
`name`, `description`, `price`, `category`, `diet`, `photo`, `modifiers`); items × stores at most `TEMPLATE_PUSH_COPIES_MAX` (5000), else 400 on `itemIds`. Each chosen branch's copy of each chosen item, found by
lineage, gets the chosen fields from the template; a branch without a live copy gets a new one, with the item's
modifier groups (a group copy the branch already has is reused as it is). `modifiers` makes every chosen copy's groups and options match the template's (an option's
availability stays the branch's; a group the branch made itself is kept), and counts each copy it changed. Stock, availability,
order and popularity are never pushed. An item that is not a live item of the brand's template, or a store that is not
one of its live branches (another brand's, the template, a `SUSPENDED` or `ARCHIVED` one), is 404 `NOT_FOUND` "An item or a store is not part of this
brand." and nothing changes anywhere. Answers `{ updated }`, the copies changed or created (a copy that already matched is not written: a repeat answers 0 and leaves no event); drops each store's cached
menu. One `menu.changed` per changed store; the audit rows share the request id.

### GET /stores/:storeId/manage, /stores/:storeId/manage/hours

The manage screen's own reads, uncached and at any status: the public `GET /stores/:storeRef` and `/hours` serve only
`ACTIVE` stores, so a `DRAFT` branch (or the template) could not be managed through them.

- `GET /stores/:storeId/manage`: `requireAuth` → `requireStore('store.profile')` → `store.controller.getManagedStore`
  → `store.service.getManagedStore`. Answers `{ store: ManagedStoreDto, brand: { id, name, slug }, missing }`;
  `missing` lists what the store lacks before it can be published (`'address' | 'hours' | 'menu'`, empty when ready),
  from `store_publish_missing`, the same check `POST /publish` applies ([SCHEMA.md](SCHEMA.md#stores)). The owner
  reads the template too (`store.profile` is a template capability); STAFF get 403.
- `GET /stores/:storeId/manage/hours`: `requireStore('hours.edit')` → `store.controller.getManagedHours`. The
  `StoreScheduleResponse` of the public hours route, read uncached (`getStoreSchedule(store, fresh)`); the template has
  no hours capability (404).

### PATCH /stores/:storeId/profile

Code: `requireAuth` → `requireStore('store.profile')` → `writeLimiter` → `validate(updateStoreProfileSchema)` →
`store.controller.updateStoreProfile` → `store.service.updateStoreProfile`. `store.profile` is held by MANAGER and OWNER
(staff: 403); a manager cannot edit a brand template through it, only the brand's owner can (below).

Body, at least one field, unknown fields 400: `name` (2–80), `tagline` (at most 120), `description` (at most 300), `area`
(at most 60), `addressLine` (at most 200) and `contactPhone` (the phone rule of [Shared field rules](#shared-field-rules)).
A blank or `null` `area`, `addressLine` or `contactPhone` clears it. The slug and the status are never edited here. A published (`ACTIVE`) store cannot clear its `addressLine` (400, `details: { field: 'addressLine' }`): unpublish first. The brand's owner may also edit the template's profile, whose tagline and description new branches copy.
Answers `{ store: ManagedStoreDto }`. The write goes through the Data API with the `x-actor` and `x-request-id`
headers: `stores_audit` leaves a `store.changed` audit row, and `stores_changed` emits a `store.changed` event
([JOBS.md](JOBS.md#store-events)) when a value really changed (a same-value write emits none). Drops `store:<id>`,
`stores:list` and the store's menus.

### POST /stores/:storeId/publish

Code: `requireAuth` → `requireStore('store.publish')` → `writeLimiter` → `store.controller.publishStore` →
`store.service.setStoreStatus` → `set_store_status` RPC. `store.publish` is the brand's owner only (MANAGER and STAFF:
403, ADMIN: 404 or 403 as for any capability it lacks). No body. Moves a `DRAFT` store to `ACTIVE` once it has an
address, at least one weekly hour and at least one item that is available, not archived and not sold out; otherwise 409
`STORE_NOT_READY` with `details` `{ kind: 'storeNotReady', missing }`, `missing` any of `address`, `hours`, `menu`, and
nothing changes. A store already `ACTIVE` is 200 and changes nothing. A `SUSPENDED` or `ARCHIVED` store (only an
operator moves it) is 409 `INVALID_STATUS_TRANSITION`. Answers `{ store: ManagedStoreDto }`. Emits `store.changed`
(`status`) and drops the same cache keys as the profile edit; the store then appears in `GET /stores` within the read
cache's TTL at most.

### POST /stores/:storeId/unpublish

As publish, back to `DRAFT`: no readiness check, the store leaves `GET /stores` and `GET /stores/:storeRef`, and
`POST /orders` for it is 404 `NOT_FOUND`. Orders already placed stay on the staff board and move on normally. A `DRAFT`
store is 200 and changes nothing; `SUSPENDED` or `ARCHIVED` is 409 `INVALID_STATUS_TRANSITION`.

### GET /stores/:storeId/members

Code: `requireAuth` → `requireStore('team.manageStaff')` → `team.controller.listTeam` → `team.service.listTeam`. Returns
`{ members: MemberDto[], invites: InviteDto[] }`: the store's memberships (oldest first, with the person's name and
email) and its **open** invites (not accepted, not revoked; one past `expiresAt` is still listed but can no longer be
accepted). The brand's owner is not a member. Not cached. `team.manageStaff` is held by MANAGER, OWNER and ADMIN
([PERMISSIONS.md](PERMISSIONS.md#team-invites-and-removals)); STAFF get 403, a store the caller may not know is 404.

### POST /stores/:storeId/invites

Code: `requireAuth` → `requireStore('team.manageStaff')` → `writeLimiter` → `validate(createInviteSchema)` →
`team.controller.createInvite` → `team.service.createInvite`.

Body: `email` (trimmed, lower-cased, a valid address of at most 320 characters) and `role` (`MANAGER` or `STAFF`).
Answers 201 `{ invite: InviteDto, token: string }`. The `token` (32 random bytes, base64url) is in this answer only:
the database keeps its sha-256, so it cannot be shown again, and nothing sends mail yet, so the inviter shares the link
out of band. The invite expires after 7 days (`INVITE_EXPIRY_DAYS`, [CONFIGURATION.md](CONFIGURATION.md#platform-constants)).
Expired open invites for that email are revoked first, so it can be invited again.

| Status | Code                | When                                                                                   |
| ------ | ------------------- | -------------------------------------------------------------------------------------- |
| 201    |                     | `{ invite, token }`                                                                    |
| 400    | `VALIDATION_ERROR`  | bad email or role                                                                      |
| 403    | `FORBIDDEN`         | not a `team.manageStaff` holder, or inviting a `MANAGER` without `team.manageManagers` |
| 409    | `MEMBERSHIP_EXISTS` | the email already works at the store, or already has an open invite there              |

### DELETE /stores/:storeId/invites/:inviteId

Code: `requireAuth` → `requireStore('team.manageStaff')` → `writeLimiter` → `team.controller.revokeInvite` →
`team.service.revokeInvite`. Answers 204. Revoking an invite twice is a no-op (204). An invite that was accepted, does
not exist, belongs to another store or has an id that is not a UUID is 404. Revoking a `MANAGER` invite also needs
`team.manageManagers` (403 without it).

### DELETE /stores/:storeId/members/:membershipId

Code: `requireAuth` → `requireStore('team.manageStaff')` → `writeLimiter` → `team.controller.removeMember` →
`team.service.removeMember`. Answers 204. A membership of another store, an unknown one or an id that is not a UUID is 404. Removing a `MANAGER` needs `team.manageManagers`, except that a manager may remove themselves. The person's access
ends on their next request, because `requireAuth` reads memberships on every request.

### POST /me/invites/accept

Code: `requireAuth` → `inviteAcceptLimiter` → `validate(acceptInviteSchema)` → `team.controller.acceptInvite` →
`team.service.acceptInvite` → `accept_store_invite` RPC ([SCHEMA.md](SCHEMA.md#accept_store_invite)).

Body: `token` (1–100 characters). Answers 200 `{ membership: { id, role, store: { id, slug, name } } }`, so the client
can go to the store. The invite must be for the signed-in account's email. **Every refusal is the same 404
`NOT_FOUND`** ("That invite is not valid any more."): an unknown token, another account's invite, an expired, revoked
or already used one, or a member of another role at that store (the invite stays open). So a token cannot be probed.
A repeat by the account that accepted it answers 200 with the same membership. Limited per signed-in user by
`RATE_LIMIT_INVITE_ACCEPT_MAX` (429 `RATE_LIMITED`). The token travels in the body and is never logged
([LOGGING.md](LOGGING.md#never-logged)).

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
`settings.service.updateSettings`. A save that changes a value writes one `audit_log` row naming the admin and the
request id; a save of the same values writes none ([SCHEMA.md](SCHEMA.md#audit_row_change)).

Body (`server/src/schemas/admin.schema.ts`), every field optional but at least one required:

| Field                                             | Type   | Rules                                                                                                |
| ------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| `customerOrderHistoryLimit`                       | number | whole number, 1–200                                                                                  |
| `staffOrderListLimit`                             | number | whole number, 1–500                                                                                  |
| `maxLinesPerOrder`                                | number | whole number, 1–100 ("Items per order must be …")                                                    |
| `orderPollMs`, `ordersPollMs`, `staffBoardPollMs` | number | whole number, 2000–60000 ("Order page refresh / Order list refresh / Staff board refresh must be …") |
| `clientErrorSamplePercent`                        | number | whole number, 0–100 ("Error reporting sample must be …")                                             |
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

### GET /stores/:storeId/audit

Code: `requireAuth` → `requireStore('audit.store')` → `validate(auditQuerySchema, 'query')` →
`admin.controller.listStoreAudit` → `audit.service.listAudit(query, storeId)`. The same cursor query as
[`GET /admin/audit`](#get-adminaudit) (same parameters, same `AuditPageDto`, same `Cache-Control: no-store`), narrowed
to `audit_log.store_id = req.store.id`. The store comes from the path through `requireStore`, never from the query:
a `storeId` in the query string is dropped by the schema and has no effect. The rows hold statuses, settings, hours
and team changes, no customer data; an invite's row carries the invited email, which the same roles see in the team
list. MANAGER, OWNER and ADMIN may read it; STAFF get 403, a store the caller cannot see is 404 as for the other store
routes.

### GET /admin/audit

Code: `requireAuth` → `requireAdmin` → `validate(auditQuerySchema, 'query')` → `admin.controller.listAudit` →
`audit.service.listAudit`. One page of the `audit_log` ([SCHEMA.md](SCHEMA.md#audit_log)), newest first, as
`AuditPageDto`. Never read through the process cache: every request reads the table. Answered with
`Cache-Control: no-store` instead of the global `no-cache`, so the log never stays in the browser's cache after the
admin signs out (it is not polled, so an ETag would save nothing). No screen calls it yet (the admin
audit view is P7.4).

Query (`server/src/schemas/admin.schema.ts`), every parameter optional:

| Param        | Type          | Rules                                                                                                                          |
| ------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `entityType` | string        | one of `site_settings`, `order`, `profile`, `menu_item`, `feature_flag`, `brand`, `store`, `membership` (the audited entities) |
| `entityId`   | string        | 1–64 characters; needs `entityType` (the same id can belong to entities of different types)                                    |
| `actorId`    | string (uuid) | the profile that made the change                                                                                               |
| `from`       | ISO 8601      | date and time with an offset (`2026-11-02T10:00:00Z`); `occurredAt >= from`                                                    |
| `to`         | ISO 8601      | same format; `occurredAt < to`                                                                                                 |
| `before`     | number        | whole number ≥ 1: the previous page's `nextCursor`; only rows with a smaller `id`                                              |
| `limit`      | number        | whole number, 1–100, default 50 (`AUDIT_PAGE`)                                                                                 |

- `from` must be before `to` when both are sent (400 otherwise).
- Paging is keyset on `id`: pass `nextCursor` back as `before` until it is `null`. `before` is the only cursor:
  `occurredAt` is rounded to the millisecond, so echoing it back as `to` can skip rows from the same millisecond. A row written mid-walk lands
  before the first page, so a walk never repeats or skips a row. `nextCursor` is `null` exactly on the last page.
- An entity with no rows is 200 `{ entries: [], nextCursor: null }`, never 404.

| Status | Code               | When                                                                                            |
| ------ | ------------------ | ----------------------------------------------------------------------------------------------- |
| 200    |                    | `AuditPageDto`                                                                                  |
| 400    | `VALIDATION_ERROR` | a parameter out of bounds or malformed; `entityId` without `entityType`; `from` not before `to` |
| 401    | `UNAUTHORIZED`     | see [Authentication](#authentication)                                                           |
| 403    | `FORBIDDEN`        | caller is not `ADMIN`                                                                           |

### PATCH /admin/flags/:key

Code: `requireAuth` → `requireAdmin` → `writeLimiter` → `validate(updateFlagSchema)` → `admin.controller.updateFlag` →
`flags.service.setFlag`. Flips one feature flag ([SCHEMA.md](SCHEMA.md#feature_flags)). A change writes one
`audit_log` row (`feature_flag.changed`) naming the admin and the request id; a save of the same values writes none.
There is no list endpoint and no screen until the flags page (P7.4); flags are created by migrations, never here.

Body (`server/src/schemas/admin.schema.ts`), every field optional but at least one required:

| Field           | Type    | Rules                                                                                                                                                                                                          |
| --------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`       | boolean | off is off for everyone                                                                                                                                                                                        |
| `clientVisible` | boolean | whether `GET /api/config` serves it (P1 PR 14)                                                                                                                                                                 |
| `rules`         | object  | replaces the stored rules whole; only `storeIds` (1–100 distinct store uuids), `roles` (1–3 distinct of `CUSTOMER`, `STAFF`, `ADMIN`) and `percent` (whole number 0–100), each optional; `{}` clears targeting |

- Any other key in `rules` is 400 (a misspelt `storeId` would otherwise turn a targeted flag on for everyone).
- On success `updated_by` is the admin, and the process cache key `'feature_flags'` is invalidated at once, so the next
  evaluation on this API instance sees the flip. The controller logs `Feature flag changed` at `info` with the key, the
  fields sent and `by: admin.id`.

| Status | Code               | When                                                         |
| ------ | ------------------ | ------------------------------------------------------------ |
| 200    |                    | `{ flag: FeatureFlagDto }`                                   |
| 400    | `VALIDATION_ERROR` | a field of the wrong type, a malformed rule, or nothing sent |
| 401    | `UNAUTHORIZED`     | see [Authentication](#authentication)                        |
| 403    | `FORBIDDEN`        | caller is not `ADMIN`                                        |
| 404    | `NOT_FOUND`        | no flag has that key                                         |

## Response DTOs

From `server/src/types/api.ts`. The serializers in `server/src/utils/serializers.ts` turn snake_case rows into these
camelCase shapes and every timestamp into ISO 8601 (`new Date(ts).toISOString()`). Money is whole rupees as integers:
it is stored in paise (`…_paise` columns, [SCHEMA.md](SCHEMA.md)) and converted by `server/src/utils/money.ts`, so
nothing changes for clients. A new money field carries paise and says so in its name (`amountPaise`,
[ADR-004](adr/004-rupees-and-paise.md)).

`UserDto`

| Field         | Type                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------- |
| `id`          | string (uuid)                                                                                 |
| `name`        | string                                                                                        |
| `email`       | string                                                                                        |
| `phone`       | string \| null                                                                                |
| `role`        | `'CUSTOMER'` \| `'STAFF'` \| `'ADMIN'`                                                        |
| `createdAt`   | string (ISO 8601)                                                                             |
| `memberships` | `{ storeId, storeSlug, storeName, role: 'MANAGER' \| 'STAFF', staffCanEditStock: boolean }[]` |
| `ownedBrands` | `{ id, name, slug }[]`                                                                        |

`memberships` are the stores the account works at; `ownedBrands` are the brands it owns (OWNER of every store of each, no membership row). Each is `[]` only when the account has no corresponding membership or owned brand (a CUSTOMER profile can have either), and both are returned by `GET /auth/me` and `POST /auth/register`. A membership's `staffCanEditStock` is the store's setting, so the staff board knows whether to offer its Stock view (the settings route itself is `settings.edit`); the server checks it again on every stock request. See [PERMISSIONS.md](PERMISSIONS.md#store-roles).

`ADMIN` is the site-wide developer/operator role (the `/admin` dashboard), not a restaurant role — see
[PERMISSIONS.md](PERMISSIONS.md#roles).

`SiteSettingsDto`

| Field                       | Type              | Notes                                                                                      |
| --------------------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| `customerOrderHistoryLimit` | number            | 1–200, default 20; caps `GET /orders` for a customer                                       |
| `maxLinesPerOrder`          | number            | 1–100, default 30; most lines one order may have                                           |
| `orderPollMs`               | number            | 2000–60000, default 4000; an open order's page poll interval (ms)                          |
| `ordersPollMs`              | number            | 2000–60000, default 8000; the customer's order list poll interval (ms)                     |
| `staffBoardPollMs`          | number            | 2000–60000, default 4000; the staff board poll interval (ms)                               |
| `clientErrorSamplePercent`  | number            | 0–100, default 100; the share of page loads that report their errors                       |
| `minClientVersion`          | string            | default `0.0.0`; clients below it get 426 `CLIENT_OUTDATED` ([gate](#client-version-gate)) |
| `updatedAt`                 | string (ISO 8601) | set whenever a setting is saved                                                            |

`StoreSummaryDto`: `id`, `slug`, `name`, `tagline`, `imageUrl`, `area`, `brand` (`{ id, name, slug }`), `isOpen`, `openState`, `nextChangeAt`, `openLabel`; the
fields of `StoreDto` a store picker needs (client: `StoreSummary`).

`StoreDto`

| Field                | Type                                                                |
| -------------------- | ------------------------------------------------------------------- |
| `id`                 | string (uuid)                                                       |
| `slug`               | string                                                              |
| `name`               | string                                                              |
| `brand`              | `{ id: string, name: string, slug: string }`                        |
| `area`               | string \| null                                                      |
| `address`            | string \| null                                                      |
| `tagline`            | string                                                              |
| `description`        | string                                                              |
| `imageUrl`           | string \| null                                                      |
| `isOpen`             | boolean                                                             |
| `openState`          | `'OPEN' \| 'CLOSING_SOON' \| 'CLOSED' \| 'PAUSED' \| 'UNAVAILABLE'` |
| `nextChangeAt`       | string (ISO 8601) \| null                                           |
| `openLabel`          | string \| null                                                      |
| `prepTimeMinMinutes` | number                                                              |
| `prepTimeMaxMinutes` | number                                                              |

`MenuItemDto`

| Field              | Type                                      | Notes                                                                                                                         |
| ------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `id`               | string (uuid)                             |                                                                                                                               |
| `category`         | string                                    |                                                                                                                               |
| `name`             | string                                    |                                                                                                                               |
| `description`      | string                                    |                                                                                                                               |
| `price`            | number                                    | whole rupees                                                                                                                  |
| `imageUrl`         | string \| null                            | `null`: no photo yet                                                                                                          |
| `imageSrcSet`      | string \| null                            | an uploaded photo's sizes, `"/media/… 400w, /media/… 900w"`; `null` for a bundled photo or none                               |
| `modifierGroupIds` | string[]                                  | the item's groups, keys of `MenuResponse.modifierGroups`, in order; `[]` while `modifiers` is off and outside the public menu |
| `diet`             | `'VEG'` \| `'NON_VEG'` \| `'EGG'` \| null | `null`: not marked                                                                                                            |
| `isAvailable`      | boolean                                   | false when switched off or tracked stock is 0                                                                                 |
| `isPopular`        | boolean                                   |                                                                                                                               |
| `sortOrder`        | number                                    |                                                                                                                               |
| `stockQuantity`    | number \| null                            | units left; `null` = not tracked (only the 10-per-order cap)                                                                  |

`ManagedMenuItemDto` (the editor's list): `MenuItemDto` plus `isEnabled` (boolean, the switch alone; `isAvailable` also
counts stock), `archivedAt` (ISO 8601 \| null) and `templateItemId` (the brand template item it was copied from, its
lineage; null for a branch's own item or a template's own). The public menu never carries archived items.

`ManagedStoreDto` (a store as its owner and managers see it, any status): `id`, `slug`, `name`, `status` (`DRAFT`,
`ACTIVE`, `SUSPENDED`, `ARCHIVED`), `isTemplate`, `area`, `address` (both string \| null), `contactPhone` (string \|
null), `tagline`, `description`, `imageUrl` (string \| null), `createdAt` (client: `ManagedStore`).

`MyBrandDto`: `{ id, name, slug, template: ManagedStoreDto | null, stores: ManagedStoreDto[] }`, the branches without the
template (client: `MyBrand`).

`MenuResponse`: `{ rules: { maxQuantityPerItem, lowStockThreshold }, store: StoreDto, popular: MenuItemDto[], categories: { name: string, items: MenuItemDto[] }[], modifierGroups: { [id]: ModifierGroupDto } }`.

`ModifierGroupDto` (P3.2): `{ id, name, minSelect, maxSelect, options: { id, name, priceDelta, isDefault, isAvailable }[] }`;
`minSelect` 0 is optional, `priceDelta` is whole rupees and may be negative, `isDefault` is applied when the group is
required and nothing is chosen.

`OrderDto`

| Field              | Type                                         | Notes                                                               |
| ------------------ | -------------------------------------------- | ------------------------------------------------------------------- |
| `id`               | string (uuid)                                |                                                                     |
| `orderNumber`      | number                                       | starts at 1001                                                      |
| `status`           | `OrderStatus`                                |                                                                     |
| `paymentStatus`    | `'PENDING'` \| `'PAID'`                      | new orders are `PAID`                                               |
| `total`            | number                                       | whole rupees                                                        |
| `customerName`     | string                                       |                                                                     |
| `customerPhone`    | string \| null                               |                                                                     |
| `note`             | string \| null                               |                                                                     |
| `estimatedReadyAt` | string (ISO 8601)                            |                                                                     |
| `createdAt`        | string (ISO 8601)                            |                                                                     |
| `updatedAt`        | string (ISO 8601)                            | set by the `orders_set_updated_at` trigger                          |
| `store`            | `{ id: string, name: string, slug: string }` | `name` is the store's name at order time; `slug` is its current one |
| `items`            | `OrderItemDto[]`                             | cart order                                                          |

`OrderItemDto`

| Field           | Type                                                | Notes                                                                                                                                                                                                                                       |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | string (uuid)                                       |                                                                                                                                                                                                                                             |
| `menuItemId`    | string (uuid)                                       |                                                                                                                                                                                                                                             |
| `name`          | string                                              | snapshot at order time                                                                                                                                                                                                                      |
| `unitPrice`     | number                                              | snapshot at order time                                                                                                                                                                                                                      |
| `quantity`      | number                                              |                                                                                                                                                                                                                                             |
| `lineTotal`     | number                                              | `unitPrice × quantity`                                                                                                                                                                                                                      |
| `imageUrl`      | string \| null                                      | the menu item's photo at order time                                                                                                                                                                                                         |
| `baseUnitPrice` | number \| null                                      | the item's own price before its options (`unitPrice` includes them); null on orders before P3.2                                                                                                                                             |
| `modifiers`     | `{ optionId, groupName, optionName, priceDelta }[]` | the options the line was made with, as they were then (a later rename or delete of the option changes nothing); `[]` without any. `optionId` is the option on the menu ("Order Again" re-adds it), `null` once it was deleted (P3.2, PR 16) |

`MemberDto`

| Field      | Type              | Notes                                                               |
| ---------- | ----------------- | ------------------------------------------------------------------- |
| `id`       | string (uuid)     | the membership's id, which `DELETE .../members/:membershipId` takes |
| `userId`   | string (uuid)     |                                                                     |
| `name`     | string            |                                                                     |
| `email`    | string            |                                                                     |
| `role`     | `StoreRole`       | `MANAGER` or `STAFF`                                                |
| `joinedAt` | string (ISO 8601) |                                                                     |

`InviteDto`

| Field       | Type              | Notes                |
| ----------- | ----------------- | -------------------- |
| `id`        | string (uuid)     |                      |
| `email`     | string            | lower-case           |
| `role`      | `StoreRole`       | `MANAGER` or `STAFF` |
| `expiresAt` | string (ISO 8601) |                      |
| `createdAt` | string (ISO 8601) |                      |

`AuditPageDto`: `{ entries: AuditEntryDto[], nextCursor: number | null }`.

`AuditEntryDto`

| Field        | Type                                                                       | Notes                                                                                        |
| ------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `id`         | number                                                                     | the keyset cursor                                                                            |
| `occurredAt` | string (ISO 8601)                                                          |                                                                                              |
| `actorType`  | `USER` \| `WORKER` \| `RECONCILER` \| `WEBHOOK` \| `SCHEDULER` \| `SYSTEM` |                                                                                              |
| `actorId`    | string (uuid) \| null                                                      | the profile for `USER`, null for system actors                                               |
| `actorRole`  | string \| null                                                             | the actor's role when the change happened                                                    |
| `storeId`    | string (uuid) \| null                                                      | the row's store, when it has one                                                             |
| `action`     | string                                                                     | `site_settings.changed`, `order.status_changed`, `profile.role_changed`, `menu_item.changed` |
| `entityType` | string                                                                     | the first part of `action`                                                                   |
| `entityId`   | string                                                                     | the changed row's id                                                                         |
| `changes`    | `{ [column]: [old, new] }` \| null                                         | the watched columns that changed                                                             |
| `reason`     | string \| null                                                             |                                                                                              |
| `requestId`  | string \| null                                                             | the API request that made the change; null outside the API                                   |

`FeatureFlagDto`

| Field           | Type                                                        | Notes                                                                           |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `key`           | string                                                      |                                                                                 |
| `description`   | string                                                      |                                                                                 |
| `enabled`       | boolean                                                     |                                                                                 |
| `clientVisible` | boolean                                                     |                                                                                 |
| `rules`         | `{ storeIds?: string[], roles?: Role[], percent?: number }` | as stored (a hand edit that does not parse is shown as is, and the flag is off) |
| `updatedAt`     | string (ISO 8601)                                           |                                                                                 |
| `updatedBy`     | string (uuid) \| null                                       | the admin who last changed it; null for a migration                             |

## Shared field rules

From `server/src/schemas/common.ts` and `server/src/middleware/validate.ts`:

- **NUL bytes** are removed from every string in the body or query before validation.
- **Nesting:** a body nested deeper than 32 arrays or objects (`MAX_BODY_DEPTH`) is 400 `VALIDATION_ERROR` "The
  request body is nested too deeply." The deepest real body is three levels.
- **Typed text** (`typedText`: `name`, `customerName`, `note`): a lone UTF-16 surrogate is 400 `VALIDATION_ERROR`
  "Invalid characters in input." (as it is in `password`); blank and invisible characters (format characters such as
  the zero-width space, the Braille blank, the Hangul fillers) are trimmed from both ends, and stay inside the value
  (a joiner builds an emoji sequence); tag characters and variation selectors are never trimmed, since they end a
  subdivision flag or a red heart ("❤️"); a minimum counts visible characters only, leaving out whitespace, invisible
  characters and marks that draw nothing on their own (variation selectors, the combining grapheme joiner); lengths
  are UTF-16 units, as a form's `maxLength` counts them (31 emoji are 62 units, over a limit of 60).
- **Optional fields** (`optionalField`): a blank string, or one with no visible character (only whitespace, invisible
  characters or variation selectors), counts as not sent.
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
- `details` is present only on the errors below.

### Error details

`details` takes one of the shapes in `ErrorDetails` (`server/src/utils/errors.ts`; the client's `ApiErrorDetails`).
**Rule:** the three shapes that predate P1 stay untagged, because the deployed client reads them by `code`; every new
shape carries a `kind`, and the client narrows on it.

| Shape                  | On                                                                        | Fields                                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ItemErrorDetails`     | `INSUFFICIENT_STOCK`, `ITEM_UNAVAILABLE`, `ITEM_NOT_FOUND`                | `{ menuItemId: string, name?: string, available: number }`; `available` is 0 for a sold-out, unavailable or missing item                                                                         |
| `ReplayedOrderDetails` | `IDEMPOTENCY_KEY_REUSED`                                                  | `{ orderId, orderNumber }`                                                                                                                                                                       |
| `FieldErrorDetails`    | a `VALIDATION_ERROR` about one request field, `EMAIL_TAKEN`, `SLUG_TAKEN` | `{ field }`: the top-level field at fault (`customerPhone`, `email`, `items` for `items[2].quantity`), so a form shows the message on it; a rule with no single field (the lines limit) has none |
| `StorePausedDetails`   | `STORE_PAUSED`                                                            | `{ kind: 'storePaused', pausedUntil }`: when the pause ends (ISO 8601); null when it lasts until someone resumes                                                                                 |
| `StoreClosedDetails`   | `STORE_CLOSED`                                                            | `{ kind: 'storeClosed', nextChangeAt }`: when the store next opens (ISO 8601); absent when no opening is known                                                                                   |
| `StoreNotReadyDetails` | `STORE_NOT_READY`                                                         | `{ kind: 'storeNotReady', missing }`: what to add before publishing, any of `address`, `hours`, `menu`                                                                                           |
| `UploadInvalidDetails` | `UPLOAD_INVALID`                                                          | `{ kind: 'uploadInvalid', reason }`: which rule a photo upload broke, `type`, `sizeMismatch`, `content`, `notUploaded` or `state`                                                                |
| `RateLimitDetails`     | `RATE_LIMITED`                                                            | `{ kind: 'rateLimit', retryAfterSeconds }`: the same number as the `Retry-After` header, the seconds until that key's window resets                                                              |

### Error codes

| Status | Code                        | Raised by                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`          | zod schemas; the 10-per-item cap; the `site_settings` bounds (`GET`/`PATCH /admin/settings`); malformed JSON ("Malformed request body."); Postgres `22001` ("One of the values is too long."), `22021` / `22P05` and PostgREST `PGRST102` ("Invalid characters in input."); a body nested too deeply; Supabase Auth `email_address_invalid` / `weak_password`                                                                      |
| 400    | `BAD_REQUEST`               | bad percent-encoding in the URL ("The request URL is malformed."); any other 4xx from body-parser ("The request could not be processed."); `simulatePayment` for a total of 0 or less ("The order total must be more than ₹0.")                                                                                                                                                                                                    |
| 400    | `ITEM_NOT_FOUND`            | `POST /orders`                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 400    | `ITEM_UNAVAILABLE`          | `POST /orders` (the API's check, or `place_order`'s)                                                                                                                                                                                                                                                                                                                                                                               |
| 400    | `INSUFFICIENT_STOCK`        | `POST /orders` (from `place_order`)                                                                                                                                                                                                                                                                                                                                                                                                |
| 400    | `STORE_CLOSED`              | `POST /orders` (the API's check, or `place_order`'s)                                                                                                                                                                                                                                                                                                                                                                               |
| 409    | `STORE_PAUSED`              | `POST /orders` (the API's check, or `place_order`'s): "<store name> has paused new orders. Back at 3:40 PM."                                                                                                                                                                                                                                                                                                                       |
| 401    | `UNAUTHORIZED`              | `requireAuth`                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 403    | `FORBIDDEN`                 | `requireAdmin`, `requireStore`; the team routes when acting on a manager without `team.manageManagers`                                                                                                                                                                                                                                                                                                                             |
| 429    | `RATE_LIMITED`              | `middleware/rateLimit.ts`: more requests than the window allows from one account (writes) or one address (all of `/api`, `POST /auth/register`); "Too many requests. Please wait a minute and try again." with `Retry-After`, `RateLimit-Policy` and `RateLimit` headers and `details: { kind: 'rateLimit', retryAfterSeconds }` (`RateLimitDetails`). Logged at `warn` for the first refusal per key per window, `debug` after it |
| 426    | `CLIENT_OUTDATED`           | every route mounted after the [client version gate](#client-version-gate): the client's `X-Client-Version` is below `site_settings.min_client_version`. "A new version of Food Pickup is available. Refresh the page to continue." Logged at `debug`                                                                                                                                                                               |
| 404    | `NOT_FOUND`                 | missing store, order or profile; an unmatched route ("No route matches <METHOD> <path>.")                                                                                                                                                                                                                                                                                                                                          |
| 409    | `EMAIL_TAKEN`               | `POST /auth/register`                                                                                                                                                                                                                                                                                                                                                                                                              |
| 409    | `SLUG_TAKEN`                | `POST /brands/:brandId/stores`: another store already uses the slug (given, or made from the name); `details: { field: 'slug' }`                                                                                                                                                                                                                                                                                                   |
| 409    | `STORE_NOT_READY`           | `POST /stores/:storeId/publish`: no address, no weekly hours or no orderable item; `details: { kind: 'storeNotReady', missing }`                                                                                                                                                                                                                                                                                                   |
| 400    | `UPLOAD_INVALID`            | a photo upload refused: the bytes are not the declared type, size or format, the upload is not finished, or it is already done; `details: { kind: 'uploadInvalid', reason }`                                                                                                                                                                                                                                                       |
| 409    | `INVALID_STATUS_TRANSITION` | `PATCH /orders/:id/status` (from `update_order_status`); `POST /stores/:storeId/publish` and `/unpublish` on a `SUSPENDED` or `ARCHIVED` store (from `set_store_status`)                                                                                                                                                                                                                                                           |
| 409    | `IDEMPOTENCY_KEY_REUSED`    | `POST /orders`: the `idempotencyKey` already placed an order that differs from this request. "Your earlier order #<n> already went through. Pay again to order what is in your cart now." with `details: { orderId, orderNumber }` (`ReplayedOrderDetails`)                                                                                                                                                                        |
| 400    | `MODIFIER_REQUIRED`         | `POST /orders`: a required option group was left empty and has no default. "Choose a <group> for <name>.", `details: { kind: 'modifier', menuItemId, name, group }`; nothing is placed                                                                                                                                                                                                                                             |
| 400    | `MODIFIER_INVALID`          | `POST /orders`: the options chosen for a line cannot be ordered (not the item's, unavailable, twice, too many in a group, a price below zero, or any option while the store's `modifiers` flag is off). Same `details`; nothing is placed                                                                                                                                                                                          |
| 409    | `PRICE_CHANGED`             | `POST /orders`: an `expectedUnitPrice` is not the item's current price, or (from `place_order`) an item's price changed after the API charged for it. "The price of <name> just changed to ₹<price>. Please review your order.", no `details`; nothing is placed                                                                                                                                                                   |
| 413    | `PAYLOAD_TOO_LARGE`         | JSON body over 100 kB (`JSON_BODY_LIMIT_BYTES`), refused on the declared `Content-Length` before auth runs: the rest of the upload is read and thrown away (at most 1 MB or 2 s), then 413 with `Connection: close`; a chunked body when it passes the limit ("The request body is too large.")                                                                                                                                    |
| 500    | `INTERNAL`                  | anything else ("Something went wrong. Please try again."), logged with its stack                                                                                                                                                                                                                                                                                                                                                   |
| 503    | `UPSTREAM_UNAVAILABLE`      | any route when the database or Supabase Auth cannot be reached (an `IntegrationError`): "The service is temporarily unavailable. Please try again in a moment.", with `Retry-After: 5`; logged once at `error` with the cause chain                                                                                                                                                                                                |

The client also creates codes the server never sends: `INVALID_CREDENTIALS` for a failed Supabase sign-in, together with `UNREACHABLE`, `UNKNOWN` and `CLIENT_RELOAD_REQUIRED` (the sign-in code failed to load; only a page reload helps, see [FRONTEND_STRUCTURE.md](FRONTEND_STRUCTURE.md#services)) (and `RATE_LIMITED` for Supabase Auth's own 429, the same code the API uses)
(`client/src/services/auth.ts`, `client/src/services/api.ts`, `client/src/lib/useResource.ts`). The client treats
`ApiError.code` as a plain string.

### Database errors (`P0001`)

The database functions report expected failures with `raise exception`: the message is an API error code and the
detail is a JSON object. `raisedByDatabase(err, code)` in `server/src/utils/supabase.ts` matches PostgREST errors with
SQLSTATE `P0001` and that message. `order.service.ts` and `team.service.ts` map them:

| Function              | Message                     | Detail                            | API response                                                             |
| --------------------- | --------------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| `place_order`         | `INSUFFICIENT_STOCK`        | `{ menuItemId, name, available }` | 400 `INSUFFICIENT_STOCK` + details                                       |
| `place_order`         | `PRICE_CHANGED`             | `{ menuItemId, name, price }`     | 409 `PRICE_CHANGED`, no details                                          |
| `place_order`         | `ITEM_UNAVAILABLE`          | `{ menuItemId, name, available }` | 400 `ITEM_UNAVAILABLE` + details                                         |
| `place_order`         | `STORE_CLOSED`              | `{ storeId }`                     | 400 `STORE_CLOSED`, no details                                           |
| `place_order`         | `STORE_PAUSED`              | `{ storeId, pausedUntil }`        | 409 `STORE_PAUSED` + details                                             |
| `place_order`         | `NOT_FOUND`                 | none                              | 404 `NOT_FOUND` "Store not found." (the store stopped trading)           |
| `update_order_status` | `NOT_FOUND`                 | none                              | 404 `NOT_FOUND` "Order not found."                                       |
| `accept_store_invite` | `NOT_FOUND`                 | none                              | 404 `NOT_FOUND` "That invite is not valid any more." (`team.service.ts`) |
| `update_order_status` | `INVALID_STATUS_TRANSITION` | `{ orderNumber, status }`         | 409 `INVALID_STATUS_TRANSITION`                                          |
| `set_store_status`    | `INVALID_STATUS_TRANSITION` | none                              | 409 `INVALID_STATUS_TRANSITION` (suspended or archived store)            |
| `set_store_status`    | `NOT_FOUND`                 | none                              | 404 `NOT_FOUND` "Store not found." (unknown store or a template)         |

Any other `P0001` or database error is a 500.

## Client version gate

`clientVersionGate` (`server/src/middleware/clientVersion.ts`) runs on every route mounted after it in
`server/src/routes/index.ts`. It reads `X-Client-Version` (missing or malformed counts as `0.1.0`, the deployed V0
client that sends none), compares its numeric triple with `site_settings.min_client_version` (read through the
settings cache: no database round trip per request) and answers 426 `CLIENT_OUTDATED` when it is lower. A prerelease
label is ignored, so a staging build is never older than its own release.

- **Exempt by mount order, not a path list:** `/health`, `/ready`, `/config` and `POST /client-errors` are
  registered before the gate (later the payment webhooks join them). CORS preflights never reach the router (`cors()` answers them), and
  the same-origin client sends none.
- **Before auth:** the gate runs before any router's `requireAuth`, so a stale tab gets 426, not 401.
- **The client:** `services/api.ts` sets the `outdated` flag on any 426 and `App` shows a "New version available"
  banner with Refresh; `useResource` stops polling after a 426. The V0 client has no banner, but it shows the
  envelope's message in `ErrorState`, which is the intended fallback for the first gated release.
- Raise the minimum with `PATCH /admin/settings` `{ "minClientVersion": "x.y.z" }` when a change ships that the
  deployed client cannot survive (CLAUDE.md §2); `0.0.0` gates nothing.

## Headers and limits

| Item                   | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Source                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `X-Client-Version`     | sent by the client on every request (`client/package.json` version); logged as `clientVersion` on the access line (`none` when missing, or not `^\d+\.\d+\.\d+(-[\w.]+)?$` up to 32 chars)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `client/src/services/api.ts`, `server/src/middleware/clientVersion.ts` |
| `x-request-id`         | echoed on every response; a caller's value is kept if it matches `^[\w.-]{1,64}$`, else a new UUID                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `server/src/app.ts`                                                    |
| CORS                   | one allowed origin, `CLIENT_ORIGIN` (default `http://localhost:5173`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `server/src/app.ts`, `utils/env.ts`                                    |
| `x-powered-by`         | disabled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `server/src/app.ts`                                                    |
| Security headers       | every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`; `Strict-Transport-Security: max-age=86400` only on a request that arrived over TLS (`req.secure`, honouring `X-Forwarded-Proto` through `trust proxy`). The web image's nginx adds the page's own headers ([DEPLOYMENT.md](DEPLOYMENT.md#web-image-headers))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `server/src/middleware/securityHeaders.ts`                             |
| Rate limits            | fixed windows of `RATE_LIMIT_WINDOW_MS` (default 60 s), counted per process: `RATE_LIMIT_IP_MAX` (600) requests on all of `/api`, per signed-in account when the request carries a valid token and per address otherwise (a forged or expired token counts against the address); `RATE_LIMIT_WRITE_MAX` (30) per signed-in user on `POST /orders`, `PATCH /orders/:id/status`, `PATCH /admin/settings`, `PATCH /admin/flags/:key`, `PATCH /stores/:storeId/settings`, `PATCH /stores/:storeId/menu-items/:itemId/stock`, `PUT /stores/:storeId/hours`, `POST /stores/:storeId/pause`, `POST /stores/:storeId/resume`, `POST /stores/:storeId/schedule-exceptions`, `DELETE /stores/:storeId/schedule-exceptions/:exceptionId`, `POST /stores/:storeId/invites`, `DELETE /stores/:storeId/invites/:inviteId`, `DELETE /stores/:storeId/members/:membershipId`; `RATE_LIMIT_INVITE_ACCEPT_MAX` (10) per signed-in user on `POST /me/invites/accept`; `RATE_LIMIT_REGISTER_MAX` (10) per address on `POST /auth/register`; `RATE_LIMIT_CLIENT_ERRORS_MAX` (30) per address on `POST /client-errors`. Over the limit: 429 `RATE_LIMITED` with `Retry-After` (the seconds left in that key's window, matching `RateLimit`'s `reset`) and the draft-7 `RateLimit-Policy` / `RateLimit` headers; 0 turns a limit off. CORS preflights count against that limit too. The body repeats the wait as `details.retryAfterSeconds`. The 429 log line names the limiter (`limiter`: `flood`, `write`, `register`, `clientErrors`, `inviteAccept`) and whether it counted an account or an address (`keyedBy`); neither is sent to the client. Only the first refusal per key per window logs at `warn`; the rest log at `debug`, so a client hammering the limit writes one line, not one per request. Per user, not per address, because campus Wi-Fi puts many customers behind one address ([CONFIGURATION.md](CONFIGURATION.md#deployment-settings), [ADR-009](adr/009-rate-limiting-token-buckets.md)) | `server/src/middleware/rateLimit.ts`, `utils/env.ts`                   |
| JSON body size         | 100 kB (`JSON_BODY_LIMIT_BYTES`); larger is 413, refused on the declared `Content-Length` before auth runs. The rest of the upload is read and thrown away first (at most 1 MB or 2 s, then cut), and the 413 goes out with `Connection: close`: closing with the upload unread made the OS reset the connection, and a client still sending could lose the 413 to the reset. The web image's nginx caps bodies at the same 100 kB with the same JSON envelope and drops a client silent mid-body for 15 s (`client_body_timeout`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `server/src/app.ts`                                                    |
| Lines per order        | site setting `max_lines_per_order`, default 30 (1–100, `PATCH /admin/settings`), counted before merging duplicates; enforced by `createOrder` ("An order can have at most N items."); the schema's hard cap is 100 (`MAX_ITEM_LINES_HARD`). Through the settings cache, another instance may apply a new value up to 10 s late                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `order.service.ts`, `order.schema.ts`, `site_settings`                 |
| Quantity per item      | 1–`max_quantity_per_item` after merging duplicates (store setting, default 10, 1–50); one line is sanity-bounded at 50                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `order.schema.ts`, `order.service.ts`                                  |
| Customer order history | site setting, default 20 (1–200), editable at `PATCH /admin/settings`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `settings.service.ts`, `site_settings`                                 |
| Staff order list       | store setting, default 100 (1–500), editable at `PATCH /stores/:storeId/settings`: how many **finished** orders each store's board keeps; every active order always shows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `settings.service.ts`, `site_settings`                                 |
| Name                   | 2–60 UTF-16 units (register); at most 60 UTF-16 units (`customerName`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `auth.schema.ts`, `order.schema.ts`                                    |
| Note                   | at most 200 UTF-16 units                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `order.schema.ts`                                                      |
| Password               | 6–72                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `auth.schema.ts`                                                       |
| Phone                  | optional `+` and 10–15 digits after stripping spaces, dashes, parentheses                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `common.ts`                                                            |

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

The three `GET /api/stores` routes and the `site_settings` row (read by every `GET /api/orders`, by
`GET /api/admin/settings`, by `GET /api/config` and by the client version gate) are additionally held in an in-process cache, so concurrent requests during a cold cache
share one database round-trip instead of repeating it:

| Export                        | What                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cached<T>(key, ttlMs, load)` | returns the cached value while younger than `ttlMs`; otherwise calls `load()` once and shares the pending promise between every concurrent miss, however long it takes — the `ttlMs` clock only starts once the load settles, so a slow load is never re-triggered mid-flight. A failed load is dropped, never cached |
| `invalidate(key?)`            | drops one key, or every key with no argument                                                                                                                                                                                                                                                                          |
| `PUBLIC_READ_TTL_MS`          | the TTL used by the reads below: env `PUBLIC_READ_TTL_MS`, default 10000 ms (0 turns the cache off)                                                                                                                                                                                                                   |

| Cached endpoint                                                           | Key                  | Loader                                                                                                                                                                         | Invalidated by                                                                                                           |
| ------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/stores`                                                         | `'stores:list'`      | `store.service.listStores` (every `ACTIVE` store; `area` filters in memory afterwards)                                                                                         | pause, resume, hours, profile, publish and unpublish (`invalidate('stores:list')`)                                       |
| `GET /api/stores/:storeRef`, `/menu` (the store)                          | `'store:<id>'`       | `store.service.getActiveStore`; the ref → id step is `'store_ref:<slug>'` (`resolveStoreRef`)                                                                                  | settings, pause, resume, hours, profile, publish and unpublish (`invalidate('store:<id>')`)                              |
| `GET /api/stores/:storeRef/hours`, and the open state of every store read | `'store_hours:<id>'` | `schedule.service.getSchedule` (the week and the exceptions; the list reads them in two paged queries; the menu's open fields are computed per read, outside `menu:<storeId>`) | the hours and exception writes (`storeHours.service`), with `store:<id>`, `stores:list` and the menu                     |
| `GET /api/stores/:storeRef/menu`                                          | `'menu:<id>'`        | `menu.service.getStoreMenu` → `loadMenu`                                                                                                                                       | `menu.service.invalidateMenus(storeId)` from `order.service.createOrder` (in a `finally`), a cancel and the hours editor |
| `GET /api/orders`, `GET /api/admin/settings`, `GET /api/config`           | `'site_settings'`    | `settings.service.getSettings`                                                                                                                                                 | `settings.service.updateSettings` (`PATCH /api/admin/settings`), at once                                                 |
| `GET /api/config` (`features`), every `flags.service.isEnabled` call      | `'feature_flags'`    | `flags.service.getFlags` (every flag, rules parsed; evaluated per caller, never cached per caller)                                                                             | `flags.service.setFlag` (`PATCH /api/admin/flags/:key`), at once                                                         |

`createOrder`'s own open check reads the store uncached through `getStore()` (and the schedule uncached through `loadSchedule`) — a write
path never trusts a stale read of the data it is about to act on. Nothing user-specific (orders, profiles) is ever
put through `cached()`; the cache is per-process (see the `ponytail:` note in `cache.ts` for the multi-instance
ceiling — a shared cache such as Redis, or LISTEN/NOTIFY, is the upgrade if edits from a second API instance or the
Supabase dashboard ever need to show up faster than the TTL).

Tests: `server/test/unit/cache.safe.test.ts` (the cache primitive), `server/test/api/caching.safe.test.ts` (the HTTP
headers and the 304), `server/test/api/store-cache.test.ts` (the menu cache tracks a real order and its
cancellation), `server/test/api/admin.test.ts` (settings bounds, `requireAdmin`, and the cache invalidation on
save), `server/test/api/flags.test.ts` (a flip shows on the next evaluation after a cached read). See also
[TESTING.md](TESTING.md).
