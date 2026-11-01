# Architecture

How Food Pickup works end to end: which piece talks to which, and what happens, step by step, in every workflow the app has today. Each section names the files that implement it, so the diagrams can be checked against the code.

- **Web app**: React 18 + Vite, in `client/`. It signs in with supabase-js and gets all its data from the API.
- **API**: Express 5, in `server/`. It verifies Supabase access tokens, holds all business rules, and reads and writes Postgres with the Supabase **secret** key.
- **Supabase**: Auth (sign-in, tokens, users), PostgREST (the REST layer supabase-js calls) and Postgres. The Postgres side holds the tables, row-level security (RLS), triggers, and the two functions that do the order transactions.

## Docs map

This file owns the system overview, the cross-cutting flows and the diagrams. Everything else has one owner:

| Topic                                                           | Doc                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------- |
| Endpoints, request/response shapes, error codes, limits         | [API.md](API.md)                                              |
| Tables, columns, enums, indexes, triggers, RPCs, migrations     | [SCHEMA.md](SCHEMA.md)                                        |
| Roles, route guards, ownership rules, RLS, grants               | [PERMISSIONS.md](PERMISSIONS.md)                              |
| Shared components, `lib/` hooks and utils, feature rules        | [COMPONENTS.md](COMPONENTS.md)                                |
| `client/src` layout, routes, stores, services                   | [FRONTEND_STRUCTURE.md](FRONTEND_STRUCTURE.md)                |
| `server/src` layout, request pipeline, modules, scripts         | [BACKEND_STRUCTURE.md](BACKEND_STRUCTURE.md)                  |
| Environments, env vars, migrations, seeding, builds, production | [DEPLOYMENT.md](DEPLOYMENT.md)                                |
| Log levels, request ids, redaction                              | [LOGGING.md](LOGGING.md)                                      |
| Tests                                                           | [TESTING.md](TESTING.md)                                      |
| Performance budgets                                             | `PERF_BASELINE.md` (created by perf-auditor on its first run) |

## Contents

