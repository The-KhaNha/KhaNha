import { expect, test, type Page } from '@playwright/test';
import type { Role } from '../src/types/api';
import { CART_LINE, mockApi, seedCart, signIn } from './fixtures';

test.beforeEach(async ({ page }) => mockApi(page));

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
  if (form.role) await signIn(page, form.role);
  await seedCart(page);
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

// A cart kept from before a price change shows the old price. Pay sends that price, so the server refuses the order
// (PRICE_CHANGED) instead of charging the new one, and the cart shows the new price before the next Pay.
test('a stale persisted cart: Pay sends the price it shows, and a refusal shows the new price', async ({
  page,
}) => {
  await signIn(page, 'CUSTOMER');
  await seedCart(page, { ...CART_LINE, unitPrice: 100 });
  const bodies: unknown[] = [];
  await page.route('**/api/orders', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    bodies.push(route.request().postDataJSON());
    return route.fulfill({
      status: 409,
      json: {
        error: {
          code: 'PRICE_CHANGED',
          message: 'The price of Cold Coffee just changed to ₹120. Please review your order.',
        },
      },
    });
  });
  await page.goto('/checkout');
  await page.getByLabel('Phone', { exact: true }).fill('98765 43210');
  await page.getByRole('button', { name: /^Pay ₹200/ }).click();

  await expect(page.getByText('The price of Cold Coffee just changed to ₹120.')).toBeVisible();
  expect(bodies).toEqual([
    expect.objectContaining({
      items: [{ menuItemId: 'i1', quantity: 2, expectedUnitPrice: 100 }],
    }),
  ]);
  await expect(page.getByRole('button', { name: /^Pay ₹240/ })).toBeEnabled();
});
