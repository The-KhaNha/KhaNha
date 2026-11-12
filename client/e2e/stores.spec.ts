import { expect, test } from '@playwright/test';
import { menu, mockApi, seedCart, signIn, store } from './fixtures';

test.beforeEach(async ({ page }) => mockApi(page));

test('a cart from one store is replaced by an add from another, after a confirmation', async ({
  page,
}) => {
  const bistro = { ...store, id: 's2', slug: 'bistro', name: 'Bistro' };
  const bistroMenu = { ...menu, store: bistro };
  await page.route('**/api/stores/bistro', (route) => route.fulfill({ json: { store: bistro } }));
  await page.route('**/api/stores/bistro/menu', (route) => route.fulfill({ json: bistroMenu }));
  await seedCart(page); // a cart at Campus Cafe
  await page.goto('/s/bistro/menu');
  await page.getByRole('button', { name: 'Add to cart' }).first().click();
  await page.getByRole('button', { name: 'Replace with Bistro' }).click();
  // Read in place: a reload would run seedCart again.
  const saved = await page.evaluate(() => localStorage.getItem('fp_cart'));
  expect(saved).toContain('"storeName":"Bistro"');
  expect(saved).not.toContain('Campus Cafe');
});

test('staff of one store never reach, or ask for, the orders of another', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => asked.push(new URL(r.url()).pathname));
  await signIn(page, 'STAFF'); // a member of Campus Cafe only
  await page.goto('/staff/bistro');
  await expect(page).not.toHaveURL(/\/staff/);
  expect(asked.filter((p) => p.startsWith('/api/') && p.includes('/orders'))).toEqual([]);
});
