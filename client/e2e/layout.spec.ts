import { expect, test, type Page } from '@playwright/test';
import budget from '../perf-budget.json' with { type: 'json' };
import type { OrderStatus, Role, User } from '../src/types/api';
import { mockApi, seedCart, signIn, store } from './fixtures';

// Every route fits a 320px screen and 200% text with 44px controls, and loading or a late web font moves nothing.

test.beforeEach(async ({ page }) => mockApi(page));

/**
 * Anything past the right edge of the configured screen. Measured against the viewport Playwright set, not
 * `innerWidth`: mobile browsers widen the layout viewport to fit an overflowing page, which would hide the bug.
 */
async function overflowingPastScreen(page: Page): Promise<string[]> {
  const width = page.viewportSize()?.width ?? 0;
  return page.evaluate((screenWidth) => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || getComputedStyle(el).visibility === 'hidden') continue;
      // An icon is measured as a whole: its inner shapes may be drawn offset inside the svg's own box.
      if (el.parentElement?.closest('svg')) continue;
      // Content clipped by an ancestor that itself ends inside the screen is not visible past the edge: a row that
      // scrolls sideways on purpose (category chips, the popular rail) or a truncated label.
      let clippedInside = false;
      for (let p = el.parentElement; p && !clippedInside; p = p.parentElement) {
        clippedInside =
          getComputedStyle(p).overflowX !== 'visible' &&
          p.getBoundingClientRect().right <= screenWidth + 1;
      }
      if (box.right > screenWidth + 1 && !clippedInside) {
        out.push(
          `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}" right=${Math.round(box.right)}`,
        );
      }
    }
    return out.slice(0, 5);
  }, width);
}

/** Visible controls a finger must hit that are shorter than 44px. */
async function smallTapTargets(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea'))
      .filter((el) => el.getAttribute('aria-hidden') !== 'true' && el.tabIndex !== -1)
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.height < 44)
      .map(
        ({ el, box }) =>
          `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(box.height)}px`,
      ),
  );
}

/**
 * Controls whose label text runs past their own edges. Measures the text, not the box's scrollWidth: a badge pinned
 * to the corner (the cart count) overhangs on purpose, and text clipped on purpose (truncate) is not visible outside.
 */
async function labelsWiderThanControl(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, a[href]'))) {
      if (el.getClientRects().length === 0) continue;
      const box = el.getBoundingClientRect();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const label = node.textContent?.trim();
        let placedOrClipped = false;
        for (
          let p = node.parentElement;
          p && !placedOrClipped;
          p = p === el ? null : p.parentElement
        ) {
          const style = getComputedStyle(p);
          placedOrClipped =
            style.position === 'absolute' ||
            style.position === 'fixed' ||
            style.overflowX !== 'visible';
        }
        if (!label || placedOrClipped) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const text = range.getBoundingClientRect();
        // A label hidden on phones (the staff header's "Profile") has no box at all.
        if (text.width === 0) continue;
        if (text.left < box.left - 1 || text.right > box.right + 1) {
          out.push(
            `${el.tagName.toLowerCase()} "${label.slice(0, 30)}" ${Math.round(text.width)}px in ${Math.round(box.width)}px`,
          );
          break;
        }
      }
    }
    return out;
  });
}

/**
 * Text cut off by a box that hides its overflow, with no ellipsis to say so: a word the reader never sees. A row that
 * scrolls (overflow auto) keeps its text reachable, a truncated label ends in "…", and screen-reader-only text is
 * clipped on purpose.
 */
async function textCutOff(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const label = node.textContent?.trim();
      if (!label || !node.parentElement) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const text = range.getBoundingClientRect();
      if (text.width === 0) continue;
      for (let p: HTMLElement | null = node.parentElement; p; p = p.parentElement) {
        const style = getComputedStyle(p);
        if (style.overflowX === 'visible') continue;
        const box = p.getBoundingClientRect();
        const cut = text.left < box.left - 1 || text.right > box.right + 1;
        const meant =
          style.overflowX === 'auto' ||
          style.overflowX === 'scroll' ||
          style.textOverflow === 'ellipsis' ||
          box.width <= 1;
        if (cut && !meant)
          out.push(
            `"${label.slice(0, 30)}" ${Math.round(text.width)}px in ${Math.round(box.width)}px`,
          );
        break;
      }
    }
    return out.slice(0, 5);
  });
}

