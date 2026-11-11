// Local only: the public store reads (P2 PR 02). Writes throwaway brand and stores, removed afterwards.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MenuResponse, StoreDto, StoreSummaryDto } from '../../src/types/api';
import { invalidate } from '../../src/utils/cache';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import { oldestStoreId } from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
const areaA = `area-a-${tag}`;
const areaB = `area-b-${tag}`;
let brandId: string;
const ids: Record<'a' | 'b' | 'draft', string> = { a: '', b: '', draft: '' };
const slug = (key: string) => `read-${key}-${tag}`;

async function makeStore(key: 'a' | 'b' | 'draft', area: string, status: 'ACTIVE' | 'DRAFT') {
  const { data } = await supabaseAdmin
    .from('stores')
    .insert({
      name: `Read ${key} ${tag}`,
      slug: slug(key),
      brand_id: brandId,
      area,
      status,
      tagline: 'Test',
      description: 'A store for stores-read.test.ts',
    })
    .select('id')
    .single()
    .throwOnError();
  ids[key] = data.id;
}

beforeAll(async () => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'Read Test', slug: `read-test-${tag}` })
    .select('id')
    .single()
    .throwOnError();
  brandId = brand.id;
  await makeStore('a', areaA, 'ACTIVE');
  await makeStore('b', areaB, 'ACTIVE');
  await makeStore('draft', areaA, 'DRAFT');
  invalidate();
}, 30_000);

afterAll(async () => {
  await supabaseAdmin.from('stores').delete().eq('brand_id', brandId);
  await supabaseAdmin.from('brands').delete().eq('id', brandId);
  invalidate();
});

const list = async (query = '') =>
  (await api().get(`/api/stores${query}`)).body.stores as StoreSummaryDto[];

describe('GET /api/stores', () => {
  it('lists ACTIVE stores in name order with the summary fields, and omits a DRAFT store', async () => {
    const res = await api().get('/api/stores');
    expect(res.status).toBe(200);
    const stores = res.body.stores as StoreSummaryDto[];
    expect(stores.map((s) => s.id)).toEqual(expect.arrayContaining([ids.a, ids.b]));
    expect(stores.map((s) => s.id)).not.toContain(ids.draft);
    // The database's own order (its collation), not a JS sort that may disagree on case or punctuation.
    const { data: expected } = await supabaseAdmin
      .from('stores')
      .select('id')
      .eq('status', 'ACTIVE')
      .order('name')
      .order('id')
      .throwOnError();
    expect(stores.map((s) => s.id)).toEqual(expected.map((s) => s.id));
    expect(Object.keys(stores[0]!).sort()).toEqual(
      ['area', 'brand', 'id', 'imageUrl', 'isOpen', 'name', 'slug', 'tagline'].sort(),
    );
  });

  it('filters by area, and two requests in a row with different areas each get their own', async () => {
    expect((await list(`?area=${areaA}`)).map((s) => s.id)).toEqual([ids.a]);
    expect((await list(`?area=${areaB}`)).map((s) => s.id)).toEqual([ids.b]);
    expect((await list(`?area=${areaA}`)).map((s) => s.id)).toEqual([ids.a]);
    expect(await list('?area=nowhere')).toEqual([]);
  });

  it('an empty area lists every store', async () => {
    const all = await api().get('/api/stores');
    const empty = await api().get('/api/stores?area=');
    expect(empty.status).toBe(200);
    expect(empty.body.stores).toEqual(all.body.stores);
  });

  it('refuses an over-long area with 400', async () => {
    const res = await api().get(`/api/stores?area=${'x'.repeat(61)}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/stores/:storeRef', () => {
  it('resolves by id and by slug', async () => {
    for (const ref of [ids.a, slug('a')]) {
      const res = await api().get(`/api/stores/${ref}`);
      expect(res.status).toBe(200);
      expect((res.body.store as StoreDto).id).toBe(ids.a);
      expect((res.body.store as StoreDto).brand.slug).toBe(`read-test-${tag}`);
    }
  });

  it.each([
    ['an unknown slug', 'no-such-store'],
    ['an unknown id', randomUUID()],
    ['a DRAFT store by slug', slug('draft')],
  ])('%s → 404 NOT_FOUND', async (_label, ref) => {
    const res = await api().get(`/api/stores/${ref}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('a DRAFT store by id → 404, and its menu too', async () => {
    expect((await api().get(`/api/stores/${ids.draft}`)).status).toBe(404);
    expect((await api().get(`/api/stores/${ids.draft}/menu`)).status).toBe(404);
  });

  it('a ref that cannot be a slug (too long, upper case, punctuation) → the same 404', async () => {
    for (const ref of ['x'.repeat(81), 'Campus-Cafe', 'a_b', '-a']) {
      const res = await api().get(`/api/stores/${ref}`);
      expect(res.status, ref).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('a uuid in upper case names the same store', async () => {
    const res = await api().get(`/api/stores/${ids.a.toUpperCase()}`);
    expect(res.status).toBe(200);
    expect((res.body.store as StoreDto).id).toBe(ids.a);
  });
});

describe('GET /api/stores/:storeRef/menu', () => {
  it('returns the menu of the oldest store by slug, equal to GET /api/menu', async () => {
    const id = await oldestStoreId();
    const { data } = await supabaseAdmin.from('stores').select('slug').eq('id', id).single();
    const res = await api().get(`/api/stores/${data!.slug}/menu`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual((await api().get('/api/menu')).body);
    expect((res.body as MenuResponse).store.id).toBe(id);
  });

  it('an ACTIVE store with no items has an empty menu', async () => {
    const res = await api().get(`/api/stores/${ids.b}/menu`);
    expect(res.status).toBe(200);
    expect((res.body as MenuResponse).categories).toEqual([]);
  });
});

describe('public routes', () => {
  it.each(['/api/stores', `/api/stores/${slug('a')}`, `/api/stores/${slug('a')}/menu`])(
    '%s needs no token and ignores a bad one',
    async (path) => {
      expect((await api().get(path)).status).toBe(200);
      expect((await api().get(path).set('Authorization', 'Bearer garbage')).status).toBe(200);
    },
  );
});
