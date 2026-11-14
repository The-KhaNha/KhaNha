import type { PricingGroup } from '../domain/pricing';
import { MODIFIER_LIMITS } from '../schemas/limits';
import type { SaveModifierGroupInput } from '../schemas/modifier.schema';
import type { RequestContext } from '../types/auth';
import { notFound, validationError } from '../utils/errors';
import { isUuid } from '../utils/ids';
import { rupeesToPaise } from '../utils/money';
import { raisedByDatabase, supabaseAdmin } from '../utils/supabase';
import { invalidateMenus } from './menu.service';

/** A store's modifier groups an item offers, keyed by item, and the groups themselves (P3.2), all as pricing sees them. */
export interface ItemModifiers {
  /** Group ids per item id, in the item's order. */
  groupIds: Map<string, string[]>;
  groups: Map<string, PricingGroup>;
}

/**
 * The live (unarchived) groups of `itemIds`, each with its unarchived options in order: what the menu offers and what
 * an order line is priced against. Unavailable options stay (shown as sold out; refused if chosen).
 */
/** Item ids per query: 100 uuids keep the request URL short. */
const ITEMS_PER_QUERY = 100;
/** PostgREST's max_rows (supabase/config.toml): a longer result is cut without an error, so links are read in pages. */
const ROWS_PER_PAGE = 1000;

/** Every link of `ids` (with its group and options), page by page in a stable order until a short page. */
async function linksOf(storeId: string, ids: string[]) {
  const rows = [];
  for (let from = 0; ; from += ROWS_PER_PAGE) {
    const { data } = await supabaseAdmin
      .from('menu_item_modifier_groups')
      .select(
        `menu_item_id, group_id, sort_order,
         modifier_groups!inner (id, name, min_select, max_select, sort_order, store_id, archived_at,
           modifier_options (id, name, price_delta_paise, is_default, is_available, sort_order))`,
      )
      .in('menu_item_id', ids)
      .eq('modifier_groups.store_id', storeId)
      .is('modifier_groups.archived_at', null)
      // In the query, not after it: archived options grow with every edit and would count against max_rows.
      .is('modifier_groups.modifier_options.archived_at', null)
      .order('menu_item_id')
      .order('group_id')
      .range(from, from + ROWS_PER_PAGE - 1)
      .throwOnError();
    rows.push(...data);
    if (data.length < ROWS_PER_PAGE) return rows;
  }
}

export async function loadItemModifiers(
  storeId: string,
  itemIds: string[],
): Promise<ItemModifiers> {
  const result: ItemModifiers = { groupIds: new Map(), groups: new Map() };
  const chunks = Array.from({ length: Math.ceil(itemIds.length / ITEMS_PER_QUERY) }, (_, i) =>
    itemIds.slice(i * ITEMS_PER_QUERY, (i + 1) * ITEMS_PER_QUERY),
  );
  const pages = await Promise.all(chunks.map((ids) => linksOf(storeId, ids)));
  // An item's groups in the item's own order, then the group's, then by id: the same on every load, so the menu's
  // ETag holds.
  const links = pages
    .flat()
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        a.modifier_groups.sort_order - b.modifier_groups.sort_order ||
        a.modifier_groups.id.localeCompare(b.modifier_groups.id),
    );
  for (const link of links) {
    const g = link.modifier_groups;
    if (!result.groups.has(g.id)) result.groups.set(g.id, toPricingGroup(g));
    const ids = result.groupIds.get(link.menu_item_id) ?? [];
    ids.push(g.id);
    result.groupIds.set(link.menu_item_id, ids);
  }
  return result;
}

// The editor (P3.2, PR 14): every write is one SQL function (a group is never half-saved), and drops the store's menu.

/** A group row with its live options (every read filters archived ones in the query), in pricing's shape and order. */
function toPricingGroup(g: {
  id: string;
  name: string;
  min_select: number;
  max_select: number;
  modifier_options: {
    id: string;
    name: string;
    price_delta_paise: number;
    is_default: boolean;
    is_available: boolean;
    sort_order: number;
  }[];
}): PricingGroup {
  return {
    id: g.id,
    name: g.name,
    minSelect: g.min_select,
    maxSelect: g.max_select,
    options: g.modifier_options
      .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
      .map((o) => ({
        id: o.id,
        name: o.name,
        priceDeltaPaise: o.price_delta_paise,
        isDefault: o.is_default,
        isAvailable: o.is_available,
      })),
  };
}

const GROUP_COLUMNS = `id, name, min_select, max_select, sort_order,
  modifier_options (id, name, price_delta_paise, is_default, is_available, sort_order)`;

/**
 * The editor's read: the store's live groups in order, and which of them each item offers (archived items included,
 * as the item list shows them). At most MODIFIER_LIMITS.groupsPerStore groups; the links are read in pages.
 */
