---
paths:
  - "client/**"
---

# Frontend rules (client/)

Loaded with any `client/` file. Section numbers match `CLAUDE.md`, where each has a one-line summary.

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

