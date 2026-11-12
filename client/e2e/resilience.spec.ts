import { expect, test } from '@playwright/test';
import type { User } from '../src/types/api';
import {
  config,
  menu,
  mockApi,
  mockSupabaseToken,
  seedCart,
  signIn,
  store,
  watchConsole,
} from './fixtures';

// The client recovers from what a phone and its network do to it: full storage, a malformed response, a failed
// sign-in chunk, a clock hours fast.

test.beforeEach(async ({ page }) => mockApi(page));

const customer = (): User => ({
  id: 'u1',
  name: 'Anishka',
  email: 'anishka@example.com',
  phone: null,
  role: 'CUSTOMER',
  createdAt: new Date().toISOString(),
  memberships: [],
  ownedBrands: [],
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
  const user = customer();
  await mockSupabaseToken(page, user);

  await page.goto('/s/cafe/menu');
  await expect(page.getByRole('heading', { name: store.name })).toBeVisible();
  await page.getByRole('button', { name: 'Add to cart' }).first().click();
  await expect(page.getByLabel('Cart, 1 item')).toBeVisible();

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('test1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(s\/cafe)?$/);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  expect(problems).toEqual([]);
});

// One malformed 200 was persisted (fp_cache) and crashed every later load, so Reload could never recover; a malformed
// config, read above the app boundary, left a blank page.
test('a malformed menu once does not outlive a Reload, and a malformed config still renders', async ({
  page,
}) => {
  let broken = true;
  await page.route('**/api/stores/cafe/menu', (route) =>
    broken ? route.fulfill({ json: { ...menu, categories: null } }) : route.fallback(),
  );
  await page.goto('/s/cafe/menu');
  const reload = page.getByRole('button', { name: 'Reload' });
  await expect(reload).toBeVisible();
  broken = false;
  await reload.click();
  await expect(page.getByRole('button', { name: 'Add to cart' }).first()).toBeVisible();

  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { ...config, clientErrors: null } }),
  );
  for (const load of [() => page.goto('/'), () => page.reload()]) {
    await load();
    // After the config has arrived and been read, not just the first paint.
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Skip the queue.' })).toBeVisible();
  }
});

// Chromium keeps a failed import() for the page's life: one failed load of the supabase-js chunk made every signed-in
// call fail with a Try Again that could never work. The retry is a reload, which keeps the cart and the draft.
test('a failed sign-in chunk: Reload, then Pay goes through', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'the failed-import cache is Chromium behaviour');
  await signIn(page, 'CUSTOMER');
  await seedCart(page);
  // Every load fails until Reload: getSupabase retries a failed import once (Chromium answers that from its cache of
  // the failure, other browsers fetch again), so only the retry's failure asks for the reload.
  let broken = true;
  await page.route(/supabaseClient/, (route) => (broken ? route.abort() : route.fallback()));
  let posted = 0;
  await page.route('**/api/orders', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posted += 1;
    return route.fulfill({ status: 503, json: { error: { code: 'X', message: 'Reached.' } } });
  });
  await page.goto('/checkout');
  await page.getByRole('button', { name: /^Pay / }).click();
  await expect(page.getByText(/Reload the page to continue/)).toBeVisible();
  broken = false;
  await page.getByRole('button', { name: 'Reload' }).click();
  await page.getByRole('button', { name: /^Pay / }).click();
  await expect(page.getByText('Reached.')).toBeVisible();
  expect(posted).toBe(1);
});

// supabase-js compared the server's expires_at with the phone's clock: hours fast, every call refreshed the token, and
// one refused refresh signed the user out.
test('a phone clock hours fast refreshes the token at most once across page loads', async ({
  page,
}) => {
  await page.clock.install({ time: Date.now() + 5.5 * 3600e3 });
  const user = customer();
  const tokenPosts = await mockSupabaseToken(page, user);
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('test1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(s\/cafe)?$/);
  for (const path of ['/orders', '/profile']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  expect(tokenPosts).toHaveLength(1);
});
