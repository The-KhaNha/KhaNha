import { expect, test } from '@playwright/test';
import type { ModifierGroup, Order } from '../src/types/api';
import { menu, mockApi, noHorizontalOverflow, signIn, store } from './fixtures';

// P3.2 end to end, on mocked answers: a manager adds "Extra cheese +₹20" to Cheese Toast, a customer orders the toast
// with it, and the kitchen ticket names it.
const toast = menu.categories[1]!.items[0]!;
const addOns: ModifierGroup = {
  id: 'g1',
  name: 'Add-ons',
  minSelect: 0,
  maxSelect: 1,
  options: [
    { id: 'o1', name: 'Extra cheese', priceDelta: 20, isDefault: false, isAvailable: true },
  ],
};

test('a manager adds "Extra cheese +₹20" and gives it to an item', async ({ page }) => {
  await mockApi(page);
  await signIn(page, 'CUSTOMER', 'PLACED', {
    memberships: [
      { storeId: store.id, storeSlug: store.slug, storeName: store.name, role: 'MANAGER' },
    ],
  });
  const sent: { group?: unknown; groupIds?: unknown } = {};
  await page.route('**/api/stores/s1/menu-items', (route) =>
    route.fulfill({ json: { items: [{ ...toast, isEnabled: true, archivedAt: null }] } }),
  );
  await page.route(`**/api/stores/s1/menu-items/${toast.id}`, (route) =>
    route.fulfill({ json: { item: { ...toast, isEnabled: true, archivedAt: null } } }),
  );
  await page.route('**/api/stores/s1/modifier-groups', (route) => {
    if (route.request().method() === 'POST') {
      sent.group = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { group: addOns } });
    }
    return route.fulfill({
      json: { groups: sent.group ? [addOns] : [], itemGroupIds: {} },
    });
  });
  await page.route(`**/api/stores/s1/menu-items/${toast.id}/modifier-groups`, (route) => {
    sent.groupIds = route.request().postDataJSON();
    return route.fulfill({ json: { groupIds: ['g1'] } });
  });

  await page.goto('/manage/cafe/menu');
  await page.getByRole('button', { name: 'Add choice' }).click();
  const sheet = page.getByRole('dialog', { name: 'New choice' });
  await sheet.getByLabel('Name').fill('Add-ons');
  await sheet.getByLabel('Choose at least').fill('0');
  await sheet.getByLabel('Option 1', { exact: true }).fill('Extra cheese');
  await sheet.getByLabel('₹ change').fill('20');
  await noHorizontalOverflow(page);
  await sheet.getByRole('button', { name: 'Add choice' }).click();
  await expect(sheet).toHaveCount(0);
  expect(sent.group).toEqual({
    name: 'Add-ons',
    minSelect: 0,
    maxSelect: 1,
    options: [{ name: 'Extra cheese', priceDelta: 20, isDefault: false, isAvailable: true }],
  });
  await expect(page.getByText('Extra cheese')).toBeVisible();

  await page
    .getByRole('button', { name: new RegExp(toast.name) })
    .first()
    .click();
  await page.getByRole('dialog').getByRole('checkbox', { name: 'Add-ons' }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(sent.groupIds).toEqual({ groupIds: ['g1'] });
});

test('a customer orders the item with Extra cheese, and Pay sends the option', async ({ page }) => {
  await mockApi(page);
  await signIn(page, 'CUSTOMER');
  const withChoice = { ...toast, modifierGroupIds: ['g1'] };
  await page.route('**/api/stores/cafe/menu', (route) =>
    route.fulfill({
      json: {
        ...menu,
        categories: [menu.categories[0]!, { name: 'Snacks', items: [withChoice] }],
        modifierGroups: { g1: addOns },
      },
    }),
  );
  const bodies: unknown[] = [];
  await page.route('**/api/orders', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    bodies.push(route.request().postDataJSON());
    return route.fulfill({
      status: 409,
      json: { error: { code: 'STORE_CLOSED', message: 'The store just closed.' } },
    });
  });

  await page.goto('/s/cafe/menu');
  await expect(page.getByText('Customisable')).toBeVisible();
  await page.getByRole('button', { name: `Choose options for ${toast.name}` }).click();
  await page
    .getByRole('dialog')
    .getByRole('checkbox', { name: /Extra cheese/ })
    .check();
  await expect(page.getByRole('dialog').getByRole('button', { name: /Add to Cart/ })).toContainText(
    `₹${toast.price + 20}`,
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Add to Cart/ })
    .click();

  await page.goto('/cart');
  await expect(page.getByText('Extra cheese')).toBeVisible();
  await page.goto('/checkout');
  await expect(page.getByText('Extra cheese')).toBeVisible();
  await page.getByLabel('Phone', { exact: true }).fill('98765 43210');
  await page.getByRole('button', { name: /^Pay / }).click();
  await expect(page.getByText('The store just closed.')).toBeVisible();
  expect(bodies).toEqual([
    expect.objectContaining({
      items: [
        {
          menuItemId: toast.id,
          quantity: 1,
          expectedUnitPrice: toast.price + 20,
          modifierOptionIds: ['o1'],
        },
      ],
    }),
  ]);
});

test('the kitchen ticket names the options at full size', async ({ page }) => {
  await signIn(page, 'STAFF');
  await mockApi(page);
  const now = new Date().toISOString();
  const order: Order = {
    id: 'o9',
    orderNumber: 1043,
    status: 'PLACED',
    paymentStatus: 'PAID',
    total: toast.price + 20,
    customerName: 'Anishka',
    customerPhone: null,
    note: null,
    estimatedReadyAt: now,
    createdAt: now,
    updatedAt: now,
    store: { id: store.id, name: store.name, slug: store.slug },
    items: [
      {
        id: 'l9',
        menuItemId: toast.id,
        name: toast.name,
        unitPrice: toast.price + 20,
        quantity: 1,
        lineTotal: toast.price + 20,
        modifiers: [
          { optionId: 'o1', groupName: 'Add-ons', optionName: 'Extra cheese', priceDelta: 20 },
        ],
      },
    ],
  };
  await page.route(/\/api\/stores\/s1\/orders/, (route) =>
    route.fulfill({ json: { orders: [order] } }),
  );
  await page.goto('/staff/cafe');
  await expect(page.getByText('Extra cheese')).toBeVisible();
  await noHorizontalOverflow(page);
});
