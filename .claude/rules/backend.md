---
paths:
  - "server/**"
  - "**/Dockerfile"
  - "client/nginx/**"
  - "compose.yaml"
---

# Backend rules (server/, images)

Loaded with any `server/` file, a Dockerfile, the nginx config or `compose.yaml`. Section numbers match `CLAUDE.md`.

## 2c. Caching on the server (STRICTLY ENFORCED)

The principle is in `CLAUDE.md` §2c; the client side is in `.claude/rules/frontend.md` §2c.

- Every `/api` response carries `Cache-Control: no-cache` and `Vary: Authorization` (`server/src/app.ts`). With
  Express's ETag, an unchanged body comes back as a bodiless 304, including on every poll. Never give stock, menu or
  order responses a `max-age`.
- Public, read-mostly data (menu, store, any future catalog) is read through `cached(key, PUBLIC_READ_TTL_MS, load)`
  from `server/src/utils/cache.ts`. It is per-process, has a TTL (10 s), and shares one load between concurrent misses.
- Every write through the API that changes cached data calls `invalidate(key)` in the same service, as
  `order.service.ts` does after an order is placed or cancelled. A new cached read ships with its invalidation, and a
  test that fails without it (`server/test/api/menu-cache.test.ts`).
- Write paths never read through the cache (`createOrder` checks `is_open` with the uncached `getStore()`).
  Nothing user-specific ever goes into `cached()`.

**Containers (`server/Dockerfile`, `client/Dockerfile`, `client/nginx/`):** hashed `/assets/*`
`public, max-age=31536000, immutable`; `/images/*` a week; `index.html`, SPA routes and `/runtime-env.js` `no-cache`;
gzip on. See `docs/DEPLOYMENT.md` "Containers".

`perf-auditor` checks all of this (check 10) and reports a missing safe cache as a finding.
## 4. Server layering

`routes/*.routes.ts` → `middleware/validate.ts` (zod) → `controllers/*.controller.ts` → `services/*.service.ts` →
`utils/serializers.ts`. Controllers are thin and have no try/catch: Express 5 forwards rejected promises to
`middleware/errorHandler.ts`. `src/app.ts` builds the app (`createApp()`); `src/server.ts` only listens.
`src/worker.ts`, the second entry point, runs the queue consumers in `jobs/` (`docs/JOBS.md`). The map is
`docs/BACKEND_STRUCTURE.md`.

## 10. Backend engineering

- **Schema first:** zod in `schemas/*.schema.ts` with real bounds; `XInput` / `XQuery` inferred with `z.infer`.
- **Serializers:** rows become `XDto` (`server/src/types/api.ts`) in `utils/serializers.ts`. Update the client copy
  in `client/src/types/api.ts` (named `X`) in the same change.
- **Errors:** throw the `AppError` factories in `utils/errors.ts`; add new codes to `ErrorCode`. The envelope is
  `{ error: { code, message, details? } }`.
  A dependency that fails or cannot be reached is an `IntegrationError { provider, operation, retryable, cause }`
  (503 `UPSTREAM_UNAVAILABLE` with `Retry-After`); wrap with `{ cause }`, never swallow it (`docs/LOGGING.md`
  "Error classes").
- **Atomic multi-step writes** go into a SQL function (`p_` params; expected failures raise P0001 with the API error
  code as the message and JSON detail, decoded by `raisedByDatabase` in `utils/supabase.ts`).
- **Every transition function** takes `p_actor jsonb` and `p_request_id text` (defaulted, so the deployed API keeps
  working until the new one ships), sets them with `set_config('app.actor', …, true)` and
  `set_config('app.request_id', …, true)`, and calls `emit_event` before returning, in the same transaction. The
  service passes the controller's `RequestContext` (`types/auth.ts`). A repeat of a transition that already happened
  changes nothing and emits nothing (`update_order_status`; docs/JOBS.md "Order events").
- **Audited tables** (`site_settings`, `orders.status`, `profiles.role`, `menu_items` except stock; docs/SCHEMA.md
  `audit_row_change`) are written through a transition function, or through the Data API with
  `.setHeader('x-actor', JSON.stringify(ctx.actor)).setHeader('x-request-id', ctx.requestId)` as
  `settings.service.updateSettings` does. Anything else is recorded as `SYSTEM`. A new audited table gets its
  `audit_row_change` trigger in the migration that creates it.