1. [System overview](#1-system-overview)
2. [Environments and configuration](#2-environments-and-configuration)
3. [Authentication](#3-authentication)
4. [Browsing the store and menu](#4-browsing-the-store-and-menu)
5. [Cart](#5-cart)
6. [Checkout and placing an order](#6-checkout-and-placing-an-order)
7. [Customer order tracking, history and Order Again](#7-customer-order-tracking-history-and-order-again)
8. [Staff dashboard and order status changes](#8-staff-dashboard-and-order-status-changes)
9. [Server request pipeline and error handling](#9-server-request-pipeline-and-error-handling)
10. [Data model](#10-data-model)
11. [Access control](#11-access-control)
12. [Operations](#12-operations)

---

## 1. System overview

```mermaid
flowchart LR
  subgraph Browser["Browser: React SPA (client/)"]
    UI["Pages and components"]
    AuthStore["authStore (zustand)<br/>persisted as fp_auth"]
    CartStore["cartStore (zustand)<br/>persisted as fp_cart"]
    SBJS["supabase-js<br/>(publishable key)<br/>session in localStorage"]
    ApiClient["services/api.ts<br/>fetch wrapper"]
  end

  Vite["Vite dev server :5173<br/>proxies /api"]

  subgraph API["Express API :8000 (server/)"]
    Routes["routes → middleware<br/>(requireAuth, requireStaff, validate)"]
    Services["controllers → services<br/>(auth, store, menu, order, payment)"]
    Admin["supabaseAdmin<br/>(secret key = service_role)"]
    Verify["@supabase/server<br/>verifyCredentials"]
  end

  subgraph Worker["Worker :8001 health (server/src/worker.ts)"]
    Runner["runQueue per handler<br/>(notifyHandler)"]
  end

  subgraph Supabase["Supabase project (local / staging / production)"]
    GoTrue["Auth (GoTrue)<br/>/auth/v1"]
    JWKS["JWKS<br/>/auth/v1/.well-known/jwks.json"]
    PostgREST["PostgREST<br/>/rest/v1"]
    PG[("Postgres<br/>tables + RLS<br/>triggers<br/>place_order()<br/>update_order_status()")]
  end

  UI --> AuthStore
  UI --> CartStore
  AuthStore --> SBJS
  UI --> ApiClient
  ApiClient -->|"reads access token"| SBJS
  SBJS -->|"sign in, refresh, sign out"| GoTrue
  ApiClient -->|"/api/* + Bearer token"| Vite
  Vite -->|"proxy"| Routes
  Routes --> Verify
  Verify -->|"fetch + cache signing keys"| JWKS
  Routes --> Services
  Services --> Admin
  Admin -->|"auth.admin.createUser"| GoTrue
  Admin -->|"select / rpc"| PostgREST
  PostgREST --> PG
  GoTrue -->|"auth.users + trigger"| PG
  Runner -->|"queue_read / delete / retry (pgmq)"| PostgREST
  SBJS -.->|"publishable key: permission denied on every table"| PostgREST
```

The browser talks to Supabase **only** to sign in, refresh its token and sign out. All data goes through the API. The publishable key shipped in the bundle cannot read or write any table (see [Access control](#11-access-control)).

The worker is a second process from the same image: it reads the pgmq queues in Postgres and has no HTTP surface but `GET /health` ([JOBS.md](JOBS.md#the-worker-process)).

The API logs every request with pino. Each request gets an id, echoed in the `x-request-id` response header, and every log line inside the request carries it; the client logs that id when a call fails. See [LOGGING.md](LOGGING.md).

---

## 2. Environments and configuration

```mermaid
flowchart TB
  subgraph Local["local"]
    LDocker["Docker stack<br/>npm run db:start<br/>http://127.0.0.1:54321"]
  end
  subgraph Staging["staging"]
    SProj["Supabase project<br/>xkddnlxeeizaqpefhqlv"]
  end
  subgraph Production["production"]
    PProj["Supabase project<br/>PRODUCTION_REF in scripts/db-push.sh"]
  end

  Migrations[["server/supabase/migrations/*.sql"]]
  Migrations -->|"db:reset (rebuild)"| LDocker
  Migrations -->|"db:push:staging"| SProj
  Migrations -->|"db:push:production<br/>(type 'production' to confirm)"| PProj

  ServerEnv["server/.env<br/>APP_ENV + SUPABASE_URL + SUPABASE_SECRET_KEY"]
  ClientEnv["client/.env.development / .env.staging / .env.production<br/>VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY"]

  ServerEnv -. "APP_ENV=local" .-> LDocker
  ServerEnv -. "APP_ENV=staging" .-> SProj
  ServerEnv -. "APP_ENV=production (host env vars)" .-> PProj
  ClientEnv -. "vite --mode development" .-> LDocker
  ClientEnv -. "vite --mode staging" .-> SProj
  ClientEnv -. "vite build (production mode)" .-> PProj
```

The rule that ties it together: **the API and the web app must point at the same project.** Tokens are signed per project, so a token from staging fails verification in an API pointed at local, and the result is "Your session has expired. Please sign in again." `start.sh` enforces this by reading `APP_ENV` and starting Vite in the matching mode.

Config is validated at startup ([server/src/utils/env.ts](../server/src/utils/env.ts)): the process exits with a list of problems if `APP_ENV`, `SUPABASE_URL` or `SUPABASE_SECRET_KEY` is missing or malformed. The client refuses to start or build without its two Supabase variables ([client/vite.config.ts](../client/vite.config.ts)). Every variable, the push flow and production setup are in [DEPLOYMENT.md](DEPLOYMENT.md).

---

## 3. Authentication

Supabase Auth owns identities and passwords. The API owns the **role**, stored in `profiles.role`, which only the secret key can change. Code: [client/src/features/auth/authStore.ts](../client/src/features/auth/authStore.ts), [client/src/services/auth.ts](../client/src/services/auth.ts), [server/src/middleware/auth.ts](../server/src/middleware/auth.ts), [server/src/services/auth.service.ts](../server/src/services/auth.service.ts).

### 3.1 App start and session restore

```mermaid
sequenceDiagram
  autonumber
  participant App as App.tsx
  participant Store as authStore
  participant LS as localStorage
  participant SB as supabase-js
  participant Auth as Supabase Auth
  participant API as Express API
  participant DB as Postgres

  App->>Store: module load
  Store->>LS: rehydrate fp_auth (user, token), synchronous
  Note over Store: Route guards can render straight away from the persisted token
  SB->>LS: load session sb-ref-auth-token
  Store->>SB: onAuthStateChange(listener)
  SB-->>Store: INITIAL_SESSION (session or null)
  alt no Supabase session (never signed in, signed out, or pre-Supabase login)
    Store->>Store: user = null, token = null
  else session present
    Store->>Store: token = session.access_token
  end
  App->>Store: useEffect → hydrate()
  Store->>SB: auth.getSession()
  opt access token expired
    SB->>Auth: POST /auth/v1/token?grant_type=refresh_token
    Auth-->>SB: new access + refresh token
  end
  alt no session
    Store->>Store: user = null, token = null
  else session
    Store->>LS: readLastActive() (fp_last_active)
    alt idle more than 7 days (SESSION_IDLE_TTL_MS)
      Store->>Store: clearSession(): signOut(local), clear fp_last_active
      Note over Store: no fp_auth.me call — the device is treated as signed out
    else within 7 days, or no fp_last_active record yet
      Store->>LS: markActive(): fp_last_active = now
      Store->>API: GET /api/auth/me (Bearer access token)
      API->>DB: profiles where id = sub
      alt 200
        API-->>Store: { user }
        Store->>Store: user = profile
      else 401 (account deleted or token rejected)
        API-->>Store: 401
        Store->>SB: signOut(local)
        Store->>Store: user = null, token = null
      else network or 5xx
        Note over Store: keep the persisted session so the app stays usable offline
      end
    end
  end
```

A tab coming back from hidden re-runs the same idle check (`document.addEventListener('visibilitychange', ...)` in
`authStore.ts`), so a device left in the background past its week is signed out the moment it is looked at again. See
[PERMISSIONS.md#session-lifetime](PERMISSIONS.md#session-lifetime).

### 3.2 Registration

```mermaid
sequenceDiagram
  autonumber
  actor U as Customer
  participant Page as Register page
  participant Store as authStore
  participant API as Express API
  participant Auth as Supabase Auth (admin)
  participant DB as Postgres
  participant SB as supabase-js

  U->>Page: name, email, phone (optional), password
  Page->>Page: client validation (name 2-60, email, phone 10-15 digits, password 6-72)
  Page->>Store: register(input)
  Store->>API: POST /api/auth/register (no token)
  API->>API: validate(registerSchema)<br/>strip NUL bytes, trim, lowercase email, normalise phone
  API->>Auth: auth.admin.createUser(email, password, email_confirm = true, user_metadata name + phone)
  alt email already registered
    Auth-->>API: email_exists
    API-->>Page: 409 EMAIL_TAKEN
  else invalid email or weak password
    Auth-->>API: email_address_invalid / weak_password
    API-->>Page: 400 VALIDATION_ERROR
  else created
    Auth->>DB: insert auth.users
    DB->>DB: trigger on_auth_user_created → handle_new_user()<br/>insert profiles (role CUSTOMER, name, phone)
    Auth-->>API: user
    API->>DB: select profiles where id = user.id
    API-->>Store: 201 { user }
    Store->>Store: login(email, password), see 3.3
    Store-->>Page: user
    Page->>U: redirect: roles.homeFor(role) for STAFF/ADMIN, else ?next or /
  end
```

The account is created already confirmed and no email is sent, so the customer can order straight away. Direct sign-ups with the publishable key (`supabase.auth.signUp`) also get a CUSTOMER profile from the same trigger, but they skip the API's validation. That is why [DEPLOYMENT.md](DEPLOYMENT.md#production-first-time-setup) recommends turning off public sign-ups on hosted projects.

### 3.3 Sign-in

```mermaid
sequenceDiagram
  autonumber
  actor U as Customer or staff
  participant Page as Login page
  participant Store as authStore
  participant SB as supabase-js
  participant Auth as Supabase Auth
  participant API as Express API
  participant DB as Postgres

  U->>Page: email + password
  Page->>Store: login(email, password)
  Store->>SB: auth.signInWithPassword
  SB->>Auth: POST /auth/v1/token?grant_type=password
  alt wrong email or password
    Auth-->>SB: 400 invalid_credentials
    SB-->>Page: ApiError 401 "Incorrect email or password."
  else too many attempts
    Auth-->>SB: 429 over_request_rate_limit
    SB-->>Page: ApiError "Too many attempts..."
  else network failure
    SB-->>Page: ApiError UNREACHABLE
  else success
    Auth-->>SB: session (1 hour access token + refresh token)
    SB->>SB: save session to localStorage
    SB-->>Store: SIGNED_IN event → token mirrored
    Store->>API: GET /api/auth/me
    API->>DB: select profiles (id, role, ...)
    alt profile loaded
      API-->>Store: { user }
      Store->>Store: set user + token
      Store-->>Page: user
      Page->>U: roles.homeFor(role) for STAFF/ADMIN, CUSTOMER → ?next or /
    else profile could not be loaded
      Store->>Store: clearSession() so no half-signed-in state remains
      Store-->>Page: error message
    end
  end
```

### 3.4 An authenticated API call

Every call to a protected route follows this path, on the client and then on the server.

```mermaid
sequenceDiagram
  autonumber
  participant C as services/api.ts request()
  participant SB as supabase-js
  participant Auth as Supabase Auth
  participant MW as requireAuth
  participant V as @supabase/server
  participant J as JWKS endpoint
  participant DB as Postgres
  participant H as route handler

  C->>SB: auth.getSession()
  opt access token expired
    SB->>Auth: refresh_token grant
  end
  SB-->>C: access_token
  C->>MW: fetch /api/... with Authorization: Bearer token
  MW->>MW: readBearerToken()
  alt no token
    MW-->>C: 401 UNAUTHORIZED "Please sign in to continue."
  end
  MW->>V: verifyCredentials(token, auth user, audience authenticated)
  V->>J: fetch signing keys (first call, then cached in memory)
  alt JWKS unreachable or misconfigured
    V-->>MW: AuthError 5xx
    MW-->>C: 500 INTERNAL (server problem, not the caller's)
  else bad signature, expired, other project, not a user token
    V-->>MW: AuthError 401
    MW-->>C: 401 "Your session has expired. Please sign in again."
  else valid
    V-->>MW: userClaims.id
    MW->>DB: select id, role from profiles where id = sub
    alt no profile (account deleted)
      MW-->>C: 401 "That account no longer exists..."
    else found
      MW->>H: req.user = { id, role }, next()
      H-->>C: 2xx JSON
    end
  end
  opt response is 401 and a token was sent
    C->>C: authStore.clearSession() → signOut(local)
    Note over C: RequireAuth now redirects to /login?next=...
  end
```

The role is read from `profiles` on every request, so promoting or demoting staff takes effect on the next request, without anyone signing in again.

### 3.5 Token refresh and sign-out

```mermaid
sequenceDiagram
  autonumber
  participant SB as supabase-js
  participant Auth as Supabase Auth
  participant Store as authStore
  participant UI as Profile / Staff header

  loop while a tab is open (autoRefreshToken)
    SB->>Auth: refresh shortly before the 1-hour expiry
    Auth-->>SB: new session
    SB-->>Store: TOKEN_REFRESHED → token updated
  end

  UI->>Store: logout()
  Store->>Store: user = null, token = null (UI updates at once)
  Store->>SB: signOut(scope local)
  SB->>Auth: POST /auth/v1/logout?scope=local (revokes this session's refresh token)
  SB->>SB: remove session from localStorage
  SB-->>Store: SIGNED_OUT (already cleared)
  UI->>UI: navigate to / (customer) or /login (staff)
  Note over SB,Store: A sign-out in another tab fires SIGNED_OUT here too, clearing this tab
```

### 3.6 Route guards

```mermaid
flowchart TD
  Nav["Navigate to a route"] --> Which{"Route"}
  Which -->|"/ , /menu, /cart, /profile, /login, /register"| Open["Render (public)"]
  Which -->|"/checkout, /orders, /orders/:id, /orders/:id/success"| RA{"RequireAuth:<br/>token in authStore?"}
  RA -->|"no"| ToLogin["Redirect /login?next=current path"]
  RA -->|"yes"| Render["Render page<br/>(API still verifies the token)"]
  Which -->|"/staff"| RS{"RequireRole role=STAFF:<br/>token?"}
  RS -->|"no"| ToLogin
  RS -->|"yes"| RoleS{"user.role = STAFF?"}
  RoleS -->|"no"| Home["Redirect /"]
  RoleS -->|"yes"| Board["Staff dashboard"]
  Which -->|"/admin"| RAd{"RequireRole role=ADMIN:<br/>token?"}
  RAd -->|"no"| ToLogin
  RAd -->|"yes"| RoleA{"user.role = ADMIN?"}
  RoleA -->|"no"| Home
  RoleA -->|"yes"| AdminPage["Admin dashboard"]
  ToLogin --> LoginDone["After sign-in: roles.homeFor(role)<br/>(STAFF → /staff, ADMIN → /admin),<br/>else the ?next path if it is same-site, else /"]
```

The guards only improve the UX. The API enforces the same rules with `requireAuth`, `requireStaff` and
`requireAdmin`.

---

## 4. Browsing the store and menu

Code: [client/src/features/menu/useStore.ts](../client/src/features/menu/useStore.ts), [client/src/features/menu/useMenu.ts](../client/src/features/menu/useMenu.ts), [server/src/services/store.service.ts](../server/src/services/store.service.ts), [server/src/services/menu.service.ts](../server/src/services/menu.service.ts).

```mermaid
sequenceDiagram
  autonumber
  actor U as Visitor
  participant Home as Home page
  participant Menu as Menu / Cart / Checkout page
  participant Cart as cartStore
  participant API as Express API
  participant DB as Postgres

  U->>Home: open /
  Home->>API: GET /api/store (no token)
  API->>DB: select * from stores limit 1
  alt no store row
    API-->>Home: 404 "The store has not been set up yet. Run npm run seed"
  else
    API-->>Home: { store } open state, prep time 10-15 min
  end

  U->>Menu: View Menu
  Menu->>API: GET /api/menu (no token), loaded once per visit
  API->>DB: stores limit 1
  API->>DB: menu_items where store_id order by sort_order
  API->>API: toMenuItemDto: isAvailable = is_available AND (stock null OR stock > 0)<br/>popular = is_popular items<br/>categories grouped by first appearance
  API-->>Menu: { store, popular, categories }
  Menu->>Cart: syncAvailability(items)
  Note over Cart: each cart line's maxQuantity is refreshed from the live menu<br/>(prices, names and photos are never changed)
  Menu->>U: cards with Only N left (N ≤ 5), Sold out, Unavailable
```

The menu is public and is not polled. The Cart and Checkout pages load it again on arrival, so stock limits are fresh right before paying.

---

## 5. Cart

The cart lives only in the browser (`fp_cart` in localStorage) and holds no server state. Code: [client/src/features/cart/cartStore.ts](../client/src/features/cart/cartStore.ts), [client/src/features/cart/cartRules.ts](../client/src/features/cart/cartRules.ts).

### 5.1 Adding and changing quantities

```mermaid
flowchart TD
  Add["add(item, qty)"] --> Avail["maxQuantity = item.isAvailable ? item.stockQuantity : 0<br/>(null = not tracked)"]
  Avail --> Limit["limit = min(10, maxQuantity or 10)"]
  Limit --> Zero{"limit ≤ 0?"}
  Zero -->|"yes"| NoOp["Ignore: sold out / unavailable"]
  Zero -->|"no"| Exists{"Line already in cart?"}
  Exists -->|"no"| NewLine["Append line: name, unitPrice, imageUrl,<br/>quantity = min(limit, qty), maxQuantity"]
  Exists -->|"yes"| Over{"existing quantity ≥ limit?"}
  Over -->|"yes"| Keep["Leave as is (the cart flags it)"]
  Over -->|"no"| TopUp["quantity = min(limit, existing + qty)"]

  Inc["increment(id)"] --> AtLimit{"quantity ≥ lineLimit?"}
  AtLimit -->|"yes"| Shake["No change: stepper shakes,<br/>caption Only N available / Max 10 per order"]
  AtLimit -->|"no"| Plus["quantity + 1"]
  Dec["decrement(id)"] --> One{"quantity ≤ 1?"}
  One -->|"yes"| Remove["Remove line"]
  One -->|"no"| Minus["quantity - 1"]
```

Count and total are always derived (`selectCount`, `selectTotal`) and never stored. The prices shown are the ones captured when the item was added. The server re-prices every line from the database at checkout.

### 5.2 A cart line going stale

```mermaid
stateDiagram-v2
  [*] --> OK: added within limit
  OK --> OverLimit: menu reload or checkout refusal says fewer are left
  OK --> SoldOut: stock hit 0, switched off, or item removed from the menu
  OverLimit --> OK: Fix trims quantity to what is left
  OverLimit --> OK: customer lowers the quantity
  SoldOut --> [*]: Fix or Remove deletes the line
  OverLimit --> SoldOut: stock runs out meanwhile
  OK --> [*]: removed, cleared, or ordered
```

`lineProblem()` computes these states from `quantity` and `maxQuantity`. A flagged line gets a paprika ring and a label, and it blocks the Pay button with a sentence that names the item.

---

## 6. Checkout and placing an order

Code: [client/src/pages/Checkout.tsx](../client/src/pages/Checkout.tsx), [server/src/schemas/order.schema.ts](../server/src/schemas/order.schema.ts), [server/src/services/order.service.ts](../server/src/services/order.service.ts), `place_order` in [the migration](../server/supabase/migrations/20260925120000_init.sql).

### 6.1 End to end

```mermaid
sequenceDiagram
  autonumber
  actor U as Customer
  participant CO as Checkout page
  participant Cart as cartStore
  participant API as Express API
  participant Svc as order.service
  participant Pay as payment.service
  participant DB as Postgres

  U->>CO: Proceed to Checkout (RequireAuth: signed in)
  CO->>API: GET /api/menu (refresh stock limits)
  API-->>CO: menu
  CO->>Cart: syncAvailability
  alt some line is flagged
    CO->>U: Pay blocked, error names the item, Fix cart / Back to cart
  end
  U->>CO: Pay (name, optional phone, optional note)
  CO->>CO: validate name, phone, note
  CO->>API: POST /api/orders { items: [{menuItemId, quantity}], customerName, customerPhone, note }
  API->>API: requireAuth (3.4)
  API->>API: validate(createOrderSchema)<br/>1-30 lines, quantity ≥ 1 whole number,<br/>duplicate items merged, unknown keys such as price dropped
  API->>Svc: createOrder(user, input)
  par one round trip: the reads do not depend on each other
    Svc->>DB: the order this idempotency key already placed, if any
  and
    Svc->>DB: stores limit 1
  and
    Svc->>DB: profiles.name for this user (when customerName is not sent)
  and
    Svc->>DB: menu_items where id in (ids that are UUIDs)
  end
  alt the key already placed an order
    Svc-->>CO: 201 that order (409 IDEMPOTENCY_KEY_REUSED if the request differs)
  else store is closed
    Svc-->>CO: 400 STORE_CLOSED
  end
  Svc->>Svc: priceLines(): per line, in cart order
  alt item missing (or a non-UUID id from an old cart)
    Svc-->>CO: 400 ITEM_NOT_FOUND { menuItemId, available 0 }
  else is_available = false
    Svc-->>CO: 400 ITEM_UNAVAILABLE { menuItemId, name, available 0 }
  else quantity > 10
    Svc-->>CO: 400 VALIDATION_ERROR "You can order at most 10 of ..."
  end
  Svc->>Svc: total = Σ unit_price × quantity (prices from the database)
  Svc->>Pay: simulatePayment(total)
  Pay-->>Svc: PAID
  Svc->>DB: rpc place_order(user, store, name, PAID, lines, phone, note), one transaction (6.2)
  alt not enough stock
    DB-->>Svc: raise INSUFFICIENT_STOCK { menuItemId, name, available }
    Svc-->>CO: 400 INSUFFICIENT_STOCK "Only 1 Cheese Toast left..." or "... just sold out."
  else placed
    DB-->>Svc: order id
    Svc->>DB: select order + stores(id, name) + order_items(... menu_items(image_url)) by line_number
    Svc-->>API: order row
    API-->>CO: 201 { order } (order number, PAID, PLACED, estimatedReadyAt = created + 15 min)
    CO->>CO: flushSync: show green Paid state + receipt
    CO->>Cart: clear()
    CO->>CO: wait 500 ms
    CO->>U: navigate /orders/:id/success (order passed in router state)
  end
```

### 6.2 Inside `place_order`

One function call is one Postgres transaction. Any `raise` rolls back every stock decrement and insert made before it.

```mermaid
flowchart TD
  Start(["place_order(p_user_id, p_store_id, p_customer_name,<br/>p_payment_status, p_lines, p_customer_phone, p_note)"]) --> Loop["For each line, ordered by menu_item_id<br/>(same lock order for concurrent orders, avoiding deadlocks)"]
  Loop --> Dec["UPDATE menu_items SET stock_quantity = stock_quantity - qty<br/>WHERE id = line AND stock_quantity ≥ qty"]
  Dec --> Found{"Row updated?"}
  Found -->|"yes"| Next{"More lines?"}
  Found -->|"no"| Look["SELECT stock_quantity for that id"]
  Look --> Why{"Row exists with stock NULL?"}
  Why -->|"yes: not stock-tracked"| Next
  Why -->|"no: too few left, or item gone"| Raise["RAISE 'INSUFFICIENT_STOCK'<br/>detail = { menuItemId, name, available }<br/>→ whole transaction rolled back"]
  Next -->|"yes"| Loop
  Next -->|"no"| InsOrder["INSERT orders: total = Σ unit_price × quantity,<br/>status PLACED, payment status,<br/>estimated_ready_at = now() + store.prep_time_max_minutes,<br/>order_number from identity (starts at 1001)"]
  InsOrder --> InsItems["INSERT order_items with line_number = cart position,<br/>snapshot name + unit_price, line_total"]
  InsItems --> Ret(["RETURN order id"])
```

### 6.3 Recovering from a refusal in the browser

```mermaid
flowchart TD
  Err["POST /api/orders fails"] --> Kind{"error.code"}
  Kind -->|"INSUFFICIENT_STOCK, ITEM_UNAVAILABLE, ITEM_NOT_FOUND"| Record["cartStore.setAvailability(details.menuItemId, details.available)"]
  Record --> Flag["That line now has a problem:<br/>ringed in paprika, labelled Only N left / Sold out"]
  Flag --> Banner["Banner names the item, Pay is blocked"]
  Banner --> Fix{"Customer taps"}
  Fix -->|"Fix cart"| Trim["fix(): trim to what is left, or remove when sold out"]
  Trim --> Retry["Pay again"]
  Fix -->|"Back to cart"| CartPage["Cart page, same flags"]
  Kind -->|"STORE_CLOSED, VALIDATION_ERROR, UNREACHABLE, INTERNAL"| Plain["Show the message, cart unchanged, Pay can be retried"]
  Kind -->|"401"| Session["Session cleared → redirected to sign in, cart kept"]
```

### 6.4 Two customers racing for the last unit

```mermaid
sequenceDiagram
  autonumber
  actor A as Customer A
  actor B as Customer B
  participant API as Express API
  participant DB as Postgres (place_order)

  Note over DB: Cheese Toast stock_quantity = 1
  par both pay at the same moment
    A->>API: POST /api/orders (Cheese Toast × 1)
    API->>DB: place_order
    DB->>DB: UPDATE ... WHERE stock ≥ 1 → row locked, stock 0
  and
    B->>API: POST /api/orders (Cheese Toast × 1)
    API->>DB: place_order
    DB->>DB: UPDATE waits for A's row lock
  end
  DB-->>API: A commits → order id
  API-->>A: 201 order placed
  DB->>DB: B's UPDATE re-checks: stock 0 ≥ 1 is false → 0 rows
  DB->>DB: SELECT stock = 0 → RAISE INSUFFICIENT_STOCK (available 0)
  DB-->>API: B rolled back
  API-->>B: 400 "Cheese Toast just sold out."
  Note over A,B: Exactly one order exists, stock is 0, never negative (CHECK stock_quantity ≥ 0)
```

---

## 7. Customer order tracking, history and Order Again

Code: [client/src/lib/useResource.ts](../client/src/lib/useResource.ts), [client/src/features/orders/useOrder.ts](../client/src/features/orders/useOrder.ts), [client/src/features/orders/useOrders.ts](../client/src/features/orders/useOrders.ts), [client/src/features/cart/useReorder.ts](../client/src/features/cart/useReorder.ts).

### 7.1 Success screen and live tracking

```mermaid
sequenceDiagram
  autonumber
  actor U as Customer
  participant P as Success / Order page
  participant R as useOrder → useResource
  participant API as Express API
  participant DB as Postgres

  U->>P: /orders/:id/success (order in router state) or /orders/:id
  P->>R: useOrder(id, initialData)
  R-->>P: render the passed order at once (success page)
  R->>API: GET /api/orders/:id
  API->>API: requireAuth, id must be a UUID (else 404)
  API->>DB: order with details, where id AND (user_id = caller unless STAFF)
  alt not found or someone else's order
    API-->>R: 404 "Order not found." (the two look identical, so ids cannot be probed)
  else
    API-->>R: { order }
  end
  loop every 4 s while status is PLACED, PREPARING or READY
    R->>API: GET /api/orders/:id
    API-->>R: { order }
    R-->>P: re-render, tracker and hero keyed on status
  end
  Note over R: stops at COLLECTED or CANCELLED<br/>pauses while the tab is hidden, fetches immediately when visible again
  P->>U: Placed → Preparing → Ready (Your order is ready!) → Order collected!
```

### 7.2 The polling engine (`useResource`)

```mermaid
flowchart TD
  Mount["Mount or key change"] --> Run["run(): fetch"]
  Run --> Ok{"Success?"}
  Ok -->|"yes"| Stale{"mutate() called since this fetch started?"}
  Stale -->|"yes"| Drop["Ignore result (a local change is newer)"]
  Stale -->|"no"| Save["data = result, error = null, updatedAt = now"]
  Ok -->|"no"| Keep["keep last data, set error<br/>(AbortError ignored)"]
  Save --> Sched
  Drop --> Sched
  Keep --> Sched
  Sched{"data present, pollInterval set,<br/>tab visible?"} -->|"no"| Idle["Stop scheduling"]
  Sched -->|"yes"| Delay{"pollInterval(data)"}
  Delay -->|"null (e.g. terminal order)"| Idle
  Delay -->|"ms"| Timer["setTimeout(run, ms)"] --> Run
  Vis["visibilitychange → visible"] --> Run
  Idle -.-> Vis
```

| Hook                              | Endpoint                          | Interval                         |
| --------------------------------- | --------------------------------- | -------------------------------- |
| `useOrder`                        | `GET /api/orders/:id`             | 4 s until COLLECTED or CANCELLED |
| `useOrders` (customer Orders tab) | `GET /api/orders`                 | 8 s                              |
| `useOrders` (staff board)         | `GET /api/orders`                 | 4 s                              |
| `useMenu`, `useStore`             | `GET /api/menu`, `GET /api/store` | once per mount                   |

### 7.3 Order history

```mermaid
sequenceDiagram
  autonumber
  participant O as Orders page
  participant API as Express API
  participant DB as Postgres

  loop every 8 s (paused while hidden)
    O->>API: GET /api/orders
    API->>DB: orders with details where user_id = caller<br/>order by created_at desc, lines by line_number
    DB-->>API: rows
    API-->>O: { orders }
  end
  O->>O: split into In progress / Past orders
```

### 7.4 Order Again

```mermaid
flowchart TD
  Tap["Order Again on an order"] --> Fetch["GET /api/menu (current prices and stock)"]
  Fetch -->|"fails"| FailNote["Notice: couldn't load the menu, nothing added"]
  Fetch -->|"ok"| Sync["cartStore.syncAvailability(menu items)"]
  Sync --> Each["For each line of the old order"]
  Each --> OnMenu{"Still on the menu?"}
  OnMenu -->|"no"| N1["Notice: X is no longer on the menu, skipped"]
  OnMenu -->|"yes"| Avail{"available = 0?"}
  Avail -->|"yes"| N2["Notice: X is sold out, skipped"]
  Avail -->|"no"| Room["added = min(wanted, limit - already in cart)"]
  Room --> AddIt{"added > 0?"}
  AddIt -->|"yes"| Add["cart.add(item, added) at the CURRENT price"]
  AddIt -->|"no"| N3["Notice: X already in your cart at the limit"]
  Add --> Short{"added < wanted?"}
  Short -->|"yes"| N4["Notice: X only N left / max 10 per order, added M"]
  Short -->|"no"| Done
  N1 --> Done
  N2 --> Done
  N3 --> Done
  N4 --> Done
  FailNote --> Go
  Done["Next line, or finish"] --> Go["navigate /cart with notices in router state<br/>(gold heads-up list, dismissible)"]
```

---

## 8. Staff dashboard and order status changes

Code: [client/src/pages/StaffDashboard.tsx](../client/src/pages/StaffDashboard.tsx), [client/src/features/orders/orderStatus.ts](../client/src/features/orders/orderStatus.ts), `updateOrderStatus` in [order.service.ts](../server/src/services/order.service.ts), `update_order_status` in [the migration](../server/supabase/migrations/20260925120000_init.sql).

### 8.1 The board

```mermaid
sequenceDiagram
  autonumber
  actor S as Staff
  participant B as Staff dashboard
  participant API as Express API
  participant DB as Postgres

  S->>B: /staff (RequireRole role="STAFF")
  B->>API: GET /api/store (name for the header)
  loop every 4 s (paused while hidden)
    B->>API: GET /api/orders (requireAuth, role STAFF)
    API->>DB: newest staffOrderListLimit orders across all customers (site setting, default 100), created_at desc
    API-->>B: { orders }
    B->>B: counts per filter: All, New (PLACED), Preparing, Ready, Done (COLLECTED + CANCELLED)
    B->>B: sort: active oldest-first (fair queue), finished newest-first
    B->>B: flash orders not seen since the board opened
    B->>B: header clock + last updated, offline badge when a poll fails
  end
```

### 8.2 Changing a status

```mermaid
sequenceDiagram
  autonumber
  actor S as Staff
  participant B as Staff dashboard
  participant API as Express API
  participant Svc as order.service
  participant DB as Postgres

  S->>B: Start Preparing / Mark Ready / Mark Collected / Cancel order
  B->>B: mark card pending, clear its old error
  B->>API: PATCH /api/orders/:id/status { status }
  API->>API: requireAuth → requireStaff (else 403 FORBIDDEN)
  API->>API: validate: status is one of the 5 enum values (else 400)
  API->>Svc: updateOrderStatus(id, next)
  Svc->>Svc: id must be a UUID (else 404)
  Svc->>Svc: from = every status whose ALLOWED_TRANSITIONS include next
  Svc->>DB: rpc update_order_status(id, next, from), one transaction (8.3)
  alt order does not exist
    DB-->>Svc: raise NOT_FOUND
    Svc-->>B: 404
  else status already moved on
    DB-->>Svc: raise INVALID_STATUS_TRANSITION { orderNumber, current status }
    Svc-->>B: 409 "Order #1001 cannot move from READY to PREPARING."
    B->>B: show the message on the card, reload the list at once
  else updated
    Svc->>DB: select the order with details
    Svc-->>B: 200 { order }
    B->>B: mutate(): replace the card in the list
    opt new status no longer matches the active filter
      B->>B: 220 ms fade-out, then the card leaves
    end
  end
  Note over B: The customer's tracking page picks up the change on its next 4 s poll
```

### 8.3 Inside `update_order_status`, and two staff pressing at once

```mermaid
sequenceDiagram
  autonumber
  actor S1 as Staff device 1
  actor S2 as Staff device 2
  participant API as Express API
  participant DB as Postgres

  Note over DB: order 1001 is PLACED
  par both press Start Preparing
    S1->>API: PATCH status PREPARING
    API->>DB: UPDATE orders SET status = PREPARING<br/>WHERE id = X AND status = ANY(PLACED)
    DB->>DB: 1 row, locked until commit
  and
    S2->>API: PATCH status PREPARING
    API->>DB: same UPDATE, waits for the lock
  end
  DB-->>API: device 1 commits (updated_at set by trigger)
  API-->>S1: 200 { order PREPARING }
  DB->>DB: device 2 re-checks: status is now PREPARING, not in (PLACED) → 0 rows
  DB->>DB: SELECT status, order_number → RAISE INVALID_STATUS_TRANSITION
  API-->>S2: 409 "Order #1001 cannot move from PREPARING to PREPARING."

  Note over S1,DB: Cancelling (from PLACED or PREPARING) runs in the same transaction:
  S1->>API: PATCH status CANCELLED
  API->>DB: UPDATE ... WHERE status = ANY(PLACED, PREPARING)
  DB->>DB: UPDATE menu_items SET stock += SUM(order_items.quantity)<br/>WHERE stock_quantity IS NOT NULL (untracked items untouched)
  DB-->>API: committed, stock restored exactly once
  API-->>S1: 200 { order CANCELLED }
```

### 8.4 Order lifecycle

```mermaid
stateDiagram-v2
  [*] --> PLACED: customer pays (place_order), payment PAID
  PLACED --> PREPARING: staff Start Preparing
  PREPARING --> READY: staff Mark Ready
  READY --> COLLECTED: staff Mark Collected (customer picked up)
  PLACED --> CANCELLED: staff Cancel, stock restored
  PREPARING --> CANCELLED: staff Cancel, stock restored
  COLLECTED --> [*]
  CANCELLED --> [*]
```

`ALLOWED_TRANSITIONS` in [order.service.ts](../server/src/services/order.service.ts) is the single source of truth for these transitions. Anything not drawn here is a 409. The client's `STATUS_META` only decides which button to show.

### 8.5 Stock for one tracked item

```mermaid
stateDiagram-v2
  [*] --> InStock: seed or dashboard sets stock_quantity to N
  InStock --> InStock: order takes k (k ≤ stock), stock - k
  InStock --> LowStock: 1 to 5 left, menu shows Only N left
  LowStock --> InStock: a cancellation returns units
  LowStock --> SoldOut: last unit ordered, stock 0
  SoldOut --> LowStock: a cancellation returns units
  SoldOut --> SoldOut: order refused, INSUFFICIENT_STOCK
  InStock --> Untracked: stock_quantity set to NULL
  Untracked --> Untracked: orders never touch stock, only the 10 per order cap applies
```

---

## 9. Server request pipeline and error handling

Code: [server/src/app.ts](../server/src/app.ts), [server/src/routes/](../server/src/routes/), [server/src/middleware/](../server/src/middleware/), [server/src/utils/serializers.ts](../server/src/utils/serializers.ts). [server/src/server.ts](../server/src/server.ts) only calls `createApp()` from `app.ts`, listens on `PORT`, and on `SIGINT`/`SIGTERM` closes the server and flushes the logger (`utils/shutdown.ts`, shared with the worker). Module-by-module detail is in [BACKEND_STRUCTURE.md](BACKEND_STRUCTURE.md).

### 9.1 Pipeline

```mermaid
flowchart TD
  Req["HTTP request"] --> Pino["pino-http<br/>request id → x-request-id header, req.log"]
  Pino --> Cors["cors(CLIENT_ORIGIN)"]
  Cors --> Json["express.json (100 kB limit)"]
  Json --> Router{"/api router"}
  Router -->|"GET /health"| Health["{ ok: true }"]
  Router -->|"GET /store, GET /menu"| Public["controller → service"]
  Router -->|"POST /auth/register"| ValReg["validate(registerSchema)"] --> RegCtl["auth.controller.register"]
  Router -->|"GET /auth/me"| AuthMe["requireAuth"] --> MeCtl["auth.controller.me"]
  Router -->|"/orders/*"| AuthO["requireAuth (all order routes)"]
  AuthO -->|"POST /"| ValC["validate(createOrderSchema)"] --> CCtl["createOrder"]
  AuthO -->|"GET /"| ValQ["validate(listOrdersQuerySchema, query)"] --> LCtl["listOrders"]
  AuthO -->|"GET /:id"| GCtl["getOrder"]
  AuthO -->|"PATCH /:id/status"| Staff["requireStaff"] --> ValS["validate(updateOrderStatusSchema)"] --> UCtl["updateOrderStatus"]
  Public --> Svc["services → supabaseAdmin (PostgREST / rpc) → Postgres"]
  RegCtl --> Svc
  MeCtl --> Svc
  CCtl --> Svc
  LCtl --> Svc
  GCtl --> Svc
  UCtl --> Svc
  Svc --> Ser["serializers: snake_case rows → camelCase DTOs,<br/>timestamps → ISO 8601"]
  Ser --> Res["JSON response"]
  Router -->|"no match"| NF["notFoundHandler → 404 NOT_FOUND"]
  Svc -. "throws" .-> EH["errorHandler (9.2)"]
  AuthO -. "throws" .-> EH
  ValC -. "throws" .-> EH
```

`validate()` removes NUL characters from every string, parses with zod, and replaces `req.body` or `req.query` with the parsed value, so handlers only ever see validated, stripped data.

`pino-http` writes one access line per request: `debug` for successful reads, `info` for writes and failures. The error handler is the one place a failed request is logged (see [LOGGING.md](LOGGING.md)).

### 9.2 Error mapping

Every error reaches the client as `{ "error": { "code", "message", "details?" } }`, and the message is safe to show to the user.

```mermaid
flowchart TD
  E["Thrown error"] --> A{"AppError?"}
  A -->|"yes"| A1["its status + code + message (+ details for cart-line errors)"]
  A -->|"no"| Z{"ZodError?"}
  Z -->|"yes"| Z1["400 VALIDATION_ERROR, first issue as a sentence"]
  Z -->|"no"| U{"URIError?"}
  U -->|"yes"| U1["400 BAD_REQUEST malformed URL"]
  U -->|"no"| P{"PostgrestError?"}
  P -->|"22001"| P1["400 One of the values is too long"]
  P -->|"22021 / 22P05"| P2["400 Invalid characters in input"]
  P -->|"other"| I["500 INTERNAL, logged with stack"]
  P -->|"not a PostgrestError"| H{"body-parser error?"}
  H -->|"entity.too.large"| H1["413 PAYLOAD_TOO_LARGE"]
  H -->|"entity.parse.failed"| H2["400 VALIDATION_ERROR malformed body"]
  H -->|"other 4xx status"| H3["that status, BAD_REQUEST"]
  H -->|"none"| I
```

Database functions report expected failures as `raise exception` with the API code as the message and a JSON detail. The service turns those into `AppError`s before the error handler sees them:

| Raised by             | Message                                                  | Becomes                                 |
| --------------------- | -------------------------------------------------------- | --------------------------------------- |
| `place_order`         | `INSUFFICIENT_STOCK` + `{ menuItemId, name, available }` | 400 `INSUFFICIENT_STOCK` with `details` |
| `update_order_status` | `NOT_FOUND`                                              | 404 `NOT_FOUND`                         |
| `update_order_status` | `INVALID_STATUS_TRANSITION` + `{ orderNumber, status }`  | 409 `INVALID_STATUS_TRANSITION`         |

Every code, status and message: [API.md](API.md#errors).

---

## 10. Data model

Schema: [server/supabase/migrations/20260925120000_init.sql](../server/supabase/migrations/20260925120000_init.sql). Generated types: [server/src/types/database.ts](../server/src/types/database.ts) (`npm run db:types`).

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : "on_auth_user_created trigger"
  PROFILES o|--o| SITE_SETTINGS : updated_by
  PROFILES ||--o{ ORDERS : places
  STORES ||--o{ MENU_ITEMS : sells
  STORES ||--o{ ORDERS : receives
  ORDERS ||--|{ ORDER_ITEMS : contains
  MENU_ITEMS ||--o{ ORDER_ITEMS : "snapshotted in"

  AUTH_USERS {
    uuid id PK
    text email
    text encrypted_password
    jsonb raw_user_meta_data "name, phone at sign-up"
  }
  PROFILES {
    uuid id PK "FK auth.users, cascade delete"
    text name
    text email UK "kept in sync by trigger"
    text phone
    user_role role "CUSTOMER, STAFF or ADMIN"
    timestamptz created_at
  }
  SITE_SETTINGS {
    boolean id PK "always true"
    int customer_order_history_limit
    int staff_order_list_limit
    timestamptz updated_at
    uuid updated_by FK "nullable, ON DELETE SET NULL"
  }
  STORES {
    uuid id PK
    text name
    text tagline
    text description
    text image_url
    boolean is_open
    int prep_time_min_minutes
    int prep_time_max_minutes "drives estimated_ready_at"
  }
  MENU_ITEMS {
    uuid id PK
    uuid store_id FK
    text category
    text name
    text description
    int price "whole rupees, at least 0"
    text image_url
    boolean is_available
    boolean is_popular
    int sort_order
    int stock_quantity "NULL = untracked, never negative"
  }
  ORDERS {
    uuid id PK
    int order_number UK "identity from 1001"
    uuid user_id FK
    uuid store_id FK
    text customer_name
    text customer_phone
    text note
    int total "computed in place_order"
    payment_status payment_status "PENDING or PAID"
    order_status status "PLACED to COLLECTED or CANCELLED"
    timestamptz estimated_ready_at
    timestamptz created_at
    timestamptz updated_at "orders_set_updated_at trigger"
  }
  ORDER_ITEMS {
    uuid id PK
    uuid order_id FK "cascade delete"
    int line_number "cart order, unique per order"
    uuid menu_item_id FK
    text name "snapshot"
    int unit_price "snapshot"
    int quantity "at least 1"
    int line_total
  }
```

Five tables: `profiles` (one per Auth user, holds the role), `stores` (one row in V0), `menu_items` (with optional tracked stock), `orders` and `order_items` (name and price snapshotted at order time). Columns with their types, defaults and constraints, the indexes, triggers and the `place_order` / `update_order_status` / `reset_demo_orders` functions are in [SCHEMA.md](SCHEMA.md).

---

## 11. Access control

The browser's publishable key can touch nothing: RLS is on for every table with no policies, all table privileges are revoked from `anon` and `authenticated`, and only `service_role` (the API's secret key) may execute `place_order`, `update_order_status` and `reset_demo_orders`. Because the API's `supabaseAdmin` client bypasses RLS, the services decide who sees what and scope every per-user query themselves: customers see only their own orders, staff see all, and someone else's order returns the same 404 as a missing one. The role is only ever `profiles.role`, never the token or `user_metadata`. The access diagram, the route matrix and the client guards are in [PERMISSIONS.md](PERMISSIONS.md).

---

## 12. Operations

`./start.sh` starts the API and web app for `local` or `staging` in the matching Vite mode and refuses `production`. `npm run seed` resets the demo data (local and staging) or, with `--production`, loads the store and menu into an empty production project. Schema changes are append-only migrations in `server/supabase/migrations/`, rebuilt locally with `db:reset` and applied to hosted projects with `db:push:staging` / `db:push:production`. The flow diagrams for all four (`start.sh`, seeding, promoting a migration, first-time production setup), the environment variables and the build steps are in [DEPLOYMENT.md](DEPLOYMENT.md).
