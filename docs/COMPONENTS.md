# Components

The catalog of what already exists in the web app: the shared atoms in `client/src/components/`, the hooks and
utilities in `client/src/lib/`, and the rules, hooks and UI in `client/src/features/*/`. Where each piece sits in the
app is in [FRONTEND_STRUCTURE.md](FRONTEND_STRUCTURE.md).

## How to choose

1. **Check this catalog first.** Most UI needs (a button, a card, a price, a status pill, a photo, a loading block)
   already have a component.
2. **Extend with a variant prop** when an existing component is close. Add a value to its `variant`, `tone`, `size`
   or `padding` union and keep the defaults unchanged, as `Card`'s `tone: 'cancel'` and `Button`'s `tint` did.
3. **Build new only as a last resort**, in `components/` if more than one feature needs it, otherwise in the feature
   folder. Add it to this catalog in the same change.

## Mandates

- **Every food photo goes through `FoodPhoto`.** It sets `object-cover`, the saturation lift, the inset ring, lazy
  loading and the placeholder. Storefront photos are the exception (`StoreCard`, the menu header in `pages/Menu.tsx`): plain `<img>`s that still
  take `srcSet={photoSrcSet(url)}` and a real `sizes`, so phones get the 400px cover.
- **Every data view has a loading, an empty and an error state**: a `Skeleton` (or a `*Skeleton` component shaped
  like the real content), an `EmptyState`, and an `ErrorState` with `onRetry` (and `unreachable` when
  `error.isUnreachable`).
- **Buttons use `Button`, `ButtonLink` or `buttonClasses()`.** Special-purpose controls that already exist
  (`AddButton`, `QuantityStepper`, `CartButton`) are the only other buttons for their jobs.
- Icons come from `lucide-react` only, with `aria-hidden` when decorative.

## Design system

Tokens (colour, type, radius, shadow, motion) and the design rules written in the components live in
[DESIGN.md](DESIGN.md), enforced by `client/src/lib/designTokens.test.ts`.

## Shared atoms (`client/src/components/`)

Every prop that has a default shows it after `=`. `className` is always optional and merged last with `cn()`.

### Actions

**`Button`** (`Button.tsx`). The standard button. `ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>`:

| Prop                    | Type                          | Notes                                                                                                                                                                                                                            |
| ----------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `variant`               | `ButtonVariant` = `'primary'` | see below                                                                                                                                                                                                                        |
| `size`                  | `ButtonSize` = `'md'`         | `md` is `h-11` (44px), `lg` is `h-14`                                                                                                                                                                                            |
| `fullWidth`             | `boolean` = `false`           |                                                                                                                                                                                                                                  |
| `loading`               | `boolean` = `false`           | sets `aria-busy` and `aria-disabled` and shows a spinner in place of `iconLeft`; stays focusable (a disabled button would drop keyboard focus mid-submit) and swallows clicks and the form submit they carry (`Button.test.tsx`) |
| `iconLeft`, `iconRight` | `ReactNode`                   |                                                                                                                                                                                                                                  |
| `type`                  | = `'button'`                  | pass `'submit'` in forms                                                                                                                                                                                                         |

`ButtonVariant`: `primary` (paprika fill, the main CTA), `secondary` (white with a line border), `ghost` (text
only), `tint` (paprika-tinted pill for secondary brand actions such as Order Again), `danger` (slate tint, for
cancel), `ghost-danger` (text only, slate on hover: a quiet destructive action beside the main one, "Clear cart",
"Cancel order"), `success` (green, transient confirmation only). `ButtonSize`: `md`, `lg`.

**`IconButton`** (`IconButton.tsx`). The round 44px icon-only button for every close, dismiss or toggle. Props:
`label: string` (required: it is the `aria-label`), `icon: ReactNode`, `tone?: 'plain' | 'floating' | 'gold' = 'plain'`
(`floating` over a photo or sheet, `gold` inside a gold notice), plus any button attribute. Used by the password toggle,
the item sheet's Close and the cart notice's Dismiss. A new round 44px `h-11 w-11` button outside it fails
`lib/designTokens.test.ts`.

**`ButtonLink`** (`Button.tsx`). A react-router `Link` styled exactly like `Button`. `ButtonLinkProps extends
LinkProps` plus `variant`, `size`, `fullWidth`, `iconLeft`, `iconRight`. No `loading`.

**`buttonClasses({ variant, size, fullWidth }, extra?)`** (`Button.tsx`). Returns the class string, for an element
that must look like a button but cannot be one of the two components.

**`AddButton`** (`AddButton.tsx`). The filled paprika "+ Add" pill beside a menu photo. Props: `onAdd: () => void`,
`disabled?: boolean = false`, `className?`. It stays quiet; feedback comes from the photo flight, the stepper swap
and the cart badge.