- **Trust nothing from the client:** prices and totals come from the database. Someone else's resource is 404, never 403. The role is read from `profiles` on every request, never from the token.
- **`supabaseAdmin` bypasses RLS,** so every query scopes by user explicitly.
- Public reads are cached with `cached()` and invalidated by the writes that change them (§2c).
- Sessions: access tokens stay 1 h (refreshed by supabase-js). A sign-in ends after 7 days without use; each use
  restarts the week (`client/src/features/auth/sessionActivity.ts` + `auth.sessions.inactivity_timeout = "168h"` in
  `server/supabase/config.toml` locally; on hosted Supabase Free, where the inactivity timeout is a Pro setting,
  `requireAuth` enforces it per session through `touch_session`, revokes an idle sign-in and refuses a signed-out one,
  `docs/PERMISSIONS.md` "Session lifetime"). Never raise `jwt_expiry` to get longer
  sign-ins: a long-lived bearer token cannot be revoked.
- Env is read only through `utils/env.ts`. `src/types/database.ts` is generated (`npm run db:types`); never
  hand-edit it.
- Recipes: `/new-endpoint`, `/db-migration`.

## 12. Naming

| Thing          | Convention                                                        |
| -------------- | ----------------------------------------------------------------- |
| Server modules | `<area>.routes.ts`, `.controller.ts`, `.service.ts`, `.schema.ts` |
| Response types | `XDto` on the server, `X` on the client                           |
| Database       | snake_case; JSON is camelCase (serializers convert)               |
| Tests          | `*.test.ts(x)`; staging-safe suites `*.safe.test.ts`              |

## 14. CRUD and lifecycle verification

For any endpoint or order-flow change, exercise it against the local API with a real token:

```bash
KEY=$(grep VITE_SUPABASE_PUBLISHABLE_KEY client/.env.development | cut -d= -f2)
TOKEN=$(curl -s "http://127.0.0.1:54321/auth/v1/token?grant_type=password" -H "apikey: $KEY" \
  -H 'Content-Type: application/json' -d '{"email":"anishka@example.com","password":"test1234"}' | jq -r .access_token)
curl -s localhost:8000/api/orders -H "Authorization: Bearer $TOKEN" | jq
```

Walk the lifecycle: create → get → list → each valid status transition (staff token: `staff@campuscafe.local` /
`staff123`; admin: `admin@campuscafe.local` / `admin123`) → repeating the last transition returns 200 and changes
nothing → an invalid transition returns 409 → cancelling restores stock → another user's order returns 404. Each
step that changed something left one row in `domain_events` with the caller as `actor` and the request's
`x-request-id`, and each status change one `audit_log` row with the same actor and request id; the repeat and the
refusals left neither. Then confirm the UI shows the result.

## 19. Logging

- Log only through `server/src/utils/logger.ts` (pino; inside a request use `req.log`, which carries the request id)
  and `client/src/lib/logger.ts`. `console.*` fails lint.
- Levels are tunable per environment: `LOG_LEVEL` on the server (default `debug` on local, `info` on staging and
  production) and `VITE_LOG_LEVEL` on the client (default `debug` in dev, `warn` in builds; `debug`/`info` are
  compiled out of production builds).

| Level   | Meaning                                                                                                   | In this app                                                                                                        |
| ------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `error` | 5xx or unexpected; server logs it with `err` (stack and cause chain), `route`, `status`, `code`, `userId` | unhandled route error; 503 `UPSTREAM_UNAVAILABLE` (database or Auth unreachable, an `IntegrationError`)            |
| `warn`  | expected but worth noticing                                                                               | 401 / 403, the first 429 per key per window (repeats and 426 `CLIENT_OUTDATED` are `debug`: each is expected)      |
| `info`  | lifecycle and business events                                                                             | listening/shutdown, `Order placed`, `Order status changed`, 4xx like `INSUFFICIENT_STOCK`, access lines for writes |
| `debug` | dev tracing                                                                                               | access lines for successful reads (polled lists)                                                                   |

- Access lines carry `clientVersion` (the `X-Client-Version` header, `none` when missing or malformed).
- Structured fields first, a short constant message second: `req.log.info({ orderId, status }, 'Order status changed')`.
- Never log tokens, the secret key, passwords, or raw email/phone. Redaction (`REDACT_PATHS`) covers object keys
  only, never message strings.
- Log a failure once, at the boundary (`errorHandler`). Do not log and rethrow. Nothing above `debug` on polling
  paths or in loops.
- Details: `docs/LOGGING.md`.

