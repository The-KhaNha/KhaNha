# Frontend structure

The web app in `client/`: React 18, TypeScript, Vite 6, Tailwind v4, zustand 5, react-router 7, icons from
`lucide-react`. What each shared component and hook does is in [COMPONENTS.md](COMPONENTS.md). How the pieces talk to
the API is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Tree

```
client/
├── index.html              font preconnect + preload (Plus Jakarta Sans, display=swap), first-paint background,
│                           description and link-preview tags, manifest and Apple icon, a still boot frame in
│                           #root (the page's shape until the app's first render), a <noscript> message,
│                           /runtime-env.js as a classic script before the app
├── vite.config.ts          dev server :VITE_DEV_PORT (5173, strictPort), proxies /api → VITE_API_PROXY_TARGET
│                           (http://localhost:8000); refuses to start
│                           or build without VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY for the mode
│                           (except mode "container")
├── vitest.config.ts        unit tests (jsdom), separate from vite.config.ts
├── playwright.config.ts    the WebKit smoke (pnpm run e2e:webkit; e2e:chromium where WebKit cannot launch): 360px, every /api call mocked
├── tsconfig.e2e.json       typechecks e2e/ and the Playwright config with Node types (part of pnpm run typecheck)
├── e2e/                    no backend; every /api call mocked (fixtures.ts)
│   ├── fixtures.ts         shared mocks and helpers (mockApi, signIn, seedCart, watchConsole, …)
│   ├── smoke.spec.ts       home, menu, add to cart, cart; the core path
│   ├── layout.spec.ts      every route at 320px and 200% text, 44px targets, layout shift
│   ├── forms.spec.ts       blur-then-submit on each form, checkout
│   ├── resilience.spec.ts  storage, cache, failed chunk and device-clock failures
│   └── error-reporting.spec.ts  browser crash reports
├── eslint.config.js
├── .env.example            documents the client env vars (see DEPLOYMENT.md)
├── .env.development        Vite mode "development" (pnpm run dev)
├── .env.staging            Vite mode "staging" (pnpm run dev:staging, build:staging)
├── .env.container          Vite mode "container" (build:container): placeholders, replaced at start
├── Dockerfile              the web image (build → nginx-unprivileged); DEPLOYMENT.md "Containers"
├── nginx/                  default.conf.template, security.conf.template (headers, CSP), runtime-env.sh
├── public/runtime-env.js   window.__RUNTIME_ENV__ = {} for dev; the image serves a generated one instead
├── public/images/          food and cafe photos, served at /images/*
├── public/manifest.webmanifest, icon.svg, icon-192/512.png, icon-maskable-512.png, apple-touch-icon.png
│                           installable app icons; rendered from icon.svg by scripts/make-icons.mjs
├── public/robots.txt       menu and home crawlable; carts, orders, accounts, staff and admin disallowed
└── src/
    ├── main.tsx            installs browser error reporting, applies the preloaded webfont, prefetches landing data, starts supabase-js when signed in, createRoot
    ├── App.tsx             routes, route guards, the shell, app error boundary and reporting sample from useConfig
    ├── appShell.ts         SHELL_BY_ROUTE + getShellConfig: which chrome and title each route gets
    ├── index.css           Tailwind import, design tokens (@theme), keyframes, utilities, reduced-motion rules
    ├── vite-env.d.ts       typed import.meta.env
    ├── config/fallbacks.json  the server config's defaults and field bounds (the one client copy, parity-tested)
    ├── config/app.ts       APP_TITLE, the product name, named once
    ├── components/         shared presentational atoms (catalog: COMPONENTS.md)
    ├── features/
    │   ├── admin/          settingsRules, useSiteSettings (the /admin dashboard's rules and data hook)
    │   ├── auth/           authStore, RequireAuth, RequireRole, roles (homeFor), sessionActivity, useAuthRedirect, validation, AuthCard
    │   ├── cart/           cartStore, cartRules, useReorder, CartBar
    │   ├── checkout/       checkoutDraftStore (the form as typed + the idempotency key, sessionStorage)
    │   ├── config/         useConfig (GET /api/config, persisted), fallbacks (config/fallbacks.json)
    │   ├── menu/           useMenu, useStore, CategoryChips, ItemDetailSheet
    │   ├── version/        versionStore (the 426 "outdated" flag), OutdatedBanner
    │   └── orders/         orderStatus, useOrder, useOrders, OrderHero, StaffHeader, StaffFilters, StaffBoard, StaffOrderCard
    ├── lib/                framework-free helpers and generic hooks (supabase, logger, useResource, format, uuid, sessionDraft, safeStorage, ...)
    ├── pages/              one component per route
    ├── services/           the only modules that call the API
    ├── types/api.ts        the API contract types (mirror of server/src/types/api.ts)
    └── test/setup.ts       jest-dom matchers + cleanup for Vitest
```

