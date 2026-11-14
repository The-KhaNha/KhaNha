import { expect, test } from '@playwright/test';
import { managed, menu, mockApi, noHorizontalOverflow, signIn, store, summary } from './fixtures';

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
  await page.route('**/api/stores/s1/manage/hours', (route) =>
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

test('a manager adds an item and a customer sees it', async ({ page }) => {
  await mockApi(page);
  await signIn(page, 'CUSTOMER', 'PLACED', {
    memberships: [
      { storeId: store.id, storeSlug: store.slug, storeName: store.name, role: 'MANAGER' },
    ],
  });
  const added = { ...menu.categories[0]!.items[0]!, id: 'i9', name: 'Masala Chai', price: 30 };
  let created = false;
  await page.route('**/api/stores/s1/menu-items', (route) => {
    if (route.request().method() === 'POST') {
      created = true;
      return route.fulfill({
        status: 201,
        json: { item: { ...added, isEnabled: true, archivedAt: null } },
      });
    }
    return route.fulfill({ json: { items: [] } });
  });
  // The customer's menu answers with the new item once it exists.
  await page.route('**/api/stores/cafe/menu', (route) =>
    route.fulfill({
      json: created
        ? { ...menu, categories: [{ name: 'Coffee', items: [added] }], popular: [] }
        : menu,
    }),
  );

  await page.goto('/manage/cafe/menu');
  await noHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Add item' }).first().click();
  await page.getByLabel('Name').fill('Masala Chai');
  await page.getByLabel('Price (₹)').fill('30');
  await page.getByLabel('Category', { exact: true }).last().fill('Coffee');
  await page.getByRole('dialog').getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('/s/cafe/menu');
  await expect(page.getByText('Masala Chai').first()).toBeVisible();
});

test('a manager adds an item with a photo, and a phone downloads its 400w size', async ({
  page,
  browserName,
}) => {
  await mockApi(page);
  await signIn(page, 'CUSTOMER', 'PLACED', {
    memberships: [
      { storeId: store.id, storeSlug: store.slug, storeName: store.name, role: 'MANAGER' },
    ],
  });
  const variant = (w: number) => `/media/stores/s1/variants/abc-${w}.webp`;
  // Filled by the routes below: what the browser sent.
  const captured: { photo?: Buffer; photoType?: string; item?: Record<string, unknown> } = {};
  await page.route('**/api/stores/s1/media/uploads', (route) =>
    route.fulfill({
      status: 201,
      json: {
        uploadId: 'u1',
        upload: {
          method: 'PUT',
          url: '/api/stores/s1/media/uploads/u1/file',
          headers: { 'Content-Type': 'image/jpeg' },
        },
      },
    }),
  );
  await page.route('**/api/stores/s1/media/uploads/u1/file', (route) => {
    captured.photo = route.request().postDataBuffer() ?? undefined;
    captured.photoType = route.request().headers()['content-type'];
    return route.fulfill({ status: 204 });
  });
  const processed = {
    id: 'u1',
    status: 'PROCESSED',
    contentType: 'image/jpeg',
    byteSize: 1,
    url: variant(900),
    variants: [
      { width: 400, height: 300, url: variant(400) },
      { width: 900, height: 675, url: variant(900) },
    ],
    failure: null,
    createdAt: new Date().toISOString(),
  };
  await page.route('**/api/stores/s1/media/uploads/u1/complete', (route) =>
    route.fulfill({ json: { upload: { ...processed, status: 'UPLOADED', variants: null } } }),
  );
  await page.route('**/api/stores/s1/media/uploads/u1', (route) =>
    route.fulfill({ json: { upload: processed } }),
  );
  // Any photo will do for the variants: a bundled one.
  await page.route(
    (url) => url.pathname.startsWith('/media/'),
    (route) => route.fulfill({ path: 'public/images/cold-coffee.jpg', contentType: 'image/jpeg' }),
  );
  const added = {
    ...menu.categories[0]!.items[0]!,
    id: 'i9',
    name: 'Filter Coffee',
    imageUrl: variant(900),
    imageSrcSet: `${variant(400)} 400w, ${variant(900)} 900w`,
  };
  await page.route('**/api/stores/s1/menu-items', (route) => {
    if (route.request().method() === 'POST') {
      captured.item = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: { item: { ...added, isEnabled: true, archivedAt: null } },
      });
    }
    return route.fulfill({ json: { items: [] } });
  });
  await page.route('**/api/stores/cafe/menu', (route) =>
    route.fulfill({
      json: captured.item
        ? { ...menu, categories: [{ name: 'Coffee', items: [added] }], popular: [] }
        : menu,
    }),
  );

  await page.goto('/manage/cafe/menu');
  await page.getByRole('button', { name: 'Add item' }).first().click();
  await page.getByLabel('Name').fill('Filter Coffee');
  await page.getByLabel('Price (₹)').fill('40');
  await page.getByLabel('Category', { exact: true }).last().fill('Coffee');
  await page.locator('input[type="file"]').setInputFiles('public/images/cold-coffee.jpg');
  await expect(page.getByText('New photo ready. Save to use it.')).toBeVisible();
  await noHorizontalOverflow(page);
  // The browser redrew it as a JPEG before sending. Playwright's WebKit never hands a route a Blob body (text and
  // ArrayBuffer bodies, yes; checked 15 November 2026), so there the header is what can be seen of it.
  expect(captured.photoType).toBe('image/jpeg');
  if (browserName !== 'webkit')
    expect(captured.photo?.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  await page.getByRole('dialog').getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(captured.item).toMatchObject({ imageUploadId: 'u1' });

  await page.goto('/s/cafe/menu');
  const img = page.locator('img[srcset*="abc-400"]').first();
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).currentSrc))
    .toContain(variant(400));
});

