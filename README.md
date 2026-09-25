# Food Pickup — V0

Order ahead from **Campus Cafe**, pay in a tap (simulated), and collect your food at the counter without standing in the ordering queue.
One shop, one staff screen, real-time-enough status updates. The API and web app run on localhost; data and sign-in live in Supabase (a local Docker stack for development, plus hosted **staging** and **production** projects — see [Environments](#environments)).

- **Customer app:** http://localhost:5173
- **Staff dashboard:** http://localhost:5173/staff
- **API:** http://localhost:8000/api (health check: http://localhost:8000/api/health)

## Prerequisites

- **Node 20+** (`node --version`; built and tested with Node 26)
- **Docker** (Docker Desktop, OrbStack or Colima) for the local Supabase stack. Not needed if you develop against staging.

## Quick start

The one-time setup is three commands; after that `./start.sh` runs everything.

**1. Install and start the local Supabase stack**

```bash
cd server && npm install && npm run db:start && cd ..
```

`db:start` runs Supabase (Postgres, Auth, the REST API) in Docker and applies everything in `server/supabase/migrations/`. The first run downloads the images and takes a few minutes. It prints the local URL and keys; they are fixed defaults and already filled in below.

**2. Configure the server**

```bash
cp server/.env.example server/.env
```

The defaults point at the local stack (`APP_ENV=local`) and need no editing. To work against staging instead, see [Environments](#environments).

**3. Run it**

```bash
./start.sh --seed          # first time: loads Campus Cafe, 11 menu items and the two test accounts
./start.sh                 # every time after that
```

It prints the URLs and logins when both servers answer. Press **Ctrl+C** once to stop both. The Supabase stack keeps running in Docker; stop it with `cd server && npm run db:stop`.

### What `start.sh` does

- Reads `APP_ENV` from `server/.env` and starts the web app in the matching mode (`local` → `npm run dev`, `staging` → `npm run dev:staging`), so the browser signs in to the same Supabase project the API uses. Refuses `APP_ENV=production`.
- Stops with a clear message if `server/.env` is missing, or (for `local`) the Supabase stack is not running.
- Runs `npm install` in `server/` and `client/` if `node_modules` is missing.
- **Frees ports 8000 and 5173 first** — anything still listening on them (a stray `npm run dev`, an earlier `start.sh`) is killed. Don't run it while another copy of the project is deliberately serving those ports.
- `--seed` runs `npm run seed` before starting (see [Re-seeding wipes orders](#re-seeding-wipes-orders)).
- Starts the API (`tsx watch`, auto-reloads on server edits) and the web app (Vite, hot reloads client edits). Their output goes to **`.logs/server.log`** and **`.logs/client.log`** (gitignored) — look there when something misbehaves.
- Waits until `GET /api/health`, the web app and `GET /api/menu` all return 200. If the API is up but the menu isn't, it says **"Database looks empty or unreachable — run ./start.sh --seed"** and stops.
- Does *not* start Supabase or apply migrations — that is step 1 above (or `npm run db:push:staging` for staging).

### Manual start (two terminals)

If you would rather see the servers' output directly:

```bash
# terminal 1 — API on http://localhost:8000/api
cd server
npm run seed               # first time only
npm run dev

# terminal 2 — web app on http://localhost:5173
cd client
npm install                # first time only
npm run dev                # or `npm run dev:staging` when server/.env has APP_ENV=staging
```

The Vite dev server proxies `/api/*` to `http://localhost:8000`. The only client configuration is which Supabase project to sign in to, in `client/.env.<mode>` (see [Environments](#environments)).

## Test accounts

| Role     | Email                    | Password   |
|----------|--------------------------|------------|
| Customer | `anishka@example.com`    | `test1234` |
| Staff    | `staff@campuscafe.local` | `staff123` |

Or tap **Create an account** in the app; new accounts are customers.

## Opening the apps

- **Customer app:** http://localhost:5173 — designed for a phone; on a laptop, a narrow window or the browser's device toolbar (390 × 844) shows it as intended.
- **Staff dashboard:** http://localhost:5173/login → sign in with the staff account → you land on http://localhost:5173/staff. Non-staff accounts are sent back to the home page.

> **Demo tip:** when the customer and staff run in the *same* browser, open the staff dashboard in a private/incognito window (or another browser). Both tabs share one login otherwise, and after a page reload the most recent login wins. In real use they are on different devices.

## Demo script (the flow that must work)

Customer on the phone (or a narrow window), staff on the laptop:

1. Open http://localhost:5173 — **"Skip the queue."**
2. See the **Campus Cafe** card: Open · Ready in ~10–15 min.
3. Tap **View Menu**.
4. Add **Cold Coffee** (tap **+** once more for 2, or open the item and set the quantity).
5. Add **Veg Sandwich**.
6. Open the cart (**View cart** bar or the bag icon).
7. Check the total: 2 × Cold Coffee ₹240 + 1 × Veg Sandwich ₹150 = **₹390** — no fees, no taxes.
8. **Proceed to Checkout** → you're asked to sign in (`anishka@example.com` / `test1234`) → back on Checkout with **TOTAL TO PAY ₹390**.
9. Tap **Pay ₹390** (payment is simulated).
10. The order is created as PAID and PLACED.
11. Success screen: **Order placed! #1001 · ₹390 Paid · Ready around <time>** (created time + 15 min). Tap **Track Order** — the tracker shows PLACED.
12. On the laptop (private window): http://localhost:5173/login → `staff@campuscafe.local` / `staff123` → the staff dashboard opens.
13. The order appears under **All** and **New**.
14. Tap **Start Preparing**.
15. Within a few seconds the customer's page switches to **Preparing** — no reload.
16. Tap **Mark Ready**.
17. The customer sees the green **"Your order is ready!"** screen with the order number.
18. The customer walks to the counter and says the number: "1001".
19. Staff finds the card (the **Ready** filter shows only orders waiting for pickup).
20. Tap **Complete Order**.
21. The customer sees **"Pickup complete!"** with **Order Again**; the Orders tab lists the order as Completed.

Also worth showing: **Order Again** adds a past order to the cart (and says what it couldn't add in full), **–** at quantity 1 (or the **Remove** link) removes the line, **Clear cart** shows the empty state, the unavailable **Berry Smoothie** can't be added, **+** stops at 20 of one item ("Max 20 per order"), and the stock-limited **Cheese Toast** shows "Only 1 left" — its **+** stops at 1, and if someone else buys it first, checkout names it and offers **Fix cart** (see [Stock limits](#stock-limits)).

## API

Base URL `http://localhost:8000/api`. Authenticated routes take `Authorization: Bearer <token>`, where the token is a **Supabase Auth access token**: the web app signs in with `supabase.auth.signInWithPassword` and supabase-js refreshes the token (1 hour) automatically. The API verifies it against the project's JWKS with `@supabase/server`, then reads the caller's role from `profiles`.

| Method | Path                      | Auth       | Purpose                                                        |
|--------|---------------------------|------------|----------------------------------------------------------------|
| POST   | `/auth/register`          | –          | `{ name, email, password, phone? }` → `{ user }` (201). Creates a confirmed Supabase Auth user; the client then signs in with supabase-js |
| GET    | `/auth/me`                | user       | `{ user }`                                                     |
| GET    | `/store`                  | –          | `{ store }` — Campus Cafe, open state, prep time               |
| GET    | `/menu`                   | –          | `{ store, popular, categories: [{ name, items }] }` — each item has `stockQuantity` (`null` = unlimited) and an `isAvailable` that is already false once tracked stock hits 0 |
| POST   | `/orders`                 | user       | `{ items: [{ menuItemId, quantity }], customerName?, customerPhone?, note? }` → `{ order }` (201). `customerName` falls back to the account name |
| GET    | `/orders`                 | user       | `{ orders }`, newest first — customers see all of their own, staff see the newest 100 across everyone; `?status=` filters |
| GET    | `/orders/:id`             | user       | `{ order }` — customers only their own (404 otherwise)         |
| PATCH  | `/orders/:id/status`      | staff      | `{ status }` → `{ order }`; 409 on an invalid transition       |
| GET    | `/health`                 | –          | `{ ok: true }`                                                 |

Each `order.items[]` entry carries a snapshot of `name`, `unitPrice`, `quantity`, `lineTotal` plus the item's current `imageUrl`, so order screens need no menu lookup.

Errors are always `{ "error": { "code", "message" } }` and the message is safe to show to the user. Errors about one cart line (`INSUFFICIENT_STOCK`, `ITEM_UNAVAILABLE`, `ITEM_NOT_FOUND`) add `details: { menuItemId, name?, available }` so the client can point at the exact line. Codes:

| Status | Codes |
|--------|-------|
| 400    | `VALIDATION_ERROR` (bad or missing field, malformed JSON — the message names the field and, for cart problems, the item), `ITEM_NOT_FOUND`, `ITEM_UNAVAILABLE` ("Berry Smoothie is currently unavailable…"), `INSUFFICIENT_STOCK` ("Only 1 Cheese Toast left. Reduce the quantity in your cart." / "Cheese Toast just sold out."), `STORE_CLOSED` (the store's `isOpen` is false), `BAD_REQUEST` (malformed URL or request) |
| 401    | `UNAUTHORIZED` (missing, expired or wrong-project token) |
| 403    | `FORBIDDEN` |
| 404    | `NOT_FOUND` |
| 409    | `EMAIL_TAKEN`, `INVALID_STATUS_TRANSITION` (message quotes the order's *current* status) |
| 413    | `PAYLOAD_TOO_LARGE` (JSON body over 100 kB) |
| 500    | `INTERNAL` |

Rules the server enforces:

- Prices and totals come from the database only (anything sent by the client is ignored); `total = Σ unitPrice × quantity`; `estimatedReadyAt = createdAt + store.prepTimeMaxMinutes`; new orders are `PAID` + `PLACED`.
- Ordering is refused while the store is closed (`STORE_CLOSED`).
- An order has at most **30 lines** and at most **20 of any one item**; the same item listed twice is merged into one line before the cap is checked. `customerName` ≤ 60 chars, `note` ≤ 200 chars.
- Phone numbers (`phone`, `customerPhone`) may contain spaces, dashes and parentheses, which are stripped; what remains must be 10–15 digits with an optional leading `+`, and that normalised value is stored. Passwords are 6–72 characters (bcrypt's limit).
- Stock is reserved by the `place_order` database function, in the same transaction that writes the order, with a conditional decrement (`stock_quantity >= quantity`), so two customers can never both get the last unit; a refused order leaves no rows and no decrements behind.
- Allowed transitions are `PLACED → PREPARING → READY → COMPLETED`, plus `PLACED/PREPARING → CANCELLED` by staff. The `update_order_status` database function does a single conditional write, so two staff devices pressing at once get exactly one 200 and one 409. Cancelling puts the order's items back in stock in the same transaction.
- The browser's publishable key cannot read or write any table: RLS is on everywhere with no policies, and only the API's secret key can call the database functions.

## Project structure

```
food-pickup/
├── client/                      React 18 + TypeScript + Vite 6 + Tailwind v4
│   ├── index.html               font preload + first-paint background
│   ├── vite.config.ts           dev server on :5173, proxies /api → http://localhost:8000
│   ├── .env.development         Supabase project per Vite mode (.env.staging, .env.production); public values only
│   ├── public/images/           food and cafe photos
│   └── src/
│       ├── index.css            Tailwind + design tokens (@theme: brand/gold/success/cancel, bg/surface/ink/muted/line)
│       ├── components/          Button, FoodCard, AddControl, QuantityStepper, PopularRail, StoreCard, CartItem, OrderCard, StatusTracker, TopBar, BottomNav, ...
│       ├── features/
│       │   ├── auth/            authStore (zustand; the Supabase session itself is kept by supabase-js), validation, RequireAuth, RequireStaff
│       │   ├── cart/            cartRules (MAX_LINE_QUANTITY = 20, stock limits, line problems), cartStore, CartBar, useReorder
│       │   ├── menu/            useMenu, useStore, CategoryChips, ItemDetailSheet
│       │   └── orders/          orderStatus (single source of truth for statuses), useOrder(s) polling, OrderHero, StaffHeader/Filters/Board, StaffOrderCard
│       ├── lib/                 supabase (sign-in only), cn, format, useResource (fetch + polling), useFocusTrap, useNow, useReducedMotion, flyToCart
│       ├── pages/               Home, Menu, Cart, Checkout, OrderSuccess, Order, Orders, Profile, Login, Register, StaffDashboard, NotFound
│       ├── services/            api.ts (fetch wrapper) + auth/store/menu/orders
│       ├── types/api.ts         the API contract types
│       ├── App.tsx              routes + per-route shell (top bar, cart button, bottom nav)
│       └── main.tsx
├── server/                      Express 5 + TypeScript + Supabase (supabase-js, @supabase/server)
│   ├── .env.example             copy to .env (see Environment variables)
│   ├── supabase/                config.toml (local stack) and migrations/ (schema, RLS, database functions)
│   ├── scripts/                 seed.ts, db-push.sh (apply migrations to staging / production)
│   └── src/
│       ├── routes/              thin route tables
│       ├── controllers/         parse request → call service → send JSON
│       ├── services/            business logic (auth, menu, store, order, payment simulation)
│       ├── middleware/          requireAuth / requireStaff, zod validation, error handler
│       ├── schemas/             zod request schemas (auth, order, shared phone/optional fields)
│       ├── types/               API DTOs, generated database types, enums, auth user, Express request augmentation
│       ├── utils/               env, Supabase admin client, errors, serializers, ids
│       └── server.ts
├── .logs/                       server.log / client.log written by start.sh (gitignored)
├── start.sh                     starts both servers (see "What start.sh does")
└── README.md
```

Ports: API **8000**, web app **5173**. Both are fixed: the Vite proxy target (`client/vite.config.ts`) and `start.sh` hardcode 8000, and Vite runs with `--strictPort` on 5173.

## Environments

| Environment | Supabase project | Used by |
|-------------|------------------|---------|
| `local`      | Docker stack from `npm run db:start` (`http://127.0.0.1:54321`) | day-to-day development, `./start.sh` |
| `staging`    | `xkddnlxeeizaqpefhqlv` (`https://xkddnlxeeizaqpefhqlv.supabase.co`) | shared testing before release |
| `production` | a second hosted project (create it in the Supabase dashboard, then fill in its ref) | the live app |

Each environment is a separate Supabase project with its own database, users and keys. A token from one project is rejected by an API pointed at another, so the API (`server/.env` → `SUPABASE_URL`) and the web app (`client/.env.<mode>` → `VITE_SUPABASE_URL`) must always name the same project.

**Schema changes** are SQL files in `server/supabase/migrations/`, applied in order everywhere:

```bash
cd server
npm run db:new add_something       # creates supabase/migrations/<timestamp>_add_something.sql — write the SQL there
npm run db:reset                   # local: rebuild the local database from all migrations (wipes local data)
npm run db:types                   # regenerate src/types/database.ts from the local database
npm run db:push:staging            # apply new migrations to staging
npm run db:push:production         # the same for production (asks you to type "production" first)
```

`db:push:*` need `npx supabase login` once, and ask for that project's database password (or read `SUPABASE_DB_PASSWORD`). The CLI lists what it is about to apply and asks before applying.

**Setting up staging** (once): `npm run db:push:staging`, then put the staging URL and secret key in `server/.env` with `APP_ENV=staging` and run `npm run seed` for the demo data.

**Setting up production** (once):

1. Create a new project in the Supabase dashboard (a region near your users; save the database password).
2. Put its ref in `PRODUCTION_REF` in `server/scripts/db-push.sh`, then `npm run db:push:production`.
3. Create `client/.env.production` with its `VITE_SUPABASE_URL` and publishable key (see `client/.env.example`); `npm run build` refuses to run without it.
4. On the production API host set `APP_ENV=production`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `PORT` and `CLIENT_ORIGIN`.
5. Load the store and menu once, with the production values in the environment: `npm run seed -- --production`. It only works while production has no store, and creates no accounts. The plain `npm run seed` refuses to run against production.
6. Create staff accounts in the dashboard (Authentication → Add user, with auto-confirm), then in the SQL editor: `update public.profiles set role = 'STAFF' where email = '…';`
7. Recommended in the dashboard (Authentication → Sign In / Providers): turn off **Allow new users to sign up**. Accounts are created by the API's `/auth/register` with the secret key, which still works; this closes direct sign-ups with the publishable key.

## Environment variables

`server/.env` (copy from `server/.env.example`):

| Variable              | Purpose                                              | Example                                                |
|-----------------------|------------------------------------------------------|--------------------------------------------------------|
| `APP_ENV`             | `local`, `staging` or `production`. `start.sh` picks the web app's mode from it, and `npm run seed` refuses to wipe `production` | `local` |
| `SUPABASE_URL`        | The project's URL                                    | `http://127.0.0.1:54321`, `https://xkddnlxeeizaqpefhqlv.supabase.co` |
| `SUPABASE_SECRET_KEY` | The project's **secret** key (`sb_secret_…`, Project Settings → API Keys). Bypasses RLS: keep it out of the client and git | local default is in `.env.example` |
| `PORT`                | API port (default `8000`). **Keep it at 8000** unless you also change the proxy target in `client/vite.config.ts` and the port checks in `start.sh` | `8000` |
| `CLIENT_ORIGIN`       | Origin allowed by CORS (default `http://localhost:5173`) | `http://localhost:5173`                            |

`client/.env.<mode>` (`.env.development`, `.env.staging`, `.env.production`): `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. These are public (they ship in the JavaScript bundle) and are committed. The client calls `/api` relative to its own origin, and Vite proxies that to the API.

## Stock limits

Menu items can carry a `stockQuantity` (`null` = not tracked, which is the default). Three seeded items are limited so the flow can be demoed: **Cheese Toast 1**, **Chocolate Brownie 2**, **Blueberry Muffin 5**.

- The menu shows a gold **"Only N left"** chip on items with 1–5 left. Every **+** (card, item sheet, cart) stops at what is left and says "Only N available"; tapping it past the limit shakes instead of changing anything.
- Placing an order decrements stock atomically; at 0 the item shows as **Sold out** and cannot be added. Staff cancelling an order (**PLACED/PREPARING → CANCELLED**) puts its items back.
- If stock changes while something sits in a cart (someone else bought the last one), the cart and checkout ring the exact line in paprika, label it ("Only 1 left" / "Sold out"), block the pay button with a reason that names the item, and offer a one-tap **Fix** that trims the line to what is available or removes it. The server error (`INSUFFICIENT_STOCK`) names the item too — never "some item is not available".
- **Order Again** adds a past order on top of the current cart, capped by current stock, and lists anything it could not add in full ("Cheese Toast: only 1 left, added 1", "Berry Smoothie is sold out, skipped").
- `npm run seed` resets the three counts above (and clears every order).

## Re-seeding wipes orders

`npm run seed` (in `server/`, or `./start.sh --seed`) deletes **every order** and restarts numbering at **#1001**. The store, menu items and the two test accounts are updated in place and keep their ids, so logins and saved carts in an open browser keep working. Accounts registered while testing are removed. It seeds whichever project `server/.env` points at, and refuses `APP_ENV=production`.

## Useful scripts

| Where    | Command              | What it does                                   |
|----------|----------------------|------------------------------------------------|
| root     | `./start.sh [--seed]`| Start (and optionally reseed) everything       |
| server/  | `npm run dev`        | API with reload (tsx watch) on :8000           |
| server/  | `npm run seed`       | Reset demo data (see above)                    |
| server/  | `npm run typecheck`  | `tsc --noEmit`                                 |
| server/  | `npm run db:start` / `db:stop` | Start / stop the local Supabase stack (Docker) |
| server/  | `npm run db:reset`   | Rebuild the local database from the migrations (wipes local data) |
| server/  | `npm run db:new <name>` | New empty migration file                    |
| server/  | `npm run db:types`   | Regenerate `src/types/database.ts` from the local database |
| server/  | `npm run db:push:staging` / `db:push:production` | Apply new migrations to a hosted project |
| server/  | `npm run build` / `npm start` | Compile to `dist/` and run `dist/src/server.js` without tsx |
| client/  | `npm run dev` / `dev:staging` | Vite dev server on :5173 with `/api` proxy, signing in to local / staging Supabase |
| client/  | `npm run typecheck`  | `tsc --noEmit`                                 |
| client/  | `npm run build` / `build:staging` | Type-check + build into `dist/` for production / staging |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `EADDRINUSE: address already in use :::8000` or Vite's `Port 5173 is already in use` | Something from an earlier run is still listening. `./start.sh` frees both ports for you; by hand: `lsof -ti:8000 -ti:5173 \| xargs kill`. |
| `The local Supabase stack is not running` / `Cannot connect to the Docker daemon` | Start Docker, then `cd server && npm run db:start`. |
| `start.sh` says **"Database looks empty or unreachable"**, or the app shows "The store has not been set up yet" | Tables missing or never seeded. Local: `cd server && npm run db:reset`, then `./start.sh --seed`. Staging: `npm run db:push:staging`, then `npm run seed`. |
| Sign-in works but then "Your session has expired. Please sign in again." | The web app and the API point at different Supabase projects. Check `APP_ENV`/`SUPABASE_URL` in `server/.env` against `client/.env.<mode>`, and restart with `./start.sh`. |
| `permission denied for table …` in the API log | `SUPABASE_SECRET_KEY` is not the secret key of the project in `SUPABASE_URL` (or is a publishable key). |
| `start.sh` says **"server/.env is missing"**, or the API prints `Invalid environment configuration` | `cp server/.env.example server/.env`; the message names the variable that is missing or malformed. |
| Blank page on http://localhost:5173 right after starting | Vite is still compiling on the first load; wait a couple of seconds and reload. If it persists, check `.logs/client.log` and the browser console. |
| Customer page never moves past **Placed** | The API isn't reachable through the proxy — is it on port 8000? `curl http://localhost:8000/api/health` should print `{"ok":true}`. |

## What V0 deliberately leaves out

One shop only, and nothing beyond the pickup flow: no delivery, maps or location, no GST/taxes or platform/service/handling fees, no discounts, coupons or loyalty, no recommendations or AI, no QR codes, no real payment gateway (payment is simulated, but the order flow is written so a gateway can slot in later), no refunds or wallets, no inventory or item variants, no push notifications, no reporting/analytics, no merchant onboarding, no OTP/social login, no infrastructure beyond Supabase (no Redis, queues or microservices). Real-time updates are plain polling every few seconds.
# KhaNha
