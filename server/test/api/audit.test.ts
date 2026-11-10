// Destructive (local only): changes site settings and a menu item, and moves orders; resetDemoData() puts them back.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabaseAdmin } from '../../src/utils/supabase';
import {
  createTestUser,
  deleteTestUser,
  localSql,
  resetDemoData,
  type TestUser,
} from '../setup/helpers';
import { api } from '../setup/api';
import { resolveTestTarget } from '../setup/target';

let admin: TestUser;
let staff: TestUser;
let customer: TestUser;
let storeId: string;
let menuItemId: string; // Cold Coffee: no stock count
let tracked: string; // Blueberry Muffin: stock-counted, so a cancel moves its stock back

beforeAll(async () => {
  resetDemoData();
  const { data: rows } = await supabaseAdmin
    .from('menu_items')
    .select('id, name, store_id')
    .in('name', ['Cold Coffee', 'Blueberry Muffin'])
    .throwOnError();
  const byName = new Map(rows.map((row) => [row.name, row]));
  menuItemId = byName.get('Cold Coffee')?.id ?? '';
  tracked = byName.get('Blueberry Muffin')?.id ?? '';
  storeId = byName.get('Cold Coffee')?.store_id ?? '';
  [admin, staff, customer] = await Promise.all([
    createTestUser('ADMIN'),
    createTestUser('STAFF'),
    createTestUser('CUSTOMER'),
  ]);
}, 30_000);

afterAll(async () => {
  if (resolveTestTarget() !== 'local') return;
  await supabaseAdmin.rpc('reset_demo_orders').throwOnError();
  await Promise.all([admin, staff, customer].map((user) => deleteTestUser(user)));
  resetDemoData();
});

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });

const COLUMNS =
  'actor_type, actor_id, actor_role, store_id, action, entity_type, entity_id, changes, request_id';

async function auditForRequest(requestId: string) {
  const { data } = await supabaseAdmin
    .from('audit_log')
    .select(COLUMNS)
    .eq('request_id', requestId)
    .order('id')
    .throwOnError();
  return data;
}

async function auditForEntity(entityType: string, entityId: string) {
  const { data } = await supabaseAdmin
    .from('audit_log')
    .select(COLUMNS)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('id')
    .throwOnError();
  return data;
}

describe('site settings', () => {
  it('an admin save writes one row naming the admin and the request; saving the same values writes none', async () => {
    const { data: before } = await supabaseAdmin
      .from('site_settings')
      .select('customer_order_history_limit')
      .single()
      .throwOnError();
    const next = before.customer_order_history_limit + 1;
    const save = (requestId: string) =>
      api()
        .patch('/api/admin/settings')
        .set(auth(admin))
        .set('x-request-id', requestId)
        .send({ customerOrderHistoryLimit: next })
        .expect(200);

    const changed = randomUUID();
    await save(changed);
    expect(await auditForRequest(changed)).toEqual([
      {
        actor_type: 'USER',
        actor_id: admin.id,
        actor_role: 'ADMIN',
        store_id: null,
        action: 'site_settings.changed',
        entity_type: 'site_settings',
        entity_id: 'true',
        changes: { customer_order_history_limit: [before.customer_order_history_limit, next] },
        request_id: changed,
      },
    ]);

    const unchanged = randomUUID();
    await save(unchanged);
    expect(await auditForRequest(unchanged)).toEqual([]);
  });
});

describe('orders', () => {
  it('placing writes none; each staff transition writes one row with the staff actor; a repeat writes none', async () => {
    // Other files' availability edits leave rows for the muffin (append-only), so only rows added here count.
    const muffinRowsBefore = (await auditForEntity('menu_item', tracked)).length;
    const placedBy = randomUUID();
    const placed = await api()
      .post('/api/orders')
      .set(auth(customer))
      .set('x-request-id', placedBy)
      .send({ items: [{ menuItemId: tracked, quantity: 1 }] })
      .expect(201);
    const orderId: string = placed.body.order.id;
    expect(await auditForRequest(placedBy)).toEqual([]);

    const move = (status: string, requestId: string) =>
      api()
        .patch(`/api/orders/${orderId}/status`)
        .set(auth(staff))
        .set('x-request-id', requestId)
        .send({ status })
        .expect(200);

    const preparing = randomUUID();
    await move('PREPARING', preparing);
    expect(await auditForRequest(preparing)).toEqual([
      {
        actor_type: 'USER',
        actor_id: staff.id,
        actor_role: 'STAFF',
        store_id: storeId,
        action: 'order.status_changed',
        entity_type: 'order',
        entity_id: orderId,
        changes: { status: ['PLACED', 'PREPARING'] },
        request_id: preparing,
      },
    ]);

    const repeat = randomUUID();
    await move('PREPARING', repeat);
    expect(await auditForRequest(repeat)).toEqual([]);

    // The cancel moves the muffin's stock back: stock is not audited, so the order's row is the only one.
    const cancel = randomUUID();
    await move('CANCELLED', cancel);
    expect(await auditForRequest(cancel)).toMatchObject([
      { entity_type: 'order', changes: { status: ['PREPARING', 'CANCELLED'] } },
    ]);
    expect(await auditForEntity('menu_item', tracked)).toHaveLength(muffinRowsBefore);
  });
});

