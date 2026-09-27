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

## Design rules stated in the code

Collected from the components' comments; the component named is where the rule is written.

| Rule                                                                                                   | Where                            |
| ------------------------------------------------------------------------------------------------------ | -------------------------------- |
| Only the gold Popular badge is allowed on top of a food photo.                                         | `FoodPhoto`, `PopularBadge`      |
| The "Only N left" chip sits beside the item's text, never on the photo and never on a control.         | `StockPill`                      |
| In the cart, the stepper is the outlined variant so "Proceed to Checkout" stays the only paprika fill. | `CartItem`                       |
| The `success` button variant is a transient confirmation ("Added", "Paid"), not a resting CTA.         | `Button`                         |
| No red text on cream: errors use a paprika tint and an icon.                                           | `ErrorState`                     |
| Cancelled is cool slate, never red ("red never means cancelled in a red brand").                       | `orderStatus.ts`                 |
| Status badge colour pairs meet WCAG AA.                                                                | `orderStatus.ts` (`badgeClass`)  |
| Both halves of the stepper are at least 44px tap targets.                                              | `QuantityStepper`                |
| At the limit, the plus stays tappable and shakes, and a caption says why.                              | `QuantityStepper`, `StepperNote` |
| `OpenPill`'s pulse is one of the two looping animations allowed in the app.                            | `OpenPill`                       |
| The bottom nav never animates on route changes; the active pill only recolours.                        | `BottomNav`                      |
| Skeletons match the final layout 1:1; the shimmer is static under reduced motion.                      | `Skeleton`                       |
| Staff actions are always paprika so staff can hit them without reading.                                | `StaffOrderCard`                 |
| Filters that narrow one list are toggle buttons, not tabs.                                             | `CategoryChips`, `StaffFilters`  |
| A store scrim is only for text on a store photo, never on food.                                        | `index.css` (`store-scrim`)      |

Reduced motion: `index.css` shortens every animation and transition to 0.01 ms under
`prefers-reduced-motion: reduce` and turns off the fly-to-cart clone, bag tilt, glow pulse, shimmer and ring flash.
JS-driven motion checks `prefersReducedMotion()` / `useReducedMotion()`.

## Design tokens

Defined in the `@theme` block of `client/src/index.css` and used as Tailwind classes (`bg-brand-500`, `shadow-card`,
`animate-fade-up`, …). Use the tokens, not raw hex values.

| Group      | Tokens                                                                                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Font       | `--font-sans`: Plus Jakarta Sans                                                                                                                                                                                                                                 |
| Neutrals   | `bg`, `surface`, `surface-2`, `ink`, `muted`, `line`, `hint` (input placeholders: lighter than `muted`, still readable)                                                                                                                                          |
| Brand      | `brand-50`, `brand-100`, `brand-500` (paprika), `brand-600`, `brand-700`                                                                                                                                                                                         |
| Gold       | `gold-50`, `gold-500` (saffron), `gold-700`                                                                                                                                                                                                                      |
| Success    | `success-50`, `success-500` (basil), `success-700`                                                                                                                                                                                                               |
| Cancel     | `cancel-50`, `cancel-500` (slate), `cancel-700`                                                                                                                                                                                                                  |
| Complete   | `complete-500`, `complete-700` (warm neutral for the `COMPLETED` order status)                                                                                                                                                                                   |
| Shadows    | `card`, `card-hover`, `float`, `brand`, `brand-hover`, `ready`                                                                                                                                                                                                   |
| Easings    | `ease-out-soft`, `ease-spring`, `ease-in-quick`                                                                                                                                                                                                                  |
| Animations | `pop`, `fade-in`, `fade-up`, `fade-out`, `bar-up`, `sheet-up`, `sheet-down`, `scale-in`, `check-pop`, `draw`, `pulse-soft`, `ring`, `shimmer`, `count-in`, `stepper-in`, `bag-tilt`, `glow-pulse`, `ring-flash`, `party-in`, `photo-zoom`, `card-leave`, `shake` |
| Utilities  | `no-scrollbar`, `pb-safe` (safe-area bottom padding), `eyebrow` (12px/700 uppercase), `store-scrim`                                                                                                                                                              |

