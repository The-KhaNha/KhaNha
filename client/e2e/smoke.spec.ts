import { expect, test, type Page } from '@playwright/test';
import fallbacks from '../src/config/fallbacks.json' with { type: 'json' };
import budget from '../perf-budget.json' with { type: 'json' };
import type {
  Config,
  MenuItem,
  MenuResponse,
  Order,
  OrderStatus,
  Role,
  Store,
  User,
} from '../src/types/api';

// Safari's engine on a 360px-class phone, with every API call mocked: this checks the client alone (layout,
// hydration, the cart) so it needs no backend and runs the same on a laptop and in CI.

const store: Store = {
  id: 's1',
  name: 'Campus Cafe',
  tagline: 'Coffee and toasties by the quad',
  description: 'Order ahead and skip the queue.',
  imageUrl: '/images/cafe-cover.jpg',
  isOpen: true,
  prepTimeMinMinutes: 10,
  prepTimeMaxMinutes: 15,
};

const item = (overrides: Partial<MenuItem>): MenuItem => ({
  id: 'i1',
  category: 'Coffee',
  name: 'Cold Coffee',
  description: 'Creamy chilled coffee',
  price: 120,
  imageUrl: '/images/cold-coffee.jpg',
  isAvailable: true,
  isPopular: true,
  sortOrder: 1,
  stockQuantity: null,
  ...overrides,
});

const items = [
  item({}),
  item({
    id: 'i2',
    name: 'Cheese Toast',
    category: 'Snacks',
    price: 90,
    isPopular: false,
    sortOrder: 2,
  }),
];

const menu: MenuResponse = {
  rules: { maxQuantityPerItem: 10, lowStockThreshold: 5 },
  store,
  popular: items.filter((i) => i.isPopular),
  categories: [
    { name: 'Coffee', items: [items[0]!] },
    { name: 'Snacks', items: [items[1]!] },
  ],
};

const config: Config = { serverVersion: '0.0.0', ...fallbacks };

async function mockApi(page: Page): Promise<void> {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/config') return json(config);
    if (path === '/api/store') return json({ store });
    if (path === '/api/menu') return json(menu);
    return json({ error: { code: 'NOT_FOUND', message: `No route matches ${path}.` } }, 404);
  });
}

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
  });
  return problems;
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const [scrollWidth, innerWidth] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scrollWidth, 'page must not scroll sideways').toBeLessThanOrEqual(innerWidth);
}

test.beforeEach(async ({ page }) => mockApi(page));

test('home renders the one-line pitch with nothing spilling off a small screen', async ({
  page,
}) => {
  const problems = watchConsole(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Skip the queue.' })).toBeVisible();
  await noHorizontalOverflow(page);
  expect(problems).toEqual([]);
});

test('menu → add to cart → cart works on WebKit', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/menu');
  await expect(page.getByRole('heading', { name: store.name })).toBeVisible();
  await noHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Add to cart' }).first().click();
  await expect(page.getByLabel('Cart, 1 item')).toBeVisible();

  await page.goto('/cart');
  await expect(page.getByText('Cold Coffee')).toBeVisible();
  await noHorizontalOverflow(page);
  expect(problems).toEqual([]);
});

// Storage that is there but full (older iOS private mode, a full quota, some WebViews): every write throws. zustand's
// persist writes inside each set() without a catch, which once showed the error page on every /menu load and
// "Something went wrong." for a correct password.
test('storage full: /menu renders and sign-in works', async ({ page }) => {
  const problems = watchConsole(page);
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
  });
  const user: User = {
    id: 'u1',
    name: 'Anishka',
    email: 'anishka@example.com',
    phone: null,
    role: 'CUSTOMER',
    createdAt: new Date().toISOString(),
  };
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user } }));
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  await page.route('**/auth/v1/token**', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: cors })
      : route.fulfill({
          headers: cors,
          json: {
            access_token: 'e2e',
            refresh_token: 'e2e',
            token_type: 'bearer',
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user: {
              id: user.id,
              aud: 'authenticated',
              email: user.email,
              app_metadata: {},
              user_metadata: {},
            },
          },
        }),
  );

  await page.goto('/menu');
  await expect(page.getByRole('heading', { name: store.name })).toBeVisible();
  await page.getByRole('button', { name: 'Add to cart' }).first().click();
  await expect(page.getByLabel('Cart, 1 item')).toBeVisible();

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('test1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  expect(problems).toEqual([]);
});

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

const CART_LINE = {
  menuItemId: 'i1',
  name: 'Cold Coffee',
  unitPrice: 120,
  imageUrl: '/images/cold-coffee.jpg',
  quantity: 2,
  maxQuantity: null,
};

/**
 * Signs the page in as `role` without a backend: the persisted auth store, a supabase-js session that is not near
 * expiry (so it makes no network call; the key's `127` is the host in the tracked client/.env.development) and a
 * fresh activity stamp. /api/auth/me and the order endpoints answer with fixtures.
 */
