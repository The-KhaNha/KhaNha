// Local only: ordering with modifiers (P3.2 PR 13b). The shared case table (test/setup/modifierCases.ts) is run through
// POST /api/orders, so the API's check (domain/pricing.ts) and place_order's agree on every case, flag off included;
// then the cases only the database can show: the stored line and its snapshots, a price that moved, stock shared by an
// item's lines under concurrent orders, and snapshots that outlive their option.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PricingGroup } from '../../src/domain/pricing';
import { invalidate } from '../../src/utils/cache';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import { createTestUser, deleteTestStores, type TestUser } from '../setup/helpers';
import { ADDONS, MILK, MODIFIER_CASES, SIZE } from '../setup/modifierCases';

const tag = randomUUID().slice(0, 8);
const brandIds: string[] = [];
const storeIds: string[] = [];
const users: TestUser[] = [];
let storeId = '';
let customer: TestUser;
/** The case table's ids ('o-large', 'g-size') → the rows made for them. */
const real = new Map<string, string>();

async function setFlag(on: boolean) {
  await supabaseAdmin
    .from('feature_flags')
    .update({ enabled: on, rules: on ? { storeIds: [storeId] } : {} })
    .eq('key', 'modifiers')
    .throwOnError();
  invalidate();
}

/** The case's groups as rows (made once per group), and an item of `base` paise that offers them. */
async function itemFor(base: number, groups: PricingGroup[], stock: number | null = null) {
  for (const [i, g] of groups.entries()) {
    if (real.has(g.id)) continue;
    const { data: group } = await supabaseAdmin
      .from('modifier_groups')
      .insert({
        store_id: storeId,
        name: g.name,
        min_select: g.minSelect,
        max_select: g.maxSelect,
        sort_order: i,
      })
      .select('id')
      .single()
      .throwOnError();
    real.set(g.id, group.id);
    for (const [j, o] of g.options.entries()) {
      const { data: option } = await supabaseAdmin
        .from('modifier_options')
        .insert({
          group_id: group.id,
          name: o.name,
          price_delta_paise: o.priceDeltaPaise,
          is_default: o.isDefault,
          is_available: o.isAvailable,
          sort_order: j,
        })
        .select('id')
        .single()
        .throwOnError();
      real.set(o.id, option.id);
    }
  }
  const { data: item } = await supabaseAdmin
    .from('menu_items')
    .insert({
      store_id: storeId,
      category: 'Coffee',
      name: `Coffee ${randomUUID().slice(0, 6)}`,
      description: '',
      price_paise: base,
      stock_quantity: stock,
    })
    .select('id, name')
    .single()
    .throwOnError();
  if (groups.length)
    await supabaseAdmin
      .from('menu_item_modifier_groups')
      .insert(
        groups.map((g, i) => ({
          menu_item_id: item.id,
          group_id: real.get(g.id) ?? '',
          sort_order: i,
        })),
      )
      .throwOnError();
  return item;
}

const order = (
  lines: { menuItemId: string; quantity?: number; options?: string[]; expected?: number }[],
) =>
  api()
    .post('/api/orders')
    .set({ Authorization: `Bearer ${customer.token}` })
    .send({
      storeId,
      items: lines.map((l) => ({
        menuItemId: l.menuItemId,
        quantity: l.quantity ?? 1,
        ...(l.options ? { modifierOptionIds: l.options } : {}),
        ...(l.expected !== undefined ? { expectedUnitPrice: l.expected } : {}),
      })),
    });

