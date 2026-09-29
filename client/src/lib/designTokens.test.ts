/// <reference types="node" />
import { readFileSync } from 'node:fs';
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
  // A colour spelled in code does not follow the dark scheme, which redefines the tokens.
  { name: 'rgb() colour', re: /\brgba?\(\s*\d/g, use: 'var(--color-*) or a --shadow-* token' },
  {
    name: 'bare RGB triple',
    re: /['"`[:]\d{1,3}[ _]\d{1,3}[ _]\d{1,3}(?=['"`\]])/g,
    use: 'var(--color-*)',
  },
  // The design allows two loops (pulse-soft, shimmer) plus the loading spinner (animate-spin): no stock Tailwind loops.
  {
    name: 'stock looping animation',
    re: /\banimate-(ping|bounce|pulse)(?![-\w])/g,
    use: 'the pulse-soft utility',
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

  // CLAUDE.md §2b: animate only transform and opacity, which the compositor runs without repainting. A box-shadow
  // pulse repaints every frame for as long as it plays (the order page's live dot ran for the whole visit).
  it('every keyframe animates only transform and opacity', () => {
    const css = readFileSync(`${process.cwd()}/src/index.css`, 'utf8');
    const allowed: Record<string, string> = {
      draw: 'the success check mark draws its stroke once',
    };
    const offenders = [...css.matchAll(/@keyframes ([\w-]+) \{/g)].flatMap((m) => {
      const name = m[1] ?? '';
      let depth = 1;
      let i = (m.index ?? 0) + m[0].length;
      const start = i;
      while (depth > 0 && i < css.length) {
        if (css[i] === '{') depth += 1;
        else if (css[i] === '}') depth -= 1;
        i += 1;
      }
      const props = [...css.slice(start, i).matchAll(/([a-z-]+)\s*:/g)].map((p) => p[1]);
      const bad = props.filter((prop) => prop !== 'transform' && prop !== 'opacity');
      return bad.length && !allowed[name] ? [`${name}: ${[...new Set(bad)].join(', ')}`] : [];
    });
    expect(offenders, 'move it to a pseudo-element and animate its transform or opacity').toEqual(
      [],
    );
  });

  it('index.css spells a colour only where it defines a token', () => {
    const css = readFileSync(`${process.cwd()}/src/index.css`, 'utf8');
    const stray = css
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) =>
        /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/.test(line.replace(/\/\*.*?\*\//g, '')),
      )
      .filter(({ line }) => !/^\s*--[\w-]+:/.test(line))
      .map(({ line, n }) => `${n}: ${line.trim()}`);
    expect(stray, 'use var(--color-*), a --shadow-* token or color-mix() on one').toEqual([]);
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
    // The resting shadow only: hover:shadow-card-hover is the tiles' lift, not the card recipe.
    re: /\bshadow-card(?!-)/,
    allowed: {
      '/src/components/Card.tsx': 'the atom',
      '/src/features/orders/StaffOrderCard.tsx': 'the board card: status rail and state borders',
      '/src/pages/Menu.tsx': 'the store cover photo',
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
