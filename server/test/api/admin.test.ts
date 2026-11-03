// Destructive: changes the site_settings row and inserts orders; resetDemoData() puts both back (local only).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabaseAdmin } from '../../src/utils/supabase';
import {
  createTestUser,
  deleteTestUser,
  resetDemoData,
  testAuthMatrix,
  type TestUser,
} from '../setup/helpers';
import { api } from '../setup/api';

let admin: TestUser;
let staff: TestUser;
let customer: TestUser;
const insertedOrderIds: string[] = [];

const bearer = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });

beforeAll(async () => {
  resetDemoData();
  [admin, staff, customer] = await Promise.all([
    createTestUser('ADMIN'),
    createTestUser('STAFF'),
    createTestUser('CUSTOMER'),
  ]);
});

afterAll(async () => {
  if (insertedOrderIds.length > 0) {
    await supabaseAdmin.from('orders').delete().in('id', insertedOrderIds).throwOnError();
  }
  await Promise.all([deleteTestUser(admin), deleteTestUser(staff), deleteTestUser(customer)]);
  resetDemoData();
});

testAuthMatrix('GET /api/admin/settings', (http) => http.get('/api/admin/settings'));
testAuthMatrix('PATCH /api/admin/settings', (http) =>
  http.patch('/api/admin/settings').send({ customerOrderHistoryLimit: 5 }),
);

describe('admin settings: role', () => {
  it.each([
    ['a customer', () => customer],
    ['staff (a restaurant role, not a site admin)', () => staff],
  ])('403 FORBIDDEN for %s on GET and PATCH', async (_label, who) => {
    const get = await api().get('/api/admin/settings').set(bearer(who()));
    expect(get.status).toBe(403);
    expect(get.body.error.code).toBe('FORBIDDEN');
    const patch = await api()
      .patch('/api/admin/settings')
      .set(bearer(who()))
      .send({ customerOrderHistoryLimit: 5 });
    expect(patch.status).toBe(403);
  });

  it('an admin has no staff powers', async () => {
    const res = await api()
      .patch(`/api/orders/${crypto.randomUUID()}/status`)
      .set(bearer(admin))
      .send({ status: 'PREPARING' });
    expect(res.status).toBe(403);
  });
});

describe('admin settings: read and validate', () => {
  it('returns the defaults after a reseed', async () => {
    const res = await api().get('/api/admin/settings').set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      settings: {
        customerOrderHistoryLimit: 20,
        staffOrderListLimit: 100,
        maxLinesPerOrder: 30,
        orderPollMs: 4000,
        ordersPollMs: 8000,
        staffBoardPollMs: 4000,
        clientErrorSamplePercent: 100,
        minClientVersion: '0.0.0',
        updatedAt: expect.any(String),
      },
    });
  });

  it.each([
    [{}, 'Send at least one setting'],
    [{ customerOrderHistoryLimit: 0 }, 'at least 1'],
    [{ customerOrderHistoryLimit: 201 }, 'at most 200'],
    [{ staffOrderListLimit: 501 }, 'at most 500'],
    [{ staffOrderListLimit: 2.5 }, 'whole number'],
    [{ customerOrderHistoryLimit: '20' }, 'must be a number'],
    [{ maxLinesPerOrder: 0 }, 'Items per order must be at least 1'],
    [{ maxLinesPerOrder: 101 }, 'Items per order must be at most 100'],
    [{ orderPollMs: 1999 }, 'Order page refresh must be at least 2000'],
    [{ ordersPollMs: 60_001 }, 'Order list refresh must be at most 60000'],
    [{ staffBoardPollMs: 2500.5 }, 'Staff board refresh must be a whole number'],
    [{ staffBoardPollMs: '4000' }, 'Staff board refresh must be a number'],
    [{ clientErrorSamplePercent: -1 }, 'Error reporting sample must be at least 0'],
    [{ clientErrorSamplePercent: 101 }, 'Error reporting sample must be at most 100'],
    [{ clientErrorSamplePercent: '50' }, 'Error reporting sample must be a number'],
    [{ clientErrorSamplePercent: 50.5 }, 'Error reporting sample must be a whole number'],
    [{ minClientVersion: '1.2' }, 'must look like 1.2.3'],
    [{ minClientVersion: '1.2.3-beta' }, 'must look like 1.2.3'],
    [{ minClientVersion: 123 }, 'must be text'],
  ])('400 VALIDATION_ERROR for %j', async (body, message) => {
    const res = await api().patch('/api/admin/settings').set(bearer(admin)).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain(message);
  });

  it('accepts the bounds themselves', async () => {
    const res = await api()
      .patch('/api/admin/settings')
      .set(bearer(admin))
      .send({ customerOrderHistoryLimit: 200, staffOrderListLimit: 1 });
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({
      customerOrderHistoryLimit: 200,
      staffOrderListLimit: 1,
    });
  });
});

