import { expect, test } from '@playwright/test';
import { mockApi, noHorizontalOverflow, signIn } from './fixtures';

test('an admin creates a restaurant and gets its owner link', async ({ page }) => {
  await mockApi(page);
  await signIn(page, 'ADMIN');
  const brands: unknown[] = [];
  const posted: unknown[] = [];
  // Registered after mockApi, so these win.
  await page.route('**/api/admin/settings', (route) =>
    route.fulfill({
      json: {
        settings: {
          customerOrderHistoryLimit: 20,
          maxLinesPerOrder: 30,
          orderPollMs: 4000,
          ordersPollMs: 8000,
          staffBoardPollMs: 4000,
          clientErrorSamplePercent: 100,
          minClientVersion: '0.0.0',
          updatedAt: '2026-09-27T00:00:00Z',
        },
      },
    }),
  );
  await page.route('**/api/admin/brands', (route) => {
    if (route.request().method() === 'POST') {
      posted.push(route.request().postDataJSON());
      const brand = {
        id: 'b9',
        name: 'Chai Point',
        slug: 'chai-point',
        createdAt: new Date().toISOString(),
        branchCount: 0,
        owner: null,
        invite: null,
      };
      brands.push(brand);
      return route.fulfill({ status: 201, json: { brand } });
    }
    return route.fulfill({ json: { brands } });
  });
  await page.route('**/api/admin/brands/b9/invites', (route) => {
    posted.push(route.request().postDataJSON());
    const invite = {
      id: 'i9',
      email: 'owner@example.com',
      expiresAt: '2030-01-01T00:00:00Z',
      createdAt: '',
    };
    // The list reload must show the open invite, as the real API would.
    const stored = brands.find((b) => (b as { id: string }).id === 'b9') as { invite: unknown };
    stored.invite = invite;
    return route.fulfill({ status: 201, json: { token: 'tok-e2e', invite } });
  });

  await page.goto('/admin');
  await expect(page.getByText('No restaurants yet')).toBeVisible();
  await noHorizontalOverflow(page);
  await page.getByLabel('Restaurant name').fill('Chai Point');
  await page.getByLabel('Owner email').fill('owner@example.com');
  await page.getByRole('button', { name: 'Create and get link' }).click();

  await expect(page.getByText(/\/join\/owner#tok-e2e$/)).toBeVisible();
  await expect(page.getByText(/Invite open for owner@example\.com/)).toBeVisible();
  await expect(page.getByRole('button', { name: /New link/ })).toBeVisible();
  expect(posted).toEqual([{ name: 'Chai Point' }, { email: 'owner@example.com' }]);
  await noHorizontalOverflow(page);
});