**`AddControl`** (`AddControl.tsx`). The one "order it" control on every menu card. Props: `item: MenuItem`,
`photoRef: RefObject<HTMLElement>` (where the fly-to-cart clone starts). Renders a "Sold out" / "Unavailable" pill,
or `AddButton`, or a brand `QuantityStepper` once the item is in the cart (max = `lineLimit(availableQuantity(item))`)
with a `StepperNote` at the limit. Reads and writes `cartStore`; calls `flyToCart`.

**`QuantityStepper`** (`QuantityStepper.tsx`). Pill stepper with a rolling digit.

| Prop          | Type                               | Notes                                                                                       |
| ------------- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `quantity`    | `number`                           |                                                                                             |
| `onIncrement` | `() => void`                       | not called at `max`; the pill shakes instead                                                |
| `onDecrement` | `() => void`                       | at `min` it removes the line (trash icon) when `removable`; otherwise the minus is disabled |
| `min`         | `number` = `1`                     |                                                                                             |
| `max`         | `number`                           | optional                                                                                    |
| `tone`        | `'brand' \| 'neutral'` = `'brand'` | brand = paprika fill (menu cards); neutral = outlined (cart, item sheet)                    |
| `removable`   | `boolean` = `tone === 'brand'`     |                                                                                             |
| `size`        | `'sm' \| 'md'` = `'sm'`            | `h-11` / `h-12`                                                                             |
| `label`       | `string` = `'Quantity'`            | the group's `aria-label`                                                                    |

**`StepperNote`** (`QuantityStepper.tsx`). The caption under a stopped stepper: gold "Only N available" for a stock
limit, muted "Max 10 per order" for the cap (`limitCaption`). Props: `maxQuantity: number | null | undefined`,
`inCart?: number = 0` (adds "· N in your cart"), `className?`.

**`CartButton`** (`CartButton.tsx`). Top-bar bag icon linking to `/cart` with a count badge. Props:
`tone?: TopBarTone = 'default'`. It is the `[data-cart-target]` that `flyToCart` aims at; it tilts on
`CART_LANDED_EVENT`. The badge pops on every count change and fades out when the cart empties.

### Layout and navigation

**`TopBar`** (`TopBar.tsx`). Sticky header. Props: `title?: string` (omit for the wordmark), `backTo?: string` (omit
to hide the back arrow), `tone?: TopBarTone = 'default'` (`'brand'` paints it paprika for Home), `right?: ReactNode`,
`widthClass?: string = 'max-w-md md:max-w-lg'` (must match the page column; `App` passes it). Exports
`type TopBarTone = 'default' | 'brand'`. Rendered by `App.tsx` from the route's shell config, not by pages.

**`BottomNav`** (`BottomNav.tsx`). Fixed bottom nav with Home (`/`), Orders (`/orders`), Profile (`/profile`). No
props. Rendered by `App.tsx`.