beforeAll(async () => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'Order mods', slug: `order-mods-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandIds.push(brand.id);
  const { data: store } = await supabaseAdmin
    .from('stores')
    .insert({
      name: `Order mods ${tag}`,
      slug: `store-order-mods-${tag}`,
      brand_id: brand.id,
      status: 'ACTIVE',
      is_open: true,
      tagline: 'Test',
      description: 'A store for order-modifiers.test.ts',
    })
    .select('id')
    .single()
    .throwOnError();
  storeId = store.id;
  storeIds.push(storeId);
  customer = await createTestUser();
  users.push(customer);
}, 60_000);

afterAll(async () => {
  await setFlag(false);
  await supabaseAdmin.from('orders').delete().eq('store_id', storeId).throwOnError();
  await supabaseAdmin.from('modifier_groups').delete().eq('store_id', storeId).throwOnError();
  await deleteTestStores(storeIds, brandIds, users);
});

describe('the shared case table, through POST /api/orders and place_order', () => {
  it.each(MODIFIER_CASES)(
    '$name',
    async ({ basePricePaise, groups, chosen, enabled, expect: want }) => {
      await setFlag(enabled);
      const item = await itemFor(basePricePaise, groups);
      const res = await order([
        { menuItemId: item.id, options: chosen.map((id) => real.get(id) ?? randomUUID()) },
      ]);
      if ('code' in want) {
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe(want.code);
        if (want.groupName) expect(res.body.error.details.group).toBe(want.groupName);
        return;
      }
      expect(res.status).toBe(201);
      const line = res.body.order.items[0];
      expect(line.unitPrice).toBe(want.unitPricePaise / 100);
      expect(line.baseUnitPrice).toBe(basePricePaise / 100);
      expect(line.modifiers.map((m: { optionName: string }) => m.optionName)).toEqual(want.options);
    },
  );
});

describe('the shared case table, straight to place_order (the API check skipped)', () => {
  it.each(MODIFIER_CASES)(
    '$name',
    async ({ basePricePaise, groups, chosen, enabled, expect: want }) => {
      const item = await itemFor(basePricePaise, groups);
      const expected = 'code' in want ? basePricePaise : want.unitPricePaise;
      const { data, error } = await supabaseAdmin.rpc('place_order', {
        p_user_id: customer.id,
        p_store_id: storeId,
        p_customer_name: 'Test',
        p_payment_status: 'PAID',
        p_lines: [
          {
            menu_item_id: item.id,
            name: item.name,
            quantity: 1,
            unit_price_paise: expected,
            modifier_option_ids: chosen.map((id) => real.get(id) ?? randomUUID()),
          },
        ],
        p_modifiers_enabled: enabled,
      });
      if ('code' in want) {
        expect(error?.message).toBe(want.code);
        if (want.groupName) expect(JSON.parse(error?.details ?? '{}').group).toBe(want.groupName);
        return;
      }
      expect(error).toBeNull();
      const { data: line } = await supabaseAdmin
        .from('order_items')
        .select(
          'unit_price_paise, base_unit_price_paise, order_item_modifiers (option_name, position)',
        )
        .eq('order_id', data ?? '')
        .single()
        .throwOnError();
      expect(line.unit_price_paise).toBe(want.unitPricePaise);
      expect(line.base_unit_price_paise).toBe(basePricePaise);
      expect(
        [...line.order_item_modifiers]
          .sort((a, b) => a.position - b.position)
          .map((m) => m.option_name),
      ).toEqual(want.options);
    },
  );
});

describe('ordering with options, beyond the table', () => {
  it('a price shown before an option changed price is refused (PRICE_CHANGED) and nothing is placed', async () => {
    await setFlag(true);
    const item = await itemFor(12000, [SIZE]);
    const res = await order([
      { menuItemId: item.id, options: [real.get('o-large') ?? ''], expected: 120 },
    ]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRICE_CHANGED');
    expect(res.body.error.message).toContain('₹150');
  });

  it("an item's lines with different options share its stock, also under two orders at once", async () => {
    await setFlag(true);
    const item = await itemFor(12000, [SIZE], 3);
    const regular = real.get('o-regular') ?? '';
    const large = real.get('o-large') ?? '';
    // One order asking for 2 + 2 of a stock of 3.
    const tooMany = await order([
      { menuItemId: item.id, quantity: 2, options: [regular] },
      { menuItemId: item.id, quantity: 2, options: [large] },
    ]);
    expect(tooMany.body.error.code).toBe('INSUFFICIENT_STOCK');
    // The item's real stock, not what the first line left: nothing was taken.
    expect(tooMany.body.error.details.available).toBe(3);
    // Two orders of 1 + 1 at once: the stock fits one of them.
    const both = await Promise.all(
      [0, 1].map(() =>
        order([
          { menuItemId: item.id, options: [regular] },
          { menuItemId: item.id, options: [large] },
        ]),
      ),
    );
    expect(both.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(both.find((r) => r.status === 400)?.body.error.code).toBe('INSUFFICIENT_STOCK');
    const { data } = await supabaseAdmin
      .from('menu_items')
      .select('stock_quantity')
      .eq('id', item.id)
      .single()
      .throwOnError();
    expect(data.stock_quantity).toBe(1);
  });

  it("an order keeps its options' names and prices after the option is renamed, then deleted", async () => {
    await setFlag(true);
    const item = await itemFor(12000, [MILK]);
    const oat = real.get('o-oat') ?? '';
    const placed = await order([{ menuItemId: item.id, options: [oat] }]);
    expect(placed.status).toBe(201);
    await supabaseAdmin
      .from('modifier_options')
      .update({ name: 'Oat (new)', price_delta_paise: 9900 })
      .eq('id', oat)
      .throwOnError();
    await supabaseAdmin.from('modifier_options').delete().eq('id', oat).throwOnError();
    real.delete('o-oat');
    const read = await api()
      .get(`/api/orders/${placed.body.order.id}`)
      .set({ Authorization: `Bearer ${customer.token}` });
    expect(read.body.order.items[0].modifiers).toEqual([
      { groupName: 'Milk', optionName: 'Oat', priceDelta: 20 },
    ]);
  });

  it('a retry with the same key answers the order it placed, though its default option was never sent', async () => {
    await setFlag(true);
    const item = await itemFor(12000, [SIZE]);
    const send = (key: string) =>
      api()
        .post('/api/orders')
        .set({ Authorization: `Bearer ${customer.token}` })
        .send({ storeId, idempotencyKey: key, items: [{ menuItemId: item.id, quantity: 1 }] });
    const key = randomUUID();
    const first = await send(key);
    expect(first.status).toBe(201);
    expect(first.body.order.items[0].modifiers).toEqual([
      { groupName: 'Size', optionName: 'Regular', priceDelta: 0 },
    ]);
    const again = await send(key);
    expect(again.body.order.id).toBe(first.body.order.id);
    // The same key for the same item with another option is another order, never a replay.
    const other = await api()
      .post('/api/orders')
      .set({ Authorization: `Bearer ${customer.token}` })
      .send({
        storeId,
        idempotencyKey: key,
        items: [{ menuItemId: item.id, quantity: 1, modifierOptionIds: [real.get('o-large')] }],
      });
    expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('an option refused at checkout drops the cached menu, so the retry shows it as it is', async () => {
    await setFlag(true);
    const item = await itemFor(12000, [ADDONS]);
    const syrup = real.get('o-syrup') ?? '';
    const menu = () => api().get(`/api/stores/store-order-mods-${tag}/menu`);
    const offered = (body: {
      modifierGroups: Record<string, { options: { id: string; isAvailable: boolean }[] }>;
    }) =>
      body.modifierGroups[real.get('g-addons') ?? '']?.options.find((o) => o.id === syrup)
        ?.isAvailable;
    expect(offered((await menu()).body)).toBe(true);
    // Sold out behind the cache's back.
    await supabaseAdmin
      .from('modifier_options')
      .update({ is_available: false })
      .eq('id', syrup)
      .throwOnError();
    const refused = await order([{ menuItemId: item.id, options: [syrup] }]);
    expect(refused.body.error.code).toBe('MODIFIER_INVALID');
    expect(offered((await menu()).body)).toBe(false);
  });
});