test('staff marks an item sold out on the Stock view and the menu shows it', async ({ page }) => {
  await mockApi(page);
  await signIn(page, 'STAFF');
  const first = menu.categories[0]!.items[0]!;
  let soldOut = false;
  const current = () => ({
    ...first,
    stockQuantity: soldOut ? 0 : 8,
    isAvailable: !soldOut,
  });
  await page.route('**/api/stores/s1/stock', (route) =>
    route.fulfill({
      json: { items: [{ ...current(), isEnabled: true, archivedAt: null }], lowStockThreshold: 5 },
    }),
  );
  await page.route(`**/api/stores/s1/menu-items/${first.id}/stock`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ set: 0 });
    soldOut = true;
    return route.fulfill({ json: { stockQuantity: 0 } });
  });
  await page.route('**/api/stores/cafe/menu', (route) =>
    route.fulfill({
      json: { ...menu, categories: [{ name: 'Coffee', items: [current()] }], popular: [] },
    }),
  );

  await page.goto('/staff/cafe');
  await page.getByRole('button', { name: 'Stock' }).click();
  await expect(page.getByLabel(`${first.name}: 8 left`)).toBeVisible();
  await noHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Mark sold out' }).click();
  await expect(page.getByLabel(`${first.name}: 0 left`)).toBeVisible();
  expect(soldOut).toBe(true);

  await page.goto('/s/cafe/menu');
  await expect(page.getByText('Sold out').first()).toBeVisible();
});

test('the owner opens a branch, gives it an address and publishes it', async ({ page }) => {
  await mockApi(page);
  await signIn(page, 'CUSTOMER', 'PLACED', { ownedBrands: [store.brand] });
  let branch = managed(store, {
    id: 's9',
    slug: 'north-gate',
    name: 'North Gate',
    status: 'DRAFT',
    address: null,
  });
  let opened = false;
  await page.route('**/api/brands/mine', (route) =>
    route.fulfill({
      json: {
        brands: [
          {
            ...store.brand,
            template: managed(store, {
              id: 't1',
              slug: 'cafe-template',
              status: 'DRAFT',
              isTemplate: true,
            }),
            stores: [managed(store), ...(opened ? [branch] : [])],
          },
        ],
      },
    }),
  );
  await page.route('**/api/brands/b1/stores', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ name: 'North Gate' });
    opened = true;
    return route.fulfill({ status: 201, json: { store: branch } });
  });
  await page.route('**/api/stores/s9/manage', (route) =>
    route.fulfill({
      json: { store: branch, brand: store.brand, missing: branch.address ? [] : ['address'] },
    }),
  );
  await page.route('**/api/stores/s9/profile', (route) => {
    branch = { ...branch, address: route.request().postDataJSON().addressLine };
    return route.fulfill({ json: { store: branch } });
  });
  await page.route('**/api/stores/s9/publish', (route) => {
    branch = { ...branch, status: 'ACTIVE' };
    return route.fulfill({ json: { store: branch } });
  });

  await page.goto('/manage');
  await expect(page.getByRole('link', { name: /Brand template/ })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Open a branch' }).click();
  await page.getByLabel('Branch name').fill('North Gate');
  await page.getByRole('button', { name: 'Open the branch' }).click();
  await expect(page).toHaveURL(/\/manage\/north-gate\/profile/);
  const goLive = page.getByRole('region', { name: 'Go live' });
  await expect(goLive.getByRole('button', { name: 'Publish' })).toBeDisabled();
  await page.getByLabel('Address').fill('Gate 2, North Campus');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(goLive.getByRole('button', { name: 'Publish' })).toBeEnabled();
  await noHorizontalOverflow(page);
  await goLive.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Customers can find it and order.')).toBeVisible();
});
