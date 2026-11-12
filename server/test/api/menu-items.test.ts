// Local only: the menu editor's API (P3.4). Who may call it, the bounds (equal to the CHECK constraints), what each
// write changes on the public menu (at once, through the cache), what archiving keeps, and the audit row and the one
// menu.changed event every write leaves.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/schemas/limits';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createBrandOwner,
  createStoreMember,
  createTestUser,
  deleteTestStores,
  localSql,
  testAuthMatrix,
  testStoreIsolation,
  type TestUser,
} from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
const B = LIMITS.menuItem;
let brandId = '';
let storeId = '';
let templateId = '';
let seeded = '';
let manager: TestUser;
let staff: TestUser;
let owner: TestUser;
let customer: TestUser;
const users: TestUser[] = [];

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
const base = (store = storeId) => `/api/stores/${store}/menu-items`;
const create = (body: object, user = manager) => api().post(base()).set(auth(user)).send(body);
const patch = (itemId: string, body: object, user = manager) =>
  api().patch(`${base()}/${itemId}`).set(auth(user)).send(body);
const archive = (itemId: string, user = manager) =>
  api().delete(`${base()}/${itemId}`).set(auth(user));
const publicItems = async () => {
  const res = await api().get(`/api/stores/${storeId}/menu`);
  return res.body.categories.flatMap(
    (category: { items: { id: string; price: number }[] }) => category.items,
  ) as { id: string; price: number }[];
};
const valid = { name: 'Masala Chai', description: 'Spiced tea', price: 30, category: 'Drinks' };
const eventsFor = async (itemId: string) =>
  (
    await supabaseAdmin
      .from('domain_events')
      .select('type, actor, request_id, payload')
      .eq('store_id', storeId)
      .eq('type', 'menu.changed')
      .contains('payload', { itemIds: [itemId] })
      .order('occurred_at')
      .throwOnError()
  ).data;
const auditFor = async (itemId: string) =>
  (
    await supabaseAdmin
      .from('audit_log')
      .select('actor_id, actor_role, request_id, changes')
      .eq('action', 'menu_item.changed')
      .eq('entity_id', itemId)
      .order('id')
      .throwOnError()
  ).data;

const makeItem = async (store: string) =>
  (
    await supabaseAdmin
      .from('menu_items')
      .insert({
        store_id: store,
        name: 'Iso item',
        description: '',
        category: 'Test',
        price_paise: 1000,
      })
      .select('id')
      .single()
      .throwOnError()
  ).data.id;

