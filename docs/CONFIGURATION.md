# Configuration

Every value that changes how food-pickup behaves, where it lives and who may change it. One registry, so no limit is
hard-coded in two places. Add a row here in the same change that adds a setting (CLAUDE.md §6).

## Tiers

| Tier              | Where                                                | Changed by                                                | Takes effect                                                             |
| ----------------- | ---------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| Site setting      | the one `site_settings` row                          | an admin, `PATCH /api/admin/settings` (the `/admin` page) | the next request on this API instance; others within the 10 s read cache |
| Deployment (env)  | `server/.env`, the host, the web image's runtime env | whoever deploys                                           | the next process start ([DEPLOYMENT.md](DEPLOYMENT.md))                  |
| Platform constant | code, with a parity test where both sides need it    | a code change and a release                               | the next release                                                         |

## Site settings

Read through `getSettings()` (`server/src/services/settings.service.ts`, cached as `site_settings`, invalidated by the
update). Edited from the registry in `client/src/features/admin/settingsRules.ts` (`SETTING_FIELDS`). Bounds are the
same in three places: the `site_settings` check constraints ([SCHEMA.md](SCHEMA.md#site_settings)),
`updateSettingsSchema` (`server/src/schemas/admin.schema.ts`) and `SETTING_FIELDS`.

| Key (API)                   | Column                         | Type    | Default | Bounds     | Read by                                                                                              |
| --------------------------- | ------------------------------ | ------- | ------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| `customerOrderHistoryLimit` | `customer_order_history_limit` | integer | 20      | 1–200      | `GET /api/orders` for a customer                                                                     |
| `staffOrderListLimit`       | `staff_order_list_limit`       | integer | 100     | 1–500      | `GET /api/orders` for staff                                                                          |
| `maxLinesPerOrder`          | `max_lines_per_order`          | integer | 30      | 1–100      | `POST /api/orders` (`createOrder`, lines counted before merging; up to 10 s late on other instances) |
| `orderPollMs`               | `order_poll_ms`                | integer | 4000    | 2000–60000 | the order page's poll (`useOrder`, via `GET /api/config`)                                            |
| `ordersPollMs`              | `orders_poll_ms`               | integer | 8000    | 2000–60000 | the customer's order list poll (`useOrders`)                                                         |
| `staffBoardPollMs`          | `staff_board_poll_ms`          | integer | 4000    | 2000–60000 | the staff board's poll (`useOrders({ audience: 'staff' })`)                                          |
| `minClientVersion`          | `min_client_version`           | semver  | `0.0.0` | `x.y.z`    | `clientVersionGate` ([API.md](API.md#client-version-gate))                                           |

The client reads them through `GET /api/config` (`useConfig()`, persisted) and falls back to
`client/src/config/fallbacks.json` until it loads or when it cannot.

## Deployment settings

| Variable            | Default | Bounds | Read by                                                                                                                                                                                                                                                                       |
| ------------------- | ------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_IDLE_DAYS` | 7       | 1–90   | `GET /api/config` (`session.idleDays`); must equal `auth.sessions.inactivity_timeout` (168h) in `server/supabase/config.toml` and the hosted project's dashboard. The client's sign-in cap (`sessionActivity.ts`) reads the fallback copy, because it runs before any request |

Every other environment variable is in [DEPLOYMENT.md](DEPLOYMENT.md).

## Platform constants

Bounds both sides need, kept in one place per side and parity-tested (`server/test/unit/limits-parity.safe.test.ts`):
`server/src/schemas/limits.ts` (`LIMITS`) and `client/src/config/fallbacks.json` (`validation`).

| Constant                             | Value  | Enforced by                                                                     |
| ------------------------------------ | ------ | ------------------------------------------------------------------------------- |
| `nameMin`, `nameMax`                 | 2, 60  | `registerSchema`, `createOrderSchema.customerName`; the client's `validateName` |
| `noteMax`                            | 200    | `createOrderSchema.note`; `validateNote`                                        |
| `password.min`, `password.max`       | 6, 72  | `registerSchema` (bcrypt reads 72 bytes); `validatePassword`                    |
| `phoneDigits.min`, `phoneDigits.max` | 10, 15 | `phoneField`; `validatePhone`                                                   |

## What stays in code

Presentation constants (animation timings, layout sizes, the reduced-motion rules), `CACHE_PREFIX`, the Supabase
project refs in `db-push.sh` and the product name (`APP_TITLE` in `client/src/config/app.ts`, named once) stay in
code by design. `npm run check:durations` (CI, `repo` job) fails on a `\d+_000` duration literal in
`server/src/services`, `server/src/domain` or a client `*Rules.ts`.
