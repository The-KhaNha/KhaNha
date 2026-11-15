// Local only: a template's modifier groups travel with its items (P3.2, PR 13c). A new branch copies them; a push
// copies them into a branch's new copy of an item, and overwrites a branch's copies with the `modifiers` field. A copy
// is found by lineage (template_group_id, template_option_id), never by name, and a branch's own groups are its own.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import { createBrandOwner, deleteTestStores, type TestUser } from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
const brandIds: string[] = [];
const storeIds: string[] = [];
const users: TestUser[] = [];
let brandId = '';
let templateId = '';
let northId = '';
let owner: TestUser;
let chai = '';
let toast = '';
type GroupName = 'Size' | 'Add-ons';
type OptionName = 'Small' | 'Large' | 'Honey' | 'Ginger';
const g = {} as Record<GroupName, string>; // template groups by name
const o = {} as Record<OptionName, string>; // template options by name

const push = (body: object) =>
  api()
    .post(`/api/brands/${brandId}/template/push`)
    .set({ Authorization: `Bearer ${owner.token}` })
    .send(body);

async function item(name: string) {
  const { data } = await supabaseAdmin
    .from('menu_items')
    .insert({
      store_id: templateId,
      name,
      description: name,
      category: 'Hot',
      price_paise: 5000,
      diet: 'VEG',
    })
    .select('id')
    .single()
    .throwOnError();
  return data.id;
}

async function group(
  name: GroupName,
  min: number,
  max: number,
  options: [OptionName, number, boolean][],
) {
  const { data } = await supabaseAdmin
    .from('modifier_groups')
    .insert({ store_id: templateId, name, min_select: min, max_select: max })
    .select('id')
    .single()
    .throwOnError();
  g[name] = data.id;
  for (const [i, [opt, delta, isDefault]] of options.entries()) {
    const { data: row } = await supabaseAdmin
      .from('modifier_options')
      .insert({
        group_id: data.id,
        name: opt,
        price_delta_paise: delta,
        is_default: isDefault,
        sort_order: i,
      })
      .select('id')
      .single()
      .throwOnError();
    o[opt] = row.id;
  }
}

const link = (itemId: string, groupId: string, sortOrder: number) =>
  supabaseAdmin
    .from('menu_item_modifier_groups')
    .insert({ menu_item_id: itemId, group_id: groupId, sort_order: sortOrder })
    .throwOnError();

async function openBranch(slug: string) {
  const { data } = await supabaseAdmin
    .rpc('create_store_from_template', { p_brand_id: brandId, p_name: slug, p_slug: slug })
    .throwOnError();
  storeIds.push(data);
  return data as string;
}

