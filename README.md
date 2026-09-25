# Food Pickup — V0

Order ahead from **Campus Cafe**, pay in a tap (simulated), and collect your food at the counter without standing in the ordering queue.
One shop, one staff screen, real-time-enough status updates, and everything runs on localhost.

- **Customer app:** http://localhost:5173
- **Staff dashboard:** http://localhost:5173/staff
- **API:** http://localhost:8000/api (health check: http://localhost:8000/api/health)

## Prerequisites

- **Node 20+** (`node --version`; built and tested with Node 26)
- **PostgreSQL** installed locally — Homebrew (`brew install postgresql@18`) or [Postgres.app](https://postgresapp.com). Tested with PostgreSQL 18 from Homebrew.

## Quick start

The one-time setup is four commands; after that `./start.sh` runs everything.

**1. Start PostgreSQL**

```bash
brew services start postgresql@18     # Homebrew — or open Postgres.app and click Start
pg_isready                            # should print "accepting connections"
```

**2. Create the database**

```bash
createdb food_pickup
```

**3. Configure the server**

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:
- `DATABASE_URL` — put your Mac username in it (run `whoami`): `postgresql://<mac-username>@localhost:5432/food_pickup`. Homebrew Postgres accepts your Mac username with no password; if yours needs one, use `postgresql://user:password@localhost:5432/food_pickup`.
- `JWT_SECRET` — any string of 16+ characters. The server refuses to start while it is still the placeholder; `openssl rand -hex 32` generates a good one.

**4. Create the tables**

```bash
cd server && npm install && npx prisma migrate dev && cd ..
```

This creates the 5 tables (User, Store, MenuItem, Order, OrderItem) and generates the Prisma client.

**5. Run it**

```bash
./start.sh --seed          # first time: loads Campus Cafe, 11 menu items and the two test accounts
./start.sh                 # every time after that
```

It prints the URLs and logins when both servers answer. Press **Ctrl+C** once to stop both.

### What `start.sh` does

- Stops with a clear message if `server/.env` is missing or PostgreSQL is not running.
- Runs `npm install` in `server/` and `client/` if `node_modules` is missing.
- **Frees ports 8000 and 5173 first** — anything still listening on them (a stray `npm run dev`, an earlier `start.sh`) is killed. Don't run it while another copy of the project is deliberately serving those ports.
- `--seed` runs `npm run seed` before starting (see [Re-seeding wipes orders](#re-seeding-wipes-orders)).
- Starts the API (`tsx watch`, auto-reloads on server edits) and the web app (Vite, hot reloads client edits). Their output goes to **`.logs/server.log`** and **`.logs/client.log`** (gitignored) — look there when something misbehaves.
- Waits until `GET /api/health`, the web app and `GET /api/menu` all return 200. If the API is up but the menu isn't, it says **"Database looks empty or unreachable — run ./start.sh --seed"** and stops.
- Does *not* create the database or run migrations — that is steps 1–4 above.

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
npm run dev
```

The Vite dev server proxies `/api/*` to `http://localhost:8000`, so the client needs no configuration.

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

Base URL `http://localhost:8000/api`. Authenticated routes take `Authorization: Bearer <token>` (7-day JWT from register/login).

| Method | Path                      | Auth       | Purpose                                                        |
|--------|---------------------------|------------|----------------------------------------------------------------|
| POST   | `/auth/register`          | –          | `{ name, email, password, phone? }` → `{ user, token }`        |
| POST   | `/auth/login`             | –          | `{ email, password }` → `{ user, token }`                      |
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
| 401    | `UNAUTHORIZED`, `INVALID_CREDENTIALS` |
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
- Stock is reserved inside the order's transaction with a conditional decrement (`stockQuantity >= quantity`), so two customers can never both get the last unit; a refused order leaves no rows and no decrements behind.
- Allowed transitions are `PLACED → PREPARING → READY → COMPLETED`, plus `PLACED/PREPARING → CANCELLED` by staff. The update is a single conditional write, so two staff devices pressing at once get exactly one 200 and one 409. Cancelling puts the order's items back in stock in the same transaction.

## Project structure

```
food-pickup/
├── client/                      React 18 + TypeScript + Vite 6 + Tailwind v4
│   ├── index.html               font preload + first-paint background
│   ├── vite.config.ts           dev server on :5173, proxies /api → http://localhost:8000
│   ├── public/images/           food and cafe photos
│   └── src/
│       ├── index.css            Tailwind + design tokens (@theme: brand/gold/success/cancel, bg/surface/ink/muted/line)
│       ├── components/          Button, FoodCard, AddControl, QuantityStepper, PopularRail, StoreCard, CartItem, OrderCard, StatusTracker, TopBar, BottomNav, ...
│       ├── features/
│       │   ├── auth/            authStore (zustand + localStorage), validation, RequireAuth, RequireStaff
│       │   ├── cart/            cartRules (MAX_LINE_QUANTITY = 20, stock limits, line problems), cartStore, CartBar, useReorder
│       │   ├── menu/            useMenu, useStore, CategoryChips, ItemDetailSheet
│       │   └── orders/          orderStatus (single source of truth for statuses), useOrder(s) polling, OrderHero, StaffHeader/Filters/Board, StaffOrderCard
│       ├── lib/                 cn, format, useResource (fetch + polling), useFocusTrap, useNow, useReducedMotion, flyToCart
│       ├── pages/               Home, Menu, Cart, Checkout, OrderSuccess, Order, Orders, Profile, Login, Register, StaffDashboard, NotFound
│       ├── services/            api.ts (fetch wrapper) + auth/store/menu/orders
│       ├── types/api.ts         the API contract types
│       ├── App.tsx              routes + per-route shell (top bar, cart button, bottom nav)
│       └── main.tsx
├── server/                      Express 5 + TypeScript + Prisma 6 + PostgreSQL
│   ├── .env.example             copy to .env (see Environment variables)
│   ├── prisma/                  schema.prisma, migrations/, seed.ts
│   └── src/
│       ├── routes/              thin route tables
│       ├── controllers/         parse request → call service → send JSON
│       ├── services/            business logic (auth, menu, store, order, payment simulation)
│       ├── middleware/          requireAuth / requireStaff, zod validation, error handler
│       ├── schemas/             zod request schemas (auth, order, shared phone/optional fields)
│       ├── types/               API DTOs, auth user, Express request augmentation
│       ├── utils/               env, prisma client, jwt, password hashing, errors, serializers
│       └── server.ts
├── .logs/                       server.log / client.log written by start.sh (gitignored)
├── start.sh                     starts both servers (see "What start.sh does")
└── README.md
```

Ports: API **8000**, web app **5173**. Both are fixed: the Vite proxy target (`client/vite.config.ts`) and `start.sh` hardcode 8000, and Vite runs with `--strictPort` on 5173.

## Environment variables

`server/.env` (copy from `server/.env.example`):

| Variable        | Purpose                                              | Example                                                |
|-----------------|------------------------------------------------------|--------------------------------------------------------|
| `DATABASE_URL`  | PostgreSQL connection string                         | `postgresql://anish@localhost:5432/food_pickup`        |
| `JWT_SECRET`    | Signs login tokens. 16+ characters; the server exits at startup if it is still the `.env.example` placeholder | output of `openssl rand -hex 32` |
| `PORT`          | API port (default `8000`). **Keep it at 8000** unless you also change the proxy target in `client/vite.config.ts` and the port checks in `start.sh` | `8000` |
| `CLIENT_ORIGIN` | Origin allowed by CORS (default `http://localhost:5173`) | `http://localhost:5173`                            |

The client has no environment variables; it calls `/api` relative to its own origin and Vite proxies that to the API.

## Stock limits

Menu items can carry a `stockQuantity` (`null` = not tracked, which is the default). Three seeded items are limited so the flow can be demoed: **Cheese Toast 1**, **Chocolate Brownie 2**, **Blueberry Muffin 5**.

- The menu shows a gold **"Only N left"** chip on items with 1–5 left. Every **+** (card, item sheet, cart) stops at what is left and says "Only N available"; tapping it past the limit shakes instead of changing anything.
- Placing an order decrements stock atomically; at 0 the item shows as **Sold out** and cannot be added. Staff cancelling an order (**PLACED/PREPARING → CANCELLED**) puts its items back.
- If stock changes while something sits in a cart (someone else bought the last one), the cart and checkout ring the exact line in paprika, label it ("Only 1 left" / "Sold out"), block the pay button with a reason that names the item, and offer a one-tap **Fix** that trims the line to what is available or removes it. The server error (`INSUFFICIENT_STOCK`) names the item too — never "some item is not available".
- **Order Again** adds a past order on top of the current cart, capped by current stock, and lists anything it could not add in full ("Cheese Toast: only 1 left, added 1", "Berry Smoothie is sold out, skipped").
- `npm run seed` resets the three counts above (and clears every order).

## Re-seeding wipes orders

`npm run seed` (in `server/`, or `./start.sh --seed`) deletes **every order** and restarts numbering at **#1001**. The store, menu items and the two test accounts are updated in place and keep their ids, so logins and saved carts in an open browser keep working. Accounts registered while testing are removed.

## Useful scripts

| Where    | Command              | What it does                                   |
|----------|----------------------|------------------------------------------------|
| root     | `./start.sh [--seed]`| Start (and optionally reseed) everything       |
| server/  | `npm run dev`        | API with reload (tsx watch) on :8000           |
| server/  | `npm run seed`       | Reset demo data (see above)                    |
| server/  | `npm run typecheck`  | `tsc --noEmit`                                 |
| server/  | `npm run db:migrate` | `prisma migrate dev`                           |
| server/  | `npm run db:generate`| `prisma generate` (regenerate the Prisma client) |
| server/  | `npm run build` / `npm start` | Compile to `dist/` and run `dist/src/server.js` without tsx |
| client/  | `npm run dev`        | Vite dev server on :5173 with `/api` proxy     |
| client/  | `npm run typecheck`  | `tsc --noEmit`                                 |
| client/  | `npm run build`      | Type-check + production build into `dist/`     |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `EADDRINUSE: address already in use :::8000` or Vite's `Port 5173 is already in use` | Something from an earlier run is still listening. `./start.sh` frees both ports for you; by hand: `lsof -ti:8000 -ti:5173 \| xargs kill`. |
| `role "YOUR_MAC_USERNAME" does not exist` / `password authentication failed` | `DATABASE_URL` in `server/.env` still has the placeholder or the wrong user. Use the output of `whoami` (Homebrew) or your Postgres.app user. |
| `database "food_pickup" does not exist` | Run `createdb food_pickup`, then `npx prisma migrate dev` in `server/`. |
| `start.sh` says **"Database looks empty or unreachable"**, or the app shows "The store has not been set up yet" | Tables missing or never seeded. In `server/`: `npx prisma migrate dev`, then `./start.sh --seed` (or `npm run seed`). |
| `@prisma/client did not initialize yet` / `Cannot find module '.prisma/client'` | The Prisma client wasn't generated. In `server/`: `npx prisma generate` (or `npm run db:generate`). |
| `start.sh` says **"server/.env is missing"**, or the API prints `Invalid environment configuration` | `cp server/.env.example server/.env` and set `DATABASE_URL` and `JWT_SECRET`. A `JWT_SECRET` that is too short or still the placeholder is rejected with an explicit message. |
| `PostgreSQL is not running` / `pg_isready` says `no response` | `brew services start postgresql@18`, or start Postgres.app. |
| Blank page on http://localhost:5173 right after starting | Vite is still compiling on the first load; wait a couple of seconds and reload. If it persists, check `.logs/client.log` and the browser console. |
| Customer page never moves past **Placed** | The API isn't reachable through the proxy — is it on port 8000? `curl http://localhost:8000/api/health` should print `{"ok":true}`. |

## What V0 deliberately leaves out

One shop only, and nothing beyond the pickup flow: no delivery, maps or location, no GST/taxes or platform/service/handling fees, no discounts, coupons or loyalty, no recommendations or AI, no QR codes, no real payment gateway (payment is simulated, but the order flow is written so a gateway can slot in later), no refunds or wallets, no inventory or item variants, no push notifications, no reporting/analytics, no merchant onboarding, no OTP/social login or refresh tokens, no cloud infrastructure (no Redis, queues, microservices or Docker). Real-time updates are plain polling every few seconds.
# KhaNha
