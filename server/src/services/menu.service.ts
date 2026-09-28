import { MAX_QUANTITY_PER_ITEM } from '../schemas/order.schema';
import type { MenuCategoryDto, MenuItemDto, MenuResponse } from '../types/api';
import { cached, PUBLIC_READ_TTL_MS } from '../utils/cache';
import { supabaseAdmin } from '../utils/supabase';
import { toMenuItemDto, toStoreDto } from '../utils/serializers';
import { getStore } from './store.service';

/**
 * Cart rules the client applies (per-item cap, the "only N left" threshold). Server constants for now; per store in
 * P2.3, when the client stops mirroring them (cartRules.ts).
 */
const MENU_RULES = { maxQuantityPerItem: MAX_QUANTITY_PER_ITEM, lowStockThreshold: 5 } as const;

/**
 * Full menu including unavailable items (the client greys them out). Cached for PUBLIC_READ_TTL_MS; order.service
 * drops the cache whenever stock changes through this API (an order placed or cancelled).
 */
export function getMenu(): Promise<MenuResponse> {
  return cached('menu', PUBLIC_READ_TTL_MS, loadMenu);
}

async function loadMenu(): Promise<MenuResponse> {
  const store = await getStore();
  const { data: rows } = await supabaseAdmin
    .from('menu_items')
    .select()
    .eq('store_id', store.id)
    .order('sort_order')
    .throwOnError();
  const items = rows.map(toMenuItemDto);

  return {
    rules: MENU_RULES,
    store: toStoreDto(store),
    popular: items.filter((item) => item.isPopular),
    categories: groupByCategory(items),
  };
}

/** Items arrive sorted by sortOrder, so a category is positioned by its first (lowest) item. */
function groupByCategory(items: MenuItemDto[]): MenuCategoryDto[] {
  const groups = new Map<string, MenuItemDto[]>();
  for (const item of items) {
    const group = groups.get(item.category);
    if (group) group.push(item);
    else groups.set(item.category, [item]);
  }
  return [...groups].map(([name, categoryItems]) => ({ name, items: categoryItems }));
}
