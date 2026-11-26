import { expect, test, type Page } from '@playwright/test';
import fallbacks from '../src/config/fallbacks.json' with { type: 'json' };
import type { Order, OrderStatus, User } from '../src/types/api';
import { CART_LINE, mockApi, mockSupabaseToken, seedCart, signIn, store } from './fixtures';

// The user stories end to end on mocked answers: what a person does, and what the client sends and shows for it. The
// mocks are strict (fixtures.ts): a request the real client would not send is refused, so a spec cannot pass on one.

test.beforeEach(async ({ page }) => mockApi(page));

const orderAt = (status: OrderStatus): Order => {
  const now = new Date().toISOString();
  return {
    id: 'o1',
    orderNumber: 1042,
    status,
    paymentStatus: 'PAID',
    total: 240,
    customerName: 'Anishka',
    customerPhone: null,
    note: null,
    estimatedReadyAt: now,
    createdAt: now,
    updatedAt: now,
    store: { id: store.id, name: store.name, slug: store.slug },
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
};

const storage = (page: Page) =>
  page.evaluate(() => ({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }));

test('a customer pays and lands on the order, with an empty cart and the body the server expects', async ({
  page,
}) => {
  await signIn(page, 'CUSTOMER');
  await seedCart(page);
  await page.goto('/checkout');
  await page.getByLabel('Phone', { exact: true }).fill('98765 43210');
  const [request] = await Promise.all([
    page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/orders',
    ),
    page.getByRole('button', { name: /^Pay ₹240/ }).click(),
  ]);

  expect(request.postDataJSON()).toMatchObject({
    storeId: store.id,
    items: [{ menuItemId: CART_LINE.menuItemId, quantity: CART_LINE.quantity }],
    idempotencyKey: expect.any(String),
  });
  await expect(page).toHaveURL(/\/orders\/o1\/success$/);
  const { local } = await storage(page);
  expect(JSON.parse(local.fp_cart ?? '{}').state.lines, 'the paid cart is emptied').toEqual([]);
});