async function signIn(page: Page, role: Role, status: OrderStatus = 'PLACED'): Promise<void> {
  const now = new Date().toISOString();
  const user: User = {
    id: 'u1',
    name: 'Anishka',
    email: 'a@example.com',
    phone: null,
    role,
    createdAt: now,
  };
  const order: Order = {
    id: 'o1',
    orderNumber: 1042,
    status,
    paymentStatus: 'PAID',
    total: 240,
    customerName: user.name,
    customerPhone: null,
    note: 'Less sugar, please',
    estimatedReadyAt: now,
    createdAt: now,
    updatedAt: now,
    store: { id: store.id, name: store.name },
    items: [
      {
        id: 'l1',
        menuItemId: 'i1',
        name: 'Cold Coffee',
        unitPrice: 120,
        quantity: 2,
        lineTotal: 240,
      },
    ],
  };
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user } }));
  await page.route('**/api/orders**', (route) =>
    route.fulfill({
      json:
        new URL(route.request().url()).pathname === '/api/orders' ? { orders: [order] } : { order },
    }),
  );
  await page.addInitScript((user) => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('fp_auth', JSON.stringify({ state: { user, token: 'e2e' }, version: 0 }));
    localStorage.setItem('fp_last_active', String(Date.now()));
    localStorage.setItem(
      'sb-127-auth-token',
      JSON.stringify({
        access_token: 'e2e',
        refresh_token: 'e2e',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: expiresAt,
        user: {
          id: user.id,
          aud: 'authenticated',
          email: user.email,
          app_metadata: {},
          user_metadata: {},
        },
      }),
    );
  }, user);
}

const LAYOUT_ROUTES: { path: string; role?: Role; status?: OrderStatus }[] = [
  { path: '/' },
  { path: '/menu' },
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
  { path: '/staff', role: 'STAFF' },
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

for (const { path, role, status } of LAYOUT_ROUTES) {
  test(`${path}${role ? ` (${role}${status ? `, ${status}` : ''})` : ''}: every control is at least 44px, and it reflows at 320px and at 200% text`, async ({
    page,
  }) => {
    if (role) await signIn(page, role, status);
    await page.addInitScript((line) => {
      localStorage.setItem('fp_cart', JSON.stringify({ state: { lines: [line] }, version: 1 }));
    }, CART_LINE);
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
test('/menu on a phone on its side at 200% text: an item can still be added', async ({ page }) => {
  await page.addInitScript((line) => {
    localStorage.setItem('fp_cart', JSON.stringify({ state: { lines: [line] }, version: 1 }));
  }, CART_LINE);
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('/menu');
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
          const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return top !== null && el.contains(top);
        }).length,
    );
  await expect
    .poll(reachable, { message: 'Add to cart buttons not covered by the bars' })
    .toBeGreaterThan(0);
});

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
  { path: '/' },
  { path: '/menu' },
  { path: '/orders/o1', role: 'CUSTOMER' as const },
  { path: '/staff', role: 'STAFF' as const },
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
  ...[360, 390, 412].map((width) => ({ path: '/staff', role: 'STAFF' as const, width })),
]) {
  test(`${path} at ${width}px: loading the page moves nothing`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'layout-shift entries are Chromium-only');
    await page.setViewportSize({ width, height: 640 });
    if (role) {
      await signIn(page, role);
      await page.route('**/api/orders**', async (route) => {
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

// supabase-js (the auth chunk) loads on demand (CLAUDE.md §2b): never for an anonymous visitor, and for a signed-in
// one as soon as the app starts, not after the first render, so the page's data does not wait for it in series with
// the page's own chunk. The dev server serves each module on request, so the request order shows when each started.
test('supabase-js loads early for a signed-in visit and never for an anonymous one', async ({
  browser,
}) => {
  const requested = async (path: string, role?: Role) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await mockApi(page);
    if (role) await signIn(page, role);
    const urls: string[] = [];
    page.on('request', (r) => urls.push(new URL(r.url()).pathname));
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await context.close();
    return urls;
  };

  const anonymous = await requested('/');
  expect(anonymous.filter((u) => u.includes('supabaseClient'))).toEqual([]);

  const staff = await requested('/staff', 'STAFF');
  const auth = staff.findIndex((u) => u.includes('supabaseClient'));
  const page = staff.findIndex((u) => u.includes('StaffDashboard'));
  expect(auth, 'supabase-js requested').toBeGreaterThan(-1);
  expect(auth, 'supabase-js requested before the page chunk').toBeLessThan(page);
});

test('following a link titles the new page and moves keyboard focus to it', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Food Pickup');
  await page.getByRole('link', { name: /View Menu/ }).click();
  await expect(page).toHaveTitle('Menu · Food Pickup');
  // Not <body>: a keyboard or screen-reader user starts the new page at its top.
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
});

// Each form checks a field when it loses focus, and pressing the submit button takes that focus. A blur that hid an
// error line moved everything below it up between press and release, so the press landed past the button and nothing
// was sent: a Pay that silently did nothing. An error may appear on blur; only an edit removes it.
const FORMS: {
  path: string;
  role?: Role;
  submit: string | RegExp;
  /** The request a press sends. */
  sends: string;
  /** `name` is the API's field, for a form that shows the server's field errors on the field. */
  field: { label: string; name?: string; bad: string; good: string };
  fill: Record<string, string>;
}[] = [
  {
    path: '/checkout',
    role: 'CUSTOMER',
    submit: /^Pay /,
    sends: '**/api/orders',
    field: { label: 'Phone', name: 'customerPhone', bad: '12', good: '98765 43210' },
    fill: {},
  },
  {
    path: '/register',
    submit: 'Create account',
    sends: '**/api/auth/register',
    field: { label: 'Email', name: 'email', bad: 'anishka@', good: 'anishka@example.com' },
    fill: { Name: 'Anishka', Password: 'test1234' },
  },
  {
    path: '/login',
    submit: 'Sign in',
    sends: '**/auth/v1/token**',
    field: { label: 'Email', bad: 'anishka@', good: 'anishka@example.com' },
    fill: { Password: 'test1234' },
  },
];

/** Opens the form with every field valid; the returned list grows by one per request a press sends. */
async function openForm(page: Page, form: (typeof FORMS)[number]): Promise<string[]> {
  await mockApi(page);
  if (form.role) await signIn(page, form.role);
  await page.addInitScript((line) => {
    localStorage.setItem('fp_cart', JSON.stringify({ state: { lines: [line] }, version: 1 }));
  }, CART_LINE);
  const sent: string[] = [];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  await page.route(form.sends, (route) => {
    const method = route.request().method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (method !== 'POST') return route.fallback();
    sent.push(form.path);
    return route.fulfill({
      status: 400,
      headers: cors,
      json: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The server refused this value.',
          ...(form.field.name && { details: { field: form.field.name } }),
        },
      },
    });
  });
  await page.goto(form.path);
  for (const [label, value] of Object.entries(form.fill)) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByLabel(form.field.label, { exact: true }).fill(form.field.good);
  return sent;
}