describe('changes outside the API', () => {
  it('a role change through the secret key is SYSTEM', async () => {
    // createTestUser('STAFF') promoted the new profile with the secret key.
    expect(await auditForEntity('profile', staff.id)).toEqual([
      expect.objectContaining({
        actor_type: 'SYSTEM',
        actor_id: null,
        actor_role: null,
        action: 'profile.role_changed',
        changes: { role: ['CUSTOMER', 'STAFF'] },
        request_id: null,
      }),
    ]);
  });

  it('a menu item edit records only the watched columns, and a stock-only edit records nothing', async () => {
    const { data: item } = await supabaseAdmin
      .from('menu_items')
      .select('price_paise, stock_quantity')
      .eq('id', menuItemId)
      .single()
      .throwOnError();
    // Earlier runs' rows stay (append-only), and the seed restoring the price is a change too.
    const before = (await auditForEntity('menu_item', menuItemId)).length;
    await supabaseAdmin
      .from('menu_items')
      .update({ price_paise: item.price_paise + 500, stock_quantity: 7 })
      .eq('id', menuItemId)
      .throwOnError();
    await supabaseAdmin
      .from('menu_items')
      .update({ price_paise: item.price_paise + 1000 })
      .eq('id', menuItemId)
      .throwOnError();
    await supabaseAdmin
      .from('menu_items')
      .update({ stock_quantity: 3 })
      .eq('id', menuItemId)
      .throwOnError();

    expect((await auditForEntity('menu_item', menuItemId)).slice(before)).toEqual([
      expect.objectContaining({
        actor_type: 'SYSTEM',
        action: 'menu_item.changed',
        store_id: storeId,
        changes: { price_paise: [item.price_paise, item.price_paise + 500] },
      }),
      expect.objectContaining({
        action: 'menu_item.changed',
        changes: { price_paise: [item.price_paise + 500, item.price_paise + 1000] },
      }),
    ]);
  });
});

describe('an actor that does not parse', () => {
  const save = (expr: string) =>
    // One statement (the CLI runs one): the after-row trigger fires once the CTE has set the actor.
    localSql<{ ok: number }>(
      `with actor as (select set_config('app.actor', 'not json', true))
       update public.site_settings set staff_order_list_limit = ${expr} from actor returning 1 as ok`,
    );

  it('is never read for a save that changes nothing, and fails a real change rather than skip its row', () => {
    expect(save('staff_order_list_limit')).toEqual([{ ok: 1 }]);
    expect(() => save('staff_order_list_limit + 1')).toThrow();
  });
});

describe('append-only', () => {
  it('the secret key can read the log but not forge, change or delete a row', async () => {
    const forged = await supabaseAdmin.from('audit_log').insert({
      actor_type: 'SYSTEM',
      action: 'order.status_changed',
      entity_type: 'order',
      entity_id: randomUUID(),
    });
    expect(forged.error?.code).toBe('42501');

    const { data: rows } = await supabaseAdmin
      .from('audit_log')
      .select('id')
      .limit(1)
      .throwOnError();
    const id = rows[0]?.id ?? 0;
    expect(id).toBeGreaterThan(0);

    const updated = await supabaseAdmin
      .from('audit_log')
      .update({ reason: 'tampered' })
      .eq('id', id);
    expect(updated.error?.code).toBe('42501'); // insufficient_privilege
    const deleted = await supabaseAdmin.from('audit_log').delete().eq('id', id);
    expect(deleted.error?.code).toBe('42501');
  });

  it("not even the table's owner can update, delete or truncate it", () => {
    // The CLI prints the database's error on stdout, which the thrown error carries apart from its message.
    const refusal = (sql: string): string => {
      try {
        localSql(sql);
        return 'ran';
      } catch (error) {
        return String((error as { stdout?: unknown }).stdout);
      }
    };
    for (const sql of [
      "update public.audit_log set reason = 'tampered' returning id",
      'delete from public.audit_log returning id',
      'truncate public.audit_log',
    ]) {
      expect(refusal(sql), sql).toMatch(/audit_log is append-only/);
    }
  });
});
