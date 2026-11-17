# P6 — Order experience: implementation plan

The PR-by-PR plan for [ROADMAP.md P6](ROADMAP.md#p6--order-experience): a wait time that is honest about the queue,
a pickup that cannot hand food to the wrong person, a notification at the moments that matter, and a staff board
built for a rush. The roadmap says what P6 builds and why; this file says in which order, in which pull requests,
with which files, tests, docs and checks, and where P6 deliberately builds less than the roadmap describes (each
with its reason and what picks it up). When a PR merges, tick its box here and in the roadmap.

> **Status: proposal** (17 November 2026). P6 builds on P5's lifecycle
> ([P5 plan](P5_PAYMENTS.md), PRs 01–21), and on none of P5's gates: it needs no real provider, no payouts and no
> live keys, so it can follow P5's provider-neutral work directly, against the fake gateway. The user decided the
> plan's shape the same day ([Decisions](#decisions)): notifications are in-app and Web Push only, and the counter
> screen is built.

## How the team works P6

The standing rules apply (CLAUDE.md §13–§21) with P5's additions for money functions
([P5 plan](P5_PAYMENTS.md#how-the-team-works-p5)). **Unlike P5, P6 keeps a phase branch** (the user, 17 November
2026): `feat/P6`, cut from `dev` once P5's PRs 01–21 are in it and covered by the `ci-ok required` ruleset's
`feat/P[0-9]` pattern, with work branches `feat/p6-<NN>-<slug>` and PR titles `P6 PR <NN> — <title>`. The agent
merges each work PR into `feat/P6` once `ci-ok` is green and CodeRabbit is clear, **except the money PRs**, which
wait for the user: in P6 those are PR 02 (the promise that anchors the SLA refund), PR 04 (it re-creates
`confirm_payment`) and PR 05 (collecting settles the store's share). The phase reaches `dev`, and so staging, as
one PR the user merges. Additions:

- **Real devices before the phase merges.** Staging runs `dev`, so P6 is not on it until the end. Push and the
  camera need a secure context: until then they are tried on an Android phone against a local stack through
  `adb reverse` (Chrome treats the phone's `localhost` as secure), and the milestone check on staging follows the
  merge.

- **Budgets are a gate on every client PR.** The QR encoder, the scanner, the order detail sheet and the counter
  screen are lazy; the service worker caches nothing (CLAUDE.md §2c); `perf-auditor` runs on PRs 06, 10, 12 and 14.
- **Every new polling path pauses when the tab is hidden and has a retry path** (CLAUDE.md §2b); P6 adds one, the
  counter screen.
- **Anything that shows a person's phone number or a pickup code ships its refusal cases**: another store's staff,
  another customer, a signed-out caller.

## Where P6 starts

What the code has when P5's PRs 01–21 are in (P5 as planned), and what P6 adds.

| Roadmap step       | Already in the code                                                                                                                                                                                                                                                                                                                                                            | Left for P6                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| P6.1 ETA           | `stores.prep_time_min_minutes` and `prep_time_max_minutes` (defaults 10 and 15, no bounds, no route edits them); the store card shows "Ready in ~10–15 min" from them. `confirm_payment` takes `p_promised_minutes` and gets null, so the promise is `now() + prep_time_max_minutes` whatever the queue. `ready_at` is recorded (P5 PR 18). No item carries a preparation time | the engine, its settings, the quote                           |
| P6.2 tokens        | the global `order_number` (from 1001) is what the counter reads out; `stores.timezone` exists; `collect_order` takes any member's word                                                                                                                                                                                                                                         | the per-day token, the code, the check at the counter         |
| P6.2 scanning      | `Permissions-Policy: camera=(self)` is already set at nginx; nothing uses the camera, `BarcodeDetector` or a QR library                                                                                                                                                                                                                                                        | the QR, the scan, the typed fallback                          |
| P6.3 notifications | `q_notifications` receives `order.*`; its handler only logs "Order event". No `notifications` table, no push, no service worker. `manifest.webmanifest` exists and is linked. The order page vibrates when a poll finds the order ready. ADR-010 chose polling plus Web Push                                                                                                   | all of it                                                     |
| P6.4 staff board   | one grid narrowed by toggle filters (All, To accept, New, Preparing, Ready, Done), cards with one primary action, an inline cancel and (P5) accept and reject; no detail sheet; no sound; **the card shows the customer's phone, and the list payload carries it for every order**; one generic `PATCH …/status` beside P5's accept, reject and cancel routes                  | lanes, search, the detail sheet, commands, privacy            |
| P6.4 polling       | the board polls the full list every `staffBoardMs` (4 s) with ETag 304s and pauses when hidden; cards mount near the viewport (`LazyGroup`) and re-render only when changed                                                                                                                                                                                                    | nothing new ([below](#where-p6-builds-less-than-the-roadmap)) |
| P6.5 order page    | `Order.tsx` with the hero, the tracker, items with options, and P5's states (confirming, awaiting, rejected, cancel, late, not collected); it shows `#orderNumber` and the promise as one time                                                                                                                                                                                 | the pickup card, the range, the receipt                       |
| Sheets             | six sheets, each with its own portal, backdrop and Escape handling; `useFocusTrap`, `useBackToClose` and `useLeaveWarning` are shared                                                                                                                                                                                                                                          | one more sheet, and the shell they share                      |
| Profile            | name, email, phone, three links and Log out; no preference of any kind                                                                                                                                                                                                                                                                                                         | the notifications row                                         |
| Budgets            | initial JS about 97 KiB gzip of 170; client runtime dependencies: `@supabase/supabase-js`, `lucide-react`, `react`, `react-dom`, `react-router-dom`, `zustand`                                                                                                                                                                                                                 | one small lazy dependency (the QR encoder)                    |

## Build order

"Merge" says who merges the PR into `feat/P6`.

| #   | PR                                                       | Step | Depends on | Built by    | Merge | Size (files / lines) |
| --- | -------------------------------------------------------- | ---- | ---------- | ----------- | ----- | -------------------- |
| 01  | ETA: the engine and its settings                         | P6.1 | –          | implementer | agent | 14 / 560             |
| 02  | ETA in the API: the store's wait, the quote, the promise | P6.1 | 01         | main        | user  | 14 / 600             |
| 03  | Client: the wait, shown and set                          | P6.1 | 02         | implementer | agent | 18 / 620             |
| 04  | Pickup tokens                                            | P6.2 | –          | main        | user  | 10 / 520             |
| 05  | The pickup code: verify and collect                      | P6.2 | 04         | main        | user  | 16 / 680             |
| 06  | Client: the pickup card, and the check at the counter    | P6.2 | 05         | implementer | agent | 18 / 720             |
| 07  | The counter screen                                       | P6.2 | 04         | implementer | agent | 12 / 420             |
| 08  | Notifications: the rows, the audiences, the templates    | P6.3 | –          | main        | agent | 16 / 700             |
| 09  | Web Push: subscriptions and sending                      | P6.3 | 08         | main        | agent | 14 / 560             |
| 10  | Client: the service worker, the ask, the inbox           | P6.3 | 09         | implementer | agent | 18 / 680             |
| 11  | Staff commands, the order detail, the phone              | P6.4 | –          | main        | agent | 16 / 660             |
| 12  | Client: the board in lanes                               | P6.4 | 11         | implementer | agent | 16 / 700             |
| 13  | Client: the order detail sheet, Call, sound              | P6.4 | 11, 12     | implementer | agent | 16 / 680             |
| 14  | Client: the customer's order page v2                     | P6.5 | 03, 06     | implementer | agent | 14 / 520             |
| 15  | Contract: the status patch and the phone in lists retire | P6.4 | 13         | main        | agent | 14 / 320             |

Why this order: four tracks that do not touch each other (the wait 01–03, pickup 04–07, notifications 08–10, the
staff board 11–13), so any can go first and client PRs can run in worktrees beside a server PR. The wait comes
first here because it is the smallest and changes what every later screen prints. Pickup comes before
notifications because "your order is ready" should name the token. The customer's page (14) collects what the
tracks produced, and the contract (15) removes what the new board no longer reads.

## Cross-cutting decisions

- **The estimate is one pure function, in TypeScript.** `domain/eta.ts` has no I/O; the API gathers its inputs.
  It is not mirrored in SQL: `confirm_payment` receives the minutes and only bounds them (1 to 600, else the
  store's fallback). The promise is money-adjacent (it starts the SLA clock), so the one caller is
  `confirmPaidOrder()`, which every confirm path already goes through.
- **A promise is made once.** `promised_ready_at` is set at payment and never moves; the SLA and the customer's
  screen both use it. Live re-estimates are not built ([below](#where-p6-builds-less-than-the-roadmap)).
- **The token is public, the code is secret.** The token (`A-017`) is called out and shown on a screen. The
  6-digit code proves the order is yours: it is derived (`HMAC-SHA256(PICKUP_CODE_SECRET, order id)`), never
  stored, sent only to the order's owner, and never to staff, who can only check one.
- **Collecting stays one SQL function.** `collect_order` (P5) gains how the pickup was verified; the code is
  checked in the API before it is called, because the secret lives in the environment, not the database.
- **Notifications are idempotent by a unique key**, `(event_id, user_id)`: an event delivered twice by the queue
  makes one row and one push. A notification older than ten minutes, or overtaken by the order's state, is not
  sent.
- **The service worker does two things**: show a push and open the right page when it is tapped. It has no
  `fetch` handler and caches nothing, so CLAUDE.md §2c holds unchanged.
- **Permission is asked at a moment of intent**, by our own card first: after a customer's first paid order, and
  on the staff board. The browser's prompt appears only after a tap on that card.
- **A customer's phone is shown only on request.** No list carries it; the detail carries it only after a staff
  member taps Call, and each such reveal is audited.
- **Caching** (CLAUDE.md §2c). Two new public reads are cached, each with its invalidation and the test that fails
  without it: a store's typical wait (`store_eta:<id>`, 30 s) and the counter screen's tokens
  (`store_display:<id>`, 5 s). Both are cleared by the API's own transitions and otherwise expire; a transition
  made by the worker or the reconciler is seen after the TTL. Notifications, pickup codes and anything about one
  user are never cached, on either side.
- **Backward compatibility.** Fields are added through PR 14; PR 15 removes two things an old client reads and
  ships with a `min_client_version` bump.

## The model P6 builds

```sql
alter table public.menu_items
  add column prep_offset_minutes integer not null default 0 check (prep_offset_minutes between 0 and 60);

create table public.store_token_counters (
  store_id uuid not null references public.stores (id) on delete cascade,
  business_date date not null,
  last_value integer not null default 0,
  primary key (store_id, business_date)
);
alter table public.orders
  add column business_date date,
  add column pickup_token text,
  add column pickup_verified_at timestamptz,
  add column pickup_method text check (pickup_method in ('QR', 'CODE', 'MANUAL')),
  add column pickup_failed_attempts smallint not null default 0;
create unique index orders_store_day_token_idx on public.orders (store_id, business_date, pickup_token)
  where pickup_token is not null;
```

`notifications` and `push_subscriptions` are the roadmap's, given with PRs 08 and 09.

**The estimate** (PR 01), for a cart at a store:

| Term  | Formula                                                                                 | From                                                       |
| ----- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Base  | `eta_base_minutes`                                                                      | store setting, seeded from `prep_time_max_minutes`         |
| Items | the largest `prep_offset_minutes` of the lines + `eta_extra_item_minutes` × (units − 1) | the menu item; store setting                               |
| Queue | `ceil(orders ahead / eta_parallel_orders)` × `eta_queue_minutes`                        | a count of `PLACED` and `PREPARING` orders; store settings |
| Low   | `clamp(Base + Items + Queue, Base, eta_max_minutes)`                                    | –                                                          |
| High  | `min(Low + eta_buffer_minutes, eta_max_minutes)`: **the promise**                       | store setting                                              |

**Settings P6 adds**, each with its check constraint, its TypeScript bound, the parity test and its row in
`docs/CONFIGURATION.md`:

| Setting                                                  | Tier                                     | Default                 | Bounds              | PR  |
| -------------------------------------------------------- | ---------------------------------------- | ----------------------- | ------------------- | --- |
| `eta_base_minutes`                                       | store                                    | `prep_time_max_minutes` | 1–120               | 01  |
| `eta_extra_item_minutes`                                 | store                                    | 1                       | 0–10                | 01  |
| `eta_parallel_orders`                                    | store                                    | 2                       | 1–20                | 01  |
| `eta_queue_minutes`                                      | store                                    | 3                       | 0–20                | 01  |
| `eta_buffer_minutes`                                     | store                                    | 3                       | 0–30                | 01  |
| `eta_max_minutes`                                        | store                                    | 90                      | 10–240              | 01  |
| `token_prefix`                                           | store                                    | `A`                     | 1–3 capital letters | 04  |
| the business day's start                                 | platform constant                        | 04:00, store-local      | –                   | 04  |
| `PICKUP_CODE_SECRET`                                     | deployment (secret)                      | –                       | at least 32 bytes   | 05  |
| `RATE_LIMIT_PICKUP_VERIFY_MAX`                           | deployment                               | 30 per window           | –                   | 05  |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | deployment (the private key is a secret) | –                       | all three or none   | 09  |

**Flags** (migration rows, off): `pickup_qr` (per store: the code is required at collection), `notifications_push`.

**Capability P6 adds** to `domain/permissions.ts`:

| Capability                 | STAFF | MANAGER | OWNER | Platform ADMIN |
| -------------------------- | ----- | ------- | ----- | -------------- |
| `orders.viewCustomerPhone` | ✓     | ✓       | ✓     | ✗              |

## Where P6 builds less than the roadmap

Approved with the plan. Each row is written into the roadmap's P6 section by the PR that builds it.

| Roadmap says                                                                              | P6 does                                                                                                                                                          | Picked up by                                                 |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| P6.1 a rush factor from demand against the normal for this hour of the week               | not built: the "normal" is `analytics_store_hourly`, which does not exist yet                                                                                    | P7.1                                                         |
| P6.1 a history correction from `eta_stats`                                                | not built, for the same reason; `promised_ready_at` and `ready_at` are recorded, so the data is there when it is                                                 | P7.1                                                         |
| P6.1 manual rush windows                                                                  | not built; staff already have Pause, and a manager can raise the base                                                                                            | with the rush factor                                         |
| P6.1 `estimated_ready_at` recomputed live by a debounced `eta.refresh_store` job          | not built: the promise is shown and does not move. A job that rewrites every active order on each change costs writes and polls for a number nobody was promised | when P7.4's accuracy figures show the promise drifting       |
| P6.1 `eta_breakdown jsonb` on the order                                                   | not stored                                                                                                                                                       | P7.1, if tuning needs the terms                              |
| P6.1 the range from the p90–p50 spread                                                    | the range is the estimate and the estimate plus the buffer                                                                                                       | P7.1                                                         |
| P6.2 `business_day_start` as a setting                                                    | a platform constant, 04:00 store-local (roadmap decision 15's default)                                                                                           | a store that trades through 4 am                             |
| P6.2 a QR decoder loaded lazily where `BarcodeDetector` is missing                        | no decoder library: where the browser cannot scan, staff type the 6 digits                                                                                       | a pilot store whose device cannot scan                       |
| P6.2 "raises screen brightness where it can"                                              | the web cannot set brightness; the pickup card is black on white and holds a screen wake lock while open                                                         | –                                                            |
| P6.3 SMS, email, WhatsApp                                                                 | in-app and Web Push only (the user); no SMS provider, no SES, no DLT                                                                                             | after the pilot, through the same port                       |
| P6.3 `notification_preferences` per channel and event group                               | one switch per device: push on or off (a subscription exists or it does not)                                                                                     | the second channel                                           |
| P6.3 `notification_deliveries` with status and retries per channel                        | not built: the queue retries and dead-letters, and each send is one log line (P8.7 counts them)                                                                  | the second channel                                           |
| P6.3 a push 30 minutes after collection asking for a rating; the surplus prompt for staff | neither: ratings are P7.5, and surplus is deferred                                                                                                               | P7.5; after the pilot                                        |
| P6.4 `GET …/orders?since=<cursor>` and `pollAfterMs`                                      | not built: the board already costs a 304 when nothing changed, renders only changed cards, and its interval is a site setting                                    | when `perf-auditor` measures a busy board's poll over budget |
| P6.4 "mark a line unavailable" in the detail sheet                                        | not built: partial line refunds are deferred (P5 D9)                                                                                                             | after the pilot                                              |
| P6.4 search                                                                               | a filter over the orders the board already holds; no search route                                                                                                | –                                                            |
| P6.4 masked calling through a telephony provider                                          | a `tel:` link after an audited reveal                                                                                                                            | the roadmap's "possible later improvement"                   |
| P6.5 deal savings on the receipt; the rating prompt                                       | neither: no deals, no ratings yet                                                                                                                                | with deals; P7.5                                             |
| P5.3 `POST /api/checkout/quote` (deferred from P5)                                        | built here, in PR 02                                                                                                                                             | –                                                            |

## The pull requests

### PR 01 — ETA: the engine and its settings (P6.1)

- [ ] Merged

`/before-write`: schema-guard, expected EXTEND (`stores`, `menu_items`); reuse-scout, expected EXTEND
(`STORE_SETTING_BOUNDS`, the item write's schema, the template copy functions).

Migration `<ts>_eta_settings.sql`: the six store columns of [the table](#the-model-p6-builds) with their checks,
`eta_base_minutes` filled from `prep_time_max_minutes`; `menu_items.prep_offset_minutes`; the template copy and
push functions carry both.

Server:

- `domain/eta.ts`: `estimate({ base, extraItem, parallel, perQueued, buffer, max, lines: [{ quantity, prepOffset
}], ordersAhead }) → { low, high }`, pure, as [above](#the-model-p6-builds);
- the six settings join the store settings route and `StoreSettingsDto`; `prepOffsetMinutes` joins the item
  create and edit routes and `ManagedMenuItemDto` (it is not in the public menu payload).

Tests: properties (`fast-check`): never below the base; never above the maximum; non-decreasing in the orders
ahead, in the units and in an item's offset; `high − low` is the buffer unless the maximum cuts it. The settings
route's bounds; `limits-parity`.

Docs: `docs/CONFIGURATION.md`, `docs/SCHEMA.md`, `docs/API.md`. Intent: `--server minor`.

### PR 02 — ETA in the API: the store's wait, the quote, the promise (P6.1)

- [ ] Merged (the user merges)

Skills: `/new-endpoint`. The main agent builds it: it sets the promise the SLA refund hangs on.

Server:

- `eta.service.ts`: `estimateFor(storeId, lines)` gathers the store's settings, the lines' offsets and the count
  of `PLACED` and `PREPARING` orders (one indexed count; schema-guard confirms the index);
- `GET /api/stores/:storeRef` and the menu payload's store gain `etaMinutes: { low, high }` for one unit of a
  typical item, cached for 30 s under `store_eta:<id>` and cleared by the API's order transitions.
  `prepTimeMinMinutes` and `prepTimeMaxMinutes` stay and carry the same two numbers, so an older client shows the
  honest range too;
- `POST /api/checkout/quote` (`requireAuth`, no side effects): the checks and prices `POST /api/checkout` would
  apply, without taking stock, plus `etaMinutes` for this cart and the store's policy version and summary. The
  checkout page is drawn from it;
- `confirmPaidOrder()` passes the cart's `high` to `confirm_payment` as `p_promised_minutes`, so the promise and
  the SLA deadline now follow the queue.

Tests: the wait rises when orders are placed and falls when they are collected (after the cache is cleared, and
the test fails without the clearing); a quote takes no stock and writes nothing; a quote for a closed store, a
changed price and an unavailable item answers what checkout would; the promise stored equals the quote's `high`
for the same queue; another store's orders do not count.

Docs: `docs/API.md`, `docs/PAYMENTS.md` (where the promise comes from), `.claude/rules/backend.md` §2c (the key).
Intent: `--server minor`.

### PR 03 — Client: the wait, shown and set (P6.1)

- [ ] Merged

An implementer builds it. `StoreCard`, the menu header and the checkout page read `etaMinutes` ("Ready in about
12–15 min"; `formatPrepRange` is reused); the checkout page calls the quote when it opens and when the cart
changes, shows a skeleton line meanwhile and a retry on failure, and keeps Pay disabled until a quote is in.
`/manage` → Settings gains a "Wait time" group for the six settings, in plain words ("One order takes about",
"Each extra item adds", "Orders you make at once", "Each order ahead adds", "Safety margin", "Never promise more
than"), with a live example ("With 4 orders ahead, a 2-item order shows 21–24 min"). `ItemEditor` gains "Takes
longer by … min".

Every wait a customer sees comes from the server. Only the settings screen's example is computed in the browser,
by `features/manage/etaRules.ts`, a mirror of `domain/eta.ts` held to it by one shared table of cases
(`server/test/setup/etaCases.ts`, read by both packages' tests), as P3 holds the two pricing rules together.

Tests: the shared cases through `etaRules.ts`; the editor's bounds; `e2e/forms.spec.ts` gains the quote failing
and recovering. The visual gate; `docs/COMPONENTS.md`. Intent: `--client minor`.

### PR 04 — Pickup tokens (P6.2)

- [ ] Merged (the user merges)

`/before-write`: schema-guard, expected NEW TABLE (`store_token_counters`), EXTEND (`orders`, `stores`).

Migration `<ts>_pickup_tokens.sql`: the counter table, `orders.business_date` and `pickup_token` with the unique
index, `stores.token_prefix`; `business_date(p_at, p_timezone)` (the store-local date, rolling over at 04:00);
`next_pickup_token(p_store_id, p_at) returns text` (`insert … on conflict … do update set last_value = last_value

- 1 returning`, formatted as the prefix, a dash and at least three digits); and **`confirm_payment`re-created**
from P5's merged body with one addition: an order that reaches`PLACED`or`AWAITING_ACCEPTANCE`gets its business
date and token in the same transaction. A late payment that ends`REJECTED` gets none, so tokens have no gaps from
  orders nobody will collect.

Server: `OrderDto.pickup: { token } | null`, for the owner and for staff; the staff card and the customer's hero
print the token where they printed `#orderNumber`, which stays as the support reference.

Tests: 50 confirmations for one store and day under `Promise.all` give 50 distinct, gapless tokens; two stores
count separately; an order paid at 03:59 and one at 04:01 store-local fall on different business dates; every
branch of P5's `confirm_payment` tests still passes.

Docs: `docs/SCHEMA.md`, `docs/API.md`, `docs/PAYMENTS.md`, `docs/CONFIGURATION.md`. Intent: `--server minor`.

### PR 05 — The pickup code: verify and collect (P6.2)

- [ ] Merged (the user merges)

Skills: `/new-endpoint`, `agent-skills:security-and-hardening`; a `claude-security` scan of the diff.

Migration `<ts>_pickup_verification.sql`: `orders.pickup_verified_at`, `pickup_method`, `pickup_failed_attempts`;
`collect_order` re-created with `p_method`; `note_pickup_failure(p_order_id)`; the `pickup_qr` flag row.

Server:

- `utils/pickupCode.ts`: `pickupCode(orderId)`, 6 decimal digits from the HMAC; `PICKUP_CODE_SECRET` in
  `utils/env.ts`, refused in production when missing or short;
- the **owner's** order DTO gains `pickup.code` and `pickup.qrPayload` (`fp1:<orderId>:<code>`) while the order is
  `READY` or `EXPIRED`. A staff DTO never carries either;
- `POST /api/stores/:storeId/orders/verify-pickup` (`requireStore('orders.transition')`, a new
  `pickupVerifyLimiter` per user): a typed code or a scanned payload. A typed code is compared, in constant time,
  with the codes of this store's `READY` and `EXPIRED` orders of the current business date, a small bounded set.
  A match answers the order's token, name and items; anything else is 400 `PICKUP_CODE_INVALID`, the same answer
  whether the code is wrong, the order is another store's or it was already collected;
- `POST /api/stores/:storeId/orders/:orderId/collect` with `{ method, code? }`: with `pickup_qr` on for the store,
  `QR` and `CODE` need the right code for that order; a wrong one counts against the order, and after five the
  order answers 423 `PICKUP_LOCKED` to everything but `MANUAL`. `MANUAL` ("verified by name and phone") always
  works and is audited with the member's name. With the flag off, collection works as before and records `MANUAL`.

Tests: the code never appears in a staff payload or a log line; a wrong code, another store's code and a collected
order's code all answer alike; the lockout and the manual way out; the rate limit; `testStoreIsolation`; a
collect repeated is 200 with no second settlement.

Docs: `docs/API.md`, `docs/PERMISSIONS.md`, `docs/CONFIGURATION.md`, `docs/DEPLOYMENT.md` (the secret),
`docs/LOGGING.md` (the code is added to the redaction list). Intent: `--server minor`.

### PR 06 — Client: the pickup card, and the check at the counter (P6.2)

- [ ] Merged

An implementer builds it. `/before-write`: reuse-scout on a QR encoder; expected NO MATCH, so one small dependency,
priced first: under 10 KB gzip, lazy with the pickup card, never in the initial bundle (the bundle check fails the
PR otherwise).

- **Customer:** `PickupCard` on the order page at `READY` (and `EXPIRED`): the token in very large type, the QR,
  the six digits spaced in pairs, black on white, with a screen wake lock while it is open. Before `READY` the
  page shows the token alone.
- **Staff:** "Hand over" on a ready card opens `VerifyPickup`: the camera with `BarcodeDetector` where the browser
  has it, and always a 6-digit field (`inputmode="numeric"`, large keys) beside it. A match shows the token, the
  name and the items with one **Hand over** button; no match says so and lets them try again; "Can't check the
  code" leads to the manual confirmation. Without the flag the card's button collects as today.

Tests: the card's states; the scanner falls back to typing when `BarcodeDetector` is absent or the camera is
refused; `e2e/pickup.spec.ts` (mocked): ready → code typed → handed over, and a wrong code. Visual gate at 390px
and on a tablet width; `perf-auditor` on the order page (the QR must not move its LCP).

Docs: `docs/COMPONENTS.md` (`PickupCard`, `VerifyPickup`), `docs/FRONTEND_STRUCTURE.md`. Intent: `--client minor`.

### PR 07 — The counter screen (P6.2)

- [ ] Merged

An implementer builds it. Skill: `/new-endpoint`.

Server: `GET /api/stores/:storeRef/display` (public, under the flood limiter): `{ storeName, ready: [token] }`,
the store's `READY` tokens only, no names and no order ids, cached for 5 s under `store_display:<id>` and cleared
by the API's ready and collect transitions. A store that is not `ACTIVE` is 404.

Client: `/display/:storeSlug`, a lazy public route with no navigation shell: "Now serving" and the tokens in a
grid sized for a TV, polling every 5 s through `useResource` (ETag, paused when hidden, the last tokens kept with
a small "reconnecting" mark when a poll fails). A token leaves when it is collected.

Tests: the payload carries nothing but tokens; the cache test (a ready order appears, a collected one leaves, and
the test fails without the clearing); the page at 1280px and 1920px.

Docs: `docs/API.md`, `docs/FRONTEND_STRUCTURE.md`, `.claude/rules/backend.md` §2c. Intent:
`--server minor --client minor`.

### PR 08 — Notifications: the rows, the audiences, the templates (P6.3)

- [ ] Merged

`/before-write`: schema-guard, expected NEW TABLE (`notifications`); reuse-scout, expected EXTEND (`jobs/notify.ts`,
the queue wrappers). The main agent builds it: it decides who is told what about whose order.

Migration `<ts>_notifications.sql`: the roadmap's `notifications` table (`unique (event_id, user_id)`), an index
on `(user_id, created_at desc)`, a 30-day purge; `q_notifications` also subscribes to `refund.processed`; a
wrapper `queue_send_delayed(p_queue, p_message, p_delay_seconds)`.

Server:

- `notifications/templates.ts`: one typed template per event and audience (a title, a body, where a tap leads),
  ready for another language;
- `jobs/notify.ts`, replacing the log-only handler: event → audience and template → quiet rules (older than ten
  minutes, or the order has moved on: no "ready" for a collected order) → the row. On `order.ready` it also queues
  a delayed `pickup.reminder` for ten minutes before the pickup deadline, which fires only if the order is still
  `READY`;

  | Event                       | Customer                                  | Store members                    |
  | --------------------------- | ----------------------------------------- | -------------------------------- |
  | `order.awaiting_acceptance` | "Waiting for the café to confirm"         | "Accept order A-017 (5:00 left)" |
  | `order.placed`              | "Order confirmed"                         | –                                |
  | `order.rejected`            | "Couldn't be made; refund on its way"     | –                                |
  | `order.cancelled`           | when the store cancelled it               | –                                |
  | `order.sla_breached`        | "Running late. Cancel for a full refund?" | –                                |
  | `order.ready`               | "A-017 is ready at the counter"           | –                                |
  | `pickup.reminder`           | "Collect A-017 in the next 10 minutes"    | –                                |
  | `order.expired`             | "Not collected; the café has been paid"   | –                                |
  | `refund.processed`          | "₹200 refunded"                           | –                                |

- `GET /api/me/notifications?cursor` and `POST /api/me/notifications/read`, the caller's own rows only, never
  cached.

Tests: an event handled twice makes one row; a stale event makes none; "ready" after collection makes none; the
reminder is skipped once collected; another user's rows are never returned; a store member of another store gets
nothing.

Docs: `docs/JOBS.md`, `docs/API.md`, `docs/SCHEMA.md`, `docs/ARCHITECTURE.md` (the notification flow).
Intent: `--server minor`.

### PR 09 — Web Push: subscriptions and sending (P6.3)

- [ ] Merged

`/before-write`: reuse-scout, expected EXTEND (the `integrations/` port layout). One new server dependency,
`web-push` (VAPID signing and payload encryption are not a few lines), checked on the arm64 Alpine image by the
`images` job.

Migration `<ts>_push_subscriptions.sql`: the roadmap's table (`endpoint` unique, `revoked_at`); the
`notifications_push` flag row.

Server:

- `integrations/push/`: `port.ts` (`PushSender.send(subscription, payload)` → sent, gone or retryable),
  `webpush.ts`, `fake.ts` (records what it was asked to send, for tests), `index.ts`;
- `utils/env.ts`: the three VAPID variables, all or none; with none, push is off and the rest of P6 works;
- `POST /api/me/push-subscriptions` (upsert by endpoint, re-binding an endpoint to the caller) and
  `DELETE /api/me/push-subscriptions/:id`; `ConfigDto.push: { publicKey } | null`;
- the notify handler, after writing a row for an event marked as pushed in its template: send to each of the
  user's live subscriptions. A 404 or 410 revokes that subscription; a retryable failure throws `RetryableError`;
  the payload is the title, the body and a path, never a phone number or a pickup code.

Tests: one push per subscription per event however often the event arrives; a gone endpoint is revoked and not
tried again; a subscription posted by one user and then by another belongs to the second; no push when the flag
is off or the keys are missing; the payload's fields.

Docs: `docs/API.md`, `docs/CONFIGURATION.md`, `docs/DEPLOYMENT.md` (generating the keys), `docs/JOBS.md`,
`docs/LOGGING.md`. Intent: `--server minor`.

### PR 10 — Client: the service worker, the ask, the inbox (P6.3)

- [ ] Merged

An implementer builds it.

- `client/public/sw.js`, hand-written: `push` shows the notification, `notificationclick` focuses an open tab on
  the path or opens one. No `fetch` handler, no cache. nginx serves it uncached, and the CSP gains
  `worker-src 'self'`.
- `features/notifications/`: `usePush` (supported, permission, subscribe, unsubscribe; the worker is registered
  only when a user opts in), the ask card ("Get a ping when it's ready?") on the order page after a first paid
  order, and its staff twin in the board's header ("Alert me to orders that need accepting"). A refusal is
  remembered per device and not asked again; on iOS outside the home screen the card says how to add the app.
- Profile gains **Notifications**: the switch for this device, and the inbox (`/notifications`, the user's rows,
  newest first, read on open, `EmptyState` when there are none).

Tests: the hook's states with a mocked `PushManager`; `e2e/notifications.spec.ts` with the permission granted: the
subscription is posted once; a test that fails if `sw.js` gains a `fetch` listener or a cache call. The visual
gate; `perf-auditor` (nothing of this in the initial bundle beyond the ask card's trigger).

Docs: `docs/FRONTEND_STRUCTURE.md`, `docs/COMPONENTS.md`, `.claude/rules/frontend.md` §2c (the worker caches
nothing) and §9 (no new host). Intent: `--client minor`.

### PR 11 — Staff commands, the order detail, the phone (P6.4)

- [ ] Merged

Skills: `/new-endpoint`, `agent-skills:api-and-interface-design`. The main agent builds it: it changes who may
read a customer's phone.

Server:

- `POST /api/stores/:storeId/orders/:orderId/start` and `/ready`, beside P5's accept, reject, cancel and P6's
  collect: each calls one SQL function, and a repeat is 200 with no event. `PATCH …/status` keeps working by
  mapping onto them until PR 15;
- `GET /api/stores/:storeId/orders/:orderId` gains `timeline`: the order's `domain_events` as `{ type, at, by }`
  (paid, accepted, preparing, ready, collected; a member's first name, or "customer" or "system");
- the capability `orders.viewCustomerPhone`; `POST …/orders/:orderId/reveal-phone` (`writeLimiter`) answers the
  number and writes an audit row naming the member; store order payloads gain `hasPhone` and, from PR 15, stop
  carrying `customerPhone`.

Tests: each command's matrix with `testStoreIsolation`; the timeline's order and names; a reveal leaves exactly
one audit row and another store's member gets 404; the lifecycle walk through the commands with its
`domain_events` rows.

Docs: `docs/API.md`, `docs/PERMISSIONS.md`, `docs/ARCHITECTURE.md`. Intent: `--server minor`.

### PR 12 — Client: the board in lanes (P6.4)

- [ ] Merged

An implementer builds it. Skills: `frontend-design:frontend-design` for the direction (inside the `@theme`
tokens), then `agent-skills:frontend-ui-engineering`.

`StaffBoard` gains `layout="lanes"`: from tablet width up, four columns side by side (**To accept** with its
countdown, **New**, **Preparing**, **Ready**) and **Done** behind a toggle; on a phone the lanes are the existing
filter buttons over one list, so nothing is lost at 360px. A search field filters by token or name over the
orders the board holds. The ticket (`StaffOrderCard`) shows the token, the name, the items with their options,
the note, the time since payment and a "Late" badge, and no phone number. The header gains the store switcher for
a member of several stores. Actions are disabled with a reason while the board is offline.

Tests: `staffBoardRules.test.ts` (lane assignment, search, order within a lane); the layout at 360px, 768px and
1280px in `e2e/layout.spec.ts`; the visual gate at 390px throttled, a tablet and 1280px; `perf-auditor` on
`/staff` (the board's re-render cost with 100 orders does not rise).

Docs: `docs/COMPONENTS.md`, `docs/FRONTEND_STRUCTURE.md`. Intent: `--client minor`.

### PR 13 — Client: the order detail sheet, Call, sound (P6.4)

- [ ] Merged

An implementer builds it. `/before-write`: reuse-scout on the sheet; expected EXTEND: the portal, backdrop, Escape
and scroll lock that `ConfirmSheet` already has move into `components/Sheet.tsx`, used by `ConfirmSheet` and the
new sheet. The other five sheets move to it when next touched, not here.

`OrderDetailSheet`, opened by tapping a ticket and loaded lazily: the items, options and note; the timeline; the
customer's name with **Call**, which reveals the number (one request, audited) and becomes a `tel:` link; the
refund's state; and every action the order's state allows (accept, reject with a reason, start, ready, hand over,
cancel with a reason). The header gains a **sound** switch: a short tone and a vibration when an order arrives in
"To accept" or "New", made with the Web Audio API (no audio file), enabled by the tap that turns it on.

Tests: the sheet's focus trap and Android Back; Call makes one reveal request however often it is tapped; the
tone plays once per new order and never before the switch is on; `e2e/staff.spec.ts` (mocked): a ticket opened,
called and handed over.

Docs: `docs/COMPONENTS.md` (`Sheet`, `OrderDetailSheet`). Intent: `--client minor`.

### PR 14 — Client: the customer's order page v2 (P6.5)

- [ ] Merged

An implementer builds it. The page P5 left gains what the tracks produced: the token in the hero from payment on;
"Ready around 1:30–1:35 pm" from the promise and its buffer, and after a breach the late banner P5 built; the
pickup card at `READY`; a timeline of the order's own moments; and a receipt (lines with options, the total, any
cancellation fee, each refund with its state and reference). Copy and colours come from `orderStatus.ts`; polling
stops at the terminal states as today.

Tests: each state's page in `orderStatus.test.ts` and a component test; the order-page LCP case in
`e2e/layout.spec.ts` still passes on the throttled 360px profile; the visual gate.

Docs: `docs/COMPONENTS.md`, `docs/FRONTEND_STRUCTURE.md`. Intent: `--client minor`.

### PR 15 — Contract: the status patch and the phone in lists retire (P6.4)

- [ ] Merged

`PATCH /api/stores/:storeId/orders/:orderId/status` and the client's `updateOrderStatus` are removed; store order
payloads stop carrying `customerPhone`. Both are things a deployed client reads, so `docs/API.md` records them
with the client version that no longer needs them, and the phase's merge raises `min_client_version`.

Tests: a guard that the list payload has no phone; a guard that no source file names the old route.
Intent: `--server minor --client patch`.

## CLAUDE.md edits, aggregated

- §2: "the board is `/staff`" gains the lanes and the counter screen; pickup is by token and code.
- §2c: the service worker caches nothing.
- §12: the pickup code and VAPID private key among the secrets that never reach the client or a log.
- `.claude/rules/frontend.md` §2c and §9; `.claude/rules/backend.md` §2c (the two new keys) and §19.

## ADRs this plan touches

| ADR                  | What P6 does with it                                                                        | Needs the user |
| -------------------- | ------------------------------------------------------------------------------------------- | -------------- |
| 010 polling and push | implements its Web Push half; polling is unchanged, and the delta poll it mentions waits    | no             |
| 002 outbox           | one delayed message kind (`pickup.reminder`)                                                | no             |
| 011 free tiers       | Web Push is free; notifications are purged after 30 days; no SMS or email provider is added | no             |
| 009 rate limits      | one new limiter, on pickup verification                                                     | no             |

## Decisions

| #   | Decision                                                | Answer or default                                                                                                                                         | Applies to |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| D1  | Notification channels (roadmap decision 7)              | **answered (the user, 17 November 2026):** in-app and Web Push; no SMS, no email, so no DLT registration and no provider                                  | 08–10      |
| D2  | The counter "Now serving" screen                        | **answered (the user, 17 November 2026):** built                                                                                                          | 07         |
| D3  | Token format and the business day (roadmap decision 15) | a default: `A-017`, the prefix per store, rolling over at 04:00 store-local                                                                               | 04         |
| D4  | The rush factor and the history correction              | a default: they wait for P7.1's tables; P6 ships the rule-based estimate                                                                                  | 01         |
| D5  | Live re-estimates of an order's ready time              | a default: not built; the promise does not move                                                                                                           | 02         |
| D6  | A delta poll for the staff board                        | a default: not built until a measurement asks for it                                                                                                      | –          |
| D7  | Marking one line unavailable                            | **answered (the user, 17 November 2026, P5 D9):** deferred past the pilot                                                                                 | 13         |
| D8  | Who merges work PRs                                     | **answered (the user, 17 November 2026):** the agent merges into `feat/P6`, except money PRs (02, 04, 05); P6 keeps its phase branch although P5 has none | all        |
| D9  | Where a browser cannot scan a QR                        | a default: staff type the 6 digits; no decoder library                                                                                                    | 06         |
| D10 | Who may see a customer's phone                          | a default: any member of the store, one audited reveal at a time; never in a list                                                                         | 11, 13     |
| D11 | When the app asks for notification permission           | a default: a customer after their first paid order, staff on the board; never on first load                                                               | 10         |
| D12 | Whether the pickup code is required                     | a default: per store, behind `pickup_qr`; off, collection works as today and is recorded as manual                                                        | 05         |

## Closing P6

Once every box is ticked: on a fresh `origin/feat/P6`, the gate in both packages, `pnpm run e2e:chromium`, the
WebKit smoke, and `/break` (P6 adds a secret-bearing pickup flow, push subscriptions and a public screen), with
fixes as normal PRs into `feat/P6`. Then the PR `feat/P6` → `dev` ("P6 — order experience", exempt from the size
limit, `@coderabbitai ignore`, listing its migrations in order and the `min_client_version` to set); the user
merges it.

The milestone check (M6) on staging, from a low-end Android phone and a tablet: the wait on the store card grows
as orders queue; a paid order gets a token and, when ready, a code; the tablet scans it (and a second device types
it) and the order is collected; a wrong code is refused; the phone gets a push when the order is ready and another
ten minutes before the window closes; the TV page shows the token and drops it at collection; the tablet rings
when an order needs accepting; Call reveals the number once and the audit shows who asked.

## User steps (cannot be done from the repository)

- Review and merge PRs 02, 04 and 05; merge `feat/P6` into `dev` when the phase closes.
- Generate the VAPID key pair and a `PICKUP_CODE_SECRET`, and put them into staging's and production's secret
  (`docs/DEPLOYMENT.md` will have the commands); the public key also goes into the environment.
- Raise `min_client_version` when the phase reaches an environment.
- Turn `pickup_qr` and `notifications_push` on per store.
- Try push on a real Android phone and on an iPhone with the app added to the home screen.
- Put a screen at a pilot counter on `/display/<store>` if one is wanted.

## Risks and gotchas

- **`confirm_payment` and `collect_order` are re-created** (PRs 04, 05), each from P5's merged body, with P5's
  tests kept green as the proof that nothing else moved.
- **Six digits are a small space.** A random guess matches one of a store's ready orders with probability
  (ready orders ÷ 1,000,000) per try. The per-user rate limit, the per-order lockout and the answer that never
  says why are the guards; `/break` at the close tries to defeat them.
- **Rotating `PICKUP_CODE_SECRET` invalidates every code on screen.** Rotate outside trading hours; the order page
  picks up the new code on its next poll.
- **iOS only delivers Web Push to an app on the home screen** (16.4 and later). The ask card says so, and the
  order page's own polling still shows every change.
- **A cached service worker is the classic way to pin an old app.** This one has no `fetch` handler, is served
  uncached, and a test fails if either changes.
- **Browsers block sound until a gesture.** The sound switch is that gesture; a board reloaded overnight is silent
  until someone taps it again, and the header shows the switch's state.
- **The worker cannot clear the API's cache.** The store's wait and the counter screen can be 30 s and 5 s behind
  a change the worker or the reconciler made. Neither is money, stock or status the customer acts on.
- **`domain_events` is purged after 30 days**, so an old order's timeline is empty. The sheet is for live orders;
  the audit log keeps the long record.
- **The estimate is only as good as six numbers a manager typed.** The settings' live example is there so they
  see the effect; P7.1 replaces guesswork with the store's own history.
- **Counting the queue on every quote** is one indexed count per request. If it shows up in `perf-auditor`, the
  count is cached with the store's wait.
