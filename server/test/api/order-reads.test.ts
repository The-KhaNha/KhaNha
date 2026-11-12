import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { env } from '../../src/utils/env';
import { supabaseAdmin } from '../../src/utils/supabase';
import { createTestUser, deleteTestUser, type TestUser, oldestStoreId } from '../setup/helpers';
import { resolveTestTarget } from '../setup/target';

// createOrder's reads before place_order (the key's earlier order, the store, the customer's name, the items' prices)
// do not depend on each other, so they go out together: on a slow link to the database each one in series is another
// round trip at checkout. supabase-js captures fetch when the client is made, so this loads its own copy of the app
// after wrapping fetch, and counts the PostgREST requests in flight while one order is placed.
let app: ReturnType<typeof import('../../src/app').createApp>;
let customer: TestUser;
let menuItemId: string;
let counting = false;
let inFlight = 0;
let peak = 0;

beforeAll(async () => {
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const tracked = counting && url.startsWith(`${env.SUPABASE_URL}/rest/v1/`);
    if (tracked) peak = Math.max(peak, ++inFlight);
    try {
      return await realFetch(input, init);
    } finally {
      if (tracked) inFlight -= 1;
    }
  });
  vi.resetModules();
  const { createApp } = await import('../../src/app.js');
  app = createApp();

  customer = await createTestUser('CUSTOMER');
  // An item with no stock limit, so placing it changes no stock another suite relies on.
  const { data: item } = await supabaseAdmin
    .from('menu_items')
    .select('id')
    .eq('store_id', await oldestStoreId())
    .is('stock_quantity', null)
    .eq('is_available', true)
    .limit(1)
    .single()
    .throwOnError();
  menuItemId = item.id;
}, 30_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.resetModules();
  // Orders reference profiles without ON DELETE CASCADE: clear them before the account (as orders.test.ts does).
  if (resolveTestTarget() !== 'local') return;
  await supabaseAdmin.rpc('reset_demo_orders').throwOnError();
  await deleteTestUser(customer);
});

it('placing an order reads the key, store, name and prices together, not one after another', async () => {
  counting = true;
  const res = await request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({
      storeId: await oldestStoreId(),
      items: [{ menuItemId, quantity: 1 }],
      idempotencyKey: randomUUID(),
    });
  counting = false;

  expect(res.status).toBe(201);
  expect(peak, 'PostgREST requests in flight at once').toBeGreaterThanOrEqual(4);
});