beforeAll(async () => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'Menu items', slug: `menu-items-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandId = brand.id;
  const { data: store } = await supabaseAdmin
    .from('stores')
    .insert({
      name: 'Menu items',
      slug: `menu-items-${tag}`,
      brand_id: brandId,
      status: 'ACTIVE',
      is_open: true,
      tagline: 'Test',
      description: 'A store for menu-items.test.ts',
    })
    .select('id')
    .single()
    .throwOnError();
  storeId = store.id;
  seeded = await makeItem(storeId);
  const { data: template } = await supabaseAdmin
    .rpc('ensure_brand_template', { p_brand_id: brandId })
    .throwOnError();
  templateId = template;
  manager = await createStoreMember(storeId, 'MANAGER');
  staff = await createStoreMember(storeId, 'STAFF');
  owner = await createBrandOwner(brandId);
  customer = await createTestUser();
  users.push(manager, staff, owner, customer);
}, 60_000);

afterAll(async () => {
  await supabaseAdmin.from('domain_events').delete().eq('store_id', templateId);
  await deleteTestStores([storeId, templateId], [brandId], users);
});

const someId = randomUUID();
testAuthMatrix('GET /api/stores/:storeId/menu-items', (http) => http.get(base()));
testAuthMatrix('POST /api/stores/:storeId/menu-items', (http) => http.post(base()).send(valid));
testAuthMatrix('PATCH /api/stores/:storeId/menu-items/:itemId', (http) =>
  http.patch(`${base()}/${someId}`).send({ price: 10 }),
);
testAuthMatrix('DELETE /api/stores/:storeId/menu-items/:itemId', (http) =>
  http.delete(`${base()}/${someId}`),
);

testStoreIsolation(
  'GET /api/stores/:storeId/menu-items',
  (http, store) => http.get(base(store)),
  undefined,
  'MANAGER',
);
testStoreIsolation(
  'POST /api/stores/:storeId/menu-items',
  (http, store) => http.post(base(store)).send(valid),
  undefined,
  'MANAGER',
);
testStoreIsolation(
  'PATCH /api/stores/:storeId/menu-items/:itemId',
  (http, store, item) => http.patch(`${base(store)}/${item}`).send({ price: 10 }),
  makeItem,
  'MANAGER',
);
testStoreIsolation(
  'DELETE /api/stores/:storeId/menu-items/:itemId',
  (http, store, item) => http.delete(`${base(store)}/${item}`),
  makeItem,
  'MANAGER',
);

describe('who edits a menu', () => {
  it('staff may not (403), a manager may', async () => {
    expect((await api().get(base()).set(auth(staff))).status).toBe(403);
    expect((await create(valid, staff)).status).toBe(403);
    expect((await patch(seeded, { price: 11 }, staff)).status).toBe(403);
    expect((await archive(seeded, staff)).status).toBe(403);
    expect((await api().get(base()).set(auth(manager))).status).toBe(200);
  });

  it("the brand's owner edits the template's menu; a branch manager cannot see it (404)", async () => {
    const res = await api().get(base(templateId)).set(auth(owner));
    expect(res.status).toBe(200);
    expect(res.body.items.map((item: { name: string }) => item.name)).toEqual(['Iso item']);
    expect((await api().get(base(templateId)).set(auth(manager))).status).toBe(404);
  });

  it('an unknown or malformed item id is 404', async () => {
    expect((await patch(randomUUID(), { price: 10 })).status).toBe(404);
    expect((await patch('not-a-uuid', { price: 10 })).status).toBe(404);
    expect((await archive(randomUUID())).status).toBe(404);
    expect((await archive('not-a-uuid')).status).toBe(404);
  });
});

describe('the bounds', () => {
  it.each([
    ['a one-letter name', { name: 'A' }],
    ['a name over the limit', { name: 'x'.repeat(B.nameMax + 1) }],
    ['a one-emoji name (one code point)', { name: '🍕' }],
    ['a name of invisible characters', { name: '​​​' }],
    ['a description over the limit', { description: 'x'.repeat(B.descriptionMax + 1) }],
    ['an empty category', { category: '  ' }],
    ['a category over the limit', { category: 'x'.repeat(B.categoryMax + 1) }],
    ['a zero price', { price: 0 }],
    ['a price over the limit', { price: B.priceMax + 1 }],
    ['a price with paise', { price: 10.5 }],
    ['a price as text', { price: '10' }],
    ['an unknown diet', { diet: 'VEGAN' }],
    ['negative stock', { stockQuantity: -1 }],
    ['stock over the limit', { stockQuantity: B.stockMax + 1 }],
    ['an unknown field', { imageUrl: '/images/x.jpg' }],
  ])('refuses %s (400)', async (_label, override) => {
    const res = await create({ ...valid, ...override });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a create without a name, price or category, and an empty edit', async () => {
    for (const key of ['name', 'price', 'category'] as const) {
      const { [key]: _dropped, ...rest } = valid;
      expect((await create(rest)).status).toBe(400);
    }
    expect((await patch(seeded, {})).status).toBe(400);
    // Stock is the stock function's, with its trail (PR 04), never a plain edit.
    expect((await patch(seeded, { stockQuantity: 3 })).status).toBe(400);
  });

  it('takes each bound itself', async () => {
    const res = await create({
      name: 'x'.repeat(B.nameMax),
      description: 'x'.repeat(B.descriptionMax),
      category: 'x'.repeat(B.categoryMax),
      price: B.priceMax,
      stockQuantity: B.stockMax,
    });
    expect(res.status).toBe(201);
    expect((await archive(res.body.item.id)).status).toBe(204);
  });

  it('the database holds the same bounds', () => {
    const defs = localSql<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.menu_items'::regclass and contype = 'c'`,
    ).map((row) => row.def);
    expect(defs).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `char_length\\(name\\) >= ${B.nameMin}\\).*char_length\\(name\\) <= ${B.nameMax}\\)`,
        ),
      ),
    );
    expect(defs).toContainEqual(
      expect.stringContaining(`char_length(description) <= ${B.descriptionMax}`),
    );
    expect(defs).toContainEqual(
      expect.stringContaining(`char_length(category) <= ${B.categoryMax}`),
    );
    expect(defs).toContainEqual(expect.stringContaining(`price_paise <= ${B.priceMax * 100}`));
  });
});

