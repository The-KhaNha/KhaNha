import type { MenuCategoryDto, MenuItemDto, MenuResponse } from '../types/api';
import { cached, invalidate, PUBLIC_READ_TTL_MS } from '../utils/cache';
import { logger } from '../utils/logger';
import { supabaseAdmin } from '../utils/supabase';
import { toMenuItemDto, toStoreDto, type StoreWithBrand } from '../utils/serializers';
import { getOpenFields } from './schedule.service';
import { getCachedStore } from './store.service';

/**
 * Most items one menu response carries (docs/CONFIGURATION.md, platform constant). A campus café lists tens; the cap
 * keeps a runaway import from turning the menu into a multi-megabyte payload on a metered connection. Pagination
 * arrives with the multi-branch catalog (P3.1).
 */
export const MENU_ITEMS_MAX = 500;

/**
 * Full menu including unavailable items (the client greys them out). Cached for PUBLIC_READ_TTL_MS; order.service
 * drops the cache whenever stock changes through this API (an order placed or cancelled).
 */
export async function getMenu(): Promise<MenuResponse> {
  const store = await getCachedStore();
  return withOpenFields(await cached('menu', PUBLIC_READ_TTL_MS, () => loadMenu(store)), store);
}

/** The menu of one ACTIVE store (the caller resolved it through getActiveStore), cached under `menu:<storeId>`. */
export async function getStoreMenu(store: StoreWithBrand): Promise<MenuResponse> {
  return withOpenFields(
    await cached(`menu:${store.id}`, PUBLIC_READ_TTL_MS, () => loadMenu(store)),
    store,
  );
}

/** The open state changes with the clock, not with the menu: computed on every read, never cached with the menu. */
async function withOpenFields(menu: MenuResponse, store: StoreWithBrand): Promise<MenuResponse> {
  return { ...menu, store: { ...menu.store, ...(await getOpenFields(store)) } };
}

/** Drops the old single-store key and the store's own: stock changed through this API (an order placed or cancelled). */
export function invalidateMenus(storeId: string): void {
  invalidate('menu');
  invalidate(`menu:${storeId}`);
}

async function loadMenu(store: StoreWithBrand): Promise<MenuResponse> {
  // id breaks sort_order ties (an import leaves every row at the default 0), so the cut is the same on every load.
  const { data: rows, count } = await supabaseAdmin
    .from('menu_items')
    .select('*', { count: 'exact' })
    .eq('store_id', store.id)
    .order('sort_order')
    .order('id')
    .limit(MENU_ITEMS_MAX)
    .throwOnError();
  // The cap is a safety valve, not a feature: say so when it bites, or the missing items are a silent mystery. At
  // most once per cache load (PUBLIC_READ_TTL_MS), never per request.
  if (count !== null && count > MENU_ITEMS_MAX) {
    logger.warn({ storeId: store.id, total: count, shown: MENU_ITEMS_MAX }, 'Menu truncated');
  }
  const items = rows.map(toMenuItemDto);

  return {
    // The cart rules the client applies: the store's own cap and "only N left" threshold, off the store row (its
    // cache keys are dropped by updateStoreSettings with the menu's).
    rules: {
      maxQuantityPerItem: store.max_quantity_per_item,
      lowStockThreshold: store.low_stock_threshold,
    },
    store: toStoreDto(store, await getOpenFields(store)),
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
