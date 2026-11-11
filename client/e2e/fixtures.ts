import { expect, type Page } from '@playwright/test';
import fallbacks from '../src/config/fallbacks.json' with { type: 'json' };
import type {
  Config,
  MenuItem,
  MenuResponse,
  Order,
  OrderStatus,
  Role,
  Store,
  User,
} from '../src/types/api';

// The fixtures and mocks the e2e specs share. Every API call is mocked: the specs check the client alone (layout,
// hydration, the cart), so they need no backend and run the same on a laptop and in CI.

export const store: Store = {
  id: 's1',
  slug: 'cafe',
  brand: { id: 'b1', name: 'Cafe', slug: 'cafe' },
  area: null,
  address: null,
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

export const menu: MenuResponse = {
  rules: { maxQuantityPerItem: 10, lowStockThreshold: 5 },
  store,
  popular: items.filter((i) => i.isPopular),
  categories: [
    { name: 'Coffee', items: [items[0]!] },
    { name: 'Snacks', items: [items[1]!] },
  ],
};

export const config: Config = { serverVersion: '0.0.0', ...fallbacks };

export async function mockApi(page: Page): Promise<void> {
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

export function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
  });
  return problems;
}

export async function noHorizontalOverflow(page: Page): Promise<void> {
  const [scrollWidth, innerWidth] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scrollWidth, 'page must not scroll sideways').toBeLessThanOrEqual(innerWidth);
}

export const CART_LINE = {
  menuItemId: 'i1',
  name: 'Cold Coffee',
  unitPrice: 120,
  imageUrl: '/images/cold-coffee.jpg',
  quantity: 2,
  maxQuantity: null,
};

/** Persists a cart holding `line`, as an earlier visit would have left it. */
export async function seedCart(page: Page, line: typeof CART_LINE = CART_LINE): Promise<void> {
  await page.addInitScript((line) => {
    localStorage.setItem('fp_cart', JSON.stringify({ state: { lines: [line] }, version: 1 }));
  }, line);
}

/**
 * Answers Supabase Auth's token endpoint (password and refresh grants) as `user`, with expiry stamped on the real
 * clock, as the server would. Returns the POSTs it answered.
 */
export async function mockSupabaseToken(page: Page, user: User): Promise<string[]> {
  const posts: string[] = [];
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user } }));
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  await page.route('**/auth/v1/token**', (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors });
    posts.push(route.request().url());
    return route.fulfill({
      headers: cors,
      json: {
        access_token: 'e2e',
        refresh_token: 'e2e',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: user.id,
          aud: 'authenticated',
          email: user.email,
          app_metadata: {},
          user_metadata: {},
        },
      },
    });
  });
  return posts;
}

/**
 * Signs the page in as `role` without a backend: the persisted auth store, a supabase-js session that is not near
 * expiry (so it makes no network call; the key's `127` is the host in the tracked client/.env.development) and a
 * fresh activity stamp. /api/auth/me and the order endpoints answer with fixtures.
 */
export async function signIn(
  page: Page,
  role: Role,
  status: OrderStatus = 'PLACED',
): Promise<void> {
  const now = new Date().toISOString();
  const user: User = {
    id: 'u1',
    name: 'Anishka',
    email: 'a@example.com',
    phone: null,
    role,
    createdAt: now,
  };
  const order: Order = {
    id: 'o1',
    orderNumber: 1042,
    status,
    paymentStatus: 'PAID',
    total: 240,
    customerName: user.name,
    customerPhone: null,
    note: 'Less sugar, please',
    estimatedReadyAt: now,
    createdAt: now,
    updatedAt: now,
    store: { id: store.id, name: store.name },
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
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user } }));
  await page.route('**/api/orders**', (route) =>
    route.fulfill({
      json:
        new URL(route.request().url()).pathname === '/api/orders' ? { orders: [order] } : { order },
    }),
  );
  await page.addInitScript((user) => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('fp_auth', JSON.stringify({ state: { user, token: 'e2e' }, version: 0 }));
    localStorage.setItem('fp_last_active', String(Date.now()));
    localStorage.setItem(
      'sb-127-auth-token',
      JSON.stringify({
        access_token: 'e2e',
        refresh_token: 'e2e',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: expiresAt,
        user: {
          id: user.id,
          aud: 'authenticated',
          email: user.email,
          app_metadata: {},
          user_metadata: {},
        },
      }),
    );
  }, user);
}