## Shared atoms (`client/src/components/`)

Every prop that has a default shows it after `=`. `className` is always optional and merged last with `cn()`.

### Actions

**`Button`** (`Button.tsx`). The standard button. `ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>`:

| Prop                    | Type                          | Notes                                                                         |
| ----------------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| `variant`               | `ButtonVariant` = `'primary'` | see below                                                                     |
| `size`                  | `ButtonSize` = `'md'`         | `md` is `h-11` (44px), `lg` is `h-14`                                         |
| `fullWidth`             | `boolean` = `false`           |                                                                               |
| `loading`               | `boolean` = `false`           | disables the button, sets `aria-busy`, shows a spinner in place of `iconLeft` |
| `iconLeft`, `iconRight` | `ReactNode`                   |                                                                               |
| `type`                  | = `'button'`                  | pass `'submit'` in forms                                                      |

`ButtonVariant`: `primary` (paprika fill, the main CTA), `secondary` (white with a line border), `ghost` (text
only), `tint` (paprika-tinted pill for secondary brand actions such as Order Again), `danger` (slate tint, for
cancel), `success` (green, transient confirmation only). `ButtonSize`: `md`, `lg`.

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
limit, muted "Max 20 per order" for the cap (`limitCaption`). Props: `maxQuantity: number | null | undefined`,
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

**`Card`** (`Card.tsx`). White card with a line border and warm shadow, `rounded-[28px]`.
`CardProps extends HTMLAttributes<HTMLDivElement>`: `padding?: 'none' | 'sm' | 'md' | 'lg' = 'md'`,
`as?: 'div' | 'section' | 'article' = 'div'`, `tone?: 'default' | 'cancel' = 'default'` (slate tint for a cancelled
order).

**`Wordmark`** (`Wordmark.tsx`). Bag icon + "Food Pickup". Props: `size?: 'sm' | 'lg' = 'sm'`,
`tone?: 'default' | 'inverse' = 'default'` (inverse sits on paprika), `className?`.

