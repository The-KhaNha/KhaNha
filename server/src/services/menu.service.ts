import type { MenuCategoryDto, MenuItemDto, MenuResponse } from '../types/api';
import { supabaseAdmin } from '../utils/supabase';
import { toMenuItemDto, toStoreDto } from '../utils/serializers';
import { getStore } from './store.service';

/** Full menu including unavailable items (the client greys them out). */
export async function getMenu(): Promise<MenuResponse> {
  const store = await getStore();
  const { data: rows } = await supabaseAdmin
    .from('menu_items')
    .select()
    .eq('store_id', store.id)
    .order('sort_order')
    .throwOnError();
  const items = rows.map(toMenuItemDto);

  return {
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
