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

| Key (API)                   | Column                         | Type    | Default | Bounds     | Read by                                                    |
| --------------------------- | ------------------------------ | ------- | ------- | ---------- | ---------------------------------------------------------- |
| `customerOrderHistoryLimit` | `customer_order_history_limit` | integer | 20      | 1–200      | `GET /api/orders` for a customer                           |
| `staffOrderListLimit`       | `staff_order_list_limit`       | integer | 100     | 1–500      | `GET /api/orders` for staff                                |
| `maxLinesPerOrder`          | `max_lines_per_order`          | integer | 30      | 1–100      | `POST /api/orders` (from P0 PR 15)                         |
| `orderPollMs`               | `order_poll_ms`                | integer | 4000    | 2000–60000 | the client's order page (from P0 PR 14, via `/api/config`) |
| `ordersPollMs`              | `orders_poll_ms`               | integer | 8000    | 2000–60000 | the client's order list (from P0 PR 14)                    |
| `staffBoardPollMs`          | `staff_board_poll_ms`          | integer | 4000    | 2000–60000 | the staff board (from P0 PR 14)                            |
| `minClientVersion`          | `min_client_version`           | semver  | `0.0.0` | `x.y.z`    | `clientVersionGate` ([API.md](API.md#client-version-gate)) |
