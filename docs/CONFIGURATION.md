# Configuration

Every value that changes how food-pickup behaves, where it lives and who may change it. One registry, so no limit is
hard-coded in two places. Add a row here in the same change that adds a setting (CLAUDE.md §6).

## Tiers

| Tier              | Where                                                | Changed by                                                        | Takes effect                                                             |
| ----------------- | ---------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Site setting      | the one `site_settings` row                          | an admin, `PATCH /api/admin/settings` (the `/admin` page)         | the next request on this API instance; others within the 10 s read cache |
| Store setting     | four columns of the `stores` row                     | a store's manager or owner, `PATCH /api/stores/:storeId/settings` | the next request on this instance; others within the 10 s read cache     |
| Deployment (env)  | `server/.env`, the host, the web image's runtime env | whoever deploys                                                   | the next process start ([DEPLOYMENT.md](DEPLOYMENT.md))                  |
| Feature flag      | a `feature_flags` row                                | an admin, `PATCH /api/admin/flags/:key`                           | the next request on this API instance; others within the 10 s read cache |
| Platform constant | code, with a parity test where both sides need it    | a code change and a release                                       | the next release                                                         |

## Site settings

Read through `getSettings()` (`server/src/services/settings.service.ts`, cached as `site_settings`, invalidated by the
update). Edited from the registry in `client/src/features/admin/settingsRules.ts` (`SETTING_FIELDS`). Bounds are the
same in three places: the `site_settings` check constraints ([SCHEMA.md](SCHEMA.md#site_settings)),
`updateSettingsSchema` (`server/src/schemas/admin.schema.ts`) and `SETTING_FIELDS`.

| Key (API)                   | Column                         | Type    | Default | Bounds     | Read by                                                                                                                          |
| --------------------------- | ------------------------------ | ------- | ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `customerOrderHistoryLimit` | `customer_order_history_limit` | integer | 20      | 1–200      | `GET /api/orders` for a customer                                                                                                 |
| `maxLinesPerOrder`          | `max_lines_per_order`          | integer | 30      | 1–100      | `POST /api/orders` (`createOrder`, lines counted before merging; up to 10 s late on other instances)                             |
| `orderPollMs`               | `order_poll_ms`                | integer | 4000    | 2000–60000 | the order page's poll (`useOrder`, via `GET /api/config`)                                                                        |
| `ordersPollMs`              | `orders_poll_ms`               | integer | 8000    | 2000–60000 | the customer's order list poll (`useOrders`)                                                                                     |
| `staffBoardPollMs`          | `staff_board_poll_ms`          | integer | 4000    | 2000–60000 | the staff board's poll (`useOrders({ audience: 'staff' })`)                                                                      |
| `clientErrorSamplePercent`  | `client_error_sample_percent`  | integer | 100     | 0–100      | `GET /api/config` `clientErrors.samplePercent`: the share of page loads that report their errors (the client reporter, P1 PR 12) |
| `minClientVersion`          | `min_client_version`           | semver  | `0.0.0` | `x.y.z`    | `clientVersionGate` ([API.md](API.md#client-version-gate))                                                                       |

The client reads them through `GET /api/config` (`useConfig()`, persisted) and falls back to
`client/src/config/fallbacks.json` until it loads or when it cannot.

## Store settings

Columns of the `stores` row ([SCHEMA.md](SCHEMA.md#stores)), read through `getStoreSettings(storeId)`
(`server/src/services/storeSettings.service.ts`, cached as `store_settings:<id>`; the write drops it and the store's
menus). Bounds are the check constraints, `STORE_SETTING_BOUNDS` and `updateStoreSettingsSchema`, kept equal by
`test/api/store-settings.test.ts`. A new store takes the defaults; the migration copied each existing store's
`staff_order_list_limit` from the site setting once; P2 PR 16 then dropped the site-setting column.

| Key (API)                     | Column                            | Default | Bounds | Read by                                                                  |
| ----------------------------- | --------------------------------- | ------- | ------ | ------------------------------------------------------------------------ |
| `maxQuantityPerItem`          | `max_quantity_per_item`           | 10      | 1–50   | `createOrder` (a line's merged quantity), `MenuResponse.rules`, the cart |
| `lowStockThreshold`           | `low_stock_threshold`             | 5       | 0–50   | `MenuResponse.rules` (the "only N left" pill)                            |
| `staffOrderListLimit`         | `staff_order_list_limit`          | 100     | 1–500  | the store's board: finished orders kept (active ones always show)        |
| `lastOrderMinutesBeforeClose` | `last_order_minutes_before_close` | 0       | 0–240  | stored only; enforced by P2 PR 06                                        |

The client reads the first two from the menu's `rules`; with no menu loaded it uses `storeDefaults` in
`client/src/config/fallbacks.json`, which `limits-parity.safe.test.ts` pins to the column defaults.

## Feature flags

Not a limit but a switch: whether a feature is on, and for whom. One `feature_flags` row per flag
([SCHEMA.md](SCHEMA.md#feature_flags)), created by the migration of the phase that ships the feature (none yet; the
planned ones are in the roadmap's P1.7). Evaluated on the server by `flags.service.isEnabled(key, { userId, role,
storeId })`: `enabled`, then the store list, then the role list, then a stable percentage of signed-in users. An
unknown key is off, so code can ship before its flag's row. Read through `getFlags()` (cached as `feature_flags`,
invalidated by the flip). A `client_visible` flag also reaches the client through `GET /api/config`'s `features`
([API.md](API.md#get-config)), as `false` while it has targeting rules. A flag the client cannot read (the table unreachable) is `false` there too, so a client-visible flag must be named so that `false` is the safe value: `menu_v2_enabled`, never `ordering_paused`. Flipped through [`PATCH /api/admin/flags/:key`](API.md#patch-adminflagskey), audited with
the admin's name; there is no screen until P7.4.

## Deployment settings

A blank value (`RATE_LIMIT_IP_MAX=`) counts as unset and takes the default; write `0` to turn a limit off.

| Variable             | Default | Bounds           | Read by                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | ------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_IDLE_DAYS`  | 7       | 1–90             | `requireAuth`'s server-side idle check (`touch_session`, every environment); `GET /api/config` (`session.idleDays`); must equal `auth.sessions.inactivity_timeout` (168h) in `server/supabase/config.toml` (hosted Supabase Free has no such setting, [ADR-011](adr/011-free-tiers.md)). The client's sign-in cap (`sessionActivity.ts`) reads the fallback copy, because it runs before any request |
| `WORKER_HEALTH_PORT` | 8001    | positive integer | `worker.ts`: the port of `GET /health` ([JOBS.md](JOBS.md#the-worker-process))                                                                                                                                                                                                                                                                                                                       |

| `RATE_LIMIT_WINDOW_MS` | 60000 | 1000–3600000 | `middleware/rateLimit.ts`: the fixed window every limit below counts in |
| `RATE_LIMIT_IP_MAX` | 600 | ≥ 0 (0 = off) | requests per window on all of `/api`, per signed-in account (verified token) or else per address: a flood guard only; campus Wi-Fi puts many customers behind one address, so a signed-in customer never shares it ([ADR-009](adr/009-rate-limiting-token-buckets.md)) |
| `RATE_LIMIT_WRITE_MAX` | 30 | ≥ 0 (0 = off) | writes per signed-in user per window (`POST /orders`, the store writes under `/stores/:storeId` such as an order's status, hours, pause, settings and team, `PATCH /admin/settings`, `PATCH /admin/flags/:key`): the real abuse limit |
| `RATE_LIMIT_REGISTER_MAX` | 10 | ≥ 0 (0 = off) | `POST /auth/register` per address per window |
| `RATE_LIMIT_CLIENT_ERRORS_MAX` | 30 | ≥ 0 (0 = off) | `POST /client-errors` requests (each up to 5 reports) per address per window |
| `RATE_LIMIT_INVITE_ACCEPT_MAX` | 10 | ≥ 0 (0 = off) | `POST /me/invites/accept` per signed-in user per window (`inviteAcceptLimiter`) |

Every other environment variable is in [DEPLOYMENT.md](DEPLOYMENT.md).

## Platform constants

Bounds both sides need, kept in one place per side and parity-tested (`server/test/unit/limits-parity.safe.test.ts`):
`server/src/schemas/limits.ts` (`LIMITS`) and `client/src/config/fallbacks.json` (`validation`).

| Constant                                                                                                  | Value                             | Enforced by                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nameMin`, `nameMax`                                                                                      | 2, 60                             | `registerSchema`, `createOrderSchema.customerName`; the client's `validateName` (UTF-16 units, visible characters toward the minimum, both sides)                                                   |
| `noteMax`                                                                                                 | 200                               | `createOrderSchema.note`; `validateNote`                                                                                                                                                            |
| `password.min`, `password.max`                                                                            | 6, 72                             | `registerSchema` (bcrypt reads 72 bytes); `validatePassword`                                                                                                                                        |
| `phoneDigits.min`, `phoneDigits.max`                                                                      | 10, 15                            | `phoneField`; `validatePhone`                                                                                                                                                                       |
| `clientErrors.reportsMax`, `messageMax`, `stackMax`, `routeMax`                                           | 5, 500, 3500, 200                 | `clientErrorsSchema` (`POST /api/client-errors`); the browser reporter (`lib/errorReporter.ts`) cuts to them, so a report never fails the batch                                                     |
| `store.nameMin`, `nameMax`, `slugMin`, `slugMax`, `taglineMax`, `descriptionMax`, `areaMax`, `addressMax` | 2, 80, 3, 48, 120, 300, 60, 200   | `createStoreSchema`, `updateStoreProfileSchema` (the slug bounds apply to a new branch only); the name and address bounds are also the `stores_name_length` and `stores_address_line_length` checks |
| `menuItem.nameMin`, `nameMax`, `descriptionMax`, `categoryMax`, `priceMin`, `priceMax`, `stockMax`        | 2, 80, 300, 40, 1, 100000, 100000 | `createMenuItemSchema`, `updateMenuItemSchema` (price in whole rupees); the same check constraints on `menu_items` (`menu-items.test.ts`), stock excepted                                           |

Server-only platform constants (no client copy, so not in the parity test):

| Constant                          | Value                                         | Enforced by                                                                                                                                                                                                                                                                                 |
| --------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVITE_EXPIRY_DAYS`              | 7                                             | `schemas/team.schema.ts`: how long a team invite stays open (`POST /api/stores/:storeId/invites`)                                                                                                                                                                                           |
| `JSON_BODY_LIMIT_BYTES`           | 100 kB                                        | `server/src/app.ts` (refused on the declared length) and `client_max_body_size 100k` in `client/nginx/default.conf.template`; keep the two equal                                                                                                                                            |
| `MAX_BODY_DEPTH`                  | 32                                            | `middleware/validate.ts`: how deep a request may nest arrays and objects before it is 400 (the deepest real body is three levels); past it, the walk that strips NUL bytes would overflow the stack                                                                                         |
| refused-upload drain              | 1 MB or 2 s                                   | `server/src/app.ts` (`REFUSED_UPLOAD_DRAIN_BYTES`, `REFUSED_UPLOAD_DRAIN_MS`): how much of an upload refused for its size is read and thrown away before the 413, so the client gets the answer instead of a connection reset; past either bound the 413 goes out and the connection is cut |
| `domain_events` retention         | 30 days                                       | `purge_domain_events(p_keep default '30 days')` in `20261024181904_outbox.sql`, run nightly by pg_cron ([JOBS.md](JOBS.md#retention)); a new default is a new migration                                                                                                                     |
| `SESSION_TOUCH_EVERY_MS`          | 5 min                                         | `middleware/auth.ts`: how often one API process records a session's use (`touch_session`), so one RPC per active session per 5 minutes per instance; a session gone idle can serve requests on a process for up to this long after its limit                                                |
| `audit_log` retention             | 13 months                                     | a policy of the table, not yet enforced: no purge job until P9.5 ([SCHEMA.md](SCHEMA.md#audit_log), [JOBS.md](JOBS.md#retention))                                                                                                                                                           |
| `POLL_SECONDS`                    | 2                                             | `jobs/runner.ts`: how long an empty queue waits before it is read again, so the most a new job waits to start; reads never wait in the database, so an idle worker holds no connection ([JOBS.md](JOBS.md#the-worker-process))                                                              |
| `SHUTDOWN_DEADLINE_MS`            | 10 s                                          | `utils/shutdown.ts`: how long in-flight requests and jobs get after SIGTERM before exit 1; within Docker's default 10 s stop timeout                                                                                                                                                        |
| worker health limit               | `max(3 × POLL_SECONDS, visibilityTimeoutSec)` | `jobs/health.ts` `staleAfterSec`: how long a queue's loop may show no progress before `GET /health` answers 503 ([JOBS.md](JOBS.md#the-worker-process))                                                                                                                                     |
| `AUDIT_PAGE`                      | 50 (default), 100 (max)                       | `admin.schema.ts`: rows per `GET /api/admin/audit` page                                                                                                                                                                                                                                     |
| `MANAGED_ITEMS_MAX`               | 1000                                          | `services/menu.service.ts`: most items the menu editor's list returns (archived ones included)                                                                                                                                                                                              |
| `STORE_LIST_MAX`                  | 200                                           | `schemas/limits.ts`: most stores `GET /api/stores` returns (not paginated)                                                                                                                                                                                                                  |
| `HOURS_LIMITS.intervalsPerDay`    | 6                                             | `schemas/limits.ts`: most opening intervals one day of a store's week holds                                                                                                                                                                                                                 |
| `HOURS_LIMITS.upcomingExceptions` | 50                                            | `schemas/limits.ts`: most upcoming schedule exceptions (ending today or later) a store holds                                                                                                                                                                                                |
| `MENU_ITEMS_MAX`                  | 500                                           | `menu.service.ts`: most items one `GET /api/stores/:storeRef/menu` carries (lowest `sort_order` first, ties by `id`); logs `warn` \"Menu truncated\" with the total when it bites; pagination comes with the P3.1 catalog                                                                   |

## What stays in code

Presentation constants (animation timings, layout sizes, the reduced-motion rules), `CACHE_PREFIX`, the Supabase
project refs in `db-push.sh` and the product name (`APP_TITLE` in `client/src/config/app.ts`, named once) stay in
code by design. `pnpm run check:durations` (CI, `repo` job) fails on a `\d+_000` duration literal in
`server/src/services`, `server/src/domain` or a client `*Rules.ts`.
