// Destructive: places and cancels a real order, so it reseeds before and after (local only).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MenuItemDto, MenuResponse } from '../../src/types/api';
import { supabaseAdmin } from '../../src/utils/supabase';
import { createTestUser, deleteTestUser, resetDemoData, type TestUser } from '../setup/helpers';
import { api } from '../setup/api';
let customer: TestUser;
let staff: TestUser;

async function stockOf(name: string): Promise<number | null> {
  const res = await api().get('/api/menu');
  const items = (res.body as MenuResponse).categories.flatMap((c) => c.items);
  return items.find((item: MenuItemDto) => item.name === name)!.stockQuantity;
}

beforeAll(async () => {
  resetDemoData();
  customer = await createTestUser('CUSTOMER');
  staff = await createTestUser('STAFF');
});

afterAll(async () => {
  await supabaseAdmin.rpc('reset_demo_orders').throwOnError();
  await deleteTestUser(customer);
  await deleteTestUser(staff);
  resetDemoData();
});

describe('cached menu stays in step with orders', () => {
  it('shows the new stock right after an order and again after it is cancelled', async () => {
    const before = await stockOf('Blueberry Muffin'); // warms the cache
    expect(before).toBe(5);
    const menu = (await api().get('/api/menu')).body as MenuResponse;
    const muffin = menu.categories
      .flatMap((c) => c.items)
      .find((i) => i.name === 'Blueberry Muffin')!;

    const placed = await api()
      .post('/api/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ items: [{ menuItemId: muffin.id, quantity: 2 }] });
    expect(placed.status).toBe(201);
    expect(await stockOf('Blueberry Muffin')).toBe(3);

    const cancelled = await api()
      .patch(`/api/orders/${placed.body.order.id}/status`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ status: 'CANCELLED' });
    expect(cancelled.status).toBe(200);
    expect(await stockOf('Blueberry Muffin')).toBe(5);
  });
});
