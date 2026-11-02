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
    | 2026-11-02 | feat/p1-13-feature-flags @ 4333a4b (uncommitted) | Server-only run (P1 PR 13); client bundle unchanged (types only, not rebuilt). `evaluateFlag` 0.1-1.8 us/call (off/plain/roles ~0.1, percent with sha256 ~1.3-1.8; 10 000 calls, no DB), so isEnabled cost is the cached Map lookup plus that. Cached read `select key, enabled, rules from feature_flags`: Seq Scan, 0.09 ms exec (a handful of rows, pkey covers key lookups, no index needed). `PATCH /api/admin/flags/:key` (22 flips, audit + updated_at triggers, 2.2 ms in-DB): p50 9.1 ms / p95 10.1 ms. Existing routes vs baseline: store p50 1.1 ms, menu 1.0 ms (p95 3.1), me 8.4 ms, orders customer 8.2 ms, staff 9.0 ms: none slower. |

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
