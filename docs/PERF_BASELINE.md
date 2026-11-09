# Performance Baseline — food-pickup

Date: 2026-09-26
Commit: fb7e874 + uncommitted changes
Machine: Apple M5, macOS 26.4, Node v26.7.0, local Supabase, preview build (`vite preview` on the `vite build --mode development` output), Playwright Chromium

## Budgets

| Budget         | Limit                                                                       | Measured at                                                       |
| -------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| LCP            | ≤ 3 s                                                                       | 360×640, Slow 4G (150 ms RTT, 1.6 Mbps down, 750 kbps up), 4× CPU |
| INP            | ≤ 300 ms                                                                    | same                                                              |
| CLS            | ≤ 0.15                                                                      | same                                                              |
| Initial JS     | ≤ ~170 KB gzipped                                                           | `vite build` output: entry + modulepreload chunks                 |
| Code splitting | route-level for staff, auth and checkout                                    | `client/src/App.tsx` + build chunks                               |
| Menu photo     | ≤ ~80 KB each, sized to its box, lazy below the fold, aspect box (no shift) | `client/public/images/`, rendered at 360px                        |
| API payloads   | lean JSON, no over-fetching; no chatty request waterfalls                   | per route                                                         |
| Polling        | paused while the tab is hidden; conservative intervals (metered data)       | `/orders/:id`, `/orders`, `/staff`                                |

## Bundle

Single chunk — **no route-level code splitting at all** (`client/src/App.tsx` imports every page statically, no `lazy()`/`import()`). `StaffDashboardPage`, `LoginPage`, `RegisterPage`, `CheckoutPage` all ship in the one initial bundle.

| Asset                                   | Gzip                 | Raw       | Notes                                                              |
| --------------------------------------- | -------------------- | --------- | ------------------------------------------------------------------ |
| `assets/index-*.js` (entry, only chunk) | 152,473 B (148.9 KB) | 533,026 B | includes every route                                               |
| `assets/index-*.css`                    | 10,333 B             | 55,635 B  |                                                                    |
| **Initial JS total**                    | **148.9 KB**         |           | within the 170 KB budget by byte count, but structurally not split |

Raw source share (from source maps, top contributors): `@supabase/auth-js` 423K, `react-router` 367K, app code 211K, `react-dom` 131K, `@supabase/storage-js` 113K, `@supabase/postgrest-js` 109K, `@supabase/realtime-js` 100K, `lucide-react` 25K (imported by name everywhere — tree-shaken correctly).

`client/package.json` changed in this diff, but only in `devDependencies` (vitest, eslint, prettier, testing-library, jsdom, typescript-eslint) — no new runtime dependency, no bundle impact.

## Images

Raw files (`client/public/images/`), all 900×700 px source JPEGs:

| File                  | Bytes   | Over 80 KB? |
| --------------------- | ------- | ----------- |
| cafe-cover.jpg        | 163,623 | yes         |
| veg-sandwich.jpg      | 154,367 | yes         |
| cheese-toast.jpg      | 133,741 | yes         |
| cappuccino.jpg        | 127,546 | yes         |
| french-fries.jpg      | 110,430 | yes         |
| watermelon-juice.jpg  | 108,999 | yes         |
| chocolate-brownie.jpg | 101,000 | yes         |
| berry-smoothie.jpg    | 84,858  | slightly    |
| blueberry-muffin.jpg  | 82,586  | slightly    |
| espresso.jpg          | 69,162  | no          |
| orange-juice.jpg      | 58,228  | no          |
| cold-coffee.jpg       | 55,941  | no          |

At 360×640 on `/menu`: every image is rendered at 112–170 px (device px) but served at its full 900×700 natural size — 5–8× oversized in each dimension, in every case. `loading="lazy"` is correctly applied to grid thumbnails and below-fold images; the above-the-fold popular rail and `cafe-cover.jpg` are eager, correctly. All images have a sized parent box (`boxH` non-zero before load) — no CLS shift observed (CLS ≈ 0 on `/menu`, `/cart`, `/orders/:id`).

`cafe-cover.jpg` is the LCP element on `/` (164 KB, rendered at 328×141 device px vs 900×700 natural).

## Web Vitals (median of 3, cold cache, Slow 4G, 4× CPU, 360×640)

| Route                                                               | LCP (runs)                   | Median LCP  | CLS      | INP (worst)                 | Long tasks >50ms                  |
| ------------------------------------------------------------------- | ---------------------------- | ----------- | -------- | --------------------------- | --------------------------------- |
| `/` (logged out)                                                    | 2380 / 2352 / 2344 ms        | **2352 ms** | 0        | 0 (no interaction scripted) | none                              |
| `/menu` (logged out, tap Add / open sheet / Escape / category chip) | 6192 / 6132 / 6172 ms        | **6152 ms** | ~0.0002  | 112 ms                      | one 112 ms, one 64 ms (both runs) |
| `/cart` (3 items, step quantity ×5 up/down)                         | 2032 / 1968 / 1972 ms        | **1972 ms** | ~0.0002  | 64 ms                       | none                              |
| `/orders/:id` (logged in as customer)                               | 1588 / 1600 / 1568 ms        | **1588 ms** | ~0.00005 | 0                           | none                              |
| `/staff` (secondary, not budget-held)                               | not run this pass (see note) | —           | —        | —                           | —                                 |

Total blocking time: negligible everywhere (single long task per run, all ≤ 112 ms, i.e. ≤ 62 ms over the 50 ms threshold).

## Bytes and requests per route (same cold/throttled load)

| Route         | Requests | Transfer    | API calls (encoded body)                                               |
| ------------- | -------- | ----------- | ---------------------------------------------------------------------- |
| `/`           | 6        | 330,020 B   | `/api/store` 268 B                                                     |
| `/menu`       | 14       | 1,154,926 B | `/api/menu` 4,360 B                                                    |
| `/cart`       | 8        | 508,943 B   | `/api/menu` 4,360 B                                                    |
| `/orders/:id` | 6        | 167,113 B   | `/api/orders/:id` 805 B, `/api/auth/me` 179 B (parallel, no waterfall) |

No serial API waterfalls observed on any route (all `/api/` calls on a page start together). The `/menu` page's 1.15 MB weight is almost entirely the 12 oversized photos (see Images above), and is the direct cause of its 6.15 s LCP.

## Polling (verified on a freshly-placed, non-terminal order; the only pre-seeded order, #1001, is already `COLLECTED`)

