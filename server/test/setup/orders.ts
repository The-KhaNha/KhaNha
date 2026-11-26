// Shared fixture for the orders-*.test.ts files (destructive, local Supabase only): a reset demo store, two customers, a staff member and the request helpers.
import { afterAll, beforeAll } from 'vitest';
import { paiseToRupees } from '../../src/utils/money';
import { supabaseAdmin } from '../../src/utils/supabase';
import { createTestUser, deleteTestUser, resetDemoData, type TestUser } from '../setup/helpers';
import { api } from '../setup/api';
import { resolveTestTarget } from '../setup/target';

export interface MenuItemRow {
  id: string;
  name: string;
  price: number;
  stock_quantity: number | null;
  is_available: boolean;
}

export interface OrderBodyOverrides {
  items?: Record<string, unknown>[];
  [key: string]: unknown;
}

export let customer1: TestUser;
export let customer2: TestUser;
export let staff: TestUser;
export let storeId: string;
export let items: Record<string, MenuItemRow>;

/**
 * Registers the fixture every orders-*.test.ts file shares: a reset demo store, two customers and a staff member, and
 * the cleanup. Each file calls it once at the top, so each keeps its own reset (the files run one after another).
 */
export function useOrdersFixture(): void {
  beforeAll(async () => {
    resetDemoData();
    const { data: store } = await supabaseAdmin
      .from('stores')
      .select('id')
      .order('created_at')
      .order('id')
      .limit(1)
      .single()
      .throwOnError();
    storeId = store.id;
    const { data: rows } = await supabaseAdmin
      .from('menu_items')
      .select('id, name, price_paise, stock_quantity, is_available')
      .eq('store_id', storeId)
      .throwOnError();
    // Rupees, as the API speaks them.
    items = Object.fromEntries(
      rows.map(({ price_paise, ...row }) => [
        row.name,
        { ...row, price: paiseToRupees(price_paise) },
      ]),
    );

    [customer1, customer2, staff] = await Promise.all([
      createTestUser('CUSTOMER'),
      createTestUser('CUSTOMER'),
      createTestUser('STAFF'),
    ]);
  }, 30_000);

  afterAll(async () => {
    // Orders reference profiles without ON DELETE CASCADE, so wipe orders before deleting the users who placed
    // them, or deleteTestUser fails with a foreign-key violation. resetDemoData() also removes every non-seed
    // account (including ours), so it cannot run first either: it would delete customer1/2/staff out from under
    // deleteTestUser ("User not found"). reset_demo_orders alone only truncates orders/order_items.
    // Guarded separately from resetDemoData()'s own check: afterAll still runs after a beforeAll failure (e.g. a
    // non-local target), and this RPC would otherwise truncate orders on whatever target that was.
    if (resolveTestTarget() !== 'local') return;
    await supabaseAdmin.rpc('reset_demo_orders').throwOnError();
    await Promise.all([customer1, customer2, staff].map((user) => deleteTestUser(user)));
    resetDemoData();
  });
}

export function auth(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/** Looks up a seeded menu item by name; throws (rather than returning undefined) if the seed ever changes. */
export function menuItem(name: string): MenuItemRow {
  const item = items[name];
  if (!item) throw new Error(`Seeded menu item not found: ${name}`);
  return item;
}

export function orderBody(overrides: OrderBodyOverrides = {}): OrderBodyOverrides {
  return {
    storeId,
    items: [{ menuItemId: menuItem('Cold Coffee').id, quantity: 1 }],
    ...overrides,
  };
}

export function placeOrder(user: TestUser, overrides: OrderBodyOverrides = {}) {
  return api().post('/api/orders').set(auth(user.token)).send(orderBody(overrides));
}

export function patchStatus(orderId: string, status: string, token = staff.token) {
  return api()
    .patch(`/api/stores/${storeId}/orders/${orderId}/status`)
    .set(auth(token))
    .send({ status });
}
