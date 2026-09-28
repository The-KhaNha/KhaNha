# Deployment

Environments, configuration, database changes and production setup. The environment diagram is in
[ARCHITECTURE.md](ARCHITECTURE.md#2-environments-and-configuration). Day-to-day local start-up is in the
[README](../README.md#quick-start).

> Production is changed by a person, never by an agent or a test run: `npm run db:push:production` and
> `npm run seed -- --production` are run by the user only. Tests run against local Supabase only
> ([TESTING.md](TESTING.md#the-test-target-guard-server)).

## Environments

| Environment  | Supabase project                                                                                       | Used by                                          |
| ------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `local`      | Docker stack from `npm run db:start` (`http://127.0.0.1:54321`)                                        | day-to-day development, `./start.sh`, `npm test` |
| `staging`    | `xkddnlxeeizaqpefhqlv` (`https://xkddnlxeeizaqpefhqlv.supabase.co`)                                    | shared testing before release                    |
| `production` | a second hosted project; its ref goes in `PRODUCTION_REF` in `server/scripts/db-push.sh` (empty today) | the live app                                     |

Each environment is a separate Supabase project with its own database, users and keys. Project refs are not secret:
they are the subdomain of the project URL (`server/scripts/db-push.sh`).

### API and client must point at the same project

Access tokens are signed per project. A token from one project fails verification in an API pointed at another, and
the user sees "Your session has expired. Please sign in again." So:

- `server/.env` → `SUPABASE_URL` (and `APP_ENV`) and
- `client/.env.<mode>` → `VITE_SUPABASE_URL`

must name the same project. `start.sh` enforces this for local and staging by reading `APP_ENV` from `server/.env`
and starting Vite in the matching mode (`local` → `npm run dev`, `staging` → `npm run dev:staging`). It refuses
`APP_ENV=production`.

## Server environment variables

Read from `server/.env` (copy `server/.env.example`) or the host's environment. Validated at start-up by
`server/src/utils/env.ts`: on any problem the process prints `Invalid environment configuration. Check server/.env
(see .env.example):` with one line per variable and exits with code 1.

| Variable                                                               | Required        | Default                         | Rule                                                         | Purpose                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | --------------- | ------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                                                              | yes             |                                 | `local`, `staging` or `production`                           | which project this process talks to; `start.sh` picks the client mode from it; `npm run seed` refuses the demo reset on `production`; logger output and default level                                                                                                      |
| `SUPABASE_URL`                                                         | yes             |                                 | a URL                                                        | the project URL, e.g. `http://127.0.0.1:54321` or `https://<ref>.supabase.co`                                                                                                                                                                                              |
| `SUPABASE_SECRET_KEY`                                                  | yes             |                                 | starts with `sb_secret_` (legacy JWT keys are rejected)      | the project's secret key (Project Settings → API Keys). Bypasses RLS. Never in the client or git                                                                                                                                                                           |
| `NODE_ENV`                                                             | no              |                                 | any                                                          | `production` in the API image (set by the Dockerfile): turns the pretty log transport off, so logs are JSON lines                                                                                                                                                          |
| `SUPABASE_JWKS_URL`                                                    | no              | derived from `SUPABASE_URL`     | a URL                                                        | where to fetch the token signing keys when `SUPABASE_URL` is plain `http` on a host other than localhost (a container reaching the local stack at `host.docker.internal`); see [Containers](#signed-in-requests-from-a-container-supabase_jwks_url)                        |
| `SESSION_IDLE_DAYS`                                                    | no              | `7`                             | integer 1–90                                                 | days a sign-in survives without use, served as `session.idleDays` by `GET /api/config`; must equal `auth.sessions.inactivity_timeout` in `supabase/config.toml` and the hosted dashboard ([CONFIGURATION.md](CONFIGURATION.md#deployment-settings))                        |
| `PORT`                                                                 | no              | `8000`                          | positive integer                                             | API port. `start.sh` reads it for its probes and passes it to the web app's dev proxy (`VITE_API_PROXY_TARGET`)                                                                                                                                                            |
| `PUBLIC_READ_TTL_MS`                                                   | no              | `10000`                         | integer 0–600000                                             | how long public reads (menu, store, site settings) stay in the per-process cache (`utils/cache.ts`); 0 turns it off. Another instance may serve an admin's change up to this late                                                                                          |
| `TRUST_PROXY_HOPS`                                                     | no              | `0`                             | integer 0–10                                                 | proxies in front of the API whose `X-Forwarded-For` Express trusts for `req.ip` (`app.set('trust proxy', …)`); compose sets 1 for its nginx. 0 means `req.ip` is the socket peer and cannot be spoofed                                                                     |
| `CLIENT_ORIGIN`                                                        | no              | `http://localhost:5173`         | a URL                                                        | the one origin CORS allows                                                                                                                                                                                                                                                 |
| `GIT_COMMIT`                                                           | no              | `unknown`                       | non-empty string                                             | the commit the build came from; reported by `GET /api/health`. Set by the image build (`--build-arg GIT_COMMIT`)                                                                                                                                                           |
| `KEEP_ALIVE_TIMEOUT_MS`                                                | no              | `65000`                         | positive integer                                             | idle keep-alive timeout; must exceed the load balancer's idle timeout (60 s on an ALB), or Node closes a connection the balancer is about to reuse and the request fails with a 502. `headersTimeout` is set 1 s above it                                                  |
| `LOG_LEVEL`                                                            | no              | `debug` on `local`, else `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` | minimum log level (see [LOGGING.md](LOGGING.md#tuning-per-environment))                                                                                                                                                                                                    |
| `SEED_STAFF_PASSWORD`, `SEED_ADMIN_PASSWORD`, `SEED_CUSTOMER_PASSWORD` | seed on staging |                                 | 12+ characters each                                          | read only by `npm run seed` (the API never needs them): the staging passwords of the three demo accounts; local uses the ones published in [README.md](../README.md#test-accounts). On staging the seed refuses to run (before wiping anything) and names the missing ones |

`server/.env.example` holds the local stack's default values; the local secret key there is the Supabase CLI's
fixed local default, printed by `npm run db:start`. Hosted keys go in `server/.env` (staging) or the host's
environment (production), never in git.

Other variables read outside `env.ts`:

| Variable                                                  | Read by                                                   | Purpose                                                                                                                                                                                   |
| --------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_DB_PASSWORD`                                    | Supabase CLI in `db-push.sh`                              | the hosted database password, instead of the interactive prompt                                                                                                                           |
| `TEST_TARGET`, `ALLOW_STAGING_TESTS`, `TEST_STAGING_HOST` | `server/test/setup/target.ts`, `server/vitest.config.mts` | which project a test run may touch; on `TEST_TARGET=staging`, `TEST_STAGING_HOST` must be set and match `SUPABASE_URL`'s host (see [TESTING.md](TESTING.md#the-test-target-guard-server)) |

## Client environment variables

Vite loads `client/.env.<mode>`. The values are public (they ship in the JS bundle), so the per-mode files are
committed. Never put a secret key (`sb_secret_…`) in any client file.

| Variable                        | Required | Purpose                                                                                                                               |
| ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | yes      | the project the browser signs in to; same project as the API's `SUPABASE_URL`                                                         |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes      | that project's publishable key (`sb_publishable_…`); RLS keeps it out of every table                                                  |
| `VITE_DEV_PORT`                 | no       | the dev server port (default 5173, `strictPort`); `start.sh` reads it                                                                 |
| `VITE_API_PROXY_TARGET`         | no       | where the dev server proxies `/api` (default `http://localhost:8000`; `start.sh` sets it from `server/.env`'s `PORT` when unset)      |
| `VITE_REQUEST_TIMEOUT_MS`       | no       | the client's request timeout in ms (default 15000)                                                                                    |
| `VITE_LOG_LEVEL`                | no       | `debug`, `info`, `warn`, `error` or `silent`; unset: `debug` in dev, `warn` in builds; `debug`/`info` are no-ops in production builds |

Types: `client/src/vite-env.d.ts`. Template: `client/.env.example`.

| File                      | Mode          | Used by                                        | In the repo                                      |
| ------------------------- | ------------- | ---------------------------------------------- | ------------------------------------------------ |
| `client/.env.development` | `development` | `npm run dev`                                  | yes                                              |
| `client/.env.staging`     | `staging`     | `npm run dev:staging`, `npm run build:staging` | yes                                              |
| `client/.env.production`  | `production`  | `npm run build`                                | **no**, create it for the first production build |

`client/vite.config.ts` throws `Missing VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY for mode "<mode>". Create
client/.env.<mode> (see client/.env.example).` when either required variable is missing, for the dev server and for
builds alike. `client/src/lib/supabase.ts` throws at runtime for the same reason.

The client calls the API at `/api` on its own origin (`BASE_URL` in `client/src/services/api.ts`). Only the Vite dev
server proxies `/api` to `http://localhost:8000`. A production host has to serve the API under `/api` on the client's
origin (and set `CLIENT_ORIGIN` to that origin); the web image's nginx does exactly that ([Containers](#containers)).
In the web image, each of these values can also be set at start ([runtime environment](#web-image-runtime-environment)).

## Builds

| Package | Command                 | Output         | Notes                                                                                                                         |
| ------- | ----------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| server  | `npm run build`         | `server/dist/` | `tsc -p tsconfig.build.json` (`src/` and `scripts/` only, tests never ship); run with `npm start` (`node dist/src/server.js`) |
| client  | `npm run build`         | `client/dist/` | `tsc --noEmit` then `vite build` in production mode; **requires `client/.env.production`**                                    |
| client  | `npm run build:staging` | `client/dist/` | same, with `client/.env.staging`                                                                                              |

`npm start` does not load `tsx`; it needs `npm run build` first. `server.ts` loads `dotenv/config`, so a
`server/.env` is read if present; on a host, set the variables in its environment instead.

### Compressing photos before a build

`python3 client/scripts/optimize-images.py` (needs Pillow: `pip3 install pillow`) re-encodes every `<name>.jpg`
under `client/public/images/` in place (≤900px wide, quality 72, progressive) and writes the `<name>-400.jpg`
thumbnail `FoodPhoto`'s `srcset` needs (`lib/photo.ts`). Run it once after adding or replacing a photo, before
committing — `client/src/lib/photo.test.ts` fails on a photo missing its thumbnail. It skips a photo that already
has a thumbnail, so running it again never re-compresses (and degrades) an image twice. See
[FRONTEND_STRUCTURE.md#photo-thumbnails](FRONTEND_STRUCTURE.md#photo-thumbnails).

## Schema changes

Schema changes are SQL files in `server/supabase/migrations/`, applied in order everywhere. Once a migration has been
pushed, it is never edited: later changes go in a new file. The CLI records what it applied in each project's
`supabase_migrations` history table, so `db:push` only sends new files. Anything new must enable RLS and grant
explicitly (see [PERMISSIONS.md](PERMISSIONS.md#database)).

```bash
cd server
npm run db:new add_something       # creates supabase/migrations/<timestamp>_add_something.sql
npm run db:reset                   # local: rebuild the local database from all migrations (wipes local data)
npm run db:types                   # regenerate src/types/database.ts from the local database
npm run db:push:staging            # apply new migrations to staging
npm run db:push:production         # the same for production (user only)
```

```mermaid
flowchart TD
  New["npm run db:new add_something<br/>→ supabase/migrations/timestamp_add_something.sql"] --> Write["Write the SQL<br/>(enable RLS + grant explicitly for anything new)"]
  Write --> Reset["npm run db:reset<br/>rebuild the local database from all migrations"]
  Reset --> Types["npm run db:types<br/>regenerate src/types/database.ts"]
  Types --> Code["Update services, run npm run typecheck,<br/>npm run seed, try it with ./start.sh"]
  Code --> PR["Commit migration + types + code"]
  PR --> Stg["npm run db:push:staging<br/>(supabase login once, DB password)"]
  Stg --> Verify["Point server/.env at staging (APP_ENV=staging), run ./start.sh, check"]
  Verify --> Prod["npm run db:push:production<br/>type 'production' to confirm, CLI lists migrations and asks again"]
  Prod --> Deploy["Deploy the API and web app build that expect the new schema"]
```

`20260927094610_admin_settings_collected.sql` (the `ADMIN` role, `COMPLETED` → `COLLECTED`, `site_settings`) is
applied locally by `db:reset` already; staging needs `npm run db:push:staging` run once before a staging build (which
ships the renamed status and the admin dashboard) can be pointed at it.

### Applying migrations

`server/scripts/db-push.sh <staging|production>`:

1. `staging` uses `STAGING_REF`, `production` uses `PRODUCTION_REF`. Any other argument prints the usage and exits 1.
2. An empty ref (today: `PRODUCTION_REF`) stops with "PRODUCTION_REF is empty. Create the production project, then
   set it in server/scripts/db-push.sh."
3. For `production` it asks you to type `production`; anything else prints "Cancelled." and exits 1.
4. Runs `npx supabase db push --project-ref <ref>`. The CLI asks for the database password (or reads
   `SUPABASE_DB_PASSWORD`), lists the migrations it will apply, and asks before applying them.

One-time: `npx supabase login` (opens the browser).

## Seeding

Code: `server/scripts/seed.ts`. It seeds whichever project `server/.env` points at.

```mermaid
flowchart TD
  Run["npm run seed [-- --production]"] --> E{"APP_ENV"}
  E -->|"local / staging"| F1{"--production passed?"}
  F1 -->|"yes"| Err1["Fail: flag does not match APP_ENV"]
  F1 -->|"no"| Demo
  E -->|"production"| F2{"--production passed?"}
  F2 -->|"no"| Err2["Fail: the demo seed would wipe production"]
  F2 -->|"yes"| HasStore{"a store already exists?"}
  HasStore -->|"yes"| NoOp["Change nothing, edit the live menu in the dashboard"]
  HasStore -->|"no"| ProdSet["Create store + 11 menu items<br/>no accounts, no wipes"]
  ProdSet --> ProdMsg["Print how to add staff:<br/>dashboard Add user, then set profiles.role = STAFF in SQL"]

  subgraph Demo["Demo reset (local / staging)"]
    D1["rpc reset_demo_orders()<br/>TRUNCATE order_items, orders RESTART IDENTITY → next order 1001"] --> D2["Upsert the single store"]
    D2 --> D3["Upsert 11 menu items by name (ids kept),<br/>reset stock: Cheese Toast 1, Brownie 2, Muffin 5,<br/>delete items no longer in the list"]
    D3 --> D4["For each test account (STAFF, ADMIN, CUSTOMER): auth.admin create or update<br/>(confirmed; published passwords on local, SEED_*_PASSWORD on staging),<br/>then set profile name, phone, role"]
    D4 --> D5["Delete every other Auth user (profiles cascade)"]
    D5 --> D6["Reset site_settings to defaults (20 / 100)"]
    D6 --> D7["Print summary + account roles (no emails/passwords, see README.md Test accounts)"]
  end
```

- **Demo reset** (`npm run seed`, `APP_ENV` local or staging): deletes every order, restarts numbering at #1001,
  updates the store, the 11 menu items and the three test accounts (staff, admin, customer) in place (their ids
  survive, so open browsers keep working), resets `site_settings` to its defaults (20 / 100), and deletes every
  other account.
- **Production setup** (`npm run seed -- --production`, `APP_ENV=production`): creates the store and menu only while
  production has no store. It creates no accounts and wipes nothing.

## Local and staging

- **Local**: `cd server && npm run db:start` (Docker) applies every migration. `cp server/.env.example server/.env`
  needs no edits. Then `./start.sh --seed` once, `./start.sh` after that. See the [README](../README.md#quick-start).
- **Staging, once**: `npm run db:push:staging`, then put the staging URL and secret key in `server/.env` with
  `APP_ENV=staging` and the three `SEED_*_PASSWORD`s (never the published demo passwords; see [server environment
  variables](#server-environment-variables)), and run `npm run seed` for the demo data.

### start.sh

```mermaid
flowchart TD
  S["./start.sh [--seed]"] --> Env{"server/.env exists?"}
  Env -->|"no"| X1["Exit: cp server/.env.example server/.env"]
  Env -->|"yes"| App{"APP_ENV"}
  App -->|"local"| Up{"http://127.0.0.1:54321 answers?"}
  Up -->|"no"| X2["Exit: cd server && npm run db:start"]
  Up -->|"yes"| ModeL["client script = dev"]
  App -->|"staging"| ModeS["client script = dev:staging"]
  App -->|"production"| X3["Exit: start.sh is for local and staging only"]
  App -->|"anything else"| X4["Exit: set APP_ENV"]
  ModeL --> Deps
  ModeS --> Deps
  Deps["npm install where node_modules is missing"] --> Ports["Kill anything listening on 8000 and 5173"]
  Ports --> Seed{"--seed?"}
  Seed -->|"yes"| RunSeed["cd server && npm run seed"]
  Seed -->|"no"| Start
  RunSeed -->|"fails"| X5["Exit: database not migrated?"]
  RunSeed -->|"ok"| Start
  Start["Start API (tsx watch) and Vite in the chosen mode<br/>logs → .logs/server.log, .logs/client.log"] --> Wait{"/api/health and :5173 return 200<br/>within 45 s?"}
  Wait -->|"no"| X6["Stop both, point at the logs"]
  Wait -->|"yes"| Menu{"/api/menu returns 200?"}
  Menu -->|"no"| X7["Stop both: database empty or unreachable, run --seed"]
  Menu -->|"yes"| Ready["Print URLs, test logins and APP_ENV, wait for Ctrl+C"]
```

## Production first-time setup

Run by the user, once.

1. Create a new project in the Supabase dashboard (a region near your users; save the database password).
2. Put its ref in `PRODUCTION_REF` in `server/scripts/db-push.sh`, then `npm run db:push:production`.
3. Create `client/.env.production` with its `VITE_SUPABASE_URL` and publishable key (see `client/.env.example`).
   `npm run build` refuses to run without it.
4. On the production API host set `APP_ENV=production`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `PORT`,
   `CLIENT_ORIGIN` and optionally `LOG_LEVEL`.
5. Load the store and menu once, with the production values in the environment: `npm run seed -- --production`. It
   only works while production has no store, and creates no accounts. The plain `npm run seed` refuses to run
   against production.
6. Create staff and admin accounts in the dashboard (Authentication → Add user, with auto-confirm), then in the SQL
   editor: `update public.profiles set role = 'STAFF' where email = '…';` for staff, or
   `update public.profiles set role = 'ADMIN' where email = '…';` for the site-wide developer/operator role (the
   `/admin` dashboard — see [PERMISSIONS.md#roles](PERMISSIONS.md#roles)).
7. Recommended in the dashboard (Authentication → Sign In / Providers): turn off **Allow new users to sign up**.
   Accounts are created by the API's `/auth/register` with the secret key, which still works; this closes direct
   sign-ups with the publishable key.
8. Recommended in the dashboard (Authentication → Sessions): set the same idle-session limit as local
   (see [Hosted session timeout](#hosted-session-timeout) below).

```mermaid
sequenceDiagram
  autonumber
  actor Dev as Developer
  participant Dash as Supabase dashboard
  participant CLI as Supabase CLI (db-push.sh)
  participant Prod as Production project
  participant Host as API host
  participant Seed as npm run seed

  Dev->>Dash: create project (region, DB password)
  Dev->>Dev: PRODUCTION_REF in server/scripts/db-push.sh
  Dev->>CLI: npm run db:push:production
  CLI->>Prod: apply all migrations
  Dev->>Dev: client/.env.production (URL + publishable key), npm run build
  Dev->>Host: set APP_ENV=production, SUPABASE_URL, SUPABASE_SECRET_KEY, PORT, CLIENT_ORIGIN
  Dev->>Seed: npm run seed -- --production (production env vars)
  Seed->>Prod: store + menu only (refuses if a store exists)
  Dev->>Dash: Authentication → Add user for each staff/admin member (auto-confirm)
  Dev->>Dash: SQL editor: update public.profiles set role = 'STAFF'/'ADMIN' where email = ...
  Dev->>Dash: turn off Allow new users to sign up (the API's /auth/register still works)
  Dev->>Dash: Authentication → Sessions: set the inactivity timeout to 168h (7 days), matching local
```

## Hosted session timeout

A sign-in lasts 7 days without use (`client/src/features/auth/sessionActivity.ts`, `server/supabase/config.toml`'s
`[auth.sessions] inactivity_timeout = "168h"` for the local stack — see
[PERMISSIONS.md#session-lifetime](PERMISSIONS.md#session-lifetime)). `config.toml` only configures the local Docker
stack; a hosted project (staging or production) needs the same limit set by hand, because
**`inactivity_timeout` is a paid-plan setting only available in the Supabase dashboard** (Authentication → Sessions →
"Time-box user sessions" / inactivity), not in a config file. `jwt_expiry` (the 1 h access token lifetime) is a
project setting too but its default already matches `config.toml`'s `3600`. Until this is set on a hosted project,
the client's own 7-day check still runs, but Supabase's refresh token itself will not expire on inactivity.

## Containers

Two images, built from `server/Dockerfile` and `client/Dockerfile`. One image of each serves every environment:
the web image takes its Supabase values at start, not at build.

```bash
docker build -t fp-api --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) server
docker build -t fp-web --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) client
```

| Image    | Base                                                | Runs                                       | Port   | Health check                 | Size budget |
| -------- | --------------------------------------------------- | ------------------------------------------ | ------ | ---------------------------- | ----------- |
| `fp-api` | `node:24-alpine` (deps → build → runtime stages)    | `node dist/src/server.js` as `node`, PID 1 | `8000` | `GET /api/health` on `$PORT` | 200 MB      |
| `fp-web` | `nginxinc/nginx-unprivileged:1.27-alpine` (uid 101) | nginx serving `dist/` and proxying `/api/` | `8080` | `GET /healthz`               | 50 MB       |

- **`fp-api`** installs with `npm ci --ignore-scripts` (no Supabase CLI binary), keeps `dist/scripts` so staging can
  be seeded with `node dist/scripts/seed.js` (it refuses `APP_ENV=production`), and sets `NODE_ENV=production` and
  `GIT_COMMIT` from the build arg. Its environment is the [server table above](#server-environment-variables).
- **`fp-web`** builds with `npm run build:container` (`vite build --mode container`, placeholders from the committed
  `client/.env.container`; `vite.config.ts` skips its required-env check in that mode). At start the image's
  entrypoint renders `nginx/default.conf.template` and `nginx/security.conf.template` (substituting only variables
  that are set, so nginx's `$uri` survives), then `nginx/runtime-env.sh` writes `/runtime-env.js`.

### Web image runtime environment

| Variable                   | Required | Purpose                                                                                            |
| -------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `API_UPSTREAM`             | yes      | where `/api/` is proxied, e.g. `http://api:8000`; **no trailing slash** (nginx would strip `/api`) |
| `SUPABASE_URL`             | yes      | the project the browser signs in to (browser-side URL); also the CSP's `connect-src`               |
| `SUPABASE_PUBLISHABLE_KEY` | yes      | that project's publishable key                                                                     |
| `LOG_LEVEL`                | no       | the browser console level (as `VITE_LOG_LEVEL`)                                                    |
| `REQUEST_TIMEOUT_MS`       | no       | the client's request timeout (default 15000)                                                       |

`runtime-env.sh` refuses to start when a required value is empty or any value contains a quote, backslash or `<`. It
writes `window.__RUNTIME_ENV__ = {…}` to `/tmp/runtime-env/runtime-env.js` (uid 101 cannot write the html
directory); nginx serves it at `/runtime-env.js`, shadowing the empty `client/public/runtime-env.js` that
development uses. `index.html` loads it as a classic script before the app, and `lib/runtimeEnv.ts` reads each value
as runtime first, then the build's `VITE_` value.

### Web image headers

| Path                                         | `Cache-Control`                       | Why                                                                      |
| -------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| `/assets/*`                                  | `public, max-age=31536000, immutable` | Vite hashes these names; a changed file is a new URL                     |
| `/images/*`                                  | `public, max-age=604800` (a week)     | photos change rarely and are not fingerprinted                           |
| `/index.html`, SPA routes, `/runtime-env.js` | `no-cache`                            | a deploy or a config change must reach a returning visitor at once       |
| `/api/*`                                     | the API's own `no-cache`              | stock, menu and orders are always revalidated ([API.md](API.md#caching)) |

Every location also sends `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: camera=(self)` and, in P0, **`Content-Security-Policy-Report-Only`**: `default-src 'self';
script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com;
img-src 'self' data:; connect-src 'self' ${SUPABASE_URL}; frame-ancestors 'none'; base-uri 'self'`. The snippet is
included in each location because an `add_header` inside a location drops every inherited one. Moving the CSP to
enforcing is a user decision, once staging shows no reports. gzip is on for text, CSS, JavaScript, JSON and SVG.
`/api/` is proxied with HTTP/1.1, `Host`, `X-Forwarded-For`, `X-Forwarded-Proto` and a 30 s read timeout.

### Signed-in requests from a container (`SUPABASE_JWKS_URL`)

Found while testing the images against the local stack: with the API at
`SUPABASE_URL=http://host.docker.internal:54321`, every signed-in request failed with a 500 whose log says `A JWT
was provided but no JWKS is configured`, while public routes worked. `@supabase/server` derives the token signing
keys' URL (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`) only from an `https` or `localhost` URL, and
`host.docker.internal` is neither, so it had no keys to verify against. The API does not check the token's issuer.

The fix is `SUPABASE_JWKS_URL`: when set, `utils/supabase.ts` passes it to `@supabase/server` as an explicit `jwks`,
which skips the derivation. `compose.yaml` sets it to
`http://host.docker.internal:54321/auth/v1/.well-known/jwks.json`. Hosted projects need nothing: their URL is
`https`. (Host networking with `SUPABASE_URL=http://127.0.0.1:54321` also works on Linux, but not on Docker
Desktop, where "host" is Docker's VM.)

### Local compose

`compose.yaml` at the root runs both images against the Supabase stack on the host (Supabase itself stays on the host):

```bash
cd server && npm run db:start && npm run seed && cd ..
export SUPABASE_PUBLISHABLE_KEY=$(grep VITE_SUPABASE_PUBLISHABLE_KEY client/.env.development | cut -d= -f2)
GIT_COMMIT=$(git rev-parse --short HEAD) docker compose up --build web api     # http://localhost:8080
docker compose ps                                                             # both (healthy)
```

| Service | Image     | Port   | Environment (on top of `server/.env` for `api`)                                                                                                                                                    |
| ------- | --------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api`   | `server/` | –      | `SUPABASE_URL=http://host.docker.internal:54321`, `SUPABASE_JWKS_URL` ([why](#signed-in-requests-from-a-container-supabase_jwks_url)), `CLIENT_ORIGIN=http://localhost:8080`, `TRUST_PROXY_HOPS=1` |
| `web`   | `client/` | `8080` | `API_UPSTREAM=http://api:8000`, `SUPABASE_URL=http://127.0.0.1:54321` (the browser's view), `SUPABASE_PUBLISHABLE_KEY` from your shell                                                             |

`web` waits for `api` to be healthy (`depends_on: condition: service_healthy`), because nginx resolves the upstream
when it starts. The web container refuses to start without `SUPABASE_PUBLISHABLE_KEY`. Seed through the image with
`docker compose run --rm api node dist/scripts/seed.js`. `worker`, `reconciler` and `minio` are commented placeholders
for P1 and P3.

### Running the images by hand

```bash
docker run --rm -p 8000:8000 --env-file server/.env --add-host host.docker.internal:host-gateway \
  -e SUPABASE_URL=http://host.docker.internal:54321 \
  -e SUPABASE_JWKS_URL=http://host.docker.internal:54321/auth/v1/.well-known/jwks.json fp-api
docker run --rm -p 8080:8080 -e API_UPSTREAM=http://host.docker.internal:8000 --add-host host.docker.internal:host-gateway \
  -e SUPABASE_URL=http://127.0.0.1:54321 -e SUPABASE_PUBLISHABLE_KEY=<local publishable key> fp-web
curl -i localhost:8080/runtime-env.js   # no-cache, the runtime values; /assets/* immutable; /menu serves index.html
```

`server/.env` works as a `--env-file` because its values are unquoted (Docker passes quotes through literally). The
image logs JSON lines even with `APP_ENV=local`: `NODE_ENV=production` turns pino-pretty (a dev dependency) off.