const LAYOUT_ROUTES: {
  path: string;
  role?: Role;
  status?: OrderStatus;
  account?: Partial<User>;
}[] = [
  // The store's page: with the fixtures' one store, `/` itself redirects here.
  { path: '/s/cafe' },
  { path: '/s/cafe/menu' },
  { path: '/cart' },
  { path: '/login' },
  { path: '/register' },
  { path: '/orders', role: 'CUSTOMER' },
  { path: '/profile', role: 'CUSTOMER' },
  { path: '/orders/o1/success', role: 'CUSTOMER' },
  // The order page's hero changes its whole layout with the status.
  ...(['PLACED', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED'] as const).map((status) => ({
    path: '/orders/o1',
    role: 'CUSTOMER' as const,
    status,
  })),
  // The board itself: with the fixtures' one membership, `/staff` redirects here.
  { path: '/staff/cafe', role: 'STAFF' },
  // An account on no store's team: the switcher's empty state.
  { path: '/staff', role: 'CUSTOMER' },
  // The hours editor of a manager, with a day that has hours (its Add and Copy row).
  {
    path: '/manage/cafe/hours',
    role: 'CUSTOMER',
    account: {
      memberships: [
        { storeId: store.id, storeSlug: store.slug, storeName: store.name, role: 'MANAGER' },
      ],
    },
  },
];

/**
 * Waits for the web font and one-shot animations: the fallback font sets text wider, and an entrance or a celebration
 * ring may pass the edge while it plays.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    );
  });
}

/** Everything fits the current screen: nothing past the edge, no sideways scroll, no label or word cut off. */
async function fitsScreen(page: Page, when: string): Promise<void> {
  await settle(page);
  expect(await overflowingPastScreen(page), `elements past the right edge ${when}`).toEqual([]);
  expect(await labelsWiderThanControl(page), `labels past their button ${when}`).toEqual([]);
  expect(await textCutOff(page), `text cut off ${when}`).toEqual([]);
  // A page title says where you are: it wraps rather than ending in "…" ("Orde…" told nobody anything).
  expect(
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1'))
        .filter(
          (h) => getComputedStyle(h).textOverflow === 'ellipsis' && h.scrollWidth > h.clientWidth,
        )
        .map((h) => h.textContent ?? ''),
    ),
    `page titles cut short ${when}`,
  ).toEqual([]);
  // Text spilling out of its own box (a word wider than a narrow tile) is not an element past the edge, but it
  // still scrolls the page sideways.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
    `page width ${when}`,
  ).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
}

