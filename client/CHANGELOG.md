# Changelog

All notable changes to the client (`client/package.json`). Written by `npm run release` from `.changes/`.

## 0.2.2 — 2026-11-19

- Upgrade to React 19.
- Each menu card's Add button names its item for screen readers and voice control.

## 0.2.1 — 2026-11-15

- Update dependencies (Dependabot): Supabase, Express, pino, dotenv 18, lucide-react 1.x and the minor/patch groups.

## 0.2.0 — 2026-11-15

- P0 foundations: Node 24 pin, CI, versioning, health and version reporting, containers and the configuration registry.
- Rate limits per user and address (429 RATE_LIMITED), an idempotencyKey on order placement so a retried Pay never places twice, security headers on the API and the web image, a 500-item menu cap, a session-scoped checkout and sign-up draft that survives refresh and Back and is cleared on every sign-in and sign-out, a 409 IDEMPOTENCY_KEY_REUSED when a retried Pay carries a changed cart, an early 413 on oversized bodies, and layouts that hold at 200% text.
- A design system (DESIGN.md, type, radius, focus and shadow tokens, IconButton, cards and ghost buttons from their atoms), page titles and focus that moves with navigation, an empty-menu state, a Saved confirmation on the admin page, sign-in and sign-up that keep the way back to checkout, and a status dot that uses the app's one soft pulse.
- Validation errors and EMAIL_TAKEN name the field at fault, and sign-up and checkout show the message on that field; a failed Pay scrolls its reason into view.
- Installable: a web manifest and app icons, a page description and link-preview tags, a crawl policy, a still loading frame before the app downloads, and a message when JavaScript is off.
- Dark mode that follows the device, with every text pairing at WCAG AA in both schemes, and readable step numbers on the home page.
- The staff board always shows every active order; the staff list limit now caps finished orders only.
- A password of only spaces is refused.
- 429 responses carry details { kind: 'rateLimit', retryAfterSeconds }, and a burst logs warn once per key per window; error details are one ErrorDetails union.
- Security: every known advisory fixed (zod 4, body-parser, qs, ip-address, vite, vitest, undici, minimatch); images with no fixable CVE: the web image on nginx 1.31 alpine-slim (34 MB, was 100), the API on plain Alpine with only the node binary (260 MB, was 309).
- A press on Pay, Sign in or Create account right after a field error is no longer lost: a field's error now clears as it is fixed, not when the press moves focus off it.
- Admins can switch features on and off, for chosen stores, roles or a share of users, and each switch is recorded with who made it.
- Admins can set the share of visits that report app errors (Error reporting %), and the app reads it from its configuration.
- Prices and totals are stored in paise behind the API, which still sends whole rupees, and every order line is priced by the database. An order whose price changed after it was charged is refused with 409 `PRICE_CHANGED`, and the checkout then shows the new price before the next Pay.
- Checkout: after a price change, Pay stays off until the new price has loaded, and a failed load offers a retry instead of the refused amount.
- Report browser crashes safely and show a reload screen for page and app errors.
- A deeply nested body, a lone UTF-16 surrogate or an invisible-only name is a 400 instead of a 500 or a blank name, text limits count UTF-16 units on both sides, and the client-error scrub catches percent-encoded tokens, passwords and unusual email addresses.
- Full browser storage no longer breaks the menu or sign-in, a missing order's success page says it was not found (and no longer celebrates while it loads), the menu stays usable on a phone on its side at large text, and the bottom nav no longer flips layout when an upright phone's keyboard opens.
- Checkout refuses a cart that shows an old price (PRICE_CHANGED) instead of charging the new one; an order is refused when its item is switched off or its store closes while it is placed; a menu item can no longer cost ₹0.
- Recover from a cached malformed response, a failed sign-in chunk and a fast phone clock; isolate customer text on order cards.
- Request logs record the path only, and the error scrub catches phone numbers written with slashes or spaced dashes
- Install with pnpm 12 instead of npm; the images build with it through corepack.
- Brands, and stores gain a slug, brand, area and address; the seed builds two brands and three stores. An order refuses another store's item (ITEM_NOT_FOUND).
- Store memberships and the capability map: requireStore, and /api/auth/me lists the caller's memberships and owned brands.
- Store-scoped order routes; staff see and move only their stores' orders
- Per-store settings: order line cap, low-stock threshold, staff list limit, last-order cutoff
- Cart limits come from the store's menu rules
- Opening hours: the open state, the hours read and STORE_CLOSED naming the next opening
- Store list and store pages
- One cart per store
- Pause and resume a store
- Manage area: store picker and shell
- Staff board per store, pause control
- Manage: settings, team and joining by invite
- Manage: opening hours editor
- Joining a store's team from an invite link
- Store staff see the Staff dashboard link by membership; the single-store store hook is gone
- Sign-in returns staff to an invite link; hours, switcher and pause control fixes for large text and keyboards
- Menu editor API: list, create, edit and archive a store's items, with diet and a nullable photo; menu.changed on every menu write.
- Owners open branches: list their brands, open a draft branch from the template, edit a store's profile, and publish or unpublish it once it has an address, hours and an available item.
- Managers and owners edit the menu from /manage: search, switch items on or off, reorder, mark a category sold out, add and edit items.
- Stock changes by hand keep a trail of who, when and why, and a store can let its staff edit stock or not.
- Stock screen in /manage and a Stock view on the staff board: count up or down, set, mark sold out, see an item's history; a switch for whether staff may change stock.
- Owners see their brand template and draft branches in /manage, and open a new branch there; a draft branch can be managed before it is published.
- Owners publish a branch from /manage once its checklist passes (address, hours, an orderable item), and unpublish it; owners and managers edit a store's profile.
- Owners push a template item's price, name or other fields to chosen branches from the template's menu, with a preview of each branch's change.
- Photo uploads for the menu (P3.3): start an upload, send the bytes (a local folder in development), complete it; media.uploaded for the image pipeline.
- Photos go straight to an S3 bucket with a presigned form (RustFS locally and in CI); nginx proxies /media and the CSP allows the upload origin.
- An item takes an uploaded photo (imageUploadId) and offers its sizes (imageSrcSet); a nightly sweep removes abandoned uploads and unused variants.
- Managers add a photo to a menu item; menus offer an uploaded photo's sizes.
- Modifier groups and options: the schema, the pricing rules, and the public menu's modifierGroups (behind the modifiers flag).
- Orders take options per line (modifierOptionIds), priced by the same rules in the API and place_order; order lines carry their options.
- The cart keeps one line per item and choice of options, sharing the item's limit (cart version 3).
- Items with choices: the option picker, Customisable on the menu, and options on cart and checkout lines.
- Orders show each line's options (the kitchen card at full size), and Order Again re-adds them.
- Managers edit a store's choices (modifier groups) and give them to items.
- An old cart line of an item that now has a required choice reprices with that choice's default, as the server charges.
- A site admin no longer holds team powers (it could make itself staff or a manager of any store); order ids are matched case-insensitively.
- Cart stays in step across tabs; stock change with no answer is re-checked, never retried; checkout flags a line whose options changed; owners open their branch's board; clearer required-choice copy.
- Android Back closes an open sheet instead of leaving the page; manage forms ask before a reload drops unsaved edits.
- Store list, menu editor, profile and cart bar keep their labels at 200% text; long menus and boards skip rendering off-screen cards.
- Menu cards skip rendering in groups that WebKit can scroll; the cart bar stays one line at large text; Back-to-close works in development.
- Long menus and staff boards mount their cards only as they near the screen.
- The staff board re-renders only the order cards that changed on each poll.

## 0.1.0 — 2026-09-25

- First version (V0).
