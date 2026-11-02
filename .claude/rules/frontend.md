---
paths:
  - "client/**"
---

# Frontend rules (client/)

Loaded with any `client/` file. Section numbers match `CLAUDE.md`, where each has a one-line summary.

## 2b. Target devices and network (STRICTLY ENFORCED)

**The primary UI and performance target is a low- to mid-range Android phone (₹8–15k class, 360–412px wide, ~4×
slower CPU than a laptop) on a slow or flaky connection (Slow 4G / 3G, drops).** Desktop and the staff board are
secondary. Budgets are measured at 360×640 on Slow 4G with 4× CPU throttling. The numbers live in one place,
`client/perf-budget.json` (CI reads it; `client/lighthouserc.json` must match it), and `perf-auditor` records the
measurements in `docs/PERF_BASELINE.md`:

| Metric       | Budget                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------- |
| LCP          | `lcpMs` (3 s)                                                                                  |
| INP          | `inpMs` (300 ms)                                                                               |
| CLS          | `cls` (0.15)                                                                                   |
| Initial JS   | `initialJsGzipKb` (170 KB gzip); staff, auth and checkout routes code-split                    |
| Menu photo   | ≤ ~80 KB each, sized to its box, `loading="lazy"` below the fold, aspect box so nothing shifts |
| API payloads | lean (no over-fetching); no request waterfalls                                                 |

Rules that follow:

- Mobile-first layouts. Tap targets ≥ 44px. Animate only `transform`/`opacity`, and honor
  `prefers-reduced-motion` (the global rule in `client/src/index.css`).
- No heavy dependency without checking its gzip cost first (`perf-auditor` or `npx vite build` output). supabase-js
  is loaded on demand: go through `getSupabase()` (`lib/supabase.ts`), never import `lib/supabaseClient.ts`.
- The page's largest paint (the store cover) gets `LCP_IMAGE_PROPS`, never sits inside an entrance fade, and does
  not share the link with food photos (`FoodPhotoGate`); see `docs/FRONTEND_STRUCTURE.md` "The largest paint".
- Fonts keep `display=swap` and the preconnect in `client/index.html`.
- Every network call has a visible loading state, an abort/timeout path, and a graceful unreachable state with retry
  (`ErrorState unreachable`). A spinner never hangs forever.
- Polling pauses while the tab is hidden (`useResource` does this) and uses conservative intervals: people pay for
  data.
- Give instant feedback on taps whose result is predictable (add to cart); do not block the UI on a round-trip.
- Check UI changes on a throttled 360px viewport before calling them done (§7).
## 2c. Caching on the client (STRICTLY ENFORCED)

The principle is in `CLAUDE.md` §2c; the server side is in `.claude/rules/backend.md` §2c.

- What a person typed, or their own data, in browser storage is cleared when a session starts or ends, from
  `features/auth/authStore.ts` (always loaded), never from a lazy chunk: a sign-out before that chunk loads leaks it
  to the next account on a shared phone. `lib/storageKeys.test.ts` fails for any `fp_` key nobody classified.
- Public data uses `useResource({ persist: true })` (menu, store): the last good copy in `localStorage`
  (`fp_cache:v1:<key>`) renders instantly on the next visit and is refreshed at once (stale-while-revalidate). Bump
  the version in `CACHE_PREFIX` (`lib/useResource.ts`) when a persisted response shape changes. Never `persist`
  orders, the profile, or anything else user-specific.
- Every bundled photo has a 400px thumbnail next to it and fits ~80 KB: run
  `python3 client/scripts/optimize-images.py` after adding one (`--refit` for an existing one over budget;
  `lib/photo.test.ts` fails otherwise). `FoodPhoto`'s `sizes` must be the photo's real rendered width, so
  thumbnails download the small file.
- Screens a customer does not need to browse and fill a cart (checkout, order success, login, register, staff) are
  `lazy()` routes in `App.tsx`, behind `PageBoundary` (skeleton while loading, retry if the chunk fails).
- The browser HTTP cache does the rest: never add cache-busting query strings to API calls or images.

## 4. Client layering

`pages/` compose `features/*` and `components/`. Business rules live in `features/*/…Rules.ts` and
`features/orders/orderStatus.ts`, not in components. State: zustand stores in `features/*/…Store.ts`. HTTP only in
`services/` (§8). The map is `docs/FRONTEND_STRUCTURE.md`.

