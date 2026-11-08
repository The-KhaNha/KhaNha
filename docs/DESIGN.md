# Design system

The one source for how food-pickup looks: every colour, size, radius, shadow and motion on screen comes from the
`@theme` tokens in `client/src/index.css`, used as Tailwind classes. The atoms that apply them are catalogued in
[COMPONENTS.md](COMPONENTS.md). `client/src/lib/designTokens.test.ts` fails on an arbitrary text size, radius, shadow,
hex, `rgb()` or bare RGB colour anywhere in `client/src`, on a raw colour in `index.css` outside a token definition
(keyframes and utilities use `var(--color-*)` or `color-mix()` on one, so they follow the dark scheme), on a literal
`behavior: 'smooth'`, and on a card or icon-button recipe re-typed outside its atom: add a token, or use the nearest
step.

## Principles

- **One accent.** Paprika is the only colour on a tappable control; saffron gold is a highlight, never a control;
  basil means success, slate means cancelled, taupe means collected. Nothing else carries colour.
- **Phone first.** Designed at 360px on a cheap Android phone; every tap target is at least 44px; text grows with the
  reader's font setting (sizes are rem) and layouts wrap rather than overflow at 200% text
  (`client/e2e/smoke.spec.ts`).
- **Warm, not grey.** A butter-cream page, white cards, warm-brown shadows.
- **Quiet motion.** Short, runs once, `transform`/`opacity` only; two loops in the whole app; everything stops under
  `prefers-reduced-motion`.

## Colour

| Group     | Tokens                                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neutrals  | `bg`, `surface`, `surface-2`, `ink`, `muted`, `line`, `hint` (input placeholders and the idle field edge: lighter than `muted`, still readable, 3:1 on `surface`) |
| Brand     | `brand-50`, `brand-100`, `brand-500` (paprika), `brand-600`, `brand-700`                                                                                          |
| Gold      | `gold-50`, `gold-500` (saffron), `gold-700`                                                                                                                       |
| Success   | `success-50`, `success-500` (basil), `success-700`                                                                                                                |
| Cancel    | `cancel-50`, `cancel-500` (slate), `cancel-700`                                                                                                                   |
| Collected | `collected-500`, `collected-700` (the `COLLECTED` status: quiet, never alarming)                                                                                  |
| Focus     | `focus` (= `brand-600`): the keyboard focus ring, solid, at least 3:1 against `bg` and `surface`                                                                  |

## Dark mode

Follows the device (`prefers-color-scheme`), no toggle. The dark palette in `client/src/index.css` re-values the same
roles, so no component names a scheme: text tokens (`ink`, `muted`, `brand-600`, `brand-700`, the `-700` status
texts) turn light, surfaces and tints turn dark, and the paprika, basil and gold fills stay as they are. Four tokens
exist so a fill never doubles as text:

| Token        | Light     | Dark      | Use                                                           |
| ------------ | --------- | --------- | ------------------------------------------------------------- |
| `ink-fill`   | `#1b1410` | `#3a302a` | the cart bar, the active chip, the update banner (white text) |
| `brand-deep` | `#b72e0e` | `#b72e0e` | a pressed or hovered paprika fill, the hero gradient's end    |
| `on-gold`    | `#1b1410` | `#1b1410` | text on a gold fill (the Popular badge, the cart count)       |
| `overlay`    | `#1b1410` | `#000000` | the sheet backdrop                                            |

`client/src/lib/palette.test.ts` reads both palettes from `index.css` and fails if any text pairing drops below
4.5:1 or the focus ring or a meaningful icon below 3:1; add a new pairing there when a component introduces one.
`client/index.html` paints the first frame, the boot frame and `theme-color` in the matching scheme. The hairline
`line` border stays decorative (about 1.3:1) in both. A form field's idle edge is not decorative: it shows where to
type, so it is `border-hint` (3:1 against the card, WCAG 1.4.11; `lib/palette.test.ts`, `components/Input.test.tsx`).

## Type

Plus Jakarta Sans (`--font-sans`, `display=swap`), loaded after the first paint. Until it lands, text is set in a metric-matched fallback: the `Jakarta Fallback Roboto` / `Jakarta Fallback Arial` faces at the top of `src/index.css` stretch the system font to Jakarta's width and line box, so the swap moves nothing (the e2e "a late web font does not shift the layout"). Recompute their `size-adjust` / `ascent-override` / `descent-override` if the web font changes. A layout that only just fits (a badge beside a heading on a phone) still flips when the font swaps: give it a line of its own below `sm`. Tailwind's default steps plus the in-between sizes this design uses
on purpose, all rem:

| Class               | Size                                    | Use                                                                                                |
| ------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `text-2xs`          | 11px                                    | badges, counts                                                                                     |
| `text-xs`           | 12px                                    | eyebrows, fine print                                                                               |
| `text-caption`      | 13px                                    | secondary lines, hints, meta                                                                       |
| `text-sm`           | 14px                                    | form labels, small body                                                                            |
| `text-body`         | 15px                                    | controls, list text, most copy                                                                     |
| `text-base`         | 16px                                    | item names, large controls                                                                         |
| `text-lead`         | 17px                                    | prices, card titles, the top bar title                                                             |
| `text-lg`           | 18px                                    | section headings                                                                                   |
| `text-xl`           | 20px                                    | page headings, line totals                                                                         |
| `text-2xl`          | 24px                                    | card headings                                                                                      |
| `text-title`        | 28px                                    | page and store titles                                                                              |
| `text-number`       | 32px                                    | order numbers, big totals                                                                          |
| `text-display`      | 40px                                    | the hero line, the amount to pay                                                                   |
| `text-order-number` | 72px, capped at 28% of its `@container` | the pickup number on the ready and success screens: shrinks at large text instead of being cut off |

