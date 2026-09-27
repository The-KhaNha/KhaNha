# Frontend structure

The web app in `client/`: React 18, TypeScript, Vite 6, Tailwind v4, zustand 5, react-router 7, icons from
`lucide-react`. What each shared component and hook does is in [COMPONENTS.md](COMPONENTS.md). How the pieces talk to
the API is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Tree

```
client/
├── index.html              font preconnect + preload (Plus Jakarta Sans, display=swap), first-paint background
├── vite.config.ts          dev server :5173 (strictPort), proxies /api → http://localhost:8000; refuses to start
│                           or build without VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY for the mode
├── vitest.config.ts        unit tests (jsdom), separate from vite.config.ts
├── eslint.config.js
├── .env.example            documents the client env vars (see DEPLOYMENT.md)
├── .env.development        Vite mode "development" (npm run dev)
├── .env.staging            Vite mode "staging" (npm run dev:staging, build:staging)
├── public/images/          food and cafe photos, served at /images/*
└── src/
    ├── main.tsx            createRoot + StrictMode + index.css
    ├── App.tsx             routes, route guards, per-route shell config
    ├── index.css           Tailwind import, design tokens (@theme), keyframes, utilities, reduced-motion rules
    ├── vite-env.d.ts       typed import.meta.env
    ├── components/         shared presentational atoms (catalog: COMPONENTS.md)
    ├── features/
    │   ├── admin/          settingsRules, useSiteSettings (the /admin dashboard's rules and data hook)
    │   ├── auth/           authStore, RequireAuth, RequireRole, roles (homeFor), sessionActivity, useAuthRedirect, validation, AuthCard
    │   ├── cart/           cartStore, cartRules, useReorder, CartBar
    │   ├── menu/           useMenu, useStore, CategoryChips, ItemDetailSheet
    │   └── orders/         orderStatus, useOrder, useOrders, OrderHero, StaffHeader, StaffFilters, StaffBoard, StaffOrderCard
    ├── lib/                framework-free helpers and generic hooks (supabase, logger, useResource, format, ...)
    ├── pages/              one component per route
    ├── services/           the only modules that call the API
    ├── types/api.ts        the API contract types (mirror of server/src/types/api.ts)
    └── test/setup.ts       jest-dom matchers + cleanup for Vitest
```