## 5. Reusable components (STRICTLY ENFORCED)

`docs/COMPONENTS.md` is the catalog: the `components/` atoms (props, variants, when to use), the `lib/` hooks and
utils, and the `features/*` rules and hooks.

1. Check the catalog first.
2. If something almost fits, extend it with a variant prop. Never fork an atom because "my screen is a bit
   different".
3. Build new only when nothing fits, then add it to the catalog in the same change.

Mandates:

- Every food photo goes through `FoodPhoto`.
- Every data view has a Skeleton, an EmptyState and an ErrorState.
- Buttons use `Button` / `ButtonLink` / `buttonClasses()`.

## 7. Visual fidelity

- Given a screenshot or design, describe what you see (layout, spacing, type, colors, states) before writing code.
- Colors, type sizes, radii, shadows and fonts come from the `@theme` tokens in `client/src/index.css`, documented in
  `docs/DESIGN.md`. No new hard-coded hex, arbitrary `text-[Npx]`, `rounded-[Npx]` or `shadow-[…]`: add a token or
  use the nearest step (`lib/designTokens.test.ts` fails otherwise).
- Mobile-first: bottom nav, `pb-safe` for the home indicator, sheets on phones and dialogs on desktop.
- Design rules written in component comments are binding. For example: `PopularBadge` is the ONLY thing allowed on
  top of a food photo; `OpenPill`'s pulse is one of only two looping animations in the app.
- Respect `prefers-reduced-motion`.
- **Ask before building** when the data shape, edge states (empty/loading/error), logic, layout at narrow widths or
  copy is ambiguous. A short question is cheaper than a redo.
- **Visual gate:** before calling a UI change done, use the Playwright MCP to screenshot the golden path, one edge
  state (empty, error or loading), at 390px and 1280px, the phone pass throttled (Slow 4G + 4× CPU). Say exactly what
  you verified. Delete the screenshots afterwards.

## 8. Frontend data fetching (STRICTLY ENFORCED)

- Only `client/src/services/*.ts` call `request()` from `services/api.ts`. No `fetch(` and no `'/api'` strings
  anywhere else.
- GETs use `lib/useResource.ts` through a `features/*/use*.ts` hook.
- After a mutation, call `reload()` / `mutate()` on **every** resource the mutation affects. A missing one is a
  stale-UI bug.
- Errors are `ApiError`. The server's message is user-facing: show it. Failed loads render `ErrorState` (with
  `unreachable` when `err.isUnreachable`); cart-line problems use `describeProblem` in `features/cart/cartRules.ts`.
- Public, non-user data is cached with `useResource({ persist: true })` (§2c); user data never is.
- Polling goes through `useResource`'s `pollInterval`, with the interval from `useConfig().polling` (site settings,
  edited at `/admin`); never a hard-coded interval.
- Config and rules come from the API (`GET /api/config`), never mirrored by hand. The one client copy is
  `client/src/config/fallbacks.json` (defaults and field bounds), parity-tested by the server suite.

## 9. Icons and assets

- Icons are named imports from `lucide-react`. A genuinely custom icon goes in `client/src/components/icons/` as a
  component. No inline `<svg>` in pages or features.
- Images live in `client/public/images/` and reach the UI through the database `image_url` and `FoodPhoto`. A new
  photo goes through `python3 client/scripts/optimize-images.py` (compression + the 400px thumbnail, §2c).
- Every `<img>` has `alt`, explicit dimensions or an aspect box, and `loading="lazy"` below the fold.
- Runtime hosts allowed: Google Fonts and the Supabase project. Nothing else.
- Restaurant uploads (P3.3) go to S3 behind CloudFront (`docs/adr/006-media-s3-cloudfront.md`) and are never
  committed; `MEDIA_STORAGE=local` is a development-only fallback, refused in production.


## 12. Naming

| Thing                | Convention                                             |
| -------------------- | ------------------------------------------------------ |
| Pages                | `pages/<Name>.tsx` exporting `<Name>Page`              |
| Component props      | `<Name>Props`                                          |
| Loading placeholders | `<Name>Skeleton`                                       |
| Hooks                | `useX` in `lib/` or `features/*/`                      |
| Stores               | `features/*/<x>Store.ts`, `use<X>Store`                |
| Response types       | `X` on the client (`XDto` on the server, serializers convert snake_case to camelCase) |
| Tests                | `*.test.ts(x)`                                         |