**`Card`** (`Card.tsx`). White card with a line border and warm shadow, `rounded-card`.
`CardProps extends HTMLAttributes<HTMLDivElement>`: `padding?: 'none' | 'sm' | 'md' | 'lg' | 'xl' = 'md'` (`xl` is
`p-6 md:p-8`, the sign-in card),
`as?: 'div' | 'section' | 'article' = 'div'`, `tone?: 'default' | 'cancel' = 'default'` (slate tint for a cancelled
order). **`cardClasses(extra?)`** returns the default card's classes for a component that picks its own root element
(`ErrorState`'s compact box). Every page card goes through these; the card shadow elsewhere fails
`lib/designTokens.test.ts` unless the file is listed there as its own component (the board card, the store cover, the
tiles).

**`EdgeFades({ edges })`** (`EdgeFades.tsx`). The page-coloured fades over a sideways-scrolling row, shown only on a
side that hides more (`useOverflowEdges`). Used by `CategoryChips` and `StaffFilters`.

**`Wordmark`** (`Wordmark.tsx`). Bag icon + "Food Pickup". Props: `size?: 'sm' | 'lg' = 'sm'`,
`tone?: 'default' | 'inverse' = 'default'` (inverse sits on paprika), `className?`. At large text the name truncates
and the mark stays whole, so a header never runs past the screen.

**`PageBoundary`** (`PageBoundary.tsx`). Wraps `App.tsx`'s whole `<Routes>` list around the lazy-loaded pages
(see [FRONTEND_STRUCTURE.md#lazy-routes](FRONTEND_STRUCTURE.md#lazy-routes)): a `Suspense` fallback (`Skeleton`)
while a chunk downloads, and — via `getDerivedStateFromError` — an `ErrorState unreachable` with a reload button if
the chunk itself fails to load (offline, or a stale deploy whose old chunk was removed). Props: `children: ReactNode`.

### Forms

**`Input`** and **`Textarea`** (`Input.tsx`). Labelled fields with a hint and an error, `forwardRef`ed.
`InputProps = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; hintPlacement?: 'inline' | 'below'; error?: string }`;
`TextareaProps` is the same over `TextareaHTMLAttributes` with `rows = 3`. `className` goes on the wrapper, not the
field. The `id` defaults to `useId()`; an `error` sets `aria-invalid` and renders with `role="alert"`, and
`aria-describedby` lists the hint, then the error. `hintPlacement="inline"` (default) keeps a short tag ("Optional",
"3/200") right-aligned on the label's line; `"below"` puts a sentence-long hint on its own line under the label (the
admin settings form), so neither wraps at 360px. Inputs are `h-12`.

### Food, prices and store

**`FoodPhoto`** (`FoodPhoto.tsx`). Every food photo. `forwardRef<HTMLSpanElement>`. **`FoodPhotoGate`** (`{ held, children }`): while `held`, every `FoodPhoto` inside renders its placeholder box only, so the page's largest image downloads first on a slow connection. `MenuPage` holds its lists until the store cover is painted (at most 2 s).

| Prop           | Type                 | Notes                                                                                                                                                                                                                                                                                                                 |
| -------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src`          | `string \| null`     | `null` shows the cream `surface-2` placeholder                                                                                                                                                                                                                                                                        |
| `alt`          | `string` = `''`      | decorative by default                                                                                                                                                                                                                                                                                                 |
| `className`    | `string`             | size and radius live here, e.g. `h-28 w-28 rounded-[14px]`                                                                                                                                                                                                                                                            |
| `imgClassName` | `string`             | classes for the `<img>` (hover scale, zoom)                                                                                                                                                                                                                                                                           |
| `muted`        | `boolean` = `false`  | greyed out for unavailable items                                                                                                                                                                                                                                                                                      |
| `eager`        | `boolean` = `false`  | `loading="eager"`; otherwise `lazy`                                                                                                                                                                                                                                                                                   |
| `sizes`        | `string` = `'112px'` | the photo's real rendered width, so the browser picks the 400px thumbnail or the 900px original (`lib/photo.ts`'s `photoSrcSet`); `PopularRail` passes `'188px'`, `ItemDetailSheet` passes `'(min-width: 768px) 480px, 100vw'` — see [FRONTEND_STRUCTURE.md#photo-thumbnails](FRONTEND_STRUCTURE.md#photo-thumbnails) |
| `children`     | `ReactNode`          | only `PopularBadge` belongs here                                                                                                                                                                                                                                                                                      |

**`FoodCard`** / **`FoodCardSkeleton`** (`FoodCard.tsx`). Menu list card: 112px photo, name, description,
`StockPill`, price and `AddControl`. Props: `item: MenuItem`, `onOpen: (item: MenuItem) => void` (opens the item
sheet), `showPopularBadge?: boolean = true`. The title button is the card's single tab stop, at least 44px tall
(`min-h-11`) even though the name and description it wraps are shorter.

**`PopularRail`** / **`PopularRailSkeleton`** (`PopularRail.tsx`). Horizontal snap-scrolling rail of 160px photos.
Props: `items: MenuItem[]`, `onOpen: (item: MenuItem) => void`, `id: string` (renders `section-<id>` and
`heading-<id>` for the category chips and scroll spy). No Popular chip on the photos; the heading says it.

**`PopularBadge`** (`PopularBadge.tsx`). Saffron "Popular" chip, absolutely positioned on a `FoodPhoto`. Props:
`className?`.

**`StockPill`** (`StockPill.tsx`). Gold "Only N left" chip when `isLowStock(item)` (1–5 left); renders nothing
otherwise. Props: `item: Pick<MenuItem, 'isAvailable' | 'stockQuantity'>`, `className?`.

**`Price`** (`Price.tsx`). `formatPrice(value)` ("₹1,240") with tabular numerals. Props: `value: number`,
`className?`.

**`StoreCard`** / **`StoreCardSkeleton`** (`StoreCard.tsx`). The Home store card: storefront photo (a plain `<img>`,
not `FoodPhoto`, with `photoSrcSet` + `sizes`), `OpenPill`, name, tagline, prep-time chip and a "View Menu" `ButtonLink`. Props: `store: Store`,
`className?`. The skeleton takes `className?`.

**`OpenPill`** (`OpenPill.tsx`). "Open" with a slow green pulse, or "Closed" in slate. Props: `isOpen: boolean`,
`className?`.

### Cart and orders

**`CartItem`** (`CartItem.tsx`). One cart line as an `<li>`. Props: `line: CartLine`. Neutral removable stepper
capped at `lineLimit(line.maxQuantity)`; a line with a `lineProblem` gets a paprika ring, a `problemLabel` and a Fix
(or Remove when sold out) button that calls `cartStore.fix`. Fix and Remove are each a 44px tap target (`HIT_AREA`)
around a smaller 32px visible pill (`PILL`), so the row stays visually compact without shrinking the tap target.

**`OrderCard`** / **`OrderCardSkeleton`** (`OrderCard.tsx`). An order in the Orders list: number, store, time,
`StatusBadge`, up to three round photos plus "+N", the item summary, total, "Order Again" (only for finished orders
and when `onReorder` is passed) and "View Order". Props: `order: Order`, `onReorder?: (order: Order) => void`,
`reordering?: boolean = false`.

**`summarizeItems(order)`** (`OrderCard.tsx`). `"2 × Cold Coffee, 1 × Veg Sandwich"`.

**`StatusBadge`** (`StatusBadge.tsx`). Tinted status pill from `STATUS_META[status]`; the dot pings while the order
is active. Props: `status: OrderStatus`, `size?: 'sm' | 'md' = 'sm'`, `className?`.

**`StatusTracker`** (`StatusTracker.tsx`). Four-step progress (Placed → Preparing → Ready → Collected): done steps
green with a check, the active step in its status colour pulsing, upcoming steps outlined. `COLLECTED` marks every
step done and stops the pulse; `CANCELLED` renders a slate "won't move forward" block instead. Props:
`status: OrderStatus`, `className?`.

**`TimeText`** (`TimeText.tsx`). A `<time dateTime>` with `formatTime` ("7:42 PM") or, with `withDay`,
`formatDayTime` ("Today, 7:42 PM"). Props: `iso: string`, `withDay?: boolean = false`, `className?`.

### Feedback states

**`Skeleton`** (`Skeleton.tsx`). Placeholder block with a shimmer. Props: `className?` (give it the final element's
width and height), `round?: boolean = false`. `aria-hidden`.

**`EmptyState`** (`EmptyState.tsx`). Icon disc, title, optional description and actions. Props:
`icon: LucideIcon`, `title: string`, `description?: string`, `action?: ReactNode` (buttons, stacked),
`tone?: 'brand' | 'neutral' = 'brand'`, `className?`.

**`ErrorState`** (`ErrorState.tsx`). Failure block with `role="alert"`. While the build is outdated (a 426, `useVersionStore`), its button is "Refresh" (reloads the page) instead of the retry, which could only fail again, and it shows even where no `onRetry` was given; custom `actions` are kept.

| Prop          | Type                                 | Notes                                      |
| ------------- | ------------------------------------ | ------------------------------------------ |
| `title`       | `string`                             |                                            |
| `message`     | `string` = `'Something went wrong.'` | pass `error.message`; it is safe to show   |
| `onRetry`     | `() => void`                         | renders a secondary "Try Again" button     |
| `retryLabel`  | `string` = `'Try Again'`             |                                            |
| `retrying`    | `boolean` = `false`                  | spinner on the retry button                |
| `unreachable` | `boolean` = `false`                  | Wi-Fi-off icon; pass `error.isUnreachable` |
| `compact`     | `boolean` = `false`                  | card-sized, for a section inside a page    |
| `actions`     | `ReactNode`                          | replaces the retry button                  |

### Icons

**`DrawnCheck`** (`icons/DrawnCheck.tsx`). A check mark whose stroke draws itself in (`animate-draw`); custom
because that needs `pathLength` + a dash array on the `<path>`, which `lucide-react` icons do not expose. Used once,
on the order success screen. Props: `className?`. Every other icon is a named import from `lucide-react`
(see CLAUDE.md §9); a new custom icon goes in `components/icons/`.

## lib/ hooks and utilities (`client/src/lib/`)

| Export                                                                                        | File                  | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useResource<T>(fetcher, { key, initialData?, pollInterval?, enabled?, persist? })`           | `useResource.ts`      | loads a resource and returns `{ data, isLoading, error, updatedAt, reload, mutate }`. `isLoading` is true only while there is no data. `pollInterval(data)` returns ms or `null` to stop. Polling pauses while the tab is hidden and refetches when it is visible again. A fetch started before a `mutate()` does not overwrite it. Changing `key` resets and refetches. Errors that are not `ApiError` become `ApiError(0, 'UNKNOWN')`. After a 426 `CLIENT_OUTDATED` it stops polling until the page reloads. `persist: true` renders the last good response from `localStorage` (`fp_cache:v1:<key>`) at once and refreshes it in the background — public data only, never orders or the profile; see [FRONTEND_STRUCTURE.md#caching](FRONTEND_STRUCTURE.md#caching) |
| `photoSrcSet(src)`                                                                            | `photo.ts`            | `srcset` for a bundled `/images/<name>.jpg`: `"<name>-400.jpg 400w, <name>.jpg 900w"`; `undefined` for any other URL (a future Supabase Storage upload) or an already-thumbnail path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `LCP_IMAGE_PROPS`                                                                             | `photo.ts`            | `{ fetchpriority: 'high', loading: 'eager', decoding: 'async' }`, spread onto the page's largest image (the store cover in `StoreCard` and the menu header). Lowercase `fetchpriority` because React 18 does not know `fetchPriority`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `useImagePainted(maxWaitMs)` → `{ ref, painted }`                                             | `useImagePainted.ts`  | `painted` turns true two frames after the `<img>` on `ref` loads or fails (so it has been drawn), at once when it was cached, or after `maxWaitMs`. The menu uses it to open its `FoodPhotoGate`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `getSupabase()`, `mayHaveSession()`                                                           | `supabase.ts`         | the supabase-js client (publishable key; sign-in, refresh and sign-out only), **loaded on first use** from `supabaseClient.ts`: it is 40% of the JavaScript and public pages never need it. A failed load is retried on the next call. `mayHaveSession()` checks for supabase-js's stored session (`sb-*-auth-token`) without loading it. Never import `supabaseClient.ts` directly                                                                                                                                                                                                                                                                                                                                                                                     |
| `logger`, `resolveLevel`                                                                      | `logger.ts`           | the one client logger (`debug`, `info`, `warn`, `error`); see [LOGGING.md](LOGGING.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `runtimeEnv`, `resolveRuntimeEnv(runtime, build)`, `RuntimeEnv`                               | `runtimeEnv.ts`       | `supabaseUrl`, `supabasePublishableKey`, `logLevel`, `requestTimeoutMs`: the web image's `window.__RUNTIME_ENV__` value when set and non-empty, else the build's `VITE_` value (timeout default 15000). Read by `supabase.ts`, `logger.ts` and `services/api.ts`; see [DEPLOYMENT.md](DEPLOYMENT.md#web-image-runtime-environment)                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `APP_VERSION`, `APP_COMMIT`                                                                   | `appVersion.ts`       | this build's `client/package.json` version and commit, injected by `define` in `vite.config.ts` and `vitest.config.ts`; sent as `X-Client-Version` by `services/api.ts`, shown in Profile                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `useSessionDraft(key, initial)` → `[draft, update(patch), clear()]`, `clearSessionDraft(key)` | `sessionDraft.ts`     | a form's typed strings in this tab's `sessionStorage`, so a refresh or Back keeps them; never a password. `authStore` clears every draft when a session starts or ends. Used by `pages/Register.tsx` (`fp_register`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `randomUuid()`                                                                                | `uuid.ts`             | a v4 UUID: `crypto.randomUUID` in a secure context, else built from `getRandomValues` (a phone on the dev server over plain LAN http has no `randomUUID`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `cn(...values)`                                                                               | `cn.ts`               | joins class names, skipping falsy values                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `formatPrice(value)`                                                                          | `format.ts`           | `"₹1,240"`, whole rupees, Indian grouping                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `formatTime(input)`                                                                           | `format.ts`           | `"7:42 PM"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `formatDayTime(input, now?)`                                                                  | `format.ts`           | `"Today, 7:42 PM"`, `"Yesterday, …"`, `"19 Sep, …"`, `"19 Sep 2025, …"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `formatPrepRange(min, max)`                                                                   | `format.ts`           | `"~10–15 min"` (`"~15 min"` when equal)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `formatAgo(timestamp, now?)`                                                                  | `format.ts`           | `"Just now"`, `"12s ago"`, `"3 min ago"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `initialOf(name)`                                                                             | `format.ts`           | first letter for avatars, `"?"` when empty                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `flyToCart(source, imageUrl)`, `CART_LANDED_EVENT`                                            | `flyToCart.ts`        | flies a 28px round photo clone to `[data-cart-target]` in 480 ms, then fires `cart:landed` on `window`. Skips under reduced motion or when no cart icon is on screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `useChangeKey(value)` → `{ key, direction }`, `ChangeKey`                                     | `useChangeKey.ts`     | increments `key` whenever `value` changes (use as a React `key` to replay an animation); `direction` is `-1` when a number went down                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `useFocusTrap(ref, active)`                                                                   | `useFocusTrap.ts`     | modal focus: focuses `[data-autofocus]` or the first focusable on open, cycles Tab inside, returns focus to the opener on close. Escape and scroll lock stay with the caller                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `useOverflowEdges<T>()` → `{ ref, edges, onScroll }`, `OverflowEdges`                         | `useOverflowEdges.ts` | which sides of a sideways-scrolling row still hide content (`{ left, right }`); re-measures on scroll, resize and every render. Pair with `EdgeFades`; `lib/designTokens.test.ts` fails for an `overflow-x-auto` row without them unless listed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `useNow(intervalMs = 1000)`                                                                   | `useNow.ts`           | the current `Date`, refreshed every interval                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `prefersReducedMotion()`                                                                      | `useReducedMotion.ts` | synchronous check, for imperative animations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `scrollBehavior()`                                                                            | `useReducedMotion.ts` | `'auto'` under reduced motion, else `'smooth'`: every JS `scrollTo` / `scrollIntoView` passes it (the CSS rule cannot reach them; a literal `behavior: 'smooth'` fails `lib/designTokens.test.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `useReducedMotion()`                                                                          | `useReducedMotion.ts` | reactive version, for render-time decisions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Feature rules and hooks

### features/cart

**`cartRules.ts`**: the cart's business rules. Components call these instead of comparing numbers themselves.

| Export                                      | Returns                                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `MAX_LINE_QUANTITY = 10`                    | mirrors the server's fixed per-item cap (`MAX_QUANTITY_PER_ITEM`, not a `site_settings` value)             |
| `LOW_STOCK_MAX = 5`                         | "Only N left" threshold                                                                                    |
| `availableQuantity(item)`                   | `0` when unavailable, the stock when tracked, `null` when not tracked                                      |
| `isLowStock(item)`                          | available, tracked, and at most 5 left (type guard)                                                        |
| `unavailableLabel(item)`                    | `"Sold out"` when stock is 0, else `"Unavailable"`                                                         |
| `lineLimit(maxQuantity)`                    | `min(10, maxQuantity ?? 10)`                                                                               |
| `lineProblem(line)` → `LineProblem \| null` | `{ kind: 'sold-out' }` when the limit is ≤ 0, `{ kind: 'over-limit', available }` when quantity exceeds it |
| `problemLabel(problem)`                     | `"Sold out"` / `"Only 1 left"`                                                                             |
| `describeProblem(name, problem)`            | `"Cheese Toast is sold out."` / `"Only 1 Cheese Toast left."`                                              |
| `describeProblems(lines)`                   | one sentence per flagged line, joined                                                                      |
| `limitCaption(maxQuantity)`                 | `"Only N available"` below the cap, else `"Max 10 per order"`                                              |
| `isItemErrorCode(code)`                     | true for `INSUFFICIENT_STOCK`, `ITEM_UNAVAILABLE`, `ITEM_NOT_FOUND`                                        |

**`cartStore.ts`**: `useCartStore` (persisted as `fp_cart`). `CartLine { menuItemId, name, unitPrice, imageUrl,
quantity, maxQuantity }`, where `maxQuantity` is `null` (no limit) or the units the shop can sell (0 = sold out or
off the menu).

| Action                           | Behaviour                                                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `add(item, quantity = 1)`        | adds up to `lineLimit`; ignores sold-out items; tops up an existing line; leaves a line already over its limit alone                    |
| `increment(id)`                  | no-op at the line's limit                                                                                                               |
| `decrement(id)`                  | removes the line at quantity 1                                                                                                          |
| `remove(id)`, `clear()`          |                                                                                                                                         |
| `fix(id)`                        | trims to the limit, or removes when the limit is 0                                                                                      |
| `setAvailability(id, available)` | records a checkout error's `details.available`                                                                                          |
| `syncAvailability(items)`        | refreshes every line's `maxQuantity` from a menu load; items missing from the menu become 0. Prices, names and photos are never changed |

Selectors: `selectLines`, `selectCount`, `selectTotal`, `selectQuantityOf(id)`. It also re-exports
`MAX_LINE_QUANTITY`.

**`useReorder.ts`**: `useReorder()` → `{ reorder(order), reorderingId }`. Fetches the current menu, adds the order's
items on top of the cart at current prices, capped by stock and the 20 cap, then navigates to `/cart` with one
notice per shortfall ("Cheese Toast: only 1 left, added 1", "Berry Smoothie is sold out, skipped"). On a failed menu
load it adds nothing and says so. `readReorderNotice(state)` reads those notices from router state.

**`CartBar.tsx`**: `CartBar({ widthClass? = 'max-w-md md:max-w-lg' })`. The floating ink "View cart" bar above the
bottom nav; the total rolls on change. Rendered by `App.tsx` when the route's shell has `cartBar` and the cart is not
empty.

### features/orders

**`orderStatus.ts`**: the single source of truth for statuses on the client. The server's `ALLOWED_TRANSITIONS`
decides what is allowed; this file decides what is shown.

| Export                                                    | What                                                                                                                                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORDER_STEPS`                                             | `['PLACED', 'PREPARING', 'READY', 'COLLECTED']` (the happy path)                                                                                                                   |
| `TERMINAL_STATUSES`                                       | `['COLLECTED', 'CANCELLED']`                                                                                                                                                       |
| `STATUS_META: Record<OrderStatus, StatusMeta>`            | per status: `label`, `customerTitle`, `customerCopy`, `icon`, `badgeClass`, `fillClass`, `onFillClass`, `railClass`, `pulseRgb`, `next`, `actionLabel`, `canCancel`                |
| `statusMeta(status: string)`, `FALLBACK_STATUS_META`      | **every read goes through `statusMeta`**: a status this build does not know (a newer server) gets the neutral "Updating…" meta with no staff action instead of an undefined lookup |
| `isTerminal(status)`, `isActive(status)`                  |                                                                                                                                                                                    |
| `stepIndex(status)`                                       | position in `ORDER_STEPS`, `-1` for `CANCELLED`                                                                                                                                    |
| `StaffFilterKey`, `StaffFilter`, `STAFF_FILTERS`          | All, New (`PLACED`), Preparing, Ready, Done (`COLLECTED` + `CANCELLED`, key `'COLLECTED'`, label `'Done'`)                                                                         |
| `matchesFilter(status, filter)`                           |                                                                                                                                                                                    |
| `amountLabel(order)`                                      | `"Total paid"` when paid and not cancelled, else `"Total"`                                                                                                                         |
| `timelineLabel(order)` → `{ label: string, iso: string }` | the one time that matters: "Estimated ready", "Ready since", "Collected", or "Placed" for cancelled                                                                                |

Colours: PLACED paprika, PREPARING saffron gold, READY basil green, COLLECTED warm neutral, CANCELLED cool slate.
Staff actions: PLACED "Start Preparing", PREPARING "Mark Ready", READY "Mark Collected"; cancel allowed from PLACED
and PREPARING.

**`useOrder.ts`**: `useOrder(id, initialData = null)` → `{ order, isLoading, error, retry, mutate }`. Polls every
`useConfig().polling.orderMs` (default 4 s) until the order is terminal. `initialData` is used only when its `id` matches.

**`useOrders.ts`**: `useOrders({ status?, audience = 'customer' })` → `{ orders, isLoading, error, retry, mutate,
updatedAt }`. Polls every `useConfig().polling.ordersMs` (default 8 s) for the customer; the staff board passes
`audience: 'staff'` for `polling.staffBoardMs` (default 4 s).

### features/config

| Export                          | File           | What                                                                                                                                                                                                                             |
| ------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useConfig()` → `Config`        | `useConfig.ts` | `GET /api/config` through `useResource({ key: 'config', persist: true })` (public, the same for everyone), returning `data ?? CONFIG_FALLBACK`: never loading, never failing                                                     |
| `CONFIG_FALLBACK`, `VALIDATION` | `fallbacks.ts` | `client/src/config/fallbacks.json`, the client's one copy of the server's config defaults and field bounds (parity-tested by the server suite). `features/auth/validation.ts` and `sessionActivity.ts` read their bounds from it |

UI (presentational; the pages own the data):

| Component                                   | Props                                                                                                                                                                                                                                                                         | Use                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `OrderHero`                                 | `order: Order`, `onReorder: () => void`, `reordering: boolean`                                                                                                                                                                                                                | top of the tracking page; re-key it on `order.status` so each state plays its entrance once             |
| `StaffHeader`                               | `storeName?: string`, `now: Date`, `updatedAt: number \| null`, `offline: boolean`, `onLogout: () => void`, `children?: ReactNode` (the filter row)                                                                                                                           | sticky dashboard header with clock and freshness, and Profile and Log out (the board has no bottom nav) |
| `StaffFilters`                              | `value: StaffFilterKey`, `counts: Record<StaffFilterKey, number>`, `onChange: (key) => void`                                                                                                                                                                                  | filter toggle buttons                                                                                   |
| `StaffBoard`                                | `orders: Order[] \| null`, `visible: Order[]`, `isLoading`, `error: ApiError \| null`, `filter: StaffFilter`, `pendingIds`, `actionErrors: Record<string, string>`, `freshIds`, `leavingIds` (`ReadonlySet<string>`), `onRetry`, `onShowAll`, `onChangeStatus(order, status)` | the ticket grid with its loading, error and empty states                                                |
| `StaffOrderCard` / `StaffOrderCardSkeleton` | `order: Order`, `pending: boolean`, `error?: string`, `onChangeStatus(order, status)`, `fresh?: boolean` (arrival flash), `leaving?: boolean` (fade-out)                                                                                                                      | one kitchen ticket                                                                                      |

### features/orders: staff board rules

| Export                                                                                  | What                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `staffBoardRules.ts`: `visibleActionErrors(errors, boardUpdatedAt)`, `StaffActionError` | the order-card messages to show on `/staff`: an "unreachable" failure goes stale once the board has loaded again after it (the network is back); other failures stay until that card's next action |

### features/menu

| Export                                                                                               | What                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `useMenu()` → `{ menu, isLoading, error, retry }`                                                    | loads `GET /api/menu` (persisted, see [FRONTEND_STRUCTURE.md#caching](FRONTEND_STRUCTURE.md#caching)); every load calls `cartStore.syncAvailability`                                                                                       |
| `useStore()` → `{ store, isLoading, error, retry }`                                                  | loads `GET /api/store` (persisted)                                                                                                                                                                                                         |
| `CategoryChips({ sections, activeId, onSelect, scrolled? })`, `MenuSection { id, name, isPopular? }` | sticky category bar under the TopBar; chips scroll the page to a section. Its parent must be taller than the bar or `position: sticky` has nowhere to travel                                                                               |
| `ItemDetailSheet({ item: MenuItem \| null, onClose })`                                               | bottom sheet on phones, centred dialog on desktop. Escape and the backdrop close it; uses `useFocusTrap`; the count is capped at what is left after the cart's quantity; "Add to Cart" turns green for 600 ms, then the sheet animates out |

### features/checkout

| Export                                                                                                                              | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useCheckoutDraftStore`: `name`, `phone`, `note`, `idempotencyKey`, `setField(field, value)`, `ensureKey()`, `dropKey()`, `reset()` | `checkoutDraftStore.ts`, persisted to **sessionStorage** as `fp_checkout`: the checkout form as typed (`null` = never touched, so `pages/Checkout.tsx` falls back to the profile) and one idempotency key per attempt, sent as `idempotencyKey` on `POST /api/orders` and reused on every retry ([API.md](API.md#post-orders)). `reset()` after the order is placed; `dropKey()` after a 409 `IDEMPOTENCY_KEY_REUSED`, so the next Pay is a new attempt. Reset on every sign-in and sign-out by `features/auth/authStore.ts` (always loaded; a subscription in this lazy chunk once missed sign-outs). Never localStorage: typed data must not outlive the visit |

### features/auth

| Export                                                                                                                                    | What                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useAuthStore`, `selectUser`                                                                                                              | `authStore.ts`, persisted as `fp_auth`: `user`, `token`, `login`, `register`, `logout`, `hydrate`, `clearSession` (see [ARCHITECTURE.md](ARCHITECTURE.md#3-authentication))                                                                                                                                   |
| `RequireAuth`                                                                                                                             | route guard: no token → redirect to `/login?next=`; otherwise render (see [PERMISSIONS.md](PERMISSIONS.md#client))                                                                                                                                                                                            |
| `RequireRole({ role, children })`                                                                                                         | `RequireRole.tsx`, replaces the old `RequireStaff.tsx`: no token → redirect to `/login?next=`; `user.role !== role` → redirect to `/`; otherwise render. Used as `<RequireRole role="STAFF">` (`/staff`) and `<RequireRole role="ADMIN">` (`/admin`)                                                          |
| `roles.ts`: `homeFor(role)`                                                                                                               | where a role lands after sign-in (and where `/login`/`/register` send someone already signed in): `STAFF` → `/staff`, `ADMIN` → `/admin`, else `/`                                                                                                                                                            |
| `useAuthRedirect()`                                                                                                                       | returns `redirectAfterAuth(user)`: non-customers to `homeFor(user.role)`, others to a same-site `?next` or `/`                                                                                                                                                                                                |
| `sessionActivity.ts`: `SESSION_IDLE_TTL_MS`, `readLastActive()`, `markActive(now?)`, `clearActivity()`, `isIdleExpired(lastActive, now?)` | the 7-day idle sign-out: `localStorage` key `fp_last_active`; a missing record counts as active (the week starts now). `authStore.ts` calls these from `login`, `logout`, `clearSession`, `hydrate` and a `visibilitychange` listener. See [PERMISSIONS.md#session-lifetime](PERMISSIONS.md#session-lifetime) |
| `validateName`, `validateEmail`, `validatePassword`, `validatePhone`, `validateNote`                                                      | `validation.ts`: return an error message or `undefined`. The limits mirror the server's zod schemas: `NAME_MAX_LENGTH = 60`, `PASSWORD_MIN_LENGTH = 6`, `PASSWORD_MAX_LENGTH = 72`, `PHONE_MIN_DIGITS = 10`, `PHONE_MAX_DIGITS = 15`, `NOTE_MAX_LENGTH = 200`                                                 |
| `AuthCard({ title, subtitle, error?, children, footer, backTo? })`                                                                        | shared frame for the Login and Register pages                                                                                                                                                                                                                                                                 |

### features/admin

Site-wide developer/operator dashboard (`/admin`), not a restaurant role — see [PERMISSIONS.md](PERMISSIONS.md#roles).

| Export                                                                                   | What                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settingsRules.ts`: `SETTING_FIELDS`, `SETTING_KEYS`, `SettingKey`, `SettingField`       | the registry of every editable setting in display order: `kind: 'integer' \| 'semver'`, label, hint, and `min`/`max` for integers, mirroring the server's `admin.schema.ts` bounds and the `site_settings` check constraints ([CONFIGURATION.md](CONFIGURATION.md)) |
| `settingsRules.ts`: `validateSetting(key, raw)`, `settingHint(key)`, `toDraft(settings)` | error message ("Enter a whole number." / "Must be between `<min>` and `<max>`." / "Enter a version like 1.2.3.") or `null`; the hint with its range; the saved settings as form text                                                                                |
| `settingsRules.ts`: `changedSettings(saved, draft)`                                      | only the fields whose typed value differs from the saved `SiteSettings`, typed for the API (numbers for integers, trimmed text for the version): the `PATCH` body                                                                                                   |
| `useSiteSettings()` → `{ settings, isLoading, error, retry, mutate }`                    | `useSiteSettings.ts`: the admin's view of `GET /api/admin/settings` via `lib/useResource.ts` (`key: 'admin:settings'`); not persisted to `localStorage` — admin-only data never is                                                                                  |
| `services/admin.ts`: `fetchSiteSettings()`, `updateSiteSettings(changes)`                | `GET`/`PATCH /api/admin/settings`                                                                                                                                                                                                                                   |
| `pages/Admin.tsx`: `AdminPage`                                                           | the `/admin` page: a `SettingsForm` rendered from `SETTING_FIELDS` (one `Input` per setting, client bounds via `validateSetting`, Save disabled until dirty and valid, the API's message on a failed save)                                                          |
