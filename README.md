# Food Pickup — V0

Order ahead from **Campus Cafe**, pay in a tap (simulated), and collect your food at the counter without standing in the ordering queue.
One shop, one staff screen, real-time-enough status updates. The API and web app run on localhost; data and sign-in live in Supabase (a local Docker stack for development, plus hosted **staging** and **production** projects — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

- **Customer app:** http://localhost:5173
- **Staff dashboard:** http://localhost:5173/staff
- **API:** http://localhost:8000/api (health check: http://localhost:8000/api/health)

## Docs

Which doc to update for a given change: [docs/README.md](docs/README.md).

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

Repository workflow setup for Codex: [docs/CODEX.md](docs/CODEX.md). Run `node scripts/codex/sync.mjs` to refresh
project skill entry files and role adapters, and `node scripts/codex/sync.mjs --plugins` to expose locally installed plugin
prompts. The existing shared instructions and tooling remain authoritative.

- **Node 24.15 or later 24.x** with any installer (`.nvmrc` / `.node-version` pin it; `pnpm install` refuses any other version with `ERR_PNPM_UNSUPPORTED_ENGINE`)
- **pnpm**, through the corepack that ships with Node 24: run `corepack enable` once. It then gives every root the pnpm
  that `packageManager` in its `package.json` pins. The three roots (`.`, `client/`, `server/`) are independent: install
  in each one you use. Scripts run as `pnpm run <script> <args>`, with no `--` before the arguments: pnpm passes a `--`
  through, and `pnpm test -- <file>` runs the whole suite instead of `<file>`.
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
Or `./build.sh dev && ./run.sh dev` (`staging` for the staging project, on http://localhost:8081): see
[build.sh and run.sh](docs/DEPLOYMENT.md#buildsh-and-runsh).

## Quick start

The one-time setup is three commands; after that `./start.sh` runs everything.

**1. Install and start the local Supabase stack**

```bash
corepack enable
cd server && pnpm install && pnpm run db:start && cd ..
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

It prints the URLs and logins when both servers answer. Press **Ctrl+C** once to stop both. The Supabase stack keeps running in Docker; stop it with `cd server && pnpm run db:stop`.

### What `start.sh` does

- Reads `APP_ENV` from `server/.env` and starts the web app in the matching mode (`local` → `pnpm run dev`, `staging` → `pnpm run dev:staging`), so the browser signs in to the same Supabase project the API uses. Refuses `APP_ENV=production`.
- Stops with a clear message if `server/.env` is missing, or (for `local`) the Supabase stack is not running.
- Runs `pnpm install --frozen-lockfile` in `server/` and `client/` if `node_modules` is missing. An existing checkout built with npm keeps its old `node_modules`, so migrate it once: delete `node_modules` in the repository root, `client/` and `server/`, make sure Corepack is enabled (see Prerequisites), then run `pnpm install` in each of the three.
- **Frees the API, worker and web ports first** (8000, 8001 and 5173 unless configured) — anything still listening on them (a stray `pnpm run dev`, an earlier `start.sh`) is killed. Don't run it while another copy of the project is deliberately serving those ports.
- `--seed` runs `pnpm run seed` before starting (see [Re-seeding wipes orders](#re-seeding-wipes-orders)).
- Starts the API and the job worker (`tsx watch`, auto-reload on server edits) and the web app (Vite, hot reloads client edits). Their output goes to **`.logs/server.log`**, **`.logs/worker.log`** and **`.logs/client.log`** (gitignored) — look there when something misbehaves.
- Waits until `GET /api/health`, the worker's `http://localhost:8001/health`, the web app return 200 and `GET /api/stores` lists a store. If the API is up but no store is listed, it says **"Database looks empty or unreachable — run ./start.sh --seed"** and stops.
- Does _not_ start Supabase or apply migrations — that is step 1 above (or `pnpm run db:push:staging` for staging).

### Manual start (two terminals)

If you would rather see the servers' output directly:

```bash
# terminal 1 — API on http://localhost:8000/api
cd server
pnpm run seed               # first time only
pnpm run dev

# terminal 2 — web app on http://localhost:5173
cd client
pnpm install               # first time only
pnpm run dev                # or `pnpm run dev:staging` when server/.env has APP_ENV=staging
```

The Vite dev server proxies `/api/*` to `http://localhost:8000`. The only client configuration is which Supabase project to sign in to, in `client/.env.<mode>` (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#client-environment-variables)).

## Test accounts

| Role                        | Email                                                                | Password (local)         |
| --------------------------- | -------------------------------------------------------------------- | ------------------------ |
| Customer                    | `anishka@example.com`                                                | `test1234`               |
| Staff                       | `staff@campuscafe.local`                                             | `staff123`               |
| Manager (Campus Cafe)       | `manager@campuscafe.local`                                           | `manager123`             |
| Staff, manager (North Gate) | `staff@northgate.brewlane.local`, `manager@northgate.brewlane.local` | `staff123`, `manager123` |
| Staff, manager (Tech Park)  | `staff@techpark.brewlane.local`, `manager@techpark.brewlane.local`   | `staff123`, `manager123` |
| Admin                       | `admin@campuscafe.local`                                             | `admin123`               |
| Owner (Campus Cafe)         | `owner@campuscafe.local`                                             | `owner123`               |
| Owner (Brew Lane)           | `owner@brewlane.local`                                               | `owner123`               |

Store team accounts (staff and manager) have the `STAFF` profile role until P2 PR 16, so the current `/staff` board admits them; their store role is a membership ([PERMISSIONS.md](docs/PERMISSIONS.md#store-roles)).

These passwords work on the local stack only. Shared staging uses deployment-provided passwords
(`SEED_STAFF_PASSWORD`, which every store team account uses, `SEED_ADMIN_PASSWORD`, `SEED_CUSTOMER_PASSWORD`, `SEED_OWNER_PASSWORD`; see
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

Two-store management (owner and manager): sign in as the brand owner, open **/manage**, pick a store and use **Settings** (the four limits) and **Team** (invite by email with a role; the one-time link is shown with **Copy**; **Revoke** and **Remove** ask first). A manager sees the same tabs without the **Manager** role option, and cannot remove or revoke other managers. The invitee opens the link (`/join#<token>`), signs in or registers with the invited email, and lands on the staff board or `/manage`.

Also worth showing: **Order Again** adds a past order to the cart (and says what it couldn't add in full), **–** at quantity 1 (or the **Remove** link) removes the line, **Clear cart** shows the empty state, the unavailable **Berry Smoothie** can't be added, **+** stops at 10 of one item ("Max 10 per order"), and the stock-limited **Cheese Toast** shows "Only 1 left" — its **+** stops at 1, and if someone else buys it first, checkout names it and offers **Fix cart** (see [Stock limits](#stock-limits)). The staff dashboard also has a signed-in-only **Admin dashboard** (`/admin`, `admin@campuscafe.local`; local-only credentials, see [Test accounts](#test-accounts)) where the customer order history and staff board size limits can be changed.

## Project layout

```
food-pickup/
├── .agents/       project skill entry files and ignored local plugin wrappers (docs/CODEX.md)
├── .codex/        runtime configuration, lifecycle hooks and role adapters (docs/CODEX.md)
├── client/        React 18 + Vite web app (docs/FRONTEND_STRUCTURE.md)
├── server/        Express 5 API, Supabase migrations, seed and db-push scripts (docs/BACKEND_STRUCTURE.md)
├── docs/          the documentation set (see Docs below)
├── .logs/         server.log / worker.log / client.log written by start.sh (gitignored)
└── start.sh       starts the API, the worker and the web app (see "What start.sh does")
```

Ports: API **8000** (`PORT` in `server/.env`), worker health **8001** (`WORKER_HEALTH_PORT`), web app **5173** (`VITE_DEV_PORT` in `client/.env.<mode>`). `start.sh` reads both and points the dev proxy at the API's port; Vite fails instead of moving when its port is busy (`strictPort`). The containers serve both on **8080** (`docker compose up web api worker`).

## Stock limits

Menu items can carry a `stockQuantity` (`null` = not tracked, which is the default). Three seeded items are limited so the flow can be demoed: **Cheese Toast 1**, **Chocolate Brownie 2**, **Blueberry Muffin 5**.

- The menu shows a gold **"Only N left"** chip on items with 1–5 left. Every **+** (card, item sheet, cart) stops at what is left and says "Only N available"; tapping it past the limit shakes instead of changing anything.
- Placing an order decrements stock atomically; at 0 the item shows as **Sold out** and cannot be added. Staff cancelling an order (**PLACED/PREPARING → CANCELLED**) puts its items back.
- If stock changes while something sits in a cart (someone else bought the last one), the cart and checkout ring the exact line in paprika, label it ("Only 1 left" / "Sold out"), block the pay button with a reason that names the item, and offer a one-tap **Fix** that trims the line to what is available or removes it. The server error (`INSUFFICIENT_STOCK`) names the item too — never "some item is not available".
- **Order Again** adds a past order on top of the current cart, capped by current stock, and lists anything it could not add in full ("Cheese Toast: only 1 left, added 1", "Berry Smoothie is sold out, skipped").
- `pnpm run seed` resets the three counts above (and clears every order).

## Re-seeding wipes orders

`pnpm run seed` (in `server/`, or `./start.sh --seed`) deletes **every order** and every hand-made stock change (`stock_movements`), and restarts numbering at **#1001**. The store, menu items and the two test accounts are updated in place and keep their ids, so logins and saved carts in an open browser keep working. Accounts registered while testing are removed. It seeds whichever project `server/.env` points at, and refuses `APP_ENV=production`.

## Ports

Client `5173` (`VITE_DEV_PORT`), API `8000` (`PORT`), worker health `8001` (`WORKER_HEALTH_PORT`), local Supabase
`54321` (`SUPABASE_URL`); `start.sh` reads them from the env files and kills whatever holds 8000/8001/5173 first.
`docker compose up web api worker` serves the web app on `8080`.

## Useful scripts

| Where   | Command                                                                                 | What it does                                                                                                                                                                                          |
| ------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| root    | `./start.sh [--seed]`                                                                   | Start (and optionally reseed) everything                                                                                                                                                              |
| server/ | `pnpm run dev`                                                                          | API with reload (tsx watch) on :8000                                                                                                                                                                  |
| server/ | `pnpm run dev:worker` / `start:worker`                                                  | The job worker (tsx watch / built) with `GET /health` on :8001                                                                                                                                        |
| server/ | `pnpm run seed`                                                                         | Reset demo data (see above)                                                                                                                                                                           |
| server/ | `pnpm run typecheck`                                                                    | `tsc --noEmit`                                                                                                                                                                                        |
| server/ | `pnpm run lint`                                                                         | ESLint                                                                                                                                                                                                |
| server/ | `pnpm test` / `test:watch`                                                              | Vitest against the local Supabase stack (see [docs/TESTING.md](docs/TESTING.md))                                                                                                                      |
| server/ | `pnpm run format` / `format:check`                                                      | Prettier write / check                                                                                                                                                                                |
| server/ | `pnpm run db:start` / `db:stop`                                                         | Start / stop the local Supabase stack (Docker)                                                                                                                                                        |
| server/ | `pnpm run db:reset`                                                                     | Rebuild the local database from the migrations (wipes local data)                                                                                                                                     |
| server/ | `pnpm run db:new <name>`                                                                | New empty migration file                                                                                                                                                                              |
| server/ | `pnpm run db:types`                                                                     | Regenerate `src/types/database.ts` from the local database                                                                                                                                            |
| server/ | `pnpm run db:push:staging` / `db:push:production`                                       | Apply new migrations to a hosted project                                                                                                                                                              |
| server/ | `pnpm run build` / `pnpm start`                                                         | Compile to `dist/` and run `dist/src/server.js` without tsx                                                                                                                                           |
| client/ | `pnpm run dev` / `dev:staging`                                                          | Vite dev server on :5173 with `/api` proxy, signing in to local / staging Supabase                                                                                                                    |
| client/ | `pnpm run typecheck`                                                                    | `tsc --noEmit`                                                                                                                                                                                        |
| client/ | `pnpm run lint`                                                                         | ESLint                                                                                                                                                                                                |
| client/ | `pnpm test` / `test:watch`                                                              | Vitest unit tests (jsdom, no backend needed)                                                                                                                                                          |
| client/ | `pnpm run format` / `format:check`                                                      | Prettier write / check                                                                                                                                                                                |
| client/ | `pnpm run build` / `build:staging`                                                      | Type-check + build into `dist/` for production / staging. `build` needs `client/.env.production` (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#builds))                                                |
| client/ | `pnpm run preview`                                                                      | `vite preview` of the last build                                                                                                                                                                      |
| client/ | `python3 scripts/optimize-images.py`                                                    | Compress a new/replaced photo in `public/images/` and write its 400px thumbnail (needs Pillow: `pip3 install pillow`; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#compressing-photos-before-a-build)) |
| client/ | `pnpm run e2e:webkit`                                                                   | The WebKit smoke (Safari's engine, 360px, API mocked); `pnpm run e2e:install` once first                                                                                                              |
| root    | `pnpm run format` / `format:check`                                                      | Prettier over `scripts/**`, `.github/**` and `plans/**` (root `package.json`, not a workspace; only devDependency `prettier`)                                                                         |
| root    | `pnpm test`                                                                             | `node --test` over `scripts/**/*.test.mjs`                                                                                                                                                            |
| root    | `pnpm run change --client <level> --server <level> "summary"`                           | Record a change intent in `.changes/` (`.claude/rules/workflow.md` §21)                                                                                                                               |
| root    | `pnpm run release:dry` / `release`                                                      | Print / apply the version bump from the intents (release PR only)                                                                                                                                     |
| root    | `pnpm run change:check`                                                                 | The `version-intent` CI check against `origin/dev`                                                                                                                                                    |
| root    | `pnpm run check:bundle` / `check:migrations` / `check:durations` / `check:dist-secrets` | The CI checks: initial JS budget (after a client build), migrations append-only, no hard-coded durations, no secret in the built bundle                                                               |
| server/ | `pnpm run db:start:ci`                                                                  | `db:start` without Studio, storage, realtime, mail, logs and edge functions (CI)                                                                                                                      |
| server/ | `pnpm run seed --production`                                                            | First-time production setup: **the user runs it**, never an agent (like `db:push:production`)                                                                                                         |
| client/ | `pnpm run e2e:chromium` / `e2e:install`                                                 | The 360×640 smoke on Chromium (CI, every client PR); `e2e:install` downloads the browsers once                                                                                                        |

The gate for a changed package is `pnpm run typecheck && pnpm run lint && pnpm test`.

## Troubleshooting

| Symptom                                                                                                         | Fix                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EADDRINUSE: address already in use :::8000` or Vite's `Port 5173 is already in use`                            | Something from an earlier run is still listening. `./start.sh` frees both ports for you; by hand: `lsof -ti:8000 -ti:5173 \| xargs kill`.                                  |
| `The local Supabase stack is not running` / `Cannot connect to the Docker daemon`                               | Start Docker, then `cd server && pnpm run db:start`.                                                                                                                       |
| `start.sh` says **"Database looks empty or unreachable"**, or the app shows "The store has not been set up yet" | Tables missing or never seeded. Local: `cd server && pnpm run db:reset`, then `./start.sh --seed`. Staging: `pnpm run db:push:staging`, then `pnpm run seed`.              |
| Sign-in works but then "Your session has expired. Please sign in again."                                        | The web app and the API point at different Supabase projects. Check `APP_ENV`/`SUPABASE_URL` in `server/.env` against `client/.env.<mode>`, and restart with `./start.sh`. |
| `permission denied for table …` in the API log                                                                  | `SUPABASE_SECRET_KEY` is not the secret key of the project in `SUPABASE_URL` (or is a publishable key).                                                                    |
| `start.sh` says **"server/.env is missing"**, or the API prints `Invalid environment configuration`             | `cp server/.env.example server/.env`; the message names the variable that is missing or malformed.                                                                         |
| Blank page on http://localhost:5173 right after starting                                                        | Vite is still compiling on the first load; wait a couple of seconds and reload. If it persists, check `.logs/client.log` and the browser console.                          |
| Customer page never moves past **Placed**                                                                       | The API isn't reachable through the proxy — is it on port 8000? `curl http://localhost:8000/api/health` should print `{"ok":true}`.                                        |

## What V0 deliberately leaves out

One shop only, and nothing beyond the pickup flow: no delivery, maps or location, no GST/taxes or platform/service/handling fees, no discounts, coupons or loyalty, no recommendations or AI, no QR codes, no real payment gateway (payment is simulated, but the order flow is written so a gateway can slot in later), no refunds or wallets, no inventory or item variants, no push notifications, no reporting/analytics, no merchant onboarding, no OTP/social login, no infrastructure beyond Supabase (no Redis, queues or microservices). Real-time updates are plain polling every few seconds.