**`PageBoundary`** (`PageBoundary.tsx`). Wraps `App.tsx`'s whole `<Routes>` list around the lazy-loaded pages
(see [FRONTEND_STRUCTURE.md#lazy-routes](FRONTEND_STRUCTURE.md#lazy-routes)): a `Suspense` fallback (`Skeleton`)
while a chunk downloads, and — via `getDerivedStateFromError` — an `ErrorState unreachable` with a reload button if
the chunk itself fails to load (offline, or a stale deploy whose old chunk was removed). Props: `children: ReactNode`.

### Forms

**`Input`** and **`Textarea`** (`Input.tsx`). Labelled fields with a hint and an error, `forwardRef`ed.
`InputProps = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }`;
`TextareaProps` is the same over `TextareaHTMLAttributes` with `rows = 3`. `className` goes on the wrapper, not the
field. The `id` defaults to `useId()`; an `error` sets `aria-invalid`, links the message with `aria-describedby`,
and renders it with `role="alert"`. Inputs are `h-12`.

### Food, prices and store

**`FoodPhoto`** (`FoodPhoto.tsx`). Every food photo. `forwardRef<HTMLSpanElement>`.

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

**`StatusTracker`** (`StatusTracker.tsx`). Four-step progress (Placed → Preparing → Ready → Completed): done steps
green with a check, the active step in its status colour pulsing, upcoming steps outlined. `CANCELLED` renders a
slate "won't move forward" block instead. Props: `status: OrderStatus`, `className?`.

**`TimeText`** (`TimeText.tsx`). A `<time dateTime>` with `formatTime` ("7:42 PM") or, with `withDay`,
`formatDayTime` ("Today, 7:42 PM"). Props: `iso: string`, `withDay?: boolean = false`, `className?`.

### Feedback states

**`Skeleton`** (`Skeleton.tsx`). Placeholder block with a shimmer. Props: `className?` (give it the final element's
width and height), `round?: boolean = false`. `aria-hidden`.

**`EmptyState`** (`EmptyState.tsx`). Icon disc, title, optional description and actions. Props:
`icon: LucideIcon`, `title: string`, `description?: string`, `action?: ReactNode` (buttons, stacked),
`tone?: 'brand' | 'neutral' = 'brand'`, `className?`.

**`ErrorState`** (`ErrorState.tsx`). Failure block with `role="alert"`.

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

| Export                                                                              | File                  | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `useResource<T>(fetcher, { key, initialData?, pollInterval?, enabled?, persist? })` | `useResource.ts`      | loads a resource and returns `{ data, isLoading, error, updatedAt, reload, mutate }`. `isLoading` is true only while there is no data. `pollInterval(data)` returns ms or `null` to stop. Polling pauses while the tab is hidden and refetches when it is visible again. A fetch started before a `mutate()` does not overwrite it. Changing `key` resets and refetches. Errors that are not `ApiError` become `ApiError(0, 'UNKNOWN')`. `persist: true` renders the last good response from `localStorage` (`fp_cache:v1:<key>`) at once and refreshes it in the background — public data only, never orders or the profile; see [FRONTEND_STRUCTURE.md#caching](FRONTEND_STRUCTURE.md#caching) |
| `photoSrcSet(src)`                                                                  | `photo.ts`            | `srcset` for a bundled `/images/<name>.jpg`: `"<name>-400.jpg 400w, <name>.jpg 900w"`; `undefined` for any other URL (a future Supabase Storage upload) or an already-thumbnail path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `supabase`                                                                          | `supabase.ts`         | the supabase-js client (publishable key). Sign-in, refresh and sign-out only; throws at import if the env vars are missing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `logger`, `resolveLevel`                                                            | `logger.ts`           | the one client logger (`debug`, `info`, `warn`, `error`); see [LOGGING.md](LOGGING.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `cn(...values)`                                                                     | `cn.ts`               | joins class names, skipping falsy values                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `formatPrice(value)`                                                                | `format.ts`           | `"₹1,240"`, whole rupees, Indian grouping                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `formatTime(input)`                                                                 | `format.ts`           | `"7:42 PM"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `formatDayTime(input, now?)`                                                        | `format.ts`           | `"Today, 7:42 PM"`, `"Yesterday, …"`, `"19 Sep, …"`, `"19 Sep 2025, …"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `formatPrepRange(min, max)`                                                         | `format.ts`           | `"~10–15 min"` (`"~15 min"` when equal)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `formatAgo(timestamp, now?)`                                                        | `format.ts`           | `"Just now"`, `"12s ago"`, `"3 min ago"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `initialOf(name)`                                                                   | `format.ts`           | first letter for avatars, `"?"` when empty                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `flyToCart(source, imageUrl)`, `CART_LANDED_EVENT`                                  | `flyToCart.ts`        | flies a 28px round photo clone to `[data-cart-target]` in 480 ms, then fires `cart:landed` on `window`. Skips under reduced motion or when no cart icon is on screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `useChangeKey(value)` → `{ key, direction }`, `ChangeKey`                           | `useChangeKey.ts`     | increments `key` whenever `value` changes (use as a React `key` to replay an animation); `direction` is `-1` when a number went down                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `useFocusTrap(ref, active)`                                                         | `useFocusTrap.ts`     | modal focus: focuses `[data-autofocus]` or the first focusable on open, cycles Tab inside, returns focus to the opener on close. Escape and scroll lock stay with the caller                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `useNow(intervalMs = 1000)`                                                         | `useNow.ts`           | the current `Date`, refreshed every interval                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `prefersReducedMotion()`                                                            | `useReducedMotion.ts` | synchronous check, for imperative animations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `useReducedMotion()`                                                                | `useReducedMotion.ts` | reactive version, for render-time decisions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Feature rules and hooks

### features/cart

**`cartRules.ts`**: the cart's business rules. Components call these instead of comparing numbers themselves.

| Export                                      | Returns                                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `MAX_LINE_QUANTITY = 20`                    | mirrors the server's per-item cap                                                                          |
| `LOW_STOCK_MAX = 5`                         | "Only N left" threshold                                                                                    |
| `availableQuantity(item)`                   | `0` when unavailable, the stock when tracked, `null` when not tracked                                      |
| `isLowStock(item)`                          | available, tracked, and at most 5 left (type guard)                                                        |
| `unavailableLabel(item)`                    | `"Sold out"` when stock is 0, else `"Unavailable"`                                                         |
| `lineLimit(maxQuantity)`                    | `min(20, maxQuantity ?? 20)`                                                                               |
| `lineProblem(line)` → `LineProblem \| null` | `{ kind: 'sold-out' }` when the limit is ≤ 0, `{ kind: 'over-limit', available }` when quantity exceeds it |
| `problemLabel(problem)`                     | `"Sold out"` / `"Only 1 left"`                                                                             |
| `describeProblem(name, problem)`            | `"Cheese Toast is sold out."` / `"Only 1 Cheese Toast left."`                                              |
| `describeProblems(lines)`                   | one sentence per flagged line, joined                                                                      |
| `limitCaption(maxQuantity)`                 | `"Only N available"` below the cap, else `"Max 20 per order"`                                              |
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

| Export                                                    | What                                                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORDER_STEPS`                                             | `['PLACED', 'PREPARING', 'READY', 'COMPLETED']` (the happy path)                                                                                                    |
| `TERMINAL_STATUSES`                                       | `['COMPLETED', 'CANCELLED']`                                                                                                                                        |
| `STATUS_META: Record<OrderStatus, StatusMeta>`            | per status: `label`, `customerTitle`, `customerCopy`, `icon`, `badgeClass`, `fillClass`, `onFillClass`, `railClass`, `pulseRgb`, `next`, `actionLabel`, `canCancel` |
| `isTerminal(status)`, `isActive(status)`                  |                                                                                                                                                                     |
| `stepIndex(status)`                                       | position in `ORDER_STEPS`, `-1` for `CANCELLED`                                                                                                                     |
| `StaffFilterKey`, `StaffFilter`, `STAFF_FILTERS`          | All, New (`PLACED`), Preparing, Ready, Completed (`COMPLETED` + `CANCELLED`)                                                                                        |
| `matchesFilter(status, filter)`                           |                                                                                                                                                                     |
| `amountLabel(order)`                                      | `"Total paid"` when paid and not cancelled, else `"Total"`                                                                                                          |
| `timelineLabel(order)` → `{ label: string, iso: string }` | the one time that matters: "Estimated ready", "Ready since", "Picked up", or "Placed" for cancelled                                                                 |

Colours: PLACED paprika, PREPARING saffron gold, READY basil green, COMPLETED warm neutral, CANCELLED cool slate.
Staff actions: PLACED "Start Preparing", PREPARING "Mark Ready", READY "Complete Order"; cancel allowed from PLACED
and PREPARING.

**`useOrder.ts`**: `useOrder(id, initialData = null)` → `{ order, isLoading, error, retry, mutate }`. Polls every
4 s until the order is terminal. `initialData` is used only when its `id` matches.

**`useOrders.ts`**: `useOrders({ status?, pollMs = 8000 })` → `{ orders, isLoading, error, retry, mutate, updatedAt }`.
The customer list uses the default; the staff board passes 4000.

UI (presentational; the pages own the data):

| Component                                   | Props                                                                                                                                                                                                                                                                         | Use                                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `OrderHero`                                 | `order: Order`, `onReorder: () => void`, `reordering: boolean`                                                                                                                                                                                                                | top of the tracking page; re-key it on `order.status` so each state plays its entrance once |
| `StaffHeader`                               | `storeName?: string`, `now: Date`, `updatedAt: number \| null`, `offline: boolean`, `onLogout: () => void`, `children?: ReactNode` (the filter row)                                                                                                                           | sticky dashboard header with clock and freshness                                            |
| `StaffFilters`                              | `value: StaffFilterKey`, `counts: Record<StaffFilterKey, number>`, `onChange: (key) => void`                                                                                                                                                                                  | filter toggle buttons                                                                       |
| `StaffBoard`                                | `orders: Order[] \| null`, `visible: Order[]`, `isLoading`, `error: ApiError \| null`, `filter: StaffFilter`, `pendingIds`, `actionErrors: Record<string, string>`, `freshIds`, `leavingIds` (`ReadonlySet<string>`), `onRetry`, `onShowAll`, `onChangeStatus(order, status)` | the ticket grid with its loading, error and empty states                                    |
| `StaffOrderCard` / `StaffOrderCardSkeleton` | `order: Order`, `pending: boolean`, `error?: string`, `onChangeStatus(order, status)`, `fresh?: boolean` (arrival flash), `leaving?: boolean` (fade-out)                                                                                                                      | one kitchen ticket                                                                          |

### features/menu

| Export                                                                                               | What                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `useMenu()` → `{ menu, isLoading, error, retry }`                                                    | loads `GET /api/menu` (persisted, see [FRONTEND_STRUCTURE.md#caching](FRONTEND_STRUCTURE.md#caching)); every load calls `cartStore.syncAvailability`                                                                                       |
| `useStore()` → `{ store, isLoading, error, retry }`                                                  | loads `GET /api/store` (persisted)                                                                                                                                                                                                         |
| `CategoryChips({ sections, activeId, onSelect, scrolled? })`, `MenuSection { id, name, isPopular? }` | sticky category bar under the TopBar; chips scroll the page to a section. Its parent must be taller than the bar or `position: sticky` has nowhere to travel                                                                               |
| `ItemDetailSheet({ item: MenuItem \| null, onClose })`                                               | bottom sheet on phones, centred dialog on desktop. Escape and the backdrop close it; uses `useFocusTrap`; the count is capped at what is left after the cart's quantity; "Add to Cart" turns green for 600 ms, then the sheet animates out |

### features/auth

| Export                                                                               | What                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useAuthStore`, `selectUser`                                                         | `authStore.ts`, persisted as `fp_auth`: `user`, `token`, `login`, `register`, `logout`, `hydrate`, `clearSession` (see [ARCHITECTURE.md](ARCHITECTURE.md#3-authentication))                                                                                   |
| `RequireAuth`, `RequireStaff`                                                        | route guards (see [PERMISSIONS.md](PERMISSIONS.md#client))                                                                                                                                                                                                    |
| `useAuthRedirect()`                                                                  | returns `redirectAfterAuth(user)`: staff to `/staff`, others to a same-site `?next` or `/`                                                                                                                                                                    |
| `validateName`, `validateEmail`, `validatePassword`, `validatePhone`, `validateNote` | `validation.ts`: return an error message or `undefined`. The limits mirror the server's zod schemas: `NAME_MAX_LENGTH = 60`, `PASSWORD_MIN_LENGTH = 6`, `PASSWORD_MAX_LENGTH = 72`, `PHONE_MIN_DIGITS = 10`, `PHONE_MAX_DIGITS = 15`, `NOTE_MAX_LENGTH = 200` |
| `AuthCard({ title, subtitle, error?, children, footer, backTo? })`                   | shared frame for the Login and Register pages                                                                                                                                                                                                                 |
