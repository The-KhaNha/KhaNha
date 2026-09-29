import { describe, expect, it } from 'vitest';

/**
 * Sizes, radii, shadows and colours come from the @theme tokens in index.css (docs/DESIGN.md), never ad hoc. An
 * arbitrary value here is how a design drifts one screen at a time: add a token, or use the nearest step.
 */
const FORBIDDEN: { name: string; re: RegExp; use: string }[] = [
  {
    name: 'arbitrary text size',
    re: /\btext-\[\d[^\]]*\]/g,
    use: 'text-2xs … text-7xl (DESIGN.md "Type")',
  },
  {
    name: 'arbitrary radius',
    re: /\brounded(?:-[a-z]{1,2})?-\[\d[^\]]*\]/g,
    use: 'rounded-control / -tile / -card',
  },
  { name: 'arbitrary shadow', re: /\bshadow-\[[^\]]+\]/g, use: 'a --shadow-* token' },
  { name: 'hex colour', re: /#[0-9a-fA-F]{3,8}\b(?![-\w])/g, use: 'a --color-* token' },
  // The design allows two loops (pulse-soft, shimmer) plus the loading spinner (animate-spin): no stock Tailwind loops.
  {
    name: 'stock looping animation',
    re: /\banimate-(ping|bounce|pulse)(?![-\w])/g,
    use: 'animate-pulse-soft',
  },
  // A JS scroll ignores the reduced-motion CSS rule: go through scrollBehavior() (lib/useReducedMotion.ts).
  {
    name: "literal behavior: 'smooth'",
    re: /behavior:\s*['"]smooth['"]/g,
    use: 'scrollBehavior()',
  },
];

const sources = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('design tokens', () => {
  it.each(FORBIDDEN)('no $name in client/src', ({ re, use }) => {
    const hits = Object.entries(sources).flatMap(([file, text]) =>
      [...text.matchAll(re)].map((m) => `${file}: ${m[0]}`),
    );
    expect(hits, `use ${use}`).toEqual([]);
  });
});

/**
 * Atom recipes live in their atom. A new screen that re-types the card shadow or the round 44px icon button drifts
 * from them the next time the atom changes: use Card / cardClasses() or IconButton instead, or add the file here with
 * the reason it is its own component.
 */
const RECIPES: { name: string; re: RegExp; allowed: Record<string, string> }[] = [
  {
    name: 'card shadow (use Card)',
    re: /\bshadow-card\b/,
    allowed: {
      '/src/components/Card.tsx': 'the atom',
      '/src/features/orders/StaffOrderCard.tsx': 'the board card: status rail and state borders',
      '/src/pages/Menu.tsx': 'the store cover photo',
      '/src/components/FoodCard.tsx': 'a tile (rounded-tile): interactive, hover lift',
      '/src/components/PopularRail.tsx': 'tiles (rounded-tile): interactive, hover lift',
      '/src/pages/Home.tsx': 'the how-it-works tiles (rounded-tile)',
    },
  },
  {
    name: 'round 44px icon button (use IconButton)',
    re: /\bh-11 w-11\b[^'"`]*\brounded-full\b|\bgrid h-11 w-11 place-items-center\b/,
    allowed: {
      '/src/components/IconButton.tsx': 'the atom',
      '/src/components/TopBar.tsx': 'the Back link (a Link, not a button)',
      '/src/components/CartButton.tsx': 'the cart link with its count badge',
    },
  },
];

/** A row that scrolls sideways must show it can: a cut-off "Rea" with no fade reads as broken (EdgeFades). */
const SIDEWAYS_WITHOUT_FADE_ALLOWED: Record<string, string> = {
  '/src/components/PopularRail.tsx':
    'the next card peeks in at the edge, which says "more" by itself',
};

describe('sideways-scrolling rows', () => {
  it('show EdgeFades', () => {
    const missing = Object.entries(sources)
      .filter(([, text]) => /\boverflow-x-auto\b/.test(text) && !text.includes('<EdgeFades'))
      .map(([file]) => file)
      .filter((file) => !(file in SIDEWAYS_WITHOUT_FADE_ALLOWED));
    expect(missing).toEqual([]);
  });
});

describe('atom recipes', () => {
  it.each(RECIPES)('$name only in its atom', ({ re, allowed }) => {
    const users = Object.entries(sources)
      .filter(([file, text]) => re.test(text) && !(file in allowed))
      .map(([file]) => file);
    expect(users).toEqual([]);
  });
});