- `/orders/:id` (non-terminal, `POLL_MS = 4000` in `client/src/features/orders/useOrder.ts`): ~7 `/api/orders/:id` requests over 18 s (≈ 23 req/min, ≈ 23 KB/min at 1,005 B/response) — matches the coded 4 s interval.
- Hidden tab: 0 requests over 20 s with `document.hidden` forced true — polling correctly pauses.
- Restored visibility: fetch resumed within 1 s (2 requests observed instead of the ideal 1 — negligible, well below any budget; not investigated further).
- Terminal order (`COLLECTED`): 0 additional requests over 60s+ — `isTerminal()` correctly stops polling. (The pre-seeded order #1001 has already reached `COLLECTED` — was `COMPLETED` at measurement time, the status was later renamed — unlike the `PLACED`/`PREPARING` state described in scope — DB state has moved on since seeding.)
- `/orders` (customer list) and `/staff` share the same `useResource` pause/resume mechanism (`client/src/lib/useResource.ts`); not independently re-verified live given it's the identical, already-verified code path. `/orders` defaults to `pollMs = 8000` (`client/src/features/orders/useOrders.ts`); `/staff` uses `STAFF_POLL_MS`.

## Long tasks and re-renders (menu/cart, 4× CPU)

Scroll + 3 adds + open/close `ItemDetailSheet` on `/menu`, and 5× quantity step up/down on `/cart`: at most one long task per run, ≤ 112 ms, well under the 200 ms INP-risk threshold. No static review of `useCartStore()`/selector patterns triggered (spec only calls for it when long tasks show up over budget).

## API latency (local API, 20 requests each, warm-up excluded)

| Endpoint                       | p50  | p95  | bytes |
| ------------------------------ | ---- | ---- | ----- |
| health                         | 1 ms | 3 ms | 11    |
| store                          | 6 ms | 7 ms | 268   |
| menu                           | 5 ms | 6 ms | 4,360 |
| auth/me (customer)             | 5 ms | 6 ms | 179   |
| orders (customer)              | 6 ms | 8 ms | 1,804 |
| order:customer (single)        | 6 ms | 7 ms | 1,005 |
| orders (staff)                 | 7 ms | 9 ms | 1,804 |
| orders (staff, ?status=PLACED) | 6 ms | 7 ms | 1,008 |

All well within any reasonable latency budget (local network, seeded DB).

## Supabase query patterns (server/src/services/*.ts, static review)

- **Over-fetching:** bare `.select()` (`select *`) in `auth.service.ts:28` (profiles, single row), `menu.service.ts:11` (menu_items, ~12-row table, 3 unused columns vs `toMenuItemDto`), `order.service.ts:59` (menu_items lookup during order placement, bounded by cart size), `store.service.ts:9` (stores, single row, `.limit(1)`). None are on a list/polled endpoint with a large table — impact is minor at current data volumes. `selectOrders()` (`server/src/utils/serializers.ts:11`) already uses an explicit column list with embedded `stores`/`order_items`/`menu_items` relations — a good pattern, one round trip for order + lines + store.
- **N+1:** none found (`grep -n -B4 ".from("` shows no `.from(` inside a loop or `Promise.all(list.map(...))`).
- **Missing indexes:** none found on the hot paths. `orders(user_id, created_at)` and `orders(status, created_at)` cover `listOrders`/`getOrder`'s filters and sort; `menu_items(store_id, category)` covers the menu query's `store_id` filter (the `sort_order` in the same query isn't indexed alongside `store_id`, but `menu_items` is a ~12-row table, not a growing one — not worth an index).
- **Unbounded lists:** `listOrders` (`server/src/services/order.service.ts:98-107`) bounds the staff path with `STAFF_LIST_LIMIT = 100` but the customer path (`else query = query.eq('user_id', user.id);`) has no `.limit(`. `orders` is a growing table with an index on `(user_id, created_at)`, so it will scale in query cost, if not yet in payload size (2 orders total today).
- **Round-trips:** menu route = 2 sequential calls (`getStore()` then `menu_items`, both required); order creation = `getStore` → `menu_items` (pricing) → `place_order` RPC → `selectOrders` (confirm) — 4 calls, all necessary, and `place_order` already folds the stock-reservation + insert into one DB transaction. None exceed the 3-in-series threshold.

## Client fetch patterns (changed files: `CartButton.tsx`, `StatusTracker.tsx`, `ItemDetailSheet.tsx`, `StaffDashboard.tsx`)

All four changes are the react-hooks v7 fixes described in scope (ref/setState-in-effect → render-time derived state). None add a new fetch, change a `pollInterval`, or duplicate a GET already available via router state. No findings.

## Worker (`server/src/worker.ts`, 2026-11-01, P1 PR 04, local Supabase)

Reads are quick `pgmq.read` calls with a 2 s wait in the worker when a queue is empty (`POLL_SECONDS`). The first
version long-polled for 5 s; its numbers are kept for comparison.

| Measure                                     | Quick reads (current)                                                               | Long-poll (first version, replaced)                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Idle `queue_read` per queue                 | 30/min (measured 15 in 30 s)                                                        | ~12/min                                                           |
| Connection held by an idle queue            | 1 of 100 samples (`pg_stat_activity`, every 250 ms)                                 | continuously: 1 per queue per replica                             |
| `GET :8001/health` per probe                | 7-8 ms, one `queue_metrics` RPC per queue (~0.1-0.6 ms in the database)             | same                                                              |
| Event pickup, `emit_event` to "Order event" | at most 2 s by design; 1.8-2.6 s measured through a CLI that takes 1.2-1.9 s itself | 101 / 130 / 106 ms                                                |
| Worker stop on SIGTERM                      | 116 ms                                                                              | 2.8 s (the read in progress finished its poll)                    |
| API `GET /api/orders` (customer), 40 req    | not re-measured (the worker now holds no connection)                                | with worker p50 9.9 / p95 11.8 ms; without p50 11.2 / p95 13.2 ms |

`GET /api/menu` is served from the 10 s in-process cache (1.4 ms), so it does not exercise the shared pool.
Local pooler config: `default_pool_size = 20`, `max_client_conn = 100`; PostgREST's own pool is separate.
Scaling: N queues hold N connections permanently. Revisit a shared poll (one loop reading all queues, or one
`queue_read` per ~5 s round-robin) or LISTEN/NOTIFY when N is about 5 or more on Free, or whenever the pooler or
PostgREST pool (default 10 in hosted Free) is above ~50% held by idle polls.

## Known over budget

- **LCP `/menu` = 6.15 s vs 2.5 s budget (146% over).** Root cause: 12 menu photos served at their full 900×700 source resolution (up to 164 KB each) while displayed at 112–170 px device boxes — 5–8× oversized in every case, 1.15 MB total page weight. Fix: a resize pipeline (or `srcset`/`sizes`) producing ~230–340 px variants would cut photo bytes by roughly 90%.
- **7 of 12 menu photos exceed the ~80 KB budget** (`cafe-cover.jpg` 164 KB down to `chocolate-brownie.jpg` 101 KB) — same root cause as above.
- **No route-level code splitting** — `client/src/App.tsx` imports `StaffDashboardPage`, `LoginPage`, `RegisterPage`, `CheckoutPage` eagerly; the build produces one 533 KB (149 KB gzip) chunk. Currently under the 170 KB byte budget, but structurally non-compliant and will regress past budget as any of those routes grow.
- **`listOrders` customer path has no `.limit(`** (`server/src/services/order.service.ts:98-107`) — unbounded for a growing table, no measured impact yet (2 orders exist).
- **Bare `select()` (select \*)** on `menu_items`, `profiles`, `stores` — minor over-fetch on small tables, no measured impact at current row counts.

None of the above were introduced by this change (the semantic diff is server-side logging + client hooks-correctness fixes); every item pre-dates it and is recorded here as the starting point.

## History

- **2026-09-27** · `fb7e874 + uncommitted changes` (round 2: image compression + 400px thumbnails, client localStorage
  persisted cache, server ETag/304 + in-process read cache, customer order-list cap, route-level code splitting for
  Checkout/OrderSuccess/Login/Register/StaffDashboard) — Initial JS 143.6 KB gzip (was 148.9 KB, −3.5%); `/menu` LCP
  2.88 s / INP 48 ms / CLS ~0.0002 (was 6.15 s / 112 ms / ~0.0002 — LCP −53%, still ~15% over the 2.5 s budget, no
  longer the 146%-over regression it was); `/menu` photo payload 406 KB total page weight (was 1.15 MB, −65%);
  `GET /api/menu` and `GET /api/store` p50 latency ~1 ms (was 5–6 ms, served from the new in-process read cache);
  `/orders/:id` polling unchanged at 15 req/min (4 s interval) but ~4.5 KB/min (was ~23 KB/min, −80%, from ETag 304s);
  hidden-tab pause and resume-on-visible still hold (0 requests hidden, 1 request on resume — the "2 requests"
  baseline quirk is gone). Customer `listOrders` is no longer unbounded (`CUSTOMER_LIST_LIMIT = 50` added). See
  report body (this run) for full deltas, the `cafe-cover.jpg` gap (StoreCard/menu banner still serves the
  full 900×700 original, 103 KB, even though a 400px thumbnail now exists for it), and CONFIRM items.
- **2026-09-27 (follow-up)** · same tree + storefront cover `srcSet`/`sizes` (`StoreCard.tsx`, `pages/Menu.tsx`, now
  using `cafe-cover-400.jpg`) — `/menu` LCP median 2532 ms (runs 2740/2532/2476; LCP element `cafe-cover-400.jpg`),
  page weight 322 KB (was 406 KB). Measured by the main agent with the check-3 method (preview build, 360×640, Slow 4G,
  4× CPU, cold cache) at DPR 1; a DPR 2–3 phone picks the 900px cover, so its gain is smaller. ~1% over budget.
- **2026-09-27 (round 3)** · `355fff5 + uncommitted changes` (ADMIN role + `/admin` site-settings dashboard, `site_settings`
  singleton with a 10 s in-process read cache, `listOrders` now sources its customer/staff list limits from that
  cache instead of fixed constants, COMPLETED→COLLECTED rename, max qty 10, `authStore.hydrate` single-flight) —
  Initial JS 144.3 KB gzip (`index-DVr1sxne.js` 147,789 B; was 143.6 KB, +0.5%, noise-level, still well under the
  170 KB budget); `AdminPage` confirmed lazy (`Admin-CShg55gW.js`, 1,463 B gzip, no `modulepreload`/`src` link in
  `index.html`'s initial set) — it did **not** land in the initial bundle; `roles.ts` (8 lines) and
  `sessionActivity.ts` (38 lines) are eager as scoped, both tiny, no measurable bundle impact. No new runtime
  dependency (`client/package.json` diff is devDependencies only — eslint/vitest/prettier toolchain). `/menu` LCP
  median 2292 ms (runs 2560/2260/2292, was 2532 ms — back within the 2.5 s budget, first time this round); `/orders/:id`
  LCP median 1540 ms (runs 1516/1540/1600, was 1588 ms, within noise). `cafe-cover` still serves the `srcset`
  400w/900w pair unchanged. `GET /api/orders` (customer) p50 6 ms / p95 8 ms / 609 B, `GET /api/orders` (staff) p50
  6 ms / p95 8 ms / 609 B, `GET /api/orders/:id` p50 6 ms / p95 7 ms / 606 B — all within noise of the round-1
  baseline (6–9 ms); `listOrders`'s new `await getSettings()` added no measurable latency because `site_settings`
  shares the same in-process TTL cache as menu/store (`server/src/utils/cache.ts`, 10 s TTL) — confirmed a cache hit
  by code inspection (`cached()` returns the stored promise on every call inside the TTL window) and by latency
  staying flat. `GET /api/admin/settings` p50 3 ms / p95 4 ms / 118 B; `PATCH /api/admin/settings` p50 6 ms / p95
  8 ms / 118 B, and the read cache is invalidated on every PATCH (verified live: PATCH then GET returns the new value
  immediately). Polling unchanged: `/orders/:id` (non-terminal `PLACED` order, freshly placed for this run) ~15
  req/min, transferSize 300 B/response (encodedBodySize 595 B — the ETag/304 still lands: `Content-Length` is 595 B
  but only ~300 B of headers cross the wire on repeat polls) ≈ 4.5 KB/min, matching the round-2 baseline; `/staff`
  ~15 req/min, transferSize 300 B/response (encodedBodySize 1,195 B) ≈ 4.5 KB/min, same ETag/304 behaviour — both 0
  requests over a hidden-tab window and 1 immediate request on resume. `TERMINAL_STATUSES` now reads `['COLLECTED',
'CANCELLED']` (`orderStatus.ts`) so polling still stops correctly at the renamed terminal state. The customer
  `listOrders` path is no longer a fixed `CUSTOMER_LIST_LIMIT` constant — it now reads `customer_order_history_limit`
  from the (cached) site settings, defaulting to 20 — this fully resolves last round's "no `.limit(`" advisory by
  making the cap admin-configurable instead of dropping it. See report body (this run) for the full delta table and
  CONFIRM items.
- **2026-09-27 (round 4)** · `55c3208 + uncommitted changes` (review round: `cache.ts` in-flight load shared past TTL
  via `expiresAt: Infinity` while pending, `app.ts` cache headers moved before pino-http/cors/express.json, stale-copy
  notice on `/` and `/menu` when a refresh fails over a persisted copy, `TopBar` logo `min-h-11`, server prod build via
  `tsconfig.build.json`, plus non-perf test/doc/seed/hook changes) — Initial JS 144.5 KB gzip (`index-ByUvrC2x.js`
  147,996 B; was 144.3 KB, +0.14%, noise-level, still well under the 170 KB budget); splitting unchanged (`Login`,
  `Register`, `Checkout`, `StaffDashboard`, `Admin`, `OrderSuccess` all separate chunks, none in the initial set). No
  new runtime dependency (`client/package.json` untouched this round). `/menu` LCP median 2268 ms (runs
  2268/2268/2292, was 2292 ms — within noise, still within the 2.5 s budget), CLS ~0.00016, INP 48–104 ms, one 57 ms
  long task (well under the 200 ms INP-risk line); `/` LCP median 1608 ms (runs 1616/1608/1608, was not separately
  tracked the last two rounds — within the 2.5 s budget by a wide margin). `/cart` and `/orders/:id` were not
  re-measured this round (untouched by the diff; carrying forward round-3 numbers: 1972 ms / 1540 ms, both
  within budget). Confirmed the stale-copy notice adds no layout shift: with `/api/menu` and `/api/store` aborted
  after a warm persisted-cache visit, "Showing your saved menu" / "Showing saved shop details" render and CLS stays
  ~0.00016 / 0 respectively — no shift from the notice mounting. `cache.ts`: 20 parallel `GET /api/menu` fired
  immediately after an order-placement invalidation (which calls `invalidate('menu')`) all completed in 9–26 ms with
  no serial stacking (consistent with one shared in-flight load, not 20 duplicate DB round trips); warm p50/p95
  settled back to 1 ms/1 ms afterward, matching round 3. `app.ts`: verified live that moving the `Cache-Control`/`Vary`
  middleware before `pino-http`/`cors`/`express.json` did not drop headers on paths that never reach the routers —
  an `OPTIONS` CORS preflight (204) and a malformed-JSON `POST /api/orders` (400) both still carry `Cache-Control:
no-cache` and `Vary: Authorization, Origin`; normal `GET` 304 revalidation on `/api/menu`, `/api/store`,
  `/api/orders` (customer) and `/api/orders/:id` all still return `304` with `0B` body. `cached()`/`invalidate()`
  usage unchanged (`menu`, `store`, `site_settings` cached; `persist: true` still only on `useMenu`/`useStore`, never
  on orders/profile). `server npm run build` (now via `tsconfig.build.json`) emits `dist/src/**` and `dist/scripts/**`
  only — no `dist/test/**`, no `*.test.js` anywhere in `dist` (confirmed by `find dist -iname "*test*"` returning
  nothing); `dist/` is gitignored and was removed after the check. No regressions found; nothing newly over budget.
- **2026-09-29 (feat/P0 final, `c68f0e0`)** · comparison run on Intel i9-14900HX (WSL2 Linux, Node v24.21.0, local Supabase, preview build, Playwright
  Chromium; the baseline machine was an Apple M5, so absolute times are only roughly comparable). Changes measured: rate limiter, security headers, early
  413, idempotency key on `POST /orders`, staff list split, menu cap, Button/Card/IconButton/EdgeFades atoms, dark scheme, `color-mix()` keyframes,
  `text-order-number` (cqi), boot frame, manifest/icons, checkout/register drafts. Method: cold cache, 360×640, DPR 1, Slow 4G, 4× CPU, median of 3.
  - **Bundle:** initial JS 91,054 B gzip (88.9 KB; `check:bundle` at level 9: 88.8 KB; was 87.4 KB on 2026-09-28, 144.5 KB in round 4) — budget 170 KB,
    within. CSS 11,066 B. `Login`, `Register`, `Checkout`, `OrderSuccess`, `StaffDashboard`, `Admin` and `supabaseClient` (58.8 KB gzip) are all separate
    lazy chunks, none in `index.html`.
  - **Web Vitals (median, runs):** `/` LCP 1408 ms (1428/1392/1408), CLS 0.054, INP n/a; `/menu` LCP 1484 ms (1484/1440/1604), CLS 0.0022, INP 72 ms,
    long tasks 50–86 ms; `/cart` LCP 1752 ms (1752/1740/6664, one outlier), CLS 0.0015, INP 32 ms; `/orders/:id` LCP **5532 ms** (5488/7496/5532),
    CLS **0.239** (0.2387/0.2387/0.239), INP 0; `/staff` (secondary) LCP 1684 ms, CLS 0.058.
  - **Over budget (new):** `/orders/:id` CLS 0.239 > 0.1 and LCP 5.5 s > 2.5 s. Attribution: the Google Fonts stylesheet is non-blocking
    (`client/index.html`, system font first). When it lands after the order content has rendered, `document.fonts` fills (5.5 s in the diagnosed run),
    text re-wraps, `scrollHeight` drops 838 → 783 px and the whole card stack shifts up 44 px in one frame, which also re-emits the text as a new LCP
    candidate. Reproduced in 5 of 7 diagnosed loads; a run where the stylesheet landed at ~2.2 s showed no shift, so the result depends on
    when the font CSS arrives (real network from this host). `/` (0.054) and `/staff` (0.058) show smaller shifts of the same kind (0.053 was already
    in the 2026-09-28 Lighthouse note).
  - **Bytes/requests:** `/` 7 req 129 KB (`/api/store` 268 B); `/menu` 15 req 271 KB (`/api/menu` 4,416 B); `/cart` 9 req 167 KB; `/orders/:id`
    10 req 168 KB (`/api/config` 202 B, order 595 B, `auth/me` 179 B); `/staff` 12 req 174 KB (`/api/orders` 1,983 B). On the two logged-in routes
    the order fetch starts (~1470 ms) only after the lazy `supabaseClient` chunk lands (~1450 ms): entry JS → chunk → API.
  - **Photos:** all 12 full JPEGs ≤ 81,101 B (`veg-sandwich` 81.1 KB, `cafe-cover` 80.9 KB, `cheese-toast` 79.9 KB); 12 `-400.jpg` thumbnails 11–24 KB.
    On `/menu` every `currentSrc` is a `-400.jpg`, natural width ≤ 1.1× box, below-fold cards `loading="lazy"`, every parent box has a height.
  - **Polling:** `/orders/:id` 15 req/min, 4.5 KB/min; `/orders` 8 req/min, 2.4 KB/min; `/staff` 15 req/min, 4.5 KB/min (300 B per 304); hidden tab 0
    requests in 20 s on all three; 1 request on resume; terminal (`COLLECTED`) order 0 requests in 15 s.
  - **API (p50/p95, 20 reqs):** health 1/1 ms, config 1/1, store 1/1, menu 1/1 (4,416 B), auth/me 5/7, orders (customer) 5/6 (1,983 B), order 6/8
    (595 B), orders (staff) 5/6 (1,983 B), `?status=PLACED` 5/6 (598 B). Menu cold 12.9 ms, warm 0.6 ms.
  - **Caching:** `store`, `menu`, `config`, `orders` (customer + staff), `orders/:id` all `Cache-Control: no-cache`, `Vary: Authorization, Origin`,
    weak ETag, `304` 0 B. `cached()` on menu/store/site_settings; `invalidate('menu')` on place (`finally`) and cancel; `createOrder` reads the
    uncached `getStore()`. `persist: true` only on `useMenu`, `useStore`, `useConfig`. Repeat visit to `/menu`: first card at 405 ms, `/api/menu`
    answers at 513 ms (304, 300 B), no skeleton (cold: skeleton, card at 1195 ms after the API at 1122 ms). Aborted Checkout chunk lands on the
    `PageBoundary` retry state. New security headers present (nosniff, `X-Frame-Options: DENY`, `Referrer-Policy`, CSP, `RateLimit` 600/60 s).
- **2026-09-29 (feat/P0, after fixes, `92da501`)** · re-check of the `/orders/:id` HIGH above after `73c239b` (boot-style
  `font-family` defers to `var(--font-sans)`, metric-matched `Jakarta Fallback Roboto/Arial` faces, hero status badge on
  its own line below `sm`), `1702860` (supabase-js chunk starts before first render when a session may exist) and
  `92da501` (`createOrder` reads in one `Promise.all`). Same machine and method as the entry above (cold cache, 360×640,
  DPR 1, Slow 4G, 4× CPU, median of 3), preview build of `--mode development`. This host has no Roboto/Arial, so Chromium
  was run twice: with `FONTCONFIG_FILE` adding Arimo (Arial-metric, what CI gets as Liberation Sans) and without it
  (DejaVu Sans fallback, which no real device uses).
  - **Bundle:** initial JS 91,059 B gzip (was 91,054 B), `supabaseClient` still a separate lazy chunk (58.96 KB gzip).
  - **CLS, with Arimo (medians, runs):** `/` 0 (0/0/0; was 0.054), `/orders/:id` 0.0054 (0.0054/0.0054/0; was 0.239),
    `/staff` 0.0279 (was 0.058), `/menu` 0.0001. **Without it:** `/` 0.054, `/orders/:id` 0 (0.006/0/0), `/staff` 0.032,
    `/menu` 0.0022; the `/` 0.054 is the DejaVu fallback's own wrap, gone with a metric-matched face.
  - **LCP, with Arimo:** `/` 1480 ms (1504/1396/1480), `/menu` 1580 ms, `/orders/:id` 2600 ms (2600/5536/1992), `/staff`
    1628 ms. **Without:** `/` 1392 ms, `/menu` 1548 ms, `/orders/:id` 1984 ms (5528/1984/1952), `/staff` 1628 ms.
  - **Residual `/orders/:id` LCP outlier (about 1 load in 3, 5.5-6.5 s):** the CLS cause is fixed, but in the slow
    loads the LCP candidate `<p>` (order status copy) is first painted only when the web font lands (font stylesheet
    177-5490 ms in one run; the diagnostic loads show the paragraph at 1996-2068 ms normally, 6512 ms once). Medians are
    2.6 s with Arimo (4% over) and 2.0 s without: within noise of the 2.5 s line; the outlier tracks the font CSS/file
    arrival from this host's real network, not app code. Not root-caused; a trace-level look is advised.
  - **Request timeline, signed-in `/orders/:id`:** `supabaseClient` chunk requested at 915 ms, lands 1372 ms; `/api/config`
    997-1164 ms; order and `auth/me` fetches start 1389 ms (was ~1470 ms; chunk 1450 before). The order fetch still
    starts only after the chunk lands (entry, then chunk, then API), about 80 ms earlier than before. `/staff`: chunk
    918-1409 ms, `/api/orders` starts 1440 ms.
  - **Other:** INP `/menu` 72 ms, long tasks 50-89 ms, none over 200 ms. Polling and API latency not re-measured (untouched).
- **2026-09-29 (feat/P0 fix batch, `b9f7828`)** · re-check of `git diff a9532bd..HEAD` against the loosened budgets (LCP ≤ 3 s,
  INP ≤ 300 ms, CLS ≤ 0.15, initial JS ≤ ~170 KB gzip). Same machine and method as the two entries above (preview build of
  `--mode development`, cold cache, 360×640, DPR 1, Slow 4G, 4× CPU, median of 3, Chromium with the Arimo Arial-metric fontconfig).
  - **Bundle:** initial JS 91,256 B gzip (89.1 KB; was 91,059 B, +0.2%), `supabaseClient` still a separate lazy chunk (58.96 KB gzip).
  - **LCP (median, runs):** `/` 1476 ms (1464/1476/1492), `/menu` 1628 ms (1628/1612/1628), `/orders/:id` 1736 ms (1740/1736/1612;
    was 2600 ms with a 5.5 s outlier, no outlier in these 3 runs), `/staff` 1812 ms (1796/1812/1816; secondary). The `/orders/:id` LCP
    element is the footer `<p class="text-caption text-muted">` ("Placed ... Picking up as ..."), not the hero: it is the largest text
    block on screen, and it now paints at first render rather than after a font swap.
  - **CLS (median):** `/` 0, `/menu` 0.0001, `/orders/:id` 0 (0/0/0.0054; was 0.0054), `/staff` 0.0003 (was 0.0279, first-poll jump gone).
  - **INP (worst tap, lab proxy):** `/menu` 64/64/80 ms in the vitals runs (Add then Escape). Add tap, 4× CPU, 3 taps per run x 3 runs:
    real 14-item menu 64/96/96 ms worst per run; mocked 500-item menu 96/96/96 ms (earlier measurement 48-104 ms). Handler processing is
    only 9-24 ms; the remainder is frame presentation, so 500 items costs nothing measurable over 14. Long tasks 50-88 ms, none over 200 ms.
  - **Idle paint cost, `/orders/:id`, 2 s trace at 4× CPU (3 runs):** 0 `Paint` events, `Layerize` 0.01-0.71 ms in total, `PrePaint`
    0.8-2.6 ms and `UpdateLayoutTree` 0.7-1.9 ms over 5 frames, i.e. the pulse runs on the compositor and no longer repaints each frame.
  - Polling, API latency and caching not re-measured (untouched by this batch).
    | 2026-11-02 | feat/p1-07-audit-read (uncommitted) | Server-only run for GET /api/admin/audit; client bundle unchanged (types only, not rebuilt). Audit endpoint default page (11 rows, 3,571 B): p50 10 ms / p95 12 ms; limit=100 p50 9 ms. Existing routes: store 4.8 ms, menu 9 ms single request. |
- **2026-11-02 (feat/p1-10-client-errors, uncommitted)** · server-only run for `POST /api/client-errors` (unauthenticated, per-IP limiter,
  strict zod body, scrub regex, one `warn` per report, 204, no DB). Client bundle unchanged (no client change, not rebuilt). Local API on :8110, 20 requests each after 2 warm-ups.
  - **Endpoint (5 reports, 13.8-20.4 KB body):** typical stack 1.7 / 2.1 ms (p50 / p95); max-size clean text 1.5 / 1.8 ms; 5 x ('a' x 500 message, 'a' x 3500 stack) 5.9 / 6.5 ms; 5 x 'eyJ' runs 1.4 / 1.6 ms. Limiter: 30 x 204 then 5 x 429 from a fresh window (default 30/60 s).
  - **Other routes (mounted before the gate, no cost seen):** health 1.4 / 1.7 ms, config 1.3 / 1.5 ms (202 B), menu 1.1 / 1.4 ms (4,416 B, in-process cache; 1.4 ms at the last baseline), store 1.1 / 1.5 ms. Within noise (< 5 ms).
  - **Scrub regex, direct microbench (tsx, parsing the schema in-process):** quadratic on a long run of characters that can start an email local part or a JWT. 5 reports at max length: 'a' x N 39 ms p50, `eyJ` x N 52 ms, '+' x N 43 ms, 'a.1-' x N 45 ms (max 60 ms); a 35,000-char run takes 830 ms, 350,000 chars 76 s (not reachable: zod `.max()` rejects before the transform). Not reproduced over HTTP (5.9 ms for the 'a' case), so the in-process figure is the pessimistic bound. Candidate fix: `(?<![\w.+-])[\w.+-]{1,64}@` for the email branch and `(?<![\w-])eyJ` for the JWT branch (0.03-0.07 ms on the same inputs).
    | 2026-11-02 | feat/p1-13-feature-flags @ 4333a4b (uncommitted) | Server-only run (P1 PR 13); client bundle unchanged (types only, not rebuilt). `evaluateFlag` 0.1-1.8 us/call (off/plain/roles ~0.1, percent with sha256 ~1.3-1.8; 10 000 calls, no DB), so isEnabled cost is the cached Map lookup plus that. Cached read `select key, enabled, rules from feature_flags`: Seq Scan, 0.09 ms exec (a handful of rows, pkey covers key lookups, no index needed). `PATCH /api/admin/flags/:key` (22 flips, audit + updated_at triggers, 2.2 ms in-DB): p50 9.1 ms / p95 10.1 ms. Existing routes vs baseline: store p50 1.1 ms, menu 1.0 ms (p95 3.1), me 8.4 ms, orders customer 8.2 ms, staff 9.0 ms: none slower. |
    | 2026-11-02 | feat/p1-15-idle-signout (uncommitted) | Server-only run for the idle sign-out check in `requireAuth` (`LOG_LEVEL=warn`, local API, curl, new session per fresh sample). Warm session, map hit: `GET /api/auth/me` p50 10.3 / p95 12.3 ms, `GET /api/orders` p50 10.6 / p95 13.3 ms. First request of a fresh session (one `touch_session` RPC): `auth/me` p50 15.6 / p95 18.6 ms, `orders` p50 16.6 / p95 19.9 ms, so the RPC costs about +5 to +6 ms once per session per 5 min per process (the second request of a fresh session is back to warm, 9.1 ms). Same-run unauthenticated controls: health/store/menu p50 1.3-1.4 ms. No A/B against the pre-change code (tree is uncommitted), so the map-hit overhead is not isolated; code inspection says one `Map.get` and an early-breaking sweep, microseconds. Eight concurrent first requests of one session each call the RPC (the map is set after it answers): 28-96 ms. `touch_session` statements: `auth.sessions` lookup is an Index Only Scan on `sessions_pkey` (0.02 ms), upsert via `session_activity_pkey` 0.43 ms, whole function 1.9 ms execution, planning ~0.6 ms. `purge_session_activity()` at 50k activity rows / 20k sessions: Hash Anti Join with two seq scans, 11.8 ms for a no-op run, 54 ms deleting 30k orphans, linear and nightly. |
- **2026-11-03 (feat/p1-11-client-error-sample @ bb32a53, uncommitted)** · P1 PR 11, `site_settings.client_error_sample_percent` carried to `GET /api/config` (`clientErrors.samplePercent`), `GET/PATCH /api/admin/settings`, `fallbacks.json` and the admin form. No browser Web Vitals pass (a separate UI check covers the form). Local API on :8111, 30 requests after 2 warm-ups, WSL2.
  - **Bundle:** `check:bundle` (build to a temp dir, `--mode development`): initial JS 91,282 B gzip (89.0 KB at level 9; was 91,256 B, +26 B, +0.03%), budget 170 KB; `fallbacks.json` is in the entry chunk, `supabaseClient` (58.8 KB) and all route chunks still lazy and outside the initial set. No new dependency.
  - **`GET /api/config`:** p50 1.0 / p95 1.1 ms (was 1.3 / 1.5), 239 B (was 202 B, +37 B = the `clientErrors` object). **`GET /api/admin/settings`:** p50 4.1 / p95 5.2 ms, 261 B; the new key is `"clientErrorSamplePercent":100,` = +31 B (the 118 B in the round-3 row predates the later setting columns, so it is not a like-for-like byte count; latency 3 / 4 ms then, +1 ms, under the 5 ms noise floor). `PATCH /api/admin/settings` (20 flips, all 200) p50 11.2 / p95 13.7 ms, 260 B; the round-3 figure was 6 / 8 ms, but the table now has the audit and `updated_at` triggers (the P1 PR 13 flag PATCH, same triggers, was 9.1 / 10.1 ms), so the gap is not this change; an A/B on the base branch was not run.
  - **Behaviour:** PATCH then `GET /api/config` returns the new `samplePercent` at once (37), so the read cache is invalidated; 101, -1 and 1.5 are 400; `config` and `admin/settings` revalidate with `If-None-Match` to 304, 0 B (`Cache-Control: no-cache`, `Vary: Authorization, Origin`). health 1.0 / 1.4, store 0.9 / 1.1, menu 0.9 / 1.0 ms (4,416 B): unchanged.
- **2026-11-03 (feat/p1-12-error-reporter @ 0040f5d)** · P1 PR 12, the browser error reporter and the app-scope
  `PageBoundary`. Base/head A/B on one machine (macOS arm64): initial JS 91,123 → 91,985 B gzip; `/` LCP 1456 →
  1432 ms, `/menu` LCP 1536 → 1552 ms, CLS 0 / 0.0001 both, `/menu` INP 48 → 48 ms. Details:
  [Browser error reporting](#web-vitals-ab-2026-11-03-0040f5d-against-its-base-572a359).

- **2026-11-09 (feat/p1-16-paise-contract @ eef97d9, uncommitted)** · P1 PR 16, server-only: migration drops `menu_items.price`, `orders.total`,
  `order_items.unit_price/line_total` and the `menu_items_sync_price` trigger; `place_order` re-created without the rupee writes. Client and response shape
  untouched, so no bundle/Web Vitals/polling run. Local API, curl, 30 requests after 2 warm-ups, 30 orders in the DB (all placed by this run, left in place).
  `GET /api/menu` p50 0.9 / p95 1.1 ms, 4,416 B (same bytes as PR 09); `GET /api/store` 0.9 / 1.1 ms; `GET /api/orders` customer (20 orders) 8.4 / 11.6 ms,
  13,276 B; `GET /api/orders/:id` 7.6 / 8.6 ms, 788 B; staff `GET /api/orders` 8.2 / 9.2 ms, 19,136 B (limit 100, 30 orders); `?status=PLACED` 8.6 / 11.4 ms.
  The DB held 0 orders before this run, so the order-list rows are not like-for-like with PR 09's (132 orders); per order they cost less than before. `POST /api/orders`
  (1 line, 20 x 201) p50 19.5 / p95 26.3 ms over HTTP (PR 09 14.4 / 17.2, PR 08 18.5 / 26.0: run-to-run session noise on a ~15-20 ms request; the 10-line batch hit the
  order rate limiter, 12 x 429, and is not reported). `place_order` in the database (300 one-line calls per round, rolled back, 3 rounds): p50 0.359 / 0.342 / 0.371 ms,
  p95 0.48-0.59 ms, against PR 09's 0.355 / 0.469 ms: unchanged, the dropped rupee writes are not measurable. Queries: `selectOrders()` keeps its explicit column
  list, no N+1, no new `select *` on a polled path; no index touched. No regression.

## CI numbers

Lighthouse CI (`.github/workflows/perf.yml`, config `client/lighthouserc.json`) runs `/` and `/menu` on the compose
stack at 360×640, simulated Slow 4G (150 ms RTT, 1638 kbps) and 4× CPU, three runs each, on PRs touching `client/**`
and nightly. LCP ≤ 3000 ms, CLS ≤ 0.15 and TBT ≤ 300 ms (from `client/perf-budget.json`) warn for now. The report is the `lighthouse-report` artifact.
perf-auditor records the numbers here and re-baselines on Node 24.

### 2026-09-28: LCP fix on the compose stack

Lighthouse (simulated, `client/lighthouserc.json`, three runs, median), before → after: `/` LCP 2704 → 2253 ms,
FCP 1953 → 1502 ms, score 94 → 98; `/menu` LCP 3755 → 2252 ms (runs 2104–2328), FCP 1953 → 1502 ms, score 88 → 98;
CLS unchanged (0.053 / 0.002), TBT 0. Initial JS 145.5 → 87.4 KB gzip (supabase-js on demand), transferred JS
173 → 88 KB (gzip_static at level 9), page weight `/menu` 528 → 419 KB. Applied throttling (Playwright + CDP, Slow 4G,
4× CPU, 360×640): `/menu` LCP 1.66–2.05 s, `/` 1.63–1.78 s. `lhci autorun` assertions pass with no warnings.

## Order writes with events (P1 PR 05, 2026-11-01, local API)

`place_order` / `update_order_status` now call `emit_event` (one `domain_events` insert + one `pgmq.send` to
`q_notifications`) in the same transaction; `update_order_status` takes `select … for update` first. The baseline
above recorded no order-write latency, so these are the first absolute numbers (30 requests each, one customer,
one staff, sequential).

| Request                                             | p50   | p95   | Notes                                                                             |
| --------------------------------------------------- | ----- | ----- | --------------------------------------------------------------------------------- |
| `POST /api/orders` (1 line)                         | 19 ms | 33 ms | 201                                                                               |
| `PATCH /api/orders/:id/status` (PLACED → PREPARING) | 13 ms | 15 ms | 200                                                                               |
| `PATCH` repeat (same status)                        | 13 ms | 19 ms | 200, writes nothing: no `domain_events` row, no queue row, `updated_at` unchanged |

- `emit_event` alone: ~0.1 ms per call (200 calls in 19.5 ms, rolled back); not a measurable share of the request.
- Growth: 60 `domain_events` rows for 30 orders taken PLACED then PREPARING (1 row per write),
  avg 270 B per row (`order.placed` 256 B, `.preparing` 296 B); a full order (PLACED, PREPARING, READY, COLLECTED)
  is about 1.1 KB. The matching `q_notifications` row averages about 513 B until the worker archives or deletes it.
- Bounds: `purge_domain_events()` (nightly, 30 days) bounds `domain_events`. `q_notifications` is bounded only
  while the worker runs; with the worker stopped it grows by one row per event (80 rows after this run).
- Rate limit: `RATE_LIMIT_WRITE_MAX` = 30 writes per user per 60 s, so a 30-request sample needs a fresh window.
- **2026-11-02** · `feat/p1-08-order-snapshots` + uncommitted changes (P1 PR 08, order snapshots v2: `selectOrders()` reads
  `orders.store_id/store_name` and `order_items.image_url` instead of joining `stores` and `menu_items`; `place_order`
  reads `stores.name` and `menu_items` name/image/category once at insert). Server-only, no client change, so the bundle,
  Web Vitals and polling intervals were not re-measured. Local API on :8108, WSL2, 25 orders placed first, 30 requests
  per read after 2 warm-ups. `GET /api/orders` (customer, 20 orders) p50 9.0 / p95 10.1 ms, 11,732 B; `GET /api/orders`
  (staff, 25 orders) p50 9.3 / p95 11.7 ms, 14,662 B; `?status=PLACED` p50 9.1 / p95 12.7 ms; `GET /api/orders/:id` p50
  8.3 / p95 10.1 ms, 595 B (unchanged from the round-3 595 B: the DTO is identical). `POST /api/orders` (1 line, 25
  requests, all 201) p50 18.5 / p95 26.0 ms (PR 05: 19 / 33 ms, not worse). EXPLAIN ANALYZE of the equivalent list query
  over 25 orders: joined shape (old) 0.347 ms execution / 0.71 ms planning with an extra `stores_pkey` and a
  `menu_items_pkey` index scan per order (20 loops each); snapshot shape (new) 0.264 ms / 0.58 ms, only the
  `order_items_order_id_line_number_key` index scan remains; no Seq Scan on `order_items`. Caveat: the old code was not
  re-run end to end, and the round-3 reads were taken on a different machine with 2 orders, so the HTTP p50s (6-8 ms
  then, 8-9 ms now with 10x the rows) are not a like-for-like comparison; the within-database EXPLAIN pair is the
  evidence that the read got cheaper. Snapshot sample verified through the API (`store.name`, `items[].imageUrl`).
- **2026-11-03** · `feat/p1-14-client-flags-config` @ `bb32a53` + uncommitted changes (P1 PR 14: `GET /api/config` also reads
  `getFlags()` through `cached('feature_flags', PUBLIC_READ_TTL_MS)` in a `Promise.all` with `getSettings()`, keeps the
  client-visible flags and evaluates each with no caller). Server-only, no client change, so the bundle, Web Vitals and
  polling intervals were not re-measured. Local API on :8114, WSL2, Node 24, 30 requests per warm sample after 2
  warm-ups (20 per cold sample), `PUBLIC_READ_TTL_MS` default 10 s. **Warm** (both caches hit): 0 flag rows p50 1.01 /
  p95 1.59 ms, 202 B; 1 hidden row (0 client-visible) 0.94 / 1.43 ms, 202 B; 20 client-visible flags 1.01 / 1.38 ms,
  614 B (about 20 B per flag); baseline `/api/config` 1.3 / 1.5 ms, 202 B (2026-11-02), so no change (< 5 ms).
  **Cold flags** (PATCH `/api/admin/flags/:key` flip, then the next GET; settings still warm): 0 client-visible 3.88 /
  5.46 ms, 20 client-visible 3.93 / 4.75 ms (hidden-flag flip) and 4.95 / 5.58 ms (visible-flag flip), 614 B. **Cold
  both** (`PUBLIC_READ_TTL_MS=0`, every request misses both): 0 rows 4.88 / 7.04 ms, 20 visible 4.74 / 7.35 ms. Cold
  costs about 3.5-4 ms over warm (one PostgREST round trip) and is paid at most once per TTL per API instance or after
  a flip; both-cold is not slower than flags-only cold, so the `Promise.all` fetches in parallel, not in series. The
  flag count does not move the cold time (0 vs 20 rows within 0.2 ms). The cold-flags baseline did not exist (the
  config route had one cached read), so there is no old cold number; the old code was not re-run. **Revalidation:**
  `Cache-Control: no-cache`, `Vary: Authorization, Origin`, ETag identical on back-to-back GETs and after the 10 s
  cache expiry (0 and 20 flags), `If-None-Match` answers 304 with 0 B; after a real flag change the old ETag gets 200
  with the new 615 B body. **Caveat:** flipping a visible flag and flipping it back changes the ETag (the row moves in
  the heap, `getFlags()` selects with no `ORDER BY`, so `features` key order changes; bodies were not diffed), costing
  each client one extra 614 B download; harmless, but `.order('key')` in `getFlags()` would make the ETag depend on
  content only. Run notes: the first visible-flag cold sample was discarded (10 of its 20 PATCHes hit the 30/min write
  limiter, 429) and rerun in a fresh window (20 PATCH 200).
- **2026-11-03 (feat/p1-09-paise-expand, uncommitted)** · server-only run for P1 PR 09 (money in paise, expand: `place_order` prices every line from
  `menu_items.price_paise` in one read and compares each sent `unit_price_paise`, a `BEFORE INSERT OR UPDATE OF price, price_paise` sync trigger on
  `menu_items`, serializers convert paise to rupees on every menu and order read). Client bundle, Web Vitals and polling intervals unchanged (no client
  change, not re-measured). Local API on :8109 (`LOG_LEVEL=warn`, write limiter raised so 100+ POSTs fit), 30 requests per cell after 2 warm-ups, seed
  freshly reset. No HIGH or MEDIUM finding.
  - **Bytes are unchanged, by construction and measured:** the DTO keys and their order are identical (serializer diff only wraps four fields in
    `paiseToRupees`), and in the DB every rupee column equals its paise column over 100 (132 orders, 422 lines, 11 menu rows, 0 mismatches), so the same
    integers are sent. `GET /api/menu` 4,416 B on the untouched seed (the same figure as the 2026-11-02 PR 10 row); all 15 `price` fields whole
    numbers (90-150). `GET /api/orders` customer, 20 orders: 11,832 B (PR 08: 11,732 B for a different cart mix); `GET /api/orders/:id` 600 B (PR 08:
    595 B; the 5 B is order-number digits and cart contents, not the shape). Every order passed `unitPrice x quantity = lineTotal` and `sum(lineTotal) = total`.
  - **`POST /api/orders` (HTTP, all 201):** 1 line p50 14.4 / p95 17.2 ms (second batch 14.0 / 19.3; PR 08 row 18.5 / 26.0, a different session, so
    not like-for-like); 10 distinct lines p50 14.6 / p95 15.9 ms. Needed the 4 stock-tracked items raised to 1,000,000 locally so ten distinct items fit
    (the seed has 11 items, 4 with a stock count).
  - **`place_order` in the database (controlled A/B, 600 one-line and 300 ten-line calls per side, 4 interleaved rounds, rolled back, no HTTP):** PR 09
    1 line p50 0.355 / p95 0.469 ms vs the PR 08 body (plus paise columns derived from rupees so it runs on this schema) 0.329 / 0.471 ms, +0.026 ms
    (+8%); 10 lines 0.882 / 1.069 ms vs 0.816 / 1.047 ms, +0.066 ms (+8%). The extra is the `jsonb_agg` of the priced lines and the second pass over it,
    under half a percent of the 14 ms request; both are well under the 5 ms noise floor of this baseline's regression rule.
  - **Pricing read, `EXPLAIN (ANALYZE, BUFFERS)`:** `menu_items` joined to the sent lines, 11 rows: Hash Join over a Seq Scan, 1 buffer, 0.10 ms
    (1 line) / 0.14 ms (10 lines), planning 0.07-0.13 ms; forced to the index it is `menu_items_pkey`, 16 buffers, 0.065 ms (the planner is right to
    prefer the seq scan on one page). At the 500-item menu cap (506 rows, analysed, rolled back): still a Seq Scan feeding a Hash Join, 11 buffers,
    0.22 ms execution for 10 lines (the planner assumes 1,000 rows from `jsonb_to_recordset`, so it never picks the index; harmless at 500 rows, revisit
    only if the menu cap is raised well past that). No new index needed.
  - **Sync trigger cost on a `menu_items` price UPDATE (committed, pgbench 1 client, 5 s cells, 4 rounds in alternating order):** sync on vs off with
    audit on 1.383/1.387/1.329/1.397 ms vs 1.336/1.371/1.377/1.349 ms (+0.016 ms mean); with audit off 1.243/1.150/1.165/1.220 vs
    1.164/1.137/1.166/1.202 ms (+0.027 ms mean): about +0.02 ms, ~1-2% of a ~1.3 ms statement, inside the round-to-round noise. `EXPLAIN ANALYZE` lists it at
    0.09 ms on a single cold call (the existing `menu_items_audit` trigger 0.13 ms; audit costs about +0.17 ms per price UPDATE in the pgbench cells, not
    new). It does not fire on `place_order`'s stock decrement (`UPDATE OF stock_quantity` has no trigger line, 0.081 ms) nor on any read; only an admin
    price edit pays it.
  - **Reads, 30 requests (PR 08 / PR 13 rows in brackets):** `GET /api/menu` warm p50 0.8 / p95 1.0 ms (1.0 / 3.1), cold after an order invalidated the
    cache 7.7 / 9.2 ms (10 samples; run 1 8.1 / 11.4); `GET /api/store` 0.9 / 1.1 ms; `GET /api/orders` customer 9.6 / 10.2 ms (9.0 / 10.1; run 1
    9.1 / 11.8), `GET /api/orders/:id` 6.5 / 7.1 ms (8.3 / 10.1); `GET /api/auth/me` 5.8 / 6.7 ms. Staff `GET /api/orders` with 132 orders and 422 lines:
    14.7 / 16.8 ms, 137,242 B (run 1 with 6-line carts: 12.6 / 14.4 ms, 110,490 B); PR 08's staff row had 25 orders (9.3 / 11.7 ms, 14,662 B), so it is
    not comparable: about 1 KB and 0.1 ms per order of this size. No read moved by 5 ms or 20%.
  - Run 2's menu was 4,434 B because the stock raise lengthened `stockQuantity`; it is not a code effect. Raw output: `KhaNha-wt/.logs/p1-09-perf.out`.
- **2026-11-03 (feat/p1-09b-reprice-retry)** · client-only run for the `Checkout.tsx` change (after a 409 `PRICE_CHANGED`, Pay
  stays off with "Updating price…" until the one menu reload lands; if that reload fails, the error card gets one more sentence and a Try Again that
  reloads the menu once per tap). No new dependency, route or request type. Bundle built from the tree and from `HEAD~1` the same way (no source
  maps, `check-bundle.mjs`, gzip -9): initial JS 91,163 B vs 91,162 B (`--mode staging`; 91,146 vs 91,149 B in `--mode development`; 89.1 KB, budget
  170 KB), `Checkout` chunk 3,441 B vs 3,334 B (+107 B, +3.2%, lazy, not in the initial set). Requests (real dev server, 360x640, Slow 4G, 4x CPU,
  one run): `GET /api/menu` once per `PRICE_CHANGED`, once per Try Again tap (a double-click still sends one, the button leaves with the first press),
  0 in 12 s idle; every menu GET sent `If-None-Match` and cost 300 B on the wire for a 4,416 B body (304); the dev server's 2 GETs on arrival are
  StrictMode, the production build sends 1. Production build served by route interception (CPU 4x only; no network emulation, no HTTP cache), 5 runs
  each, base vs change, through arrival, one reprice and (change only) two failed reloads: no long task over 50 ms in any phase, INP 24-48 ms (base) vs
  32-48 ms (change), CLS at most 0.0003. `/menu`, `/`, `/cart`, `/orders/:id`, polling and API latency not re-measured (the diff cannot reach them).
  No regression.

## Browser error reporting (P1 PR 12, 2026-11-03)

Scoped comparison at `572a359 + uncommitted changes`, Node v24.21.0, Linux. Reused the final minified
`build:container` output; gzip figures use level 9 and the Vite manifest's static import graph. No dependencies,
images, server queries or polling intervals changed.

| Metric                                          | Budget                | Previous recorded value          | This run                        | Result                                                    |
| ----------------------------------------------- | --------------------- | -------------------------------- | ------------------------------- | --------------------------------------------------------- |
| Initial JavaScript                              | 170 KiB               | 91,163 B (PR 09b, staging build) | 92,134 B (90.0 KiB)             | within budget; +971 B (+1.1%) against that recorded build |
| Reporter module alone, minified and gzipped     | 1 KiB (PR 12 plan)    | absent                           | 1,017 B                         | within budget                                             |
| `supabaseClient` lazy chunk                     | outside initial graph | outside initial graph            | 58,810 B                        | remains lazy                                              |
| Checkout / staff / login / register lazy chunks | outside initial graph | outside initial graph            | 3,425 / 4,199 / 1,362 / 1,294 B | remain lazy                                               |

The earlier bundle was built in staging mode and this output in container mode, so the +1.1% is a comparison with
the recorded size, not a controlled attribution of every byte to PR 12. No measured bundle regression crosses the
20% threshold or its absolute budget.

The reporter scans at most 8,000 characters per field and accepts at most five reports per page load. A direct
Node microbenchmark of five crafted 8,000-character inputs (30 samples per input) measured the slowest case, a
long dotted run, at p50 2.53 ms / p95 2.71 ms; the other cases' p95 was at most 0.17 ms. These are unthrottled
microbenchmarks, not browser INP measurements. Each serialized report is capped at 4,096 UTF-8 bytes including JSON
escaping: five reports plus their envelope stay below 21 KiB, within the browser's 64 KiB keepalive allowance.
Reports batch on a 250 ms debounce or `pagehide`, are never retried or persisted, and cannot load the auth chunk.

The final reporter shares the bounded chunk-failure classifier with `PageBoundary` and excludes chunk failures
from its global error/rejection path. Classification sees at most 8,000 characters, with at most 80 characters
between `chunk` and `load`/`fail`; repeated `chunk ` input measured p50 0.43 ms / p95 0.57 ms (30 samples). The
unbounded intermediate pattern was quadratic (32,000 characters took 116.7 ms); the final implementation and its
long-input regression guard remove that issue. Cap and sampling checks run before message normalization.

`App` uses the existing public persisted config hook and its in-flight-coalesced `fetchConfig`; no new polling
loop or serialized request waterfall is introduced. With no loaded or cached server config, reports remain
buffered rather than using the fallback's 100% setting. Existing settings/flags read caches and invalidation are
unchanged. The change adds no database round trip to the reporting endpoint.

The responsive verification covered page crashes, shell crashes, chunk-load failures and the normal state at
320/360/390/412/768/1024/1280/1440 px, including the 390 px Slow 4G / 4× CPU pass, 200% text and 44 px controls.
The local API accepted render reports with 204 and logged scrubbed route, stack and client version. These are
functional and layout checks. Per-route transfer totals, polling cost and API latency were not remeasured (no
request, poll or query changed).

### Web Vitals A/B (2026-11-03, `0040f5d` against its base `572a359`)

Both commits built with `vite build --mode development` and served with `vite preview` (proxying `/api` to a local
API on seeded local Supabase), measured in one interleaved session: Chromium headless shell 153, macOS arm64, cold
cache, 360×640, DPR 1, Slow 4G (150 ms, 1.6 Mbps / 750 kbps), 4× CPU, three runs per route, median. INP is the worst
interaction (Add, then Escape) on `/menu`. The machine differs from the 2026-09-29 entry (Linux with Arimo), so the
controlled comparison is base against head here, not against that entry.

| Metric                       | Budget  | Base `572a359`           | PR 12 `0040f5d`          | Result       |
| ---------------------------- | ------- | ------------------------ | ------------------------ | ------------ |
| Initial JavaScript (gzip -9) | 170 KiB | 91,123 B                 | 91,985 B                 | +862 B       |
| `/` LCP (runs)               | 3000 ms | 1456 ms (1456/1456/1432) | 1432 ms (1436/1432/1368) | within noise |
| `/menu` LCP (runs)           | 3000 ms | 1536 ms (1536/1536/1532) | 1552 ms (1536/1552/1568) | within noise |
| CLS `/` / `/menu`            | 0.15    | 0 / 0.0001               | 0 / 0.0001               | unchanged    |
| `/menu` INP (runs)           | 300 ms  | 48 ms (64/48/48)         | 48 ms (48/48/48)         | unchanged    |
| Long tasks over 50 ms        | –       | one of 68 ms on `/`      | none                     | –            |

The LCP element on both routes is `cafe-cover-400.jpg` in both builds. The reporter and the app-scope boundary add
no measurable cost to first paint or to the first interaction.

No remaining HIGH or MEDIUM performance finding.