/** Low on the button, where a thumb often lands: any jump up under it loses the press, not only a big one. */
async function pressLow(page: Page, form: (typeof FORMS)[number]): Promise<void> {
  const submit = page.getByRole('button', { name: form.submit });
  const box = await submit.boundingBox();
  await submit.click({ position: { x: 24, y: (box?.height ?? 44) - 6 } });
}

for (const form of FORMS) {
  test(`${form.path}: a field fixed in place, then a press on submit, sends`, async ({ page }) => {
    const sent = await openForm(page, form);
    const field = page.getByLabel(form.field.label, { exact: true });
    await field.fill(form.field.bad);
    await pressLow(page, form);
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(sent, 'nothing sent while the field is invalid').toEqual([]);
    // Fixed without leaving the field: the press that follows is what blurs it.
    await field.fill(form.field.good);
    await pressLow(page, form);
    await expect.poll(() => sent.length).toBe(1);
  });

  if (form.field.name) {
    test(`${form.path}: after the server refuses a field, pressing submit again sends again`, async ({
      page,
    }) => {
      const sent = await openForm(page, form);
      await pressLow(page, form);
      // The form shows the refusal on the field and moves focus there, as it does for a phone the server rejects.
      await expect(page.getByText('The server refused this value.')).toBeVisible();
      await expect(page.getByLabel(form.field.label, { exact: true })).toBeFocused();
      await pressLow(page, form);
      await expect.poll(() => sent.length).toBe(2);
    });
  }
}

test('the page is described, installable and crawl-safe', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /campus café/);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Food Pickup');

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = (await (await request.get(manifestHref ?? '')).json()) as {
    name: string;
    display: string;
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };
  expect(manifest).toMatchObject({ name: 'Food Pickup', display: 'standalone' });
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  // Every icon it lists is served, as the type and (for PNGs) at the size it claims.
  for (const icon of manifest.icons) {
    const res = await request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()['content-type'], icon.src).toContain(icon.type.split('+')[0]);
    if (icon.type === 'image/png') {
      const png = await res.body();
      const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
      expect(`${w}x${h}`, icon.src).toBe(icon.sizes);
    }
  }
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect((await request.get(apple ?? '')).status()).toBe(200);
  expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /checkout');
});

test('follows the device colour scheme', async ({ browser }) => {
  for (const [scheme, background] of [
    ['light', 'rgb(251, 245, 236)'],
    ['dark', 'rgb(22, 17, 14)'],
  ] as const) {
    const context = await browser.newContext({ colorScheme: scheme });
    const page = await context.newPage();
    await mockApi(page);
    await page.goto('/menu');
    await expect(page.getByRole('heading', { name: 'Campus Cafe' })).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), scheme).toBe(
      background,
    );
    await context.close();
  }
});
