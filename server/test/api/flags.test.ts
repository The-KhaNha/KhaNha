// Inserts its own flags and a second store and removes them afterwards; changes no seeded row.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isEnabled } from '../../src/services/flags.service';
import type { FeatureFlagDto } from '../../src/types/api';
import { supabaseAdmin } from '../../src/utils/supabase';
import { createTestUser, deleteTestUser, testAuthMatrix, type TestUser } from '../setup/helpers';
import { api } from '../setup/api';

const STORE_TWICE = randomUUID();

let admin: TestUser;
let staff: TestUser;
let customer: TestUser;
let storeId: string; // the seeded store
let otherStoreId: string; // inserted for this file

const newKey = () => `test_${randomUUID().replaceAll('-', '')}`;
const keys: string[] = [];

async function insertFlag(): Promise<string> {
  const key = newKey();
  keys.push(key);
  await supabaseAdmin
    .from('feature_flags')
    .insert({ key, description: 'A flag for flags.test.ts' })
    .throwOnError();
  return key;
}

const flip = (key: string, user: TestUser, body: object) =>
  api().patch(`/api/admin/flags/${key}`).set('Authorization', `Bearer ${user.token}`).send(body);

beforeAll(async () => {
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id')
    .limit(1)
    .single()
    .throwOnError();
  storeId = store.id;
  const { data: other } = await supabaseAdmin
    .from('stores')
    .insert({
      name: 'Flags Test Kiosk',
      tagline: 'Test',
      description: 'A second store for flags.test.ts',
    })
    .select('id')
    .single()
    .throwOnError();
  otherStoreId = other.id;
  [admin, staff, customer] = await Promise.all([
    createTestUser('ADMIN'),
    createTestUser('STAFF'),
    createTestUser('CUSTOMER'),
  ]);
}, 30_000);

afterAll(async () => {
  if (keys.length)
    await supabaseAdmin.from('feature_flags').delete().in('key', keys).throwOnError();
  if (otherStoreId)
    await supabaseAdmin.from('stores').delete().eq('id', otherStoreId).throwOnError();
  await Promise.all([admin, staff, customer].map((user) => deleteTestUser(user)));
});

describe('PATCH /api/admin/flags/:key', () => {
  it('a flag limited to one store is on for that store only', async () => {
    const key = await insertFlag();
    const res = await flip(key, admin, { enabled: true, rules: { storeIds: [storeId] } });
    expect(res.status).toBe(200);
    expect(res.body.flag).toMatchObject<Partial<FeatureFlagDto>>({
      key,
      enabled: true,
      clientVisible: false,
      rules: { storeIds: [storeId] },
      updatedBy: admin.id,
    });
    expect(await isEnabled(key, { storeId })).toBe(true);
    expect(await isEnabled(key, { storeId: otherStoreId })).toBe(false);
  });

  it('a flip shows on the next evaluation, though the flags were cached just before', async () => {
    const key = await insertFlag();
    expect(await isEnabled(key, {})).toBe(false); // loads the flags into the read cache
    await flip(key, admin, { enabled: true }).expect(200);
    expect(await isEnabled(key, {})).toBe(true);
  });

  it('writes one audit row naming the admin who flipped it', async () => {
    const key = await insertFlag();
    const requestId = randomUUID();
    await flip(key, admin, { enabled: true, clientVisible: true })
      .set('x-request-id', requestId)
      .expect(200);
    const { data } = await supabaseAdmin
      .from('audit_log')
      .select('actor_type, actor_id, actor_role, action, entity_type, entity_id, changes')
      .eq('request_id', requestId)
      .throwOnError();
    expect(data).toEqual([
      {
        actor_type: 'USER',
        actor_id: admin.id,
        actor_role: 'ADMIN',
        action: 'feature_flag.changed',
        entity_type: 'feature_flag',
        entity_id: key,
        changes: { enabled: [false, true], client_visible: [false, true] },
      },
    ]);
  });

  it('the response carries exactly the FeatureFlagDto keys', async () => {
    const key = await insertFlag();
    const res = await flip(key, admin, { enabled: true });
    expect(Object.keys(res.body.flag).sort()).toEqual(
      ['key', 'description', 'enabled', 'clientVisible', 'rules', 'updatedAt', 'updatedBy'].sort(),
    );
  });

  it('rules {} clears targeting, so the flag is on everywhere again', async () => {
    const key = await insertFlag();
    await flip(key, admin, { enabled: true, rules: { storeIds: [storeId] } }).expect(200);
    expect(await isEnabled(key, { storeId: otherStoreId })).toBe(false);
    const res = await flip(key, admin, { rules: {} });
    expect(res.status).toBe(200);
    expect(res.body.flag.rules).toEqual({});
    expect(await isEnabled(key, { storeId: otherStoreId })).toBe(true);
  });

  it('a percent rule is off with no user', async () => {
    const key = await insertFlag();
    await flip(key, admin, { enabled: true, rules: { percent: 100 } }).expect(200);
    expect(await isEnabled(key, {})).toBe(false);
  });

  it('an unknown key is 404', async () => {
    const res = await flip(newKey(), admin, { enabled: true });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it.each([
    ['an empty body', {}],
    ['a non-boolean enabled', { enabled: 'yes' }],
    ['a misspelt rule', { rules: { storeId: [randomUUID()] } }],
    ['a percent over 100', { rules: { percent: 101 } }],
    ['a negative percent', { rules: { percent: -1 } }],
    ['a fractional percent', { rules: { percent: 1.5 } }],
    ['an empty roles list', { rules: { roles: [] } }],
    ['an unknown role', { rules: { roles: ['OWNER'] } }],
    ['a store id that is not a uuid', { rules: { storeIds: ['main'] } }],
    ['a repeated store id', { rules: { storeIds: [STORE_TWICE, STORE_TWICE] } }],
    ['a repeated role', { rules: { roles: ['STAFF', 'STAFF'] } }],
    ['more roles than exist', { rules: { roles: ['STAFF', 'ADMIN', 'CUSTOMER', 'STAFF'] } }],
  ])('400 VALIDATION_ERROR for %s', async (_label, body) => {
    const key = await insertFlag();
    const res = await flip(key, admin, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    ['a customer', () => customer],
    ['a staff member', () => staff],
  ])('403 FORBIDDEN for %s', async (_label, who) => {
    const key = await insertFlag();
    const res = await flip(key, who(), { enabled: true });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  testAuthMatrix('PATCH /api/admin/flags/:key', (http) =>
    http.patch(`/api/admin/flags/${newKey()}`).send({ enabled: true }),
  );
});
