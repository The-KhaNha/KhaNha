# Changelog

All notable changes to the API server (`server/package.json`). Written by `npm run release` from `.changes/`.

## 0.4.0 — 2026-11-22

- A payment gateway port and a fake provider for local, CI and staging
- Photo uploads to the bucket are tagged as originals, so an original that is never processed expires after a day.
- db:push:production targets the production Supabase project, now that it exists.

## 0.3.0 — 2026-11-19

- A payment gateway port and a fake provider for local, CI and staging

## 0.2.1 — 2026-11-15

- Update dependencies (Dependabot): Supabase, Express, pino, dotenv 18, lucide-react 1.x and the minor/patch groups.

## 0.2.0 — 2026-11-15

- P0 foundations: Node 24 pin, CI, versioning, health and version reporting, containers and the configuration registry.
- Rate limits per user and address (429 RATE_LIMITED), an idempotencyKey on order placement so a retried Pay never places twice, security headers on the API and the web image, a 500-item menu cap, a session-scoped checkout and sign-up draft that survives refresh and Back and is cleared on every sign-in and sign-out, a 409 IDEMPOTENCY_KEY_REUSED when a retried Pay carries a changed cart, an early 413 on oversized bodies, and layouts that hold at 200% text.
- Validation errors and EMAIL_TAKEN name the field at fault, and sign-up and checkout show the message on that field; a failed Pay scrolls its reason into view.
- The staff board always shows every active order; the staff list limit now caps finished orders only.
- The capped menu cuts in a stable order and logs a warning when the cap bites.
- A password of only spaces is refused.
- Outbox schema: domain events, event subscriptions, dead letters, the queue wrappers and a nightly event purge (pgmq, pg_cron).
- Queue wrappers for the worker (read, delete, retry, dead-letter, metrics) and the job_failures dead-letter table.
- 429 responses carry details { kind: 'rateLimit', retryAfterSeconds }, and a burst logs warn once per key per window; error details are one ErrorDetails union.
- Security: every known advisory fixed (zod 4, body-parser, qs, ip-address, vite, vitest, undici, minimatch); images with no fixable CVE: the web image on nginx 1.31 alpine-slim (34 MB, was 100), the API on plain Alpine with only the node binary (260 MB, was 309).
- Job runner: handlers, retries with backoff and jitter, dead letters, graceful abort; the q_notifications handler (no process runs it yet).
- The job worker: a second process (src/worker.ts) that consumes the queues, with GET /health on WORKER_HEALTH_PORT and a graceful stop; start.sh and compose run it.
- Order placement and every status change emit their domain event with the actor and request id; repeating a status change that already happened answers 200 instead of 409.
- An oversized upload is drained (at most 1 MB or 2 s) before its 413, so a client still sending gets the 413 instead of a connection reset.
- Audit log: every change to site settings, an order's status, a role or a menu item records who made it, from which request, in an append-only table.
- Admins can read the audit log: GET /api/admin/audit lists who changed what, newest first, filtered by entity, actor and time, one page at a time.
- Past orders keep the item photos and store name they were placed with, even after the menu or store changes.
- Browsers can report their errors to POST /api/client-errors, which logs each one as a scrubbed warning.
- Sign-ins left unused for the idle limit (7 days) are now signed out by the server too, so a copied session stops working on hosted projects; a signed-out session's remaining access token is refused as well.
- Admins can switch features on and off, for chosen stores, roles or a share of users, and each switch is recorded with who made it.
- Admins can set the share of visits that report app errors (Error reporting %), and the app reads it from its configuration.
- GET /api/config now lists the client-visible feature flags under features, and stays up with no features if the flags cannot be read.
- Prices and totals are stored in paise behind the API, which still sends whole rupees, and every order line is priced by the database. An order whose price changed after it was charged is refused with 409 `PRICE_CHANGED`, and the checkout then shows the new price before the next Pay.
- The client-error report bounds live in the shared limits, so the browser reporter and the API cannot drift apart.
- A cancelled order gives back only the stock it took, and an account made outside the API gets a profile within the API's name and phone bounds.
- A deeply nested body, a lone UTF-16 surrogate or an invisible-only name is a 400 instead of a 500 or a blank name, text limits count UTF-16 units on both sides, and the client-error scrub catches percent-encoded tokens, passwords and unusual email addresses.
- Drop the whole-rupee money columns; amounts are stored in paise only
- Checkout refuses a cart that shows an old price (PRICE_CHANGED) instead of charging the new one; an order is refused when its item is switched off or its store closes while it is placed; a menu item can no longer cost ₹0.
- Request logs record the path only, and the error scrub catches phone numbers written with slashes or spaced dashes
- Install with pnpm 12 instead of npm; the images build with it through corepack.
- Messages and comments name pnpm instead of npm.
- Brands, and stores gain a slug, brand, area and address; the seed builds two brands and three stores. An order refuses another store's item (ITEM_NOT_FOUND).
- Public store reads: GET /api/stores, /api/stores/:storeRef and its menu, each cached per store.
- Store memberships and the capability map: requireStore, and /api/auth/me lists the caller's memberships and owned brands.
- Store-scoped order routes; staff see and move only their stores' orders
- Per-store settings: order line cap, low-stock threshold, staff list limit, last-order cutoff
- Store audit trail: GET /api/stores/:storeId/audit
- Opening hours: the open state, the hours read and STORE_CLOSED naming the next opening
- Opening hours: the store_hours and store_schedule_exceptions tables and the open-state rule (served from PR 06b)
- Team: store invites table, members list, invite, revoke and remove routes
- Team: accept a store invite (POST /api/me/invites/accept)
- Opening hours: editing
- Pause and resume a store
- Multi-store contract: legacy single-store routes and the STAFF profile role removed
- Each brand keeps a never-public template store; new branches are copies of it, with lineage
- Menu editor API: list, create, edit and archive a store's items, with diet and a nullable photo; menu.changed on every menu write.
- Owners open branches: list their brands, open a draft branch from the template, edit a store's profile, and publish or unpublish it once it has an address, hours and an available item.
- Menu editors switch many items on or off at once and reorder the whole menu.
- Stock changes by hand keep a trail of who, when and why, and a store can let its staff edit stock or not.
- GET /stores/:storeId/stock for the stock screen, and each membership in /auth/me says whether the store lets staff change stock; the demo seed clears hand-made stock changes.
- POST /brands/:brandId/template/push: the brand's owner sends chosen fields of chosen template items to chosen branches.
- GET /stores/:storeId/manage and /manage/hours: the manage screen reads a store at any status, with its go-live checklist.
- Owners push a template item's price, name or other fields to chosen branches from the template's menu, with a preview of each branch's change.
- Photo uploads for the menu (P3.3): start an upload, send the bytes (a local folder in development), complete it; media.uploaded for the image pipeline.
- Supabase CLI 3.1.0 for the local stack and the generated types.
- Photos go straight to an S3 bucket with a presigned form (RustFS locally and in CI); nginx proxies /media and the CSP allows the upload origin.
- The worker turns each uploaded photo into WebP variants (q_media, sharp) and marks the upload processed or failed.
- An item takes an uploaded photo (imageUploadId) and offers its sizes (imageSrcSet); a nightly sweep removes abandoned uploads and unused variants.
- migrate:media moves the bundled menu photos to the media store; the seed uses it.
- Modifier groups and options: the schema, the pricing rules, and the public menu's modifierGroups (behind the modifiers flag).
- Orders take options per line (modifierOptionIds), priced by the same rules in the API and place_order; order lines carry their options.
- db:push uses --remote and names its environment; auth config uses the CLI's current keys.
- Template copies carry modifier groups; the push takes a modifiers field.
- Modifier editing API: groups with their options, archive, and an item's groups.
- Orders show each line's options (the kitchen card at full size), and Order Again re-adds them.
- Supabase CLI: drop the deprecated --local flag (local is the default).
- A site admin no longer holds team powers (it could make itself staff or a manager of any store); order ids are matched case-insensitively.
- Cart stays in step across tabs; stock change with no answer is re-checked, never retried; checkout flags a line whose options changed; owners open their branch's board; clearer required-choice copy.
- At most 500 live items per store, enforced by the database (409 MENU_FULL); a store already past it keeps the 500 its customers see.
- A production API or worker refuses to start without an https CLIENT_ORIGIN, GIT_COMMIT and TRUST_PROXY_HOPS of at least 1.
- API responses of 1 KB or more are gzipped.

## 0.1.0 — 2026-09-25

- First version (V0).
