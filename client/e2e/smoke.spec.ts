import { expect, test } from '@playwright/test';
import type { Role } from '../src/types/api';
import { mockApi, noHorizontalOverflow, signIn, store, watchConsole } from './fixtures';

// The core path on a 360px-class phone (Safari's engine weekly, Chromium on every PR), every API call mocked. The
// rest of the e2e suite: layout.spec.ts (fit, tap targets, layout shift), forms.spec.ts (submit and checkout) and
// resilience.spec.ts (storage, cache, chunk and clock failures).

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
