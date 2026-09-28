# Food Pickup — V0

Order ahead from **Campus Cafe**, pay in a tap (simulated), and collect your food at the counter without standing in the ordering queue.
One shop, one staff screen, real-time-enough status updates. The API and web app run on localhost; data and sign-in live in Supabase (a local Docker stack for development, plus hosted **staging** and **production** projects — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

- **Customer app:** http://localhost:5173
- **Staff dashboard:** http://localhost:5173/staff
- **API:** http://localhost:8000/api (health check: http://localhost:8000/api/health)

## Docs

| Doc                                                      | What it covers                                                                                                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)             | system overview and every flow, as diagrams                                                                                                                                                            |
| [docs/API.md](docs/API.md)                               | every endpoint, request and response shapes, error codes, limits                                                                                                                                       |
| [docs/SCHEMA.md](docs/SCHEMA.md)                         | tables, enums, indexes, triggers, database functions, migrations                                                                                                                                       |
| [docs/PERMISSIONS.md](docs/PERMISSIONS.md)               | roles, route guards, ownership rules, RLS and grants                                                                                                                                                   |
| [docs/COMPONENTS.md](docs/COMPONENTS.md)                 | the shared components, hooks, utilities and feature rules                                                                                                                                              |
| [docs/FRONTEND_STRUCTURE.md](docs/FRONTEND_STRUCTURE.md) | `client/src` layout, routes, stores, services, layering rules                                                                                                                                          |
| [docs/BACKEND_STRUCTURE.md](docs/BACKEND_STRUCTURE.md)   | `server/src` layout, request pipeline, modules, scripts                                                                                                                                                |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)                 | environments, env vars, migrations, seeding, builds, production setup                                                                                                                                  |
| [docs/LOGGING.md](docs/LOGGING.md)                       | log levels, request ids, redaction                                                                                                                                                                     |
| [docs/TESTING.md](docs/TESTING.md)                       | running tests, the test-target guard, the edge-case matrix                                                                                                                                             |
| `docs/PERF_BASELINE.md`                                  | performance budgets and measurements (created by perf-auditor on its first run)                                                                                                                        |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md)           | every setting: tier, default, bounds, who reads it                                                                                                                                                     |
| [docs/adr/README.md](docs/adr/README.md)                 | architecture decision records (ADR-001..010) and how to add one                                                                                                                                        |
| [plans/ROADMAP.md](plans/ROADMAP.md)                     | the roadmap from V0 to the multi-store platform (P0–P10); [plans/PAYMENT_OPTIONS.md](plans/PAYMENT_OPTIONS.md) is its payment research, [plans/P0_FOUNDATIONS.md](plans/P0_FOUNDATIONS.md) the P0 plan |

## Prerequisites

- **Node 24.15 or later 24.x** with any installer (`.nvmrc` / `.node-version` pin it; `npm ci` refuses other majors with `EBADENGINE`)
- **Docker** (Docker Desktop, OrbStack or Colima) for the local Supabase stack. Not needed if you develop against staging.

## Containers

`server/Dockerfile` and `client/Dockerfile` build the API and web images; one web image serves every environment
(Supabase values are set at start). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#containers).

### Run it in containers

With the local Supabase stack running and seeded (Quick start steps 1–2):

```bash
export SUPABASE_PUBLISHABLE_KEY=$(grep VITE_SUPABASE_PUBLISHABLE_KEY client/.env.development | cut -d= -f2)
docker compose up --build web api
```

Then open http://localhost:8080 and run the demo below. Details: [Local compose](docs/DEPLOYMENT.md#local-compose).

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

The defaults point at the local stack (`APP_ENV=local`) and need no editing. To work against staging instead, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#local-and-staging).

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
- Does _not_ start Supabase or apply migrations — that is step 1 above (or `npm run db:push:staging` for staging).

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

