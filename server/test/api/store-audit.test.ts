// Local only: GET /api/stores/:storeId/audit (P2 PR 10) on its own brand and stores. Audit rows are append-only; the
// test writes them by editing its own throwaway stores, and deleteTestStores clears the stores, not the rows.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditPageDto } from '../../src/types/api';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createBrandOwner,
  createStoreMember,
  createTestUser,
  deleteTestStores,
  testStoreIsolation,
  type TestUser,
} from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
const store = { x: '', y: '' };
let brandId = '';
const users: TestUser[] = [];
let manager: TestUser;
let staff: TestUser;
let owner: TestUser;
let admin: TestUser;
const EDITS_AT_X = 3;

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
const read = (user: TestUser, storeId: string, query: Record<string, string | number> = {}) =>
  api().get(`/api/stores/${storeId}/audit`).query(query).set(auth(user));

async function editArea(storeId: string, n: number) {
  await supabaseAdmin
    .from('stores')
    .update({ area: `Area ${n}` })
    .eq('id', storeId)
    .throwOnError();
}

beforeAll(async () => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'Store audit', slug: `store-audit-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandId = brand.id;
  const { data: stores } = await supabaseAdmin
    .from('stores')
    .insert(
      (['x', 'y'] as const).map((key) => ({
        name: `Store audit ${key}`,
        slug: `store-audit-${key}-${tag}`,
        brand_id: brandId,
        status: 'ACTIVE' as const,
        tagline: 'Test',
        description: 'A store for store-audit.test.ts',
      })),
    )
    .select('id, slug')
    .throwOnError();
  for (const key of ['x', 'y'] as const)
    store[key] = stores.find((s) => s.slug === `store-audit-${key}-${tag}`)?.id ?? '';
  [manager, staff, owner, admin] = await Promise.all([
    createStoreMember(store.x, 'MANAGER'),
    createStoreMember(store.x, 'STAFF'),
    createBrandOwner(brandId),
    createTestUser('ADMIN'),
  ]);
  users.push(manager, staff, owner, admin);
  for (let n = 1; n <= EDITS_AT_X; n++) await editArea(store.x, n);
  await editArea(store.y, 1);
}, 60_000);

afterAll(() => deleteTestStores(Object.values(store), [brandId], users));

testStoreIsolation(
  'GET /api/stores/:storeId/audit',
  (http, storeId) => http.get(`/api/stores/${storeId}/audit`),
  undefined,
  'MANAGER',
);

describe('GET /api/stores/:storeId/audit', () => {
  it('a manager, the owner and an admin read it; STAFF does not (403)', async () => {
    for (const user of [manager, owner, admin]) {
      const res = await read(user, store.x);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect((await read(staff, store.x)).status).toBe(403);
  });

  it("returns only the store's rows", async () => {
    const x = (await read(manager, store.x, { limit: 100 })).body as AuditPageDto;
    expect(x.entries.length).toBeGreaterThan(EDITS_AT_X);
    expect(x.entries.every((entry) => entry.storeId === store.x)).toBe(true);
    const y = (await read(owner, store.y, { limit: 100 })).body as AuditPageDto;
    expect(y.entries.length).toBeGreaterThan(0);
    expect(y.entries.every((entry) => entry.storeId === store.y)).toBe(true);
  });

  it('a storeId in the query string is ignored', async () => {
    const res = await read(manager, store.x, { storeId: store.y, limit: 100 });
    expect(res.status).toBe(200);
    const { entries } = res.body as AuditPageDto;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.storeId === store.x)).toBe(true);
  });

  it('pages by the cursor and keeps the existing filters', async () => {
    const query = { entityType: 'store', entityId: store.x, limit: 2 };
    const first = (await read(manager, store.x, query)).body as AuditPageDto;
    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).toBe(first.entries[1]?.id);
    const second = (await read(manager, store.x, { ...query, before: first.nextCursor ?? 0 }))
      .body as AuditPageDto;
    expect(second.entries.length).toBeGreaterThanOrEqual(1);
    expect(second.entries.every((e) => e.entityType === 'store' && e.entityId === store.x)).toBe(
      true,
    );
    const ids = [...first.entries, ...second.entries].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });

  it('refuses a malformed query with 400', async () => {
    expect((await read(manager, store.x, { limit: 0 })).status).toBe(400);
  });
});
