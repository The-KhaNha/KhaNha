import type { PricingGroup } from '../domain/pricing';
import { supabaseAdmin } from '../utils/supabase';

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
/** Item ids per query: 100 uuids keep the request URL short, and their links stay far below the 1000-row cap. */
const ITEMS_PER_QUERY = 100;

export async function loadItemModifiers(
  storeId: string,
  itemIds: string[],
): Promise<ItemModifiers> {
  const result: ItemModifiers = { groupIds: new Map(), groups: new Map() };
  const chunks = Array.from({ length: Math.ceil(itemIds.length / ITEMS_PER_QUERY) }, (_, i) =>
    itemIds.slice(i * ITEMS_PER_QUERY, (i + 1) * ITEMS_PER_QUERY),
  );
  const pages = await Promise.all(
    chunks.map(
      async (ids) =>
        (
          await supabaseAdmin
            .from('menu_item_modifier_groups')
            .select(
              `menu_item_id, sort_order,
               modifier_groups!inner (id, name, min_select, max_select, sort_order, store_id, archived_at,
                 modifier_options (id, name, price_delta_paise, is_default, is_available, sort_order, archived_at))`,
            )
            .in('menu_item_id', ids)
            .eq('modifier_groups.store_id', storeId)
            .is('modifier_groups.archived_at', null)
            .throwOnError()
        ).data,
    ),
  );
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
    if (!result.groups.has(g.id))
      result.groups.set(g.id, {
        id: g.id,
        name: g.name,
        minSelect: g.min_select,
        maxSelect: g.max_select,
        options: g.modifier_options
          .filter((o) => o.archived_at === null)
          .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
          .map((o) => ({
            id: o.id,
            name: o.name,
            priceDeltaPaise: o.price_delta_paise,
            isDefault: o.is_default,
            isAvailable: o.is_available,
          })),
      });
    const ids = result.groupIds.get(link.menu_item_id) ?? [];
    ids.push(g.id);
    result.groupIds.set(link.menu_item_id, ids);
  }
  return result;
}
