import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MENU_ITEMS_MAX } from '../../src/services/menu.service';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createBrandOwner,
  createStoreMember,
  deleteTestStores,
  type TestUser,
} from '../setup/helpers';

// The cap on live items per store (menu_items_enforce_cap, /break at the P3 close): the database refuses the
// (MENU_ITEMS_MAX + 1)th live item however it is made, so the trigger's literal and the constant cannot drift apart.
const tag = randomUUID().slice(0, 8);
let brandId = '';
let sourceId = '';
let fullId = '';
let templateItemIds: string[] = [];
let manager: TestUser;
let owner: TestUser;
const users: TestUser[] = [];
const storeIds: string[] = [];

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
const row = (storeId: string, i: number) => ({
  store_id: storeId,
  name: `Cap ${i}`,
  description: '',
  category: 'Cap',
  image_url: '/images/x.jpg',
  price_paise: 1000,
  sort_order: i,
});
const live = async () =>
  (
    await supabaseAdmin
      .from('menu_items')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', fullId)
      .is('archived_at', null)
      .throwOnError()
  ).count;
/** Archives live items until `target` are left. */
async function trimTo(target: number) {
  const { data } = await supabaseAdmin
    .from('menu_items')
    .select('id')
    .eq('store_id', fullId)
    .is('archived_at', null)
    .order('sort_order', { ascending: false })
    .limit(Math.max(0, (await live())! - target))
    .throwOnError();
  if (data.length)
    await supabaseAdmin
      .from('menu_items')
      .update({ archived_at: new Date().toISOString(), is_available: false })
      .in(
        'id',
        data.map((d) => d.id),
      )
      .throwOnError();
}

beforeAll(async () => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'Cap', slug: `cap-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandId = brand.id;
  const store = async (key: string) =>
    (
      await supabaseAdmin
        .from('stores')
        .insert({
          name: `Cap ${key}`,
          slug: `cap-${key}-${tag}`,
          brand_id: brandId,
          status: 'ACTIVE',
          tagline: '',
          description: 'A store for menu-item-cap.test.ts',
        })
        .select('id')
        .single()
        .throwOnError()
    ).data.id;
  // The oldest store is the template's source: two items the template copies.
  sourceId = await store('source');
  fullId = await store('full');
  storeIds.push(sourceId, fullId);
  await supabaseAdmin
    .from('menu_items')
    .insert([row(sourceId, 1), row(sourceId, 2)])
    .throwOnError();
  const { data: templateId } = await supabaseAdmin
    .rpc('ensure_brand_template', { p_brand_id: brandId })
    .throwOnError();
  storeIds.push(templateId);
  templateItemIds = (
    await supabaseAdmin.from('menu_items').select('id').eq('store_id', templateId).throwOnError()
  ).data.map((i) => i.id);
  // One short of the cap, in one statement (the trigger counts a statement's rows once per store).
  await supabaseAdmin
    .from('menu_items')
    .insert(Array.from({ length: MENU_ITEMS_MAX - 1 }, (_, i) => row(fullId, i + 1)))
    .throwOnError();
  manager = await createStoreMember(fullId, 'MANAGER');
  owner = await createBrandOwner(brandId);
  users.push(manager, owner);
}, 60_000);

afterAll(async () => {
  await supabaseAdmin.from('menu_items').delete().in('store_id', storeIds);
  await deleteTestStores(storeIds, [brandId], users);
});

describe(`at most ${MENU_ITEMS_MAX} live items per store`, () => {
  const create = () =>
    api()
      .post(`/api/stores/${fullId}/menu-items`)
      .set(auth(manager))
      .send({ name: 'One more', description: 'Test', price: 30, category: 'Drinks' });

  it(`takes the ${MENU_ITEMS_MAX}th item and refuses the next with 409 MENU_FULL`, async () => {
    expect((await create()).status).toBe(201);
    const refused = await create();
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('MENU_FULL');
    expect(refused.body.error.details).toEqual({ kind: 'menuFull', max: MENU_ITEMS_MAX });
    expect(await live()).toBe(MENU_ITEMS_MAX);
  });

  it('counts only live items: archiving one frees its place', async () => {
    await trimTo(MENU_ITEMS_MAX - 1);
    expect((await create()).status).toBe(201);
    expect(await live()).toBe(MENU_ITEMS_MAX);
  });

  it('lets exactly the places left through when inserts race (no count read before the lock)', async () => {
    await trimTo(MENU_ITEMS_MAX - 4);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        supabaseAdmin.from('menu_items').insert(row(fullId, 10_000 + i)),
      ),
    );
    expect(results.filter((r) => r.error === null)).toHaveLength(4);
    for (const r of results.filter((x) => x.error !== null))
      expect(r.error?.message).toBe('MENU_FULL');
    expect(await live()).toBe(MENU_ITEMS_MAX);
  });

  it('refuses a template push whose new copies would pass it, whole', async () => {
    await trimTo(MENU_ITEMS_MAX - 1);
    const res = await api()
      .post(`/api/brands/${brandId}/template/push`)
      .set(auth(owner))
      .send({ itemIds: templateItemIds, storeIds: [fullId], fields: ['price'] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MENU_FULL');
    // Neither copy was made: the push is one transaction.
    expect(await live()).toBe(MENU_ITEMS_MAX - 1);
  });
});