The Vite dev server proxies `/api/*` to `http://localhost:8000`. The only client configuration is which Supabase project to sign in to, in `client/.env.<mode>` (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#client-environment-variables)).

## Test accounts

| Role     | Email                    | Password (local) |
| -------- | ------------------------ | ---------------- |
| Customer | `anishka@example.com`    | `test1234`       |
| Staff    | `staff@campuscafe.local` | `staff123`       |
| Admin    | `admin@campuscafe.local` | `admin123`       |

These passwords work on the local stack only. Shared staging uses deployment-provided passwords
(`SEED_STAFF_PASSWORD`, `SEED_ADMIN_PASSWORD`, `SEED_CUSTOMER_PASSWORD`; see
[DEPLOYMENT.md](docs/DEPLOYMENT.md#server-environment-variables)), and production has no demo accounts.

Or tap **Create an account** in the app; new accounts are customers. The admin account is a site-wide
developer/operator role (the `/admin` dashboard), not a restaurant role — see
[docs/PERMISSIONS.md](docs/PERMISSIONS.md#roles).

## Opening the apps

- **Customer app:** http://localhost:5173 — designed for a phone; on a laptop, a narrow window or the browser's device toolbar (390 × 844) shows it as intended.
- **Staff dashboard:** http://localhost:5173/login → sign in with the staff account → you land on http://localhost:5173/staff. Non-staff accounts are sent back to the home page.
- **Admin dashboard:** http://localhost:5173/login → sign in with the admin account → you land on http://localhost:5173/admin. Non-admin accounts are sent back to the home page.

> **Demo tip:** when the customer and staff run in the _same_ browser, open the staff dashboard in a private/incognito window (or another browser). Both tabs share one login otherwise, and after a page reload the most recent login wins. In real use they are on different devices.

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
20. Tap **Mark Collected**.
21. The customer sees **"Order collected!"** with **Order Again**; the Orders tab lists the order as Collected.

Also worth showing: **Order Again** adds a past order to the cart (and says what it couldn't add in full), **–** at quantity 1 (or the **Remove** link) removes the line, **Clear cart** shows the empty state, the unavailable **Berry Smoothie** can't be added, **+** stops at 10 of one item ("Max 10 per order"), and the stock-limited **Cheese Toast** shows "Only 1 left" — its **+** stops at 1, and if someone else buys it first, checkout names it and offers **Fix cart** (see [Stock limits](#stock-limits)). The staff dashboard also has a signed-in-only **Admin dashboard** (`/admin`, `admin@campuscafe.local`; local-only credentials, see [Test accounts](#test-accounts)) where the customer order history and staff board size limits can be changed.

## Project layout

```
food-pickup/
├── client/        React 18 + Vite web app (docs/FRONTEND_STRUCTURE.md)
├── server/        Express 5 API, Supabase migrations, seed and db-push scripts (docs/BACKEND_STRUCTURE.md)
├── docs/          the documentation set (see Docs below)
├── .logs/         server.log / client.log written by start.sh (gitignored)
└── start.sh       starts both servers (see "What start.sh does")
```

Ports: API **8000**, web app **5173**. Both are fixed: the Vite proxy target (`client/vite.config.ts`) and `start.sh` hardcode 8000, and Vite runs with `--strictPort` on 5173.

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

| Where   | Command                                          | What it does                                                                                                                                                                                          |
| ------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| root    | `./start.sh [--seed]`                            | Start (and optionally reseed) everything                                                                                                                                                              |
| server/ | `npm run dev`                                    | API with reload (tsx watch) on :8000                                                                                                                                                                  |
| server/ | `npm run seed`                                   | Reset demo data (see above)                                                                                                                                                                           |
| server/ | `npm run typecheck`                              | `tsc --noEmit`                                                                                                                                                                                        |
| server/ | `npm run lint`                                   | ESLint                                                                                                                                                                                                |
| server/ | `npm test` / `test:watch`                        | Vitest against the local Supabase stack (see [docs/TESTING.md](docs/TESTING.md))                                                                                                                      |
| server/ | `npm run format` / `format:check`                | Prettier write / check                                                                                                                                                                                |
| server/ | `npm run db:start` / `db:stop`                   | Start / stop the local Supabase stack (Docker)                                                                                                                                                        |
| server/ | `npm run db:reset`                               | Rebuild the local database from the migrations (wipes local data)                                                                                                                                     |
| server/ | `npm run db:new <name>`                          | New empty migration file                                                                                                                                                                              |
| server/ | `npm run db:types`                               | Regenerate `src/types/database.ts` from the local database                                                                                                                                            |
| server/ | `npm run db:push:staging` / `db:push:production` | Apply new migrations to a hosted project                                                                                                                                                              |
| server/ | `npm run build` / `npm start`                    | Compile to `dist/` and run `dist/src/server.js` without tsx                                                                                                                                           |
| client/ | `npm run dev` / `dev:staging`                    | Vite dev server on :5173 with `/api` proxy, signing in to local / staging Supabase                                                                                                                    |
| client/ | `npm run typecheck`                              | `tsc --noEmit`                                                                                                                                                                                        |
| client/ | `npm run lint`                                   | ESLint                                                                                                                                                                                                |
| client/ | `npm test` / `test:watch`                        | Vitest unit tests (jsdom, no backend needed)                                                                                                                                                          |
| client/ | `npm run format` / `format:check`                | Prettier write / check                                                                                                                                                                                |
| client/ | `npm run build` / `build:staging`                | Type-check + build into `dist/` for production / staging. `build` needs `client/.env.production` (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#builds))                                                |
| client/ | `npm run preview`                                | `vite preview` of the last build                                                                                                                                                                      |
| client/ | `python3 scripts/optimize-images.py`             | Compress a new/replaced photo in `public/images/` and write its 400px thumbnail (needs Pillow: `pip3 install pillow`; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#compressing-photos-before-a-build)) |

The gate for a changed package is `npm run typecheck && npm run lint && npm test`.

## Troubleshooting

| Symptom                                                                                                         | Fix                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EADDRINUSE: address already in use :::8000` or Vite's `Port 5173 is already in use`                            | Something from an earlier run is still listening. `./start.sh` frees both ports for you; by hand: `lsof -ti:8000 -ti:5173 \| xargs kill`.                                  |
| `The local Supabase stack is not running` / `Cannot connect to the Docker daemon`                               | Start Docker, then `cd server && npm run db:start`.                                                                                                                        |
| `start.sh` says **"Database looks empty or unreachable"**, or the app shows "The store has not been set up yet" | Tables missing or never seeded. Local: `cd server && npm run db:reset`, then `./start.sh --seed`. Staging: `npm run db:push:staging`, then `npm run seed`.                 |
| Sign-in works but then "Your session has expired. Please sign in again."                                        | The web app and the API point at different Supabase projects. Check `APP_ENV`/`SUPABASE_URL` in `server/.env` against `client/.env.<mode>`, and restart with `./start.sh`. |
| `permission denied for table …` in the API log                                                                  | `SUPABASE_SECRET_KEY` is not the secret key of the project in `SUPABASE_URL` (or is a publishable key).                                                                    |
| `start.sh` says **"server/.env is missing"**, or the API prints `Invalid environment configuration`             | `cp server/.env.example server/.env`; the message names the variable that is missing or malformed.                                                                         |
| Blank page on http://localhost:5173 right after starting                                                        | Vite is still compiling on the first load; wait a couple of seconds and reload. If it persists, check `.logs/client.log` and the browser console.                          |
| Customer page never moves past **Placed**                                                                       | The API isn't reachable through the proxy — is it on port 8000? `curl http://localhost:8000/api/health` should print `{"ok":true}`.                                        |

## What V0 deliberately leaves out

One shop only, and nothing beyond the pickup flow: no delivery, maps or location, no GST/taxes or platform/service/handling fees, no discounts, coupons or loyalty, no recommendations or AI, no QR codes, no real payment gateway (payment is simulated, but the order flow is written so a gateway can slot in later), no refunds or wallets, no inventory or item variants, no push notifications, no reporting/analytics, no merchant onboarding, no OTP/social login, no infrastructure beyond Supabase (no Redis, queues or microservices). Real-time updates are plain polling every few seconds.
