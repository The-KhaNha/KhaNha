import { expect, test, type Page } from '@playwright/test';
import fallbacks from '../src/config/fallbacks.json' with { type: 'json' };
import type { Config, MenuItem, MenuResponse, Store } from '../src/types/api';

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

const CART_LINE = {
  menuItemId: 'i1',
  name: 'Cold Coffee',
  unitPrice: 120,
  imageUrl: '/images/cold-coffee.jpg',
  quantity: 2,
  maxQuantity: null,
};

// The routes a signed-out customer reaches; the signed-in ones are covered by ui-verifier L11 and /break env.
for (const path of ['/', '/menu', '/cart', '/login', '/register']) {
  test(`${path}: every control is at least 44px, and nothing leaves the screen at 200% text`, async ({
    page,
  }) => {
    await page.addInitScript((line) => {
      localStorage.setItem('fp_cart', JSON.stringify({ state: { lines: [line] }, version: 1 }));
    }, CART_LINE);
    await page.goto(path);
    await expect(page.locator('main, #root > *').first()).toBeVisible();
    await page.waitForLoadState('networkidle');

    expect(await smallTapTargets(page), 'controls under 44px').toEqual([]);

    // What a phone's largest text setting does: Tailwind sizes are rem, so everything scales from the root.
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    expect(await overflowingPastScreen(page), 'elements past the right edge at 200% text').toEqual(
      [],
    );
  });
}

test('following a link titles the new page and moves keyboard focus to it', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Food Pickup');
  await page.getByRole('link', { name: /View Menu/ }).click();
  await expect(page).toHaveTitle('Menu · Food Pickup');
  // Not <body>: a keyboard or screen-reader user starts the new page at its top.
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
});

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
