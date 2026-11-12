import { expect, test } from '@playwright/test';
import { mockApi, noHorizontalOverflow, signIn, store, summary } from './fixtures';

test('a manager closes today and the store list says so', async ({ page }) => {
  await mockApi(page);
  await signIn(page, 'CUSTOMER', 'PLACED', {
    memberships: [
      { storeId: store.id, storeSlug: store.slug, storeName: store.name, role: 'MANAGER' },
    ],
  });
  const closed = {
    ...store,
    isOpen: false,
    openState: 'CLOSED' as const,
    openLabel: 'Closed for Diwali',
  };
  let exceptions: unknown[] = [];
  const posted: unknown[] = [];
  // Registered after mockApi, so these win: the store answers as closed once the exception exists.
  await page.route('**/api/stores/s1/hours', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Kolkata', hours: [], exceptions } }),
  );
  await page.route('**/api/stores/s1/schedule-exceptions', (route) => {
    posted.push(route.request().postDataJSON());
    exceptions = [{ id: 'e1', opensAt: null, closesAt: null, ...(posted[0] as object) }];
    return route.fulfill({ status: 201, json: { exception: exceptions[0] } });
  });
  await page.route('**/api/stores', (route) =>
    route.fulfill({ json: { stores: [summary(exceptions.length ? closed : store)] } }),
  );
  // With one store, / also loads its detail: both must agree or the card flips back to Open.
  await page.route('**/api/stores/cafe', (route) =>
    route.fulfill({ json: { store: exceptions.length ? closed : store } }),
  );

  await page.goto('/manage/cafe/hours');
  await expect(page.getByLabel('Monday opens')).toHaveCount(0);
  await noHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Closed for …' }).click();
  await page.getByLabel('Label').fill('Closed for Diwali');
  await page.getByRole('button', { name: 'Add special day' }).click();
  await expect(page.getByText('Closed for Diwali').first()).toBeVisible();
  expect(posted[0]).toMatchObject({ kind: 'CLOSED', label: 'Closed for Diwali' });

  await page.goto('/');
  await expect(page.getByText('Closed for Diwali')).toBeVisible();
});