Weights: 400 body, 500–600 labels and controls, 700 headings, 800 display and prices.

## Shape and depth

| Token                                | Value        | Use                                          |
| ------------------------------------ | ------------ | -------------------------------------------- |
| `rounded-control`                    | 14px         | buttons, inputs, photos                      |
| `rounded-tile`                       | 20px         | compact tiles (food card, popular rail)      |
| `rounded-card`                       | 28px         | page cards (`Card`), sheets, the store cover |
| `shadow-hairline`                    | 1px          | outlined controls                            |
| `shadow-card`, `shadow-card-hover`   | warm lift    | cards and tiles                              |
| `shadow-float`                       | deep         | sheets and dialogs                           |
| `shadow-brand`, `shadow-brand-hover` | paprika glow | the primary button                           |
| `shadow-success`, `shadow-ready`     | basil glow   | the transient success button, a ready order  |
| `shadow-photo-edge`                  | inset 1px    | the edge of a food photo                     |

Spacing uses Tailwind's standard scale only (no arbitrary padding or gaps). Rhythm: `mt-4` / `space-y-4` between
stacked cards, `p-4`/`p-5` inside them.

## Motion

Easings: `ease-out-soft`, `ease-spring`, `ease-in-quick`. Animations: `pop`, `fade-in`, `fade-up`, `fade-out`,
`bar-up`, `sheet-up`, `sheet-down`, `scale-in`, `check-pop`, `draw`, `ring`, `shimmer`, `count-in`, `stepper-in`,
`bag-tilt`, `party-in`, `photo-zoom`, `card-leave`, `shake`. Every keyframe animates only `transform` and `opacity`
(`lib/designTokens.test.ts`; `draw`, the check mark's one-shot stroke, is the one exception), so the compositor runs it
without repainting. Effects that show a ring (a shadow) paint it once on an `::after` and animate that: the utilities
`pulse-soft` (a halo in `--pulse-color` swelling behind a round dot), `glow-pulse` (a ring outside the ready hero,
three breaths) and `ring-flash` (a ring inside a new staff card's edge, fading once). The two loops are `pulse-soft`
(the Open dot, the active tracker step, the live status badge) and `shimmer` (skeletons). The largest paint is never
inside an entrance fade (FRONTEND_STRUCTURE.md "The largest paint").
`index.css` shortens every animation and transition to 0.01 ms under `prefers-reduced-motion: reduce`; JS-driven
motion checks `prefersReducedMotion()` / `useReducedMotion()`, and a scroll goes through `scrollBehavior()`.

Utilities: `no-scrollbar`, `pb-safe` (safe-area bottom padding), `eyebrow` (12px/700 uppercase), `store-scrim`,
`pulse-soft`, `glow-pulse`, `ring-flash`.

## Design rules stated in the code

Collected from the components' comments; the component named is where the rule is written.

| Rule                                                                                                                                                                                                                                                                           | Where                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Only the gold Popular badge is allowed on top of a food photo.                                                                                                                                                                                                                 | `FoodPhoto`, `PopularBadge`                          |
| The "Only N left" chip sits beside the item's text, never on the photo and never on a control.                                                                                                                                                                                 | `StockPill`                                          |
| In the cart, the stepper is the outlined variant so "Proceed to Checkout" stays the only paprika fill.                                                                                                                                                                         | `CartItem`                                           |
| The `success` button variant is a transient confirmation ("Added", "Paid"), not a resting CTA.                                                                                                                                                                                 | `Button`                                             |
| No red text on cream: errors use a paprika tint and an icon.                                                                                                                                                                                                                   | `ErrorState`                                         |
| An error's retry sits in the card that is scrolled into view, never in a second card below it.                                                                                                                                                                                 | `Checkout` (page)                                    |
| Cancelled is cool slate, never red ("red never means cancelled in a red brand").                                                                                                                                                                                               | `orderStatus.ts`                                     |
| Status badge colour pairs meet WCAG AA.                                                                                                                                                                                                                                        | `orderStatus.ts` (`badgeClass`)                      |
| Both halves of the stepper are at least 44px tap targets.                                                                                                                                                                                                                      | `QuantityStepper`                                    |
| At the limit, the plus stays tappable and shakes, and a caption says why.                                                                                                                                                                                                      | `QuantityStepper`, `StepperNote`                     |
| `OpenPill`'s pulse is one of the two looping animations allowed in the app.                                                                                                                                                                                                    | `OpenPill`                                           |
| The bottom nav never animates on route changes; the active pill only recolours.                                                                                                                                                                                                | `BottomNav`                                          |
| On a short screen (`short:`, max-height 500px, min-width 460px, landscape: a phone on its side, never an upright phone whose keyboard shrank the viewport) the pinned chrome gives way: the menu's chips scroll away, the cart bar hides, the bottom nav goes to one 48px row. | `index.css`, `CategoryChips`, `CartBar`, `BottomNav` |
| Skeletons match the final layout 1:1; the shimmer is static under reduced motion.                                                                                                                                                                                              | `Skeleton`                                           |
| Staff actions are always paprika so staff can hit them without reading.                                                                                                                                                                                                        | `StaffOrderCard`                                     |
| Filters that narrow one list are toggle buttons, not tabs.                                                                                                                                                                                                                     | `CategoryChips`, `StaffFilters`                      |
| A store scrim is only for text on a store photo, never on food.                                                                                                                                                                                                                | `index.css` (`store-scrim`)                          |

Reduced motion: `index.css` shortens every animation and transition to 0.01 ms under
`prefers-reduced-motion: reduce` and turns off the fly-to-cart clone, bag tilt, glow pulse, shimmer and ring flash.
JS-driven motion checks `prefersReducedMotion()` / `useReducedMotion()`.