for (const { path, role, status, account } of LAYOUT_ROUTES) {
  test(`${path}${role ? ` (${role}${status ? `, ${status}` : ''})` : ''}: every control is at least 44px, and it reflows at 320px and at 200% text`, async ({
    page,
  }) => {
    if (role) await signIn(page, role, status, account);
    await seedCart(page);
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.locator('main, #root > *').first()).toBeVisible();
    await page.waitForLoadState('networkidle');

    expect(await smallTapTargets(page), 'controls under 44px').toEqual([]);
    // One main landmark, so a screen reader can jump to the content; the full-screen pages render their own.
    await expect(page.locator('main')).toHaveCount(1);

    // WCAG 1.4.10 reflow: 320 CSS px wide (a 1280px screen at 400% zoom, or the narrowest phones).
    await page.setViewportSize({ width: 320, height: 640 });
    await fitsScreen(page, 'at 320px');

    // What a phone's largest text setting does: Tailwind sizes are rem, so everything scales from the root.
    await page.setViewportSize({ width: 360, height: 640 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await fitsScreen(page, 'at 200% text');
  });
}

// A phone on its side with its largest text: the sticky top bar, the category chips, the cart bar and the bottom nav
// once covered all 360px of height at 640×360 and 200% text, leaving no item that could be tapped at any scroll.
for (const { name, width, height } of [
  { name: 'a phone on its side', width: 640, height: 360 },
  { name: 'a narrow landscape window', width: 500, height: 300 },
]) {
  test(`/s/cafe/menu on ${name} at 200% text: an item can still be added`, async ({ page }) => {
    await seedCart(page);
    await page.setViewportSize({ width, height });
    await page.goto('/s/cafe/menu');
    await expect(page.getByRole('heading', { name: store.name })).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    // A hit test needs only the layout: wait for the fonts, not for the entrance animations settle() waits out (that
    // wait timed out under a loaded parallel run).
    await page.evaluate(() => document.fonts.ready);

    // Polled: the cards may still be rendering or entering on a loaded runner. Each button is scrolled to the middle of
    // the screen and counts only if a tap at its centre lands on it rather than on a bar.
    const reachable = () =>
      page.getByRole('button', { name: 'Add to cart' }).evaluateAll(
        (buttons) =>
          buttons.filter((el) => {
            el.scrollIntoView({ block: 'center' });
            const box = el.getBoundingClientRect();
            const top = document.elementFromPoint(
              box.left + box.width / 2,
              box.top + box.height / 2,
            );
            return top !== null && el.contains(top);
          }).length,
      );
    await expect
      .poll(reachable, { message: 'Add to cart buttons not covered by the bars' })
      .toBeGreaterThan(0);
  });
}

// An on-screen keyboard shrinks the layout viewport of an upright phone to about 360×480 in browsers that resize it
// (Firefox Android, Chrome before 108, in-app WebViews): `short:` once fired there too, so focusing a checkout field
// flipped the bottom nav to its compact row and back on blur. It is for a phone on its side only.
test('an upright phone with its keyboard open keeps the stacked bottom nav', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 480 });
  await page.goto('/');
  const tab = page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Home' });
  await expect(tab).toBeVisible();
  await expect(tab).toHaveCSS('flex-direction', 'column');
  // The keyboard can leave the layout viewport shorter than it is wide: still an upright phone (CSS calls that landscape).
  await page.setViewportSize({ width: 360, height: 300 });
  await expect(tab).toHaveCSS('flex-direction', 'column');
  // The widest upright phones (about 440px) with the keyboard open: the lower edge of the `short:` min-width.
  await page.setViewportSize({ width: 440, height: 300 });
  await expect(tab).toHaveCSS('flex-direction', 'column');
});

// Text scaled below 100% shrinks rem: the compact row must still be a 44px tap target (CLAUDE.md §2b).
test('a phone on its side with small text keeps 44px bottom nav tabs', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('/');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '81.25%';
  });
  const tab = page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Home' });
  await expect(tab).toHaveCSS('flex-direction', 'row');
  expect((await tab.boundingBox())?.height).toBeGreaterThanOrEqual(44);
});

// A slow network delivers the web font after the content has painted in the fallback. The fallback faces in index.css
// are metric-matched, so the swap must not move anything (the CLS budget in perf-budget.json, CLAUDE.md §2b). Chromium only: WebKit has no
// layout-shift entries.
for (const { path, role } of [
  { path: '/s/cafe' },
  { path: '/s/cafe/menu' },
  { path: '/orders/o1', role: 'CUSTOMER' as const },
  { path: '/staff/cafe', role: 'STAFF' as const },
]) {
  test(`${path}: a late web font does not shift the layout`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'layout-shift entries are Chromium-only');
    if (role) await signIn(page, role);
    // Held until the text has been checked, not for a fixed time: on a slow CI runner the page can take as long to
    // render as any timeout, and the font would land first.
    let releaseFont = () => {};
    const fontHeld = new Promise<void>((resolve) => (releaseFont = resolve));
    await page.route('https://fonts.googleapis.com/**', async (route) => {
      await fontHeld;
      await route.continue();
    });
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          value: number;
          hadRecentInput: boolean;
        }[]) {
          if (!entry.hadRecentInput) w.__cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    // `load` waits for the held stylesheet; the app has rendered long before it.
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    // Before the web font lands, the text must be drawn in a metric-matched fallback: an unlayered rule (the boot
    // style) overriding --font-sans, or a stack without the fallback faces, would draw it in whatever sans is left.
    // They need Roboto, Arial or Liberation Sans on the machine: CI has Liberation Sans (Playwright's --with-deps); a
    // laptop with none of them skips instead of failing, and CI never skips.
    const heading = page.locator(':is(h1, h2, h3, p):visible').first();
    await expect(heading).toBeVisible();
    await heading.evaluate((el) => el.setAttribute('data-font-probe', ''));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '[data-font-probe]',
    });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    const drawnIn = fonts.map((f) => f.familyName);
    const matched = drawnIn.some((name) => /^(Roboto|Arial|Liberation Sans|Arimo)$/.test(name));
    const installed = await page.evaluate(async () => {
      const faces = [...document.fonts].filter((f) => f.family.includes('Jakarta Fallback'));
      await Promise.all(faces.map((f) => f.load().catch(() => undefined)));
      return faces.some((f) => f.status === 'loaded');
    });
    test.skip(!process.env.CI && !installed, 'no Roboto, Arial or Liberation Sans installed');
    expect(matched, `heading drawn in ${drawnIn.join(', ')} before the web font arrives`).toBe(
      true,
    );
    releaseFont();
    await page.waitForFunction(() => document.fonts.check('700 16px "Plus Jakarta Sans"'), null, {
      timeout: 15_000,
    });
    await page.evaluate(() => document.fonts.ready);
    // Two frames for the swap to lay out and report.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, 'layout shift when the web font arrives').toBeLessThanOrEqual(budget.cls);
  });
}