/** A branch's copy of a template item: its groups (by lineage, in order) with their live options. */
async function copied(storeId: string, templateItemId: string) {
  const { data: copy } = await supabaseAdmin
    .from('menu_items')
    .select('id')
    .eq('store_id', storeId)
    .eq('template_item_id', templateItemId)
    .is('archived_at', null)
    .single()
    .throwOnError();
  const { data: links } = await supabaseAdmin
    .from('menu_item_modifier_groups')
    .select(
      'sort_order, modifier_groups(store_id, name, min_select, max_select, template_group_id, modifier_options(name, price_delta_paise, is_default, is_available, archived_at, template_option_id))',
    )
    .eq('menu_item_id', copy.id)
    .order('sort_order')
    .throwOnError();
  return links.map((l) => {
    const grp = l.modifier_groups!;
    return {
      ...grp,
      modifier_options: grp.modifier_options
        .filter((x) => x.archived_at === null)
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}

const groupCopies = async (storeId: string, templateGroupId: string) =>
  (
    await supabaseAdmin
      .from('modifier_groups')
      .select('id')
      .eq('store_id', storeId)
      .eq('template_group_id', templateGroupId)
      .is('archived_at', null)
      .throwOnError()
  ).data;

beforeAll(async () => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: `Mods ${tag}`, slug: `mods-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandId = brand.id;
  brandIds.push(brand.id);
  const { data: template } = await supabaseAdmin
    .rpc('ensure_brand_template', { p_brand_id: brand.id })
    .throwOnError();
  templateId = template;
  storeIds.push(template);
  chai = await item('Chai');
  toast = await item('Toast');
  await group('Size', 1, 1, [
    ['Small', 0, true],
    ['Large', 2000, false],
  ]);
  await group('Add-ons', 0, 2, [
    ['Honey', 1000, false],
    ['Ginger', 500, false],
  ]);
  await link(chai, g['Add-ons'], 2);
  await link(chai, g.Size, 1);
  await link(toast, g.Size, 1); // shared: one copy per branch, not one per item
  await link(toast, g['Add-ons'], 2);
  northId = await openBranch(`mods-north-${tag}`);
  owner = await createBrandOwner(brand.id);
  users.push(owner);
}, 60_000);

afterAll(() => deleteTestStores(storeIds, brandIds, users));

describe('a new branch', () => {
  it("copies each item's groups and options with lineage, in the template's order, once per branch", async () => {
    const groups = await copied(northId, chai);
    expect(groups.map((x) => [x.name, x.min_select, x.max_select, x.template_group_id])).toEqual([
      ['Size', 1, 1, g.Size],
      ['Add-ons', 0, 2, g['Add-ons']],
    ]);
    expect(groups.every((x) => x.store_id === northId)).toBe(true);
    expect(groups[0]!.modifier_options).toEqual([
      expect.objectContaining({
        name: 'Large',
        price_delta_paise: 2000,
        template_option_id: o.Large,
      }),
      expect.objectContaining({ name: 'Small', is_default: true, template_option_id: o.Small }),
    ]);
    expect((await copied(northId, toast)).map((x) => x.name)).toEqual(['Size', 'Add-ons']);
    expect(await groupCopies(northId, g.Size)).toHaveLength(1);
  });
});

describe('a push', () => {
  it("without `modifiers` leaves an existing copy's modifiers alone", async () => {
    await supabaseAdmin
      .from('modifier_options')
      .update({ price_delta_paise: 2500 })
      .eq('id', o.Large)
      .throwOnError();
    const res = await push({ itemIds: [chai], storeIds: [northId], fields: ['name'] });
    expect(res.body).toEqual({ updated: 0 });
    const large = (await copied(northId, chai))[0]!.modifier_options[0]!;
    expect(large.price_delta_paise).toBe(2000);
  });

  it("with `modifiers` overwrites the copies, keeps the branch's availability and own groups, and announces it", async () => {
    const [sizeCopy] = await groupCopies(northId, g.Size);
    const { data: largeCopy } = await supabaseAdmin
      .from('modifier_options')
      .update({ is_available: false }) // the branch ran out
      .eq('group_id', sizeCopy!.id)
      .eq('template_option_id', o.Large)
      .select('id')
      .single()
      .throwOnError();
    const { data: own } = await supabaseAdmin
      .from('modifier_groups')
      .insert({ store_id: northId, name: 'House sugar', min_select: 0, max_select: 1 })
      .select('id')
      .single()
      .throwOnError();
    const chaiCopy = (
      await supabaseAdmin
        .from('menu_items')
        .select('id')
        .eq('store_id', northId)
        .eq('template_item_id', chai)
        .single()
        .throwOnError()
    ).data.id;
    await link(chaiCopy, own.id, 9);
    // The template: Size renamed, Oat added, Ginger archived, Add-ons no longer offered with toast.
    await supabaseAdmin
      .from('modifier_groups')
      .update({ name: 'Cup' })
      .eq('id', g.Size)
      .throwOnError();
    await supabaseAdmin
      .from('modifier_options')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', o.Ginger)
      .throwOnError();
    await supabaseAdmin
      .from('modifier_options')
      .insert({ group_id: g.Size, name: 'Oat', price_delta_paise: 1500, sort_order: 3 })
      .throwOnError();
    await supabaseAdmin
      .from('menu_item_modifier_groups')
      .delete()
      .eq('menu_item_id', toast)
      .eq('group_id', g['Add-ons'])
      .throwOnError();

    const res = await push({ itemIds: [chai, toast], storeIds: [northId], fields: ['modifiers'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 2 });

    const groups = await copied(northId, chai);
    expect(groups.map((x) => x.name)).toEqual(['Cup', 'Add-ons', 'House sugar']);
    expect(groups[1]!.modifier_options.map((x) => x.name)).toEqual(['Honey']);
    expect(
      groups[0]!.modifier_options.map((x) => [x.name, x.price_delta_paise, x.is_available]),
    ).toEqual([
      ['Large', 2500, false],
      ['Oat', 1500, true],
      ['Small', 0, true],
    ]);
    // The same row, overwritten in place, not a second copy.
    expect(await groupCopies(northId, g.Size)).toEqual([{ id: sizeCopy!.id }]);
    const { data: large } = await supabaseAdmin
      .from('modifier_options')
      .select('id')
      .eq('id', largeCopy.id)
      .is('archived_at', null)
      .throwOnError();
    expect(large).toHaveLength(1);
    // Toast shares the group copy, so it shows the new name too, and no longer offers Add-ons.
    expect((await copied(northId, toast)).map((x) => x.name)).toEqual(['Cup']);

    const { data: events } = await supabaseAdmin
      .from('domain_events')
      .select('store_id')
      .eq('type', 'menu.changed')
      .eq('request_id', String(res.headers['x-request-id']))
      .throwOnError();
    expect(events.map((e) => e.store_id)).toEqual([northId]);
  });

  it('a repeat changes nothing, answers 0 and announces nothing', async () => {
    const res = await push({ itemIds: [chai, toast], storeIds: [northId], fields: ['modifiers'] });
    expect(res.body).toEqual({ updated: 0 });
    const { data: events } = await supabaseAdmin
      .from('domain_events')
      .select('id')
      .eq('request_id', String(res.headers['x-request-id']))
      .throwOnError();
    expect(events).toHaveLength(0);
  });

  it("gives a branch's new copy its groups without `modifiers`, reusing the branch's group copies as they are", async () => {
    // The template changes Size after the last push: chai's copy shares that group, and nobody pushed `modifiers`.
    await supabaseAdmin
      .from('modifier_options')
      .update({ price_delta_paise: 3000 })
      .eq('id', o.Large)
      .throwOnError();
    await supabaseAdmin
      .from('modifier_options')
      .insert({ group_id: g.Size, name: 'Soy', price_delta_paise: 1000, sort_order: 4 })
      .throwOnError();
    const tea = await item('Tea');
    await link(tea, g.Size, 1);
    const res = await push({ itemIds: [tea], storeIds: [northId], fields: ['price'] });
    expect(res.body).toEqual({ updated: 1 });
    expect((await copied(northId, tea)).map((x) => x.name)).toEqual(['Cup']);
    expect(await groupCopies(northId, g.Size)).toHaveLength(1);
    const size = (await copied(northId, chai))[0]!.modifier_options;
    expect(size.map((x) => [x.name, x.price_delta_paise])).toEqual([
      ['Large', 2500],
      ['Oat', 1500],
      ['Small', 0],
    ]);
  });

  it('two pushes at once of items sharing a group leave one copy of it in a new branch', async () => {
    const southId = await openBranch(`mods-south-${tag}`);
    await supabaseAdmin.from('modifier_groups').delete().eq('store_id', southId).throwOnError();
    const [a, b] = await Promise.all([
      push({ itemIds: [chai], storeIds: [southId], fields: ['modifiers'] }),
      push({ itemIds: [toast], storeIds: [southId], fields: ['modifiers'] }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await groupCopies(southId, g.Size)).toHaveLength(1);
  });
});