describe('creating, editing and archiving an item', () => {
  let chai = '';
  let snack = '';

  it('creates an item last in its category, with no photo, and shows it on the menu at once', async () => {
    const before = await publicItems(); // warms the cache: the create must drop it
    expect(before.map((item) => item.id)).not.toContain(undefined);
    const res = await create({ ...valid, category: 'Test', diet: 'VEG', stockQuantity: 5 });
    expect(res.status).toBe(201);
    chai = res.body.item.id;
    expect(res.body.item).toMatchObject({
      name: 'Masala Chai',
      description: 'Spiced tea',
      price: 30,
      category: 'Test',
      diet: 'VEG',
      imageUrl: null,
      isPopular: false,
      isAvailable: true,
      isEnabled: true,
      stockQuantity: 5,
      archivedAt: null,
    });
    const { data: rows } = await supabaseAdmin
      .from('menu_items')
      .select('id, sort_order, price_paise')
      .eq('store_id', storeId)
      .in('id', [seeded, chai])
      .throwOnError();
    const sortOf = (id: string) => rows.find((row) => row.id === id)?.sort_order ?? -1;
    expect(sortOf(chai)).toBeGreaterThan(sortOf(seeded));
    expect(rows.find((row) => row.id === chai)?.price_paise).toBe(3000);
    expect((await publicItems()).map((item) => item.id)).toContain(chai);

    // A new category goes after every item on the menu.
    const snackRes = await create({ ...valid, name: 'Samosa', category: 'Snacks' });
    snack = snackRes.body.item.id;
    const { data: last } = await supabaseAdmin
      .from('menu_items')
      .select('id')
      .eq('store_id', storeId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()
      .throwOnError();
    expect(last.id).toBe(snack);
  });

  it('allows a second item with the same name', async () => {
    const res = await create(valid);
    expect(res.status).toBe(201);
    expect((await archive(res.body.item.id)).status).toBe(204);
  });

  it('a price edit reaches the public menu at once, not after the cache expires', async () => {
    expect((await publicItems()).find((item) => item.id === chai)?.price).toBe(30);
    const res = await patch(chai, { price: 35, isPopular: true, diet: null });
    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({ price: 35, isPopular: true, diet: null });
    expect((await publicItems()).find((item) => item.id === chai)?.price).toBe(35);
  });

  it('a category change puts the item last in its new category, so no category moves', async () => {
    const moved = (await create({ ...valid, name: 'Mover', category: 'Test' })).body.item.id;
    const res = await patch(moved, { category: 'Snacks' });
    expect(res.status).toBe(200);
    const { data: last } = await supabaseAdmin
      .from('menu_items')
      .select('id')
      .eq('store_id', storeId)
      .is('archived_at', null)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()
      .throwOnError();
    expect(last.id).toBe(moved);
    expect((await archive(moved)).status).toBe(204);
  });

  it('an archived item does not hold a category a place: a category with only archived items goes last', async () => {
    const ghost = (await create({ ...valid, name: 'Ghost', category: 'Ghosts' })).body.item.id;
    const later = (await create({ ...valid, name: 'Later', category: 'Later' })).body.item.id;
    expect((await archive(ghost)).status).toBe(204);
    const revived = (await create({ ...valid, name: 'Revived', category: 'Ghosts' })).body.item.id;
    const { data: rows } = await supabaseAdmin
      .from('menu_items')
      .select('id, sort_order')
      .in('id', [later, revived])
      .throwOnError();
    const sortOf = (id: string) => rows.find((row) => row.id === id)?.sort_order ?? -1;
    expect(sortOf(revived)).toBeGreaterThan(sortOf(later));
    expect((await archive(later)).status).toBe(204);
    expect((await archive(revived)).status).toBe(204);
  });

  it('switching an item off keeps it listed as unavailable', async () => {
    const res = await patch(chai, { isAvailable: false });
    expect(res.body.item).toMatchObject({ isAvailable: false, isEnabled: false });
    expect((await patch(chai, { isAvailable: true })).body.item.isEnabled).toBe(true);
  });

  it('each write leaves its audit row and one menu.changed event, with the actor and request id', async () => {
    const audit = await auditFor(chai);
    // create, price edit, switch off, switch on
    expect(audit).toHaveLength(4);
    expect(audit.every((row) => row.actor_id === manager.id && row.actor_role === 'MANAGER')).toBe(
      true,
    );
    expect(audit[0]?.changes).toMatchObject({ name: [null, 'Masala Chai'], diet: [null, 'VEG'] });
    expect(audit[1]?.changes).toEqual({
      price_paise: [3000, 3500],
      diet: ['VEG', null],
      is_popular: [false, true],
    });
    const events = await eventsFor(chai);
    expect(events).toHaveLength(4);
    for (const [index, event] of events.entries()) {
      expect(event.actor).toMatchObject({ type: 'USER', id: manager.id });
      expect(event.request_id).toBe(audit[index]?.request_id);
      expect(event.request_id).toBeTruthy();
    }
  });

  it('a stock move alone (every order) is not a menu change', async () => {
    const before = (await eventsFor(chai)).length;
    const res = await api()
      .post('/api/orders')
      .set(auth(customer))
      .send({ storeId, items: [{ menuItemId: chai, quantity: 1, expectedUnitPrice: 35 }] });
    expect(res.status).toBe(201);
    const { data } = await supabaseAdmin
      .from('menu_items')
      .select('stock_quantity')
      .eq('id', chai)
      .single()
      .throwOnError();
    expect(data.stock_quantity).toBe(4);
    expect(await eventsFor(chai)).toHaveLength(before);
  });

  it('archiving: gone from the menu, kept in the list and in old orders, never orderable', async () => {
    expect((await archive(chai)).status).toBe(204);
    expect((await publicItems()).map((item) => item.id)).not.toContain(chai);

    const listed = (await api().get(base()).set(auth(manager))).body.items.find(
      (item: { id: string }) => item.id === chai,
    );
    expect(listed).toMatchObject({ isEnabled: false, isAvailable: false });
    expect(listed.archivedAt).toEqual(expect.any(String));

    const orders = (await api().get('/api/orders').set(auth(customer))).body.orders;
    expect(orders[0].items[0].menuItemId).toBe(chai);

    const res = await api()
      .post('/api/orders')
      .set(auth(customer))
      .send({ storeId, items: [{ menuItemId: chai, quantity: 1, expectedUnitPrice: 35 }] });
    expect(res.body.error.code).toBe('ITEM_UNAVAILABLE');
  });

  it('archiving again is 204 and changes nothing; an archived item cannot be edited (404)', async () => {
    const events = (await eventsFor(chai)).length;
    expect((await archive(chai)).status).toBe(204);
    expect(await eventsFor(chai)).toHaveLength(events);
    expect((await patch(chai, { isAvailable: true })).status).toBe(404);
  });

  it('the database keeps an archived item switched off, so place_order refuses it too', async () => {
    const { error } = await supabaseAdmin
      .from('menu_items')
      .update({ is_available: true })
      .eq('id', chai);
    expect(error?.code).toBe('23514');
  });

  it('the archive left its audit row', async () => {
    const audit = await auditFor(chai);
    expect(audit.at(-1)?.changes).toMatchObject({
      archived_at: [null, expect.any(String)],
      is_available: [true, false],
    });
    expect(await archive(snack)).toHaveProperty('status', 204);
  });
});