test('staff move an order PLACED, PREPARING, READY, COLLECTED; Cancel is offered only before READY', async ({
  page,
}) => {
  await signIn(page, 'STAFF');
  let current = orderAt('PLACED');
  const patches: unknown[] = [];
  await page.route('**/api/stores/s1/orders', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { orders: [current] } })
      : route.fulfill({
          status: 405,
          json: { error: { code: 'METHOD_NOT_ALLOWED', message: 'x' } },
        }),
  );
  await page.route('**/api/stores/s1/orders/o1/status', (route) => {
    if (route.request().method() !== 'PATCH')
      return route.fulfill({
        status: 405,
        json: { error: { code: 'METHOD_NOT_ALLOWED', message: 'x' } },
      });
    const body = route.request().postDataJSON() as { status: OrderStatus };
    patches.push(body);
    current = {
      ...orderAt(body.status),
      id: 'o1',
      updatedAt: new Date(Date.now() + 1000).toISOString(),
    };
    return route.fulfill({ json: { order: current } });
  });

  await page.goto('/staff/cafe');
  const card = page.getByRole('article');
  await expect(card).toContainText('#1042');
  await expect(card.getByRole('button', { name: 'Cancel order' })).toBeVisible();

  await card.getByRole('button', { name: 'Start Preparing' }).click();
  await expect(card.getByRole('button', { name: 'Mark Ready' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Cancel order' })).toBeVisible();

  await card.getByRole('button', { name: 'Mark Ready' }).click();
  await expect(card.getByRole('button', { name: 'Mark Collected' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);

  await card.getByRole('button', { name: 'Mark Collected' }).click();
  await expect.poll(() => patches.length).toBe(3);
  expect(patches).toEqual([{ status: 'PREPARING' }, { status: 'READY' }, { status: 'COLLECTED' }]);
  await expect(page.getByRole('button', { name: 'Mark Collected' })).toHaveCount(0);
});

test('the order page follows the order PLACED, PREPARING, READY as it polls', async ({ page }) => {
  await page.clock.install();
  await signIn(page, 'CUSTOMER');
  let status: OrderStatus = 'PLACED';
  let reads = 0;
  await page.route('**/api/orders/o1', (route) => {
    reads += 1;
    return route.fulfill({ json: { order: orderAt(status) } });
  });
  await page.goto('/orders/o1');
  await expect(page.getByText('Order received').first()).toBeVisible();

  for (const [next, title] of [
    ['PREPARING', 'Being prepared'],
    ['READY', 'Ready for pickup'],
  ] as const) {
    status = next;
    const before = reads;
    await page.clock.runFor(fallbacks.polling.orderMs + 100);
    await expect.poll(() => reads).toBeGreaterThan(before);
    await expect(page.getByText(title).first()).toBeVisible();
  }
});

test('signing out leaves no user data in browser storage', async ({ page }) => {
  await signIn(page, 'CUSTOMER');
  await seedCart(page);
  await page.route('**/auth/v1/logout**', (route) =>
    route.fulfill({
      status: 204,
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
    }),
  );
  await page.goto('/orders');
  await expect(page.getByText('#1042')).toBeVisible();
  // A draft typed at checkout is user data too (fp_checkout).
  await page.goto('/checkout');
  await page.getByLabel('Phone', { exact: true }).fill('98765 43210');
  expect(JSON.stringify(await storage(page))).toContain('98765');

  await page.goto('/profile');
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/(s\/cafe)?$/);

  const { local, session } = await storage(page);
  // lib/storageKeys.test.ts classifies the keys: the public cache (fp_cache:v2:<key>) and the device's cart may stay.
  const kept = (key: string) => key.startsWith('fp_cache') || key === 'fp_cart';
  // A store that was reset keeps its key with every field null: nobody's data.
  const emptied = (value: string) =>
    Object.values(JSON.parse(value).state as Record<string, unknown>).every((v) => v === null);
  const left = Object.entries({ ...local, ...session }).filter(
    ([key, value]) =>
      !kept(key) &&
      (key.startsWith('fp_') || key.startsWith('sb-')) &&
      !(['fp_auth', 'fp_checkout'].includes(key) && emptied(value)),
  );
  expect(left.map(([key]) => key)).toEqual([]);
  expect(JSON.stringify({ local, session })).not.toContain('98765');
  expect(JSON.stringify({ local, session })).not.toContain('a@example.com');
});

test('an invite link: sign in, land on the store board, and the token leaves the address bar', async ({
  page,
}) => {
  const user: User = {
    id: 'u2',
    name: 'Ravi',
    email: 'ravi@example.com',
    phone: null,
    role: 'CUSTOMER',
    createdAt: new Date().toISOString(),
    memberships: [],
    ownedBrands: [],
  };
  await mockSupabaseToken(page, user);
  let accepted: unknown = null;
  await page.route('**/api/me/invites/accept', (route) => {
    accepted = route.request().postDataJSON();
    return route.fulfill({
      status: 201,
      json: {
        membership: {
          id: 'm1',
          role: 'STAFF',
          store: { id: store.id, slug: store.slug, name: store.name },
        },
      },
    });
  });
  // The board it lands on.
  await page.route('**/api/stores/s1/orders', (route) => route.fulfill({ json: { orders: [] } }));

  await page.goto('/join#invite-token-123');
  await expect(page.getByRole('heading', { name: 'Join the team' })).toBeVisible();
  expect(page.url(), 'the token is gone from the address bar at once').not.toContain(
    'invite-token',
  );
  expect(accepted, 'nothing is accepted while signed out').toBeNull();

  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('test1234');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/staff\/cafe$/);
  expect(accepted).toEqual({ token: 'invite-token-123' });
  expect(page.url()).not.toContain('#');
});