describe('admin settings: configuration fields', () => {
  it('accepts every new field at its bounds and returns them', async () => {
    const low = {
      maxLinesPerOrder: 1,
      orderPollMs: 2000,
      ordersPollMs: 2000,
      staffBoardPollMs: 2000,
      clientErrorSamplePercent: 0,
    };
    const high = {
      maxLinesPerOrder: 100,
      orderPollMs: 60_000,
      ordersPollMs: 60_000,
      staffBoardPollMs: 60_000,
      clientErrorSamplePercent: 100,
    };
    for (const body of [low, high]) {
      const res = await api().patch('/api/admin/settings').set(bearer(admin)).send(body);
      expect(res.status).toBe(200);
      expect(res.body.settings).toMatchObject(body);
    }
  });

  it('a sample-percent PATCH shows in GET /api/config at once and leaves one audit row', async () => {
    const config0 = await api().get('/api/config').expect(200); // also warms the settings cache
    const before: number = config0.body.clientErrors.samplePercent;
    const next = before === 37 ? 38 : 37; // a real change, whatever an earlier test left
    const requestId = randomUUID();
    await api()
      .patch('/api/admin/settings')
      .set(bearer(admin))
      .set('x-request-id', requestId)
      .send({ clientErrorSamplePercent: next })
      .expect(200);
    const config = await api().get('/api/config').expect(200);
    expect(config.body.clientErrors).toEqual({ samplePercent: next });

    const { data } = await supabaseAdmin
      .from('audit_log')
      .select('action, actor_id, changes')
      .eq('request_id', requestId)
      .throwOnError();
    expect(data).toEqual([
      {
        action: 'site_settings.changed',
        actor_id: admin.id,
        changes: { client_error_sample_percent: [before, next] },
      },
    ]);
  });

  it('changes only the fields sent', async () => {
    const before = (await api().get('/api/admin/settings').set(bearer(admin))).body.settings;
    const res = await api()
      .patch('/api/admin/settings')
      .set(bearer(admin))
      .send({ ordersPollMs: 12_000 });
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({
      ...before,
      ordersPollMs: 12_000,
      updatedAt: expect.any(String),
    });
  });
});

describe('admin settings: minimum client version', () => {
  it('accepts a plain semver version and returns it', async () => {
    const res = await api()
      .patch('/api/admin/settings')
      .set(bearer(admin))
      .set('X-Client-Version', '9.9.9')
      .send({ minClientVersion: '0.0.0' });
    expect(res.status).toBe(200);
    expect(res.body.settings.minClientVersion).toBe('0.0.0');
  });
});

describe('admin settings: the limits apply to the next request', () => {
  beforeAll(async () => {
    const { data: store } = await supabaseAdmin
      .from('stores')
      .select('id')
      .limit(1)
      .single()
      .throwOnError();
    const now = Date.now();
    const rows = Array.from({ length: 5 }, (_, i) => ({
      user_id: customer.id,
      store_id: store.id,
      store_name: 'Campus Cafe',
      customer_name: 'Settings Test',
      total: 100,
      note: `settings-${i}`,
      estimated_ready_at: new Date(now + 600_000).toISOString(),
      created_at: new Date(now + i * 1000).toISOString(),
    }));
    const { data } = await supabaseAdmin.from('orders').insert(rows).select('id').throwOnError();
    insertedOrderIds.push(...data.map((row) => row.id));
  });

  it('a new customer history limit shows up at once, newest first', async () => {
    const saved = await api()
      .patch('/api/admin/settings')
      .set(bearer(admin))
      .send({ customerOrderHistoryLimit: 3 });
    expect(saved.status).toBe(200);

    const res = await api().get('/api/orders').set(bearer(customer));
    expect(res.body.orders.map((o: { note: string }) => o.note)).toEqual([
      'settings-4',
      'settings-3',
      'settings-2',
    ]);
  });

  it('a new staff list limit shows up at once (it caps finished orders; active ones always show)', async () => {
    await supabaseAdmin
      .from('orders')
      .update({ status: 'COLLECTED' })
      .in('id', insertedOrderIds)
      .throwOnError();
    await api().patch('/api/admin/settings').set(bearer(admin)).send({ staffOrderListLimit: 2 });
    const res = await api().get('/api/orders').set(bearer(staff));
    const finished = (res.body.orders as { status: string }[]).filter(
      (o) => o.status === 'COLLECTED' || o.status === 'CANCELLED',
    );
    expect(finished).toHaveLength(2);
  });

  it('records who changed it and when', async () => {
    const before = (await api().get('/api/admin/settings').set(bearer(admin))).body.settings;
    await api().patch('/api/admin/settings').set(bearer(admin)).send({ staffOrderListLimit: 50 });
    const { data } = await supabaseAdmin
      .from('site_settings')
      .select('updated_by, updated_at')
      .single()
      .throwOnError();
    expect(data.updated_by).toBe(admin.id);
    expect(Date.parse(data.updated_at)).toBeGreaterThanOrEqual(Date.parse(before.updatedAt));
  });
});