`client/.env.production` does not exist in the repo yet. `npm run build` needs it (see
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

How the shell works (`App.tsx`):

- `SHELL_BY_ROUTE` maps a path pattern to a `ShellConfig`: `topBar` (`{ title?, backTo?, tone? }` or `null`),
  `bottomNav`, `cartButton`, `cartBar`, `layout` (`'column'` or `'full'`) and `width` (`'default'` or `'wide'`).
  `getShellConfig` returns the first pattern that `matchPath` matches exactly, else `NOT_FOUND_SHELL`.
- `layout: 'full'` renders the page alone; it owns its whole layout.
- `layout: 'column'` renders `TopBar` (with `CartButton` on the right when `cartButton`), a centred `<main>`, the
  `CartBar` (only when `cartBar` and the cart is not empty) and `BottomNav`. The widths are
  `max-w-md md:max-w-lg` (default) and `max-w-md md:max-w-2xl` (wide). `<main>` gets bottom padding for the bar and
  the nav, including `env(safe-area-inset-bottom)`.
- `ScrollToTop` scrolls to the top on every path change.
- `App` calls `useAuthStore.getState().hydrate()` once on mount.

A new route needs an entry in both the `<Routes>` list and `SHELL_BY_ROUTE`, or it gets the Not found shell.

## Pages

| Page                 | Data                                                               | Notes                                                                                                                               |
| -------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Home.tsx`           | `useStore()`                                                       | paprika hero with `StoreCard`                                                                                                       |
| `Menu.tsx`           | `useMenu()`                                                        | `CategoryChips`, `PopularRail`, `FoodCard` list, `ItemDetailSheet`                                                                  |
| `Cart.tsx`           | `useMenu()` (refreshes stock limits), `cartStore`                  | shows the Order Again notice from router state (`readReorderNotice`)                                                                |
| `Checkout.tsx`       | `useMenu()`, `createOrder()`                                       | holds a green "Paid" state for 500 ms, then navigates to success with the order in router state                                     |
| `OrderSuccess.tsx`   | `useOrder(id, passedOrder)`                                        | renders the passed order at once, then polls                                                                                        |
| `Order.tsx`          | `useOrder(id)`, `useReorder()`                                     | tracking page with `OrderHero` and `StatusTracker`                                                                                  |
| `Orders.tsx`         | `useOrders()`, `useReorder()`                                      | In progress / Past orders, Order Again                                                                                              |
| `Profile.tsx`        | `authStore`                                                        | sign-out; a "Staff dashboard" row for `STAFF`, an "Admin dashboard" row for `ADMIN`                                                 |
| `Login.tsx`          | `authStore.login`                                                  | `AuthCard`, `useAuthRedirect`                                                                                                       |
| `Register.tsx`       | `authStore.register`                                               | `AuthCard`, `useAuthRedirect`, `validation.ts`                                                                                      |
| `StaffDashboard.tsx` | `useOrders({ pollMs: 4000 })`, `useStore()`, `updateOrderStatus()` | owns polling, filters and status changes; the `Staff*` components are presentational                                                |
| `Admin.tsx`          | `useSiteSettings()`                                                | `AdminPage` + `SettingsForm`; edits the two `site_settings` limits (see [COMPONENTS.md#featuresadmin](COMPONENTS.md#featuresadmin)) |
| `NotFound.tsx`       | none                                                               |                                                                                                                                     |

Polling intervals and the `useResource` engine are drawn in
[ARCHITECTURE.md](ARCHITECTURE.md#72-the-polling-engine-useresource).

## Stores

Both stores are zustand with the `persist` middleware (localStorage).

| Store          | File                                    | localStorage key      | Persisted       | Holds                                                                                                           |
| -------------- | --------------------------------------- | --------------------- | --------------- | --------------------------------------------------------------------------------------------------------------- |
| `useAuthStore` | `client/src/features/auth/authStore.ts` | `fp_auth`             | `user`, `token` | the profile and a mirror of the Supabase access token; `login`, `register`, `logout`, `hydrate`, `clearSession` |
| `useCartStore` | `client/src/features/cart/cartStore.ts` | `fp_cart` (version 1) | `lines`         | cart lines; `add`, `increment`, `decrement`, `remove`, `clear`, `fix`, `setAvailability`, `syncAvailability`    |

- supabase-js keeps the real session in localStorage under its own key (`sb-<project-ref>-auth-token`) and refreshes
  it. `authStore` subscribes to `supabase.auth.onAuthStateChange` to keep `token` in step, and `services/api.ts` reads
  the live token from supabase-js for every request.
- `authStore` also uses a third, plain (non-zustand) localStorage key, `fp_last_active`
  (`features/auth/sessionActivity.ts`): the 7-day idle sign-out timestamp, updated on login and use, cleared on
  logout. Not a store; see [PERMISSIONS.md#session-lifetime](PERMISSIONS.md#session-lifetime).
- The cart's `migrate` fills `maxQuantity: null` for carts saved before stock limits existed.
- Count and total are derived selectors (`selectCount`, `selectTotal`), never stored.

## Services

Only these modules call `request()` from `services/api.ts`. Components and hooks call the service functions.

| File                 | Functions                                                                                | Endpoints                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `services/api.ts`    | `request<T>(path, { method, body, auth, signal })`, `ApiError`                           | base `/api`; attaches the bearer token when `auth` (default true)            |
| `services/auth.ts`   | `signIn`, `signOut` (supabase-js), `register`, `fetchMe`                                 | `POST /auth/register`, `GET /auth/me`                                        |
| `services/store.ts`  | `fetchStore`                                                                             | `GET /store`                                                                 |
| `services/menu.ts`   | `fetchMenu`                                                                              | `GET /menu`                                                                  |
| `services/orders.ts` | `createOrder`, `fetchOrders(status?)`, `fetchOrder(id)`, `updateOrderStatus(id, status)` | `POST /orders`, `GET /orders`, `GET /orders/:id`, `PATCH /orders/:id/status` |
| `services/admin.ts`  | `fetchSiteSettings()`, `updateSiteSettings(changes)`                                     | `GET /admin/settings`, `PATCH /admin/settings`                               |

`request()`:

- throws `ApiError(0, 'UNREACHABLE', …)` when `fetch` fails, or when the response (headers and body) takes longer
  than `REQUEST_TIMEOUT_MS` (15 s), so a stalled connection ends on `ErrorState` with Retry instead of an endless
  skeleton. An abort from the caller's own `signal` is re-thrown as the `AbortError`;
- on a non-2xx response throws `ApiError(status, code, message, details)` from the error envelope, or
  `UNREACHABLE` for a 5xx without one, or `INTERNAL` otherwise;
- on a 401 for a request that sent a token, calls `useAuthStore.getState().clearSession()`;
- logs 5xx at `error` and 4xx at `debug`, with the response's `x-request-id`.

`ApiError.isUnreachable` is true for status 0 or code `UNREACHABLE`.

## Feature folders

| Folder            | Rules and hooks                                                                         | UI                                                                         |
| ----------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `features/admin`  | `settingsRules.ts`, `useSiteSettings.ts`                                                | (`pages/Admin.tsx` owns the form UI directly)                              |
| `features/auth`   | `authStore.ts`, `roles.ts`, `sessionActivity.ts`, `useAuthRedirect.ts`, `validation.ts` | `AuthCard`, `RequireAuth`, `RequireRole`                                   |
| `features/cart`   | `cartStore.ts`, `cartRules.ts`, `useReorder.ts`                                         | `CartBar`                                                                  |
| `features/menu`   | `useMenu.ts`, `useStore.ts`                                                             | `CategoryChips`, `ItemDetailSheet`                                         |
| `features/orders` | `orderStatus.ts`, `useOrder.ts`, `useOrders.ts`                                         | `OrderHero`, `StaffHeader`, `StaffFilters`, `StaffBoard`, `StaffOrderCard` |

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
- `lib/*` has no app knowledge except `lib/supabase.ts` (the sign-in client) and `lib/useResource.ts` (which uses
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
(stale-while-revalidate). `useMenu()` and `useStore()` both pass `persist: true`; `useOrder`/`useOrders` never do —
orders are user-specific and must never survive a sign-out on a shared device.

If a refresh fails while a saved copy is showing, `MenuPage` and `HomePage` keep the saved copy and add a compact
`ErrorState` ("Showing your saved menu" + Retry) instead of hiding it; checkout re-checks stock and prices anyway.

Bump `CACHE_PREFIX` (`fp_cache:v1:` → `fp_cache:v2:`, …) whenever a persisted response's shape changes, so old code
never hands new code a shape it no longer expects. Reading or writing the cache never throws: private-mode or a full
quota just means no head start, not a crash.

### Photo thumbnails

Every bundled photo in `client/public/images/` ships two files: `<name>.jpg` (≤900px) and `<name>-400.jpg` (400px),
produced by `python3 client/scripts/optimize-images.py` (see
[DEPLOYMENT.md#future-docker--nginx](DEPLOYMENT.md#future-docker--nginx) for where static-asset serving eventually
lives). `lib/photo.ts`'s `photoSrcSet(src)` turns a bundled `/images/<name>.jpg` URL into
`"/images/<name>-400.jpg 400w, /images/<name>.jpg 900w"`; any other URL (a future Supabase Storage upload) gets no
srcset. `components/FoodPhoto.tsx` renders it with a `sizes` prop that must match the photo's real rendered width so
the browser downloads the small file: the default is `112px` (menu and cart list photos), `PopularRail` passes
`188px`, `ItemDetailSheet` passes `"(min-width: 768px) 480px, 100vw"`. `lib/photo.test.ts` fails if a bundled photo
is missing its `-400` thumbnail.

### Lazy routes

The screens a customer does not need to browse the menu and fill a cart are code-split in `App.tsx`: `CheckoutPage`,
`OrderSuccessPage`, `LoginPage`, `RegisterPage` and `StaffDashboardPage` are `lazy()` imports (see the [route
table](#routes)). `components/PageBoundary.tsx` wraps the whole `<Routes>` list: a `Skeleton` while a chunk
downloads (`Suspense`), and if the download itself fails (offline, or a stale deploy whose old chunk was removed) an
`ErrorState` with a reload button instead of a blank screen (`getDerivedStateFromError`).

## Tests

Client unit tests live next to the code as `src/**/<name>.test.ts(x)`, for example `lib/format.test.ts`,
`lib/photo.test.ts` and `lib/useResource.test.ts`. See [TESTING.md](TESTING.md).