// The largest paint must not sit inside an entrance fade (docs/FRONTEND_STRUCTURE.md "The largest paint"): Chrome
// skips a paint at opacity 0 and does not count the fade, so the hero is only recorded at its next repaint (the web
// font swap, or never when fonts fail) and LCP reads seconds late. With the fonts blocked there is no later repaint.
for (const status of ['PLACED', 'READY', 'COLLECTED'] as const) {
  test(`the order page's largest paint is its hero, counted when it first shows (${status})`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'largest-contentful-paint entries are Chromium-only');
    await signIn(page, 'CUSTOMER', status);
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await page.goto('/orders/o1');
    await expect(page.locator('main section').first()).toBeVisible();
    await page.waitForTimeout(1500);
    const lcp = await page.evaluate(
      () =>
        new Promise<{ inHero: boolean; tag: string }>((resolve) => {
          new PerformanceObserver((list) => {
            const entries = list.getEntries() as unknown as { element: Element | null }[];
            const last = entries.at(-1)?.element ?? null;
            const hero = document.querySelector('main section');
            resolve({ inHero: !!last && !!hero?.contains(last), tag: last?.tagName ?? 'none' });
          }).observe({ type: 'largest-contentful-paint', buffered: true });
        }),
    );
    expect(lcp.inHero, `largest paint was a ${lcp.tag} outside the hero`).toBe(true);
  });
}

// Loading a page must move nothing: a top margin on the lazy fallback collapsed through <body> on the full-screen
// routes (everything jumped 16px down and back), and the staff header wrapped when "Connecting…" became "Updated just
// now" (the board jumped 36px). The staff board's first poll is held back so its loading state paints first.
// Held to 0.01: the web font's own swap moves a line by a pixel (about 0.001); a real jump is 0.025 and up.
for (const { path, role, width } of [
  { path: '/login', width: 360 },
  { path: '/register', width: 360 },
  // Whether the header's clock cluster fits beside the wordmark depends on the width: check the phone range.
  ...[360, 390, 412].map((width) => ({ path: '/staff/cafe', role: 'STAFF' as const, width })),
]) {
  test(`${path} at ${width}px: loading the page moves nothing`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'layout-shift entries are Chromium-only');
    await page.setViewportSize({ width, height: 640 });
    if (role) {
      await signIn(page, role);
      await page.route(/\/api\/(stores\/s1\/)?orders/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 800));
        await route.fallback();
      });
    }
    await page.addInitScript(() => {
      const w = window as unknown as { __shifts: string[]; __cls: number };
      w.__shifts = [];
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          value: number;
          sources: { node?: Node }[];
        }[]) {
          const nodes = entry.sources.map((s) => (s.node as Element | undefined)?.tagName ?? '?');
          w.__shifts.push(`${entry.value.toFixed(4)} ${nodes.join(',')}`);
          w.__cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    const { cls, shifts } = await page.evaluate(() => {
      const w = window as unknown as { __shifts: string[]; __cls: number };
      return { cls: w.__cls, shifts: w.__shifts };
    });
    expect(cls, `layout shift while the page loaded: ${shifts.join(' | ')}`).toBeLessThanOrEqual(
      0.01,
    );
  });
}