`client/.env.production` does not exist in the repo yet. `pnpm run build` needs it (see
[DEPLOYMENT.md](DEPLOYMENT.md#builds)).

## Routes

From `client/src/App.tsx`. Guards are described in [PERMISSIONS.md](PERMISSIONS.md#client).

| Path                  | Page                 | Guard                      | Top bar                            | Bottom nav | Cart button | Cart bar | Layout       | Loaded |
| --------------------- | -------------------- | -------------------------- | ---------------------------------- | ---------- | ----------- | -------- | ------------ | ------ |
| `/`                   | `HomePage`           | none                       | wordmark, `tone: 'brand'`          | yes        | yes         | yes      | column       | eager  |
| `/menu`               | `MenuPage`           | none                       | "Menu", back to `/`                | yes        | yes         | yes      | column, wide | eager  |
| `/cart`               | `CartPage`           | none                       | "Your cart", back to `/menu`       | yes        | no          | no       | column       | eager  |
| `/checkout`           | `CheckoutPage`       | `RequireAuth`              | "Checkout", back to `/cart`        | yes        | no          | no       | column       | lazy   |
| `/orders`             | `OrdersPage`         | `RequireAuth`              | "Your orders", back to `/`         | yes        | yes         | no       | column       | eager  |
| `/orders/:id`         | `OrderPage`          | `RequireAuth`              | "Order details", back to `/orders` | yes        | yes         | no       | column       | eager  |
| `/orders/:id/success` | `OrderSuccessPage`   | `RequireAuth`              | none                               | no         | no          | no       | full         | lazy   |
| `/profile`            | `ProfilePage`        | none                       | "Profile", back to `/`             | yes        | yes         | no       | column       | eager  |
| `/login`              | `LoginPage`          | none                       | none                               | no         | no          | no       | full         | lazy   |
| `/register`           | `RegisterPage`       | none                       | none                               | no         | no          | no       | full         | lazy   |
| `/staff`              | `StaffDashboardPage` | `RequireRole role="STAFF"` | none                               | no         | no          | no       | full         | lazy   |
| `/admin`              | `AdminPage`          | `RequireRole role="ADMIN"` | "Admin", back to `/profile`        | yes        | no          | no       | column       | lazy   |
| `*`                   | `NotFoundPage`       | none                       | "Not found", back to `/`           | yes        | no          | no       | column       | eager  |

Lazy pages are `lazy()` imports in `App.tsx`, wrapped in `PageBoundary`: the screens a customer does not need to
browse the menu and fill a cart. See [Caching](#caching).

How the shell works (`App.tsx`, with the route table in `appShell.ts`):

- `SHELL_BY_ROUTE` (`appShell.ts`) maps a path pattern to a `ShellConfig`: `topBar` (`{ title?, backTo?, tone? }` or `null`),
  `bottomNav`, `cartButton`, `cartBar`, `layout` (`'column'` or `'full'`) and `width` (`'default'` or `'wide'`).
  `getShellConfig` returns the first pattern that `matchPath` matches exactly, else `NOT_FOUND_SHELL`. Each config's
  `title` names the tab (through `documentTitle`) and is announced on arrival, before the page has loaded anything, so
  it must hold whatever the page turns out to show (`/orders/:id/success` is "Order confirmation", not "Order placed");
  a page whose state outgrows it sets `document.title` itself and restores it on the way out (`OrderSuccess`, `Order`). The customer
  tabs (`bottomNav`) never show on the operator screens, `/staff` and `/admin` (`App.test.tsx`).
- `layout: 'full'` renders the page alone; it owns its whole layout.
- `layout: 'column'` renders `TopBar` (with `CartButton` on the right when `cartButton`), a centred `<main>`, the
  `CartBar` (only when `cartBar` and the cart is not empty) and `BottomNav`. The widths are
  `max-w-md md:max-w-lg` (default) and `max-w-md md:max-w-2xl` (wide). `<main>` gets bottom padding for the bar and
  the nav, including `env(safe-area-inset-bottom)`.
- `ScrollToTop` scrolls to the top on every path change.
- `App` calls `useAuthStore.getState().hydrate()` once on mount.
- The shell re-renders when the cart count changes (the cart bar), so it memoises the page element: an Add tap must not
  re-render the page. With `FoodCard` memoised and each menu category `content-visibility: auto`, a 500-item menu
  (`MENU_ITEMS_MAX`) answers an Add tap in about 60 ms on a throttled phone, as a 14-item one does
  (`menuRenders.test.tsx`).

A new route needs an entry in both the `<Routes>` list (`App.tsx`) and `SHELL_BY_ROUTE` (`appShell.ts`), or it gets the
Not found shell.

## Pages

| Page                 | Data                                                                    | Notes                                                                                                                                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Home.tsx`           | `useStore()`                                                            | paprika hero with `StoreCard`                                                                                                                                                                                                                                                                    |
| `Menu.tsx`           | `useMenu()`                                                             | `CategoryChips`, `PopularRail`, `FoodCard` list, `ItemDetailSheet`                                                                                                                                                                                                                               |
| `Cart.tsx`           | `useMenu()` (refreshes stock limits), `cartStore`                       | shows the Order Again notice from router state (`readReorderNotice`)                                                                                                                                                                                                                             |
| `Checkout.tsx`       | `useMenu()`, `createOrder()`                                            | holds a green "Paid" state for 500 ms, then navigates to success with the order in router state                                                                                                                                                                                                  |
| `OrderSuccess.tsx`   | `useOrder(id, passedOrder)`                                             | renders the passed order at once, then polls; with nothing passed in, a neutral skeleton (no celebration) until the order loads; a 404 is an `<h1>` not-found state titled "Order not found"; a failed fetch with no checkout handoff is a neutral retryable `<h1>` error, never "Order placed!" |
| `Order.tsx`          | `useOrder(id)`, `useReorder()`                                          | tracking page with `OrderHero` and `StatusTracker`                                                                                                                                                                                                                                               |
| `Orders.tsx`         | `useOrders()`, `useReorder()`                                           | In progress / Past orders, Order Again                                                                                                                                                                                                                                                           |
| `Profile.tsx`        | `authStore`                                                             | sign-out; a "Staff dashboard" row for `STAFF`, an "Admin dashboard" row for `ADMIN`; a footer "Food Pickup v0.1.0 (1a2b3c4)" from `lib/appVersion.ts`                                                                                                                                            |
| `Login.tsx`          | `authStore.login`                                                       | `AuthCard`, `useAuthRedirect`                                                                                                                                                                                                                                                                    |
| `Register.tsx`       | `authStore.register`                                                    | `AuthCard`, `useAuthRedirect`, `validation.ts`                                                                                                                                                                                                                                                   |
| `StaffDashboard.tsx` | `useOrders({ audience: 'staff' })`, `useStore()`, `updateOrderStatus()` | owns polling, filters and status changes; the `Staff*` components are presentational                                                                                                                                                                                                             |
| `Admin.tsx`          | `useSiteSettings()`                                                     | `AdminPage` + `SettingsForm`; edits every `site_settings` field from the `SETTING_FIELDS` registry (see [COMPONENTS.md#featuresadmin](COMPONENTS.md#featuresadmin))                                                                                                                              |
| `NotFound.tsx`       | none                                                                    |                                                                                                                                                                                                                                                                                                  |

Polling intervals and the `useResource` engine are drawn in
[ARCHITECTURE.md](ARCHITECTURE.md#72-the-polling-engine-useresource).

## Stores

The auth and cart stores are zustand with the `persist` middleware (localStorage); the checkout draft persists to
sessionStorage; the version store is in memory. Every persisted store passes `storage: safeJSONStorage(...)`
(`lib/safeStorage.ts`): zustand writes inside each `set()` without a catch, so on full storage an ordinary action (the
menu's cart sync, a sign-in) threw; with it the store carries on in memory and only stops surviving a reload.

| Store                   | File                                                 | localStorage key                          | Persisted                                 | Holds                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------- | ----------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `useAuthStore`          | `client/src/features/auth/authStore.ts`              | `fp_auth`                                 | `user`, `token`                           | the profile and a mirror of the Supabase access token; `login`, `register`, `logout`, `hydrate`, `clearSession`                                                                                                                                                                                                                                                    |
| `useCartStore`          | `client/src/features/cart/cartStore.ts`              | `fp_cart` (version 1)                     | `lines`                                   | cart lines; `add`, `increment`, `decrement`, `remove`, `clear`, `fix`, `setAvailability`, `syncAvailability`                                                                                                                                                                                                                                                       |
| `useCheckoutDraftStore` | `client/src/features/checkout/checkoutDraftStore.ts` | `fp_checkout` (sessionStorage, version 1) | `name`, `phone`, `note`, `idempotencyKey` | the checkout form as typed (a refresh or Back keeps it; `null` = never touched, so the profile fills it) and one idempotency key per attempt (`ensureKey`); `reset` after the order is placed; `dropKey` after a 409 `IDEMPOTENCY_KEY_REUSED`; reset on every sign-in and sign-out by `authStore.ts` (always loaded), so typed data never reaches the next account |
| `useVersionStore`       | `client/src/features/version/versionStore.ts`        | –                                         | nothing                                   | `outdated` (set by `services/api.ts` on a 426 `CLIENT_OUTDATED`), `markOutdated`; `OutdatedBanner` in `App.tsx` shows "New version available" with Refresh on every screen while it is set.                                                                                                                                                                        |

- supabase-js keeps the real session in localStorage under its own key (`sb-<project-ref>-auth-token`) and refreshes
  it. `authStore` subscribes to `supabase.auth.onAuthStateChange` to keep `token` in step, and `services/api.ts` reads
  the live token from supabase-js for every request.
- `authStore` also uses a third, plain (non-zustand) localStorage key, `fp_last_active`
  (`features/auth/sessionActivity.ts`): the 7-day idle sign-out timestamp, updated on login and use, cleared on
  logout. Not a store; see [PERMISSIONS.md#session-lifetime](PERMISSIONS.md#session-lifetime).
- `pages/Register.tsx` keeps name, email and phone (never the password) in sessionStorage as `fp_register`
  (`lib/sessionDraft.ts`), cleared by `authStore` when a session starts or ends.
- Every storage key is classified in `lib/storageKeys.test.ts` (public, device, session or user-typed); a new `fp_`
  key fails the suite until it is, and the user-typed ones are proven cleared on sign-out without their page loaded.
- The cart's `migrate` fills `maxQuantity: null` for carts saved before stock limits existed.
- Count and total are derived selectors (`selectCount`, `selectTotal`), never stored.

## Services

Only these modules call `request()` from `services/api.ts`. Components and hooks call the service functions.

| File                       | Functions                                                                                | Endpoints                                                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/api.ts`          | `request<T>(path, { method, body, auth, signal, keepalive })`, `ApiError`                | base `/api`; attaches the bearer token when `auth` (default true); forwards `keepalive` to `fetch`                                                                                        |
| `services/auth.ts`         | `signIn`, `signOut` (supabase-js), `register`, `fetchMe`                                 | `POST /auth/register`, `GET /auth/me`                                                                                                                                                     |
| `services/store.ts`        | `fetchStore`, `prefetchStore`                                                            | `GET /store`                                                                                                                                                                              |
| `services/config.ts`       | `fetchConfig`                                                                            | `GET /config` without a token; concurrent callers share one request                                                                                                                       |
| `services/clientErrors.ts` | `sendClientErrors(reports)`, `ClientErrorReport`                                         | `POST /client-errors` without auth, with `keepalive` and `X-Client-Version`; failures are swallowed with no retry; see [LOGGING.md#client-error-reports](LOGGING.md#client-error-reports) |
| `services/menu.ts`         | `fetchMenu`, `prefetchMenu`                                                              | `GET /menu`                                                                                                                                                                               |
| `services/orders.ts`       | `createOrder`, `fetchOrders(status?)`, `fetchOrder(id)`, `updateOrderStatus(id, status)` | `POST /orders`, `GET /orders`, `GET /orders/:id`, `PATCH /orders/:id/status`                                                                                                              |
| `services/admin.ts`        | `fetchSiteSettings()`, `updateSiteSettings(changes)`                                     | `GET /admin/settings`, `PATCH /admin/settings`                                                                                                                                            |

`request()`:

- throws `ApiError(0, 'UNREACHABLE', …)` when `fetch` fails, or when the response (headers and body) takes longer
  than `REQUEST_TIMEOUT_MS` (15 s), so a stalled connection ends on `ErrorState` with Retry instead of an endless
  skeleton. An abort from the caller's own `signal` is re-thrown as the `AbortError`;
- on a non-2xx response throws `ApiError(status, code, message, details)` from the error envelope, or
  `UNREACHABLE` for a 5xx without one, or `INTERNAL` otherwise;
- on a 401 for a request that sent a token, calls `useAuthStore.getState().clearSession()`;
- logs 5xx at `error` and 4xx at `debug`, with the response's `x-request-id`.

`ApiError.isUnreachable` is true for status 0 or code `UNREACHABLE`.

`CLIENT_RELOAD_REQUIRED` is a client-only code (status 0, so also unreachable), never sent by the server: an
authenticated `request()` or `signIn` throws it when the supabase-js chunk failed to load (`loadSupabase()`
in `services/api.ts`); `signOut` then removes the stored session itself (`clearStoredSession()`), so the reload cannot
sign the user back in. `getSupabase()` retries a failed `import()` once first (Firefox and Safari fetch it again);
Chromium keeps a failed `import()` for the page's life, so there only a reload helps. The code logs "Sign-in module failed to load" once per page life. An `ErrorState` given `code` =
`CLIENT_RELOAD_REQUIRED` shows "Reload" (`window.location.reload()`) instead of its retry, including Checkout's Pay
error, which otherwise has none; errors from public loads (menu, store) keep their retry. The auth store loads
supabase-js through `loadSupabase()` as well: on app start `hydrate()` keeps the persisted session and resolves (a
network condition, not a crash report), and `login()` shows the code's message in the form. The cart, the checkout draft and its idempotency key are
persisted, so the reload loses nothing.

## Feature folders

| Folder              | Rules and hooks                                                                         | UI                                                                         |
| ------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `features/admin`    | `settingsRules.ts`, `useSiteSettings.ts`                                                | (`pages/Admin.tsx` owns the form UI directly)                              |
| `features/auth`     | `authStore.ts`, `roles.ts`, `sessionActivity.ts`, `useAuthRedirect.ts`, `validation.ts` | `AuthCard`, `RequireAuth`, `RequireRole`                                   |
| `features/cart`     | `cartStore.ts`, `cartRules.ts`, `useReorder.ts`                                         | `CartBar`                                                                  |
| `features/checkout` | `checkoutDraftStore.ts`                                                                 | (`pages/Checkout.tsx` owns the form)                                       |
| `features/menu`     | `useMenu.ts`, `useStore.ts`                                                             | `CategoryChips`, `ItemDetailSheet`                                         |
| `features/orders`   | `orderStatus.ts`, `useOrder.ts`, `useOrders.ts`                                         | `OrderHero`, `StaffHeader`, `StaffFilters`, `StaffBoard`, `StaffOrderCard` |

Details of each export: [COMPONENTS.md](COMPONENTS.md#feature-rules-and-hooks).

## Layering rules

- `pages/*` compose `features/*` and `components/*`. A page owns its data hooks and passes data down.
- `components/*` are shared atoms. They may read the cart store and the rules in `features/cart/cartRules.ts` and
  `features/orders/orderStatus.ts` (for example `AddControl`, `StatusBadge`), but never call services.
- Only `services/*.ts` call `request()`. Nothing else calls `fetch` for the API.
- GETs go through `lib/useResource.ts`, wrapped by a `features/*/use*.ts` hook (`useMenu`, `useStore`, `useOrder`,
  `useOrders`). Mutations are a service call followed by `reload()` or `mutate()` on the resource.
- Business rules live in `features/cart/cartRules.ts` and `features/orders/orderStatus.ts`, not in components.
  `orderStatus.ts` is the single source of truth for status labels, colours and staff actions on the client; the
  server's `ALLOWED_TRANSITIONS` decides what is actually allowed.
- `lib/*` has no app knowledge except `lib/supabase.ts` (the sign-in client, loaded on demand from `supabaseClient.ts`) and `lib/useResource.ts` (which uses
  `ApiError`).
- Types for API shapes come from `types/api.ts` only.
- Logging goes through `lib/logger.ts`; `console.*` elsewhere fails lint (see [LOGGING.md](LOGGING.md)).

## Caching

Public, non-user data survives across visits and paints instantly; user data never does. The policy is
[CLAUDE.md](../CLAUDE.md) §2c; the server side is [API.md#caching](API.md#caching).

### `useResource({ persist: true })`

`lib/useResource.ts`'s `persist` option writes the last good response to `localStorage` under
`fp_cache:v1:<key>` (`CACHE_PREFIX = 'fp_cache:v1:'` + the resource's `key`) after every successful fetch. On the
next mount or visit with the same `key`, that cached value renders at once — `isLoading` is only true while there is
nothing at all to show — while a real fetch runs and replaces it in the background
(stale-while-revalidate). `useMenu()`, `useStore()` and `useConfig()` pass `persist: true`; `useOrder`/`useOrders` never do —
orders are user-specific and must never survive a sign-out on a shared device.

If a refresh fails while a saved copy is showing, `MenuPage` and `HomePage` keep the saved copy and add a compact
`ErrorState` ("Showing your saved menu" + Retry) instead of hiding it; checkout re-checks stock and prices anyway.

A render crash clears every persisted copy (`PageBoundary` calls `clearPersistedCache()`), so one malformed 200 that
was cached cannot crash every later load: Reload starts clean.

Bump `CACHE_PREFIX` (`fp_cache:v1:` → `fp_cache:v2:`, …) whenever a persisted response's shape changes, so old code
never hands new code a shape it no longer expects. Reading or writing the cache never throws: private-mode or a full
quota just means no head start, not a crash.

### Photo thumbnails

Every bundled photo in `client/public/images/` ships two files: `<name>.jpg` (≤900px) and `<name>-400.jpg` (400px),
produced by `python3 client/scripts/optimize-images.py` (see
[DEPLOYMENT.md#containers](DEPLOYMENT.md#containers) for how the web image serves them). `lib/photo.ts`'s `photoSrcSet(src)` turns a bundled `/images/<name>.jpg` URL into
`"/images/<name>-400.jpg 400w, /images/<name>.jpg 900w"`; any other URL (a future Supabase Storage upload) gets no
srcset. `components/FoodPhoto.tsx` renders it with a `sizes` prop that must match the photo's real rendered width so
the browser downloads the small file: the default is `112px` (menu and cart list photos), `PopularRail` passes
`188px`, `ItemDetailSheet` passes `"(min-width: 768px) 480px, 100vw"`. `lib/photo.test.ts` fails if a bundled photo
is missing its `-400` thumbnail or is over the ~80 KB budget (`.claude/rules/frontend.md` §2b; `optimize-images.py --refit` fixes it).

### The largest paint

On `/` and `/menu` the LCP element is the store cover; on `/orders/:id` it is the order hero, which plays its
entrance only for a status a poll brings, never for the one the page opened on (`OrderHero`'s `entrance`; e2e "the
order page's largest paint is its hero"). The largest paint is never inside an entrance fade: Chrome skips a paint at
opacity 0 and does not count the fade, so the element is recorded only at its next repaint (the web font swap,
seconds later, or never). The cover gets `LCP_IMAGE_PROPS` (`fetchpriority="high"`), is
never inside an entrance fade (so `HomePage`, `MenuPage` and
`StoreCard` fade only what is below it), and `MenuPage` holds its food photos in a `FoodPhotoGate` until the cover is
painted, so it does not share a slow link with ten photos. `main.tsx` starts `/api/menu` (on `/menu`) or `/api/store`
(on `/`) before the first render (`prefetchMenu`, `prefetchStore`: the next fetch takes that response, once).
supabase-js loads only when a session may exist or on the sign-in screens (`getSupabase`), keeping the entry chunk
at about 88 KB gzip. When a session may exist, `main.tsx` starts it before the first render, so a signed-in page's
first request does not wait for it after the page's own lazy chunk (e2e "supabase-js loads early …").

### Lazy routes

The screens a customer does not need to browse the menu and fill a cart are code-split in `App.tsx`: `CheckoutPage`,
`OrderSuccessPage`, `LoginPage`, `RegisterPage`, `AdminPage` and `StaffDashboardPage` are `lazy()` imports (see the
[route table](#routes)). `PageBoundary` in page scope wraps the whole `<Routes>` list and owns its loading skeleton;
an outer app scope wraps the router and shell without adding another skeleton. The boundary distinguishes a failed
chunk download from a render bug, so a lost connection and a crash get different fallback copy and reports (props
and fallback behavior: [COMPONENTS.md](COMPONENTS.md#layout-and-navigation)).

`main.tsx` installs `lib/errorReporter.ts` before startup work and rendering. `App` passes
`useConfig().clientErrors.samplePercent` to `setSamplePercent` once loaded or cached server configuration replaces
the `serverVersion: 'unknown'` fallback. The effect (`ClientErrorSampling`) sits in its own app boundary beside the
shell's, so reporting still gets configured when the shell crashes on its first render, and a config that crashes its
reader is reported and renders nothing (`PageBoundary silent`) instead of a blank page. Then `setSamplePercent` never
runs and reports stay buffered, unsent: the safe side of a 0% sample. Startup errors wait for that first server sampling value.
The reporter sends through `services/clientErrors.ts`; its limits and privacy rules live in
[LOGGING.md](LOGGING.md#client-error-reports).

## Tests

Client unit tests live next to the code as `src/**/<name>.test.ts(x)`, for example `lib/format.test.ts`,
`lib/photo.test.ts` and `lib/useResource.test.ts`. The e2e suite is `e2e/*.spec.ts` (core path in `smoke.spec.ts`; `pnpm run e2e:webkit`,
after `pnpm run e2e:install` once). See [TESTING.md](TESTING.md).