export async function listStoreModifiers(
  storeId: string,
): Promise<{ groups: PricingGroup[]; itemGroupIds: Record<string, string[]> }> {
  const { data: groups } = await supabaseAdmin
    .from('modifier_groups')
    .select(GROUP_COLUMNS)
    .eq('store_id', storeId)
    .is('archived_at', null)
    .is('modifier_options.archived_at', null)
    .order('sort_order')
    .order('id')
    .throwOnError();
  const itemGroupIds: Record<string, string[]> = {};
  for (let from = 0; ; from += ROWS_PER_PAGE) {
    const { data } = await supabaseAdmin
      .from('menu_item_modifier_groups')
      .select('menu_item_id, group_id, modifier_groups!inner (store_id, archived_at)')
      .eq('modifier_groups.store_id', storeId)
      .is('modifier_groups.archived_at', null)
      .order('menu_item_id')
      .order('sort_order')
      .order('group_id')
      .range(from, from + ROWS_PER_PAGE - 1)
      .throwOnError();
    for (const link of data) (itemGroupIds[link.menu_item_id] ??= []).push(link.group_id);
    if (data.length < ROWS_PER_PAGE) break;
  }
  return { groups: groups.map(toPricingGroup), itemGroupIds };
}

/** Creates (no groupId) or overwrites a group of the store with its options; returns it as saved. */
export async function saveModifierGroup(
  storeId: string,
  groupId: string | undefined,
  input: SaveModifierGroupInput,
  ctx: RequestContext,
): Promise<PricingGroup> {
  if (groupId !== undefined && !isUuid(groupId)) throw notFound('Group not found.');
  let id: string;
  try {
    const { data } = await supabaseAdmin
      .rpc('save_modifier_group', {
        p_store_id: storeId,
        p_group_id: groupId?.toLowerCase(),
        p_name: input.name,
        p_min_select: input.minSelect,
        p_max_select: input.maxSelect,
        p_options: input.options.map((o) => ({
          id: o.id?.toLowerCase() ?? null,
          name: o.name,
          priceDeltaPaise: rupeesToPaise(o.priceDelta),
          isDefault: o.isDefault,
          isAvailable: o.isAvailable,
        })),
        p_max_groups: MODIFIER_LIMITS.groupsPerStore,
        p_actor: ctx.actor,
        p_request_id: ctx.requestId,
      })
      .throwOnError();
    id = data;
  } catch (err) {
    if (raisedByDatabase(err, 'NOT_FOUND'))
      throw notFound(groupId ? 'Group or option not found.' : 'Option not found.');
    const refused = raisedByDatabase(err, 'VALIDATION_ERROR');
    if (refused?.reason === 'groups')
      throw validationError(
        `A store has at most ${MODIFIER_LIMITS.groupsPerStore} groups. Archive one first.`,
        'name',
      );
    if (refused?.reason === 'options')
      throw validationError(
        'minSelect is more than the options available: add or switch on options first.',
        'minSelect',
      );
    if (refused?.reason === 'defaults')
      throw validationError('More options are marked default than maxSelect allows.', 'options');
    throw err;
  }
  invalidateMenus(storeId);
  const { data } = await supabaseAdmin
    .from('modifier_groups')
    .select(GROUP_COLUMNS)
    .eq('id', id)
    .is('modifier_options.archived_at', null)
    .single()
    .throwOnError();
  return toPricingGroup(data);
}

/** Archives a group: the menu stops offering it; a repeat is a no-op. */
export async function archiveModifierGroup(
  storeId: string,
  groupId: string,
  ctx: RequestContext,
): Promise<void> {
  if (!isUuid(groupId)) throw notFound('Group not found.');
  try {
    await supabaseAdmin
      .rpc('archive_modifier_group', {
        p_store_id: storeId,
        p_group_id: groupId.toLowerCase(),
        p_actor: ctx.actor,
        p_request_id: ctx.requestId,
      })
      .throwOnError();
  } catch (err) {
    if (raisedByDatabase(err, 'NOT_FOUND')) throw notFound('Group not found.');
    throw err;
  }
  invalidateMenus(storeId);
}

/** Sets the groups an item offers, in order. */
export async function setItemModifierGroups(
  storeId: string,
  itemId: string,
  groupIds: string[],
  ctx: RequestContext,
): Promise<void> {
  if (!isUuid(itemId)) throw notFound('Item not found.');
  try {
    await supabaseAdmin
      .rpc('set_item_modifier_groups', {
        p_store_id: storeId,
        p_item_id: itemId.toLowerCase(),
        p_group_ids: groupIds.map((id) => id.toLowerCase()),
        p_actor: ctx.actor,
        p_request_id: ctx.requestId,
      })
      .throwOnError();
  } catch (err) {
    if (raisedByDatabase(err, 'NOT_FOUND')) throw notFound('Item or group not found.');
    throw err;
  }
  invalidateMenus(storeId);
}
