import type { CreateMenuItemInput, UpdateMenuItemInput } from '../schemas/menuItem.schema';
import type { RequestContext } from '../types/auth';
import type { MenuCategoryDto, MenuItemDto, MenuResponse } from '../types/api';
import type { Tables, TablesUpdate } from '../types/database';
import { cached, invalidate, PUBLIC_READ_TTL_MS } from '../utils/cache';
import { notFound } from '../utils/errors';
import { isUuid } from '../utils/ids';
import { logger } from '../utils/logger';
import { rupeesToPaise } from '../utils/money';
import { supabaseAdmin } from '../utils/supabase';
import { toMenuItemDto, toStoreDto, type StoreWithBrand } from '../utils/serializers';
import { getOpenFields } from './schedule.service';

/**
 * Most items one menu response carries (docs/CONFIGURATION.md, platform constant). A campus café lists tens; the cap
 * keeps a runaway import from turning the menu into a multi-megabyte payload on a metered connection. Pagination
 * arrives with the multi-branch catalog (P3.1).
 */
export const MENU_ITEMS_MAX = 500;

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

/** Drops the store's cached menu: stock changed through this API (an order placed or cancelled). */
export function invalidateMenus(storeId: string): void {
  invalidate(`menu:${storeId}`);
}

async function loadMenu(store: StoreWithBrand): Promise<MenuResponse> {
  // id breaks sort_order ties (an import leaves every row at the default 0), so the cut is the same on every load.
  const { data: rows, count } = await supabaseAdmin
    .from('menu_items')
    .select('*', { count: 'exact' })
    .eq('store_id', store.id)
    .is('archived_at', null)
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

/**
 * Most items the editor's list returns: archived items stay in it, so it may run past MENU_ITEMS_MAX. PostgREST's
 * own row cap (1000) would cut it silently anyway.
 */
export const MANAGED_ITEMS_MAX = 1000;

/** Every item of the store for the editor, archived ones included. Never cached: the editor must see its own write. */
export async function listManagedItems(storeId: string): Promise<Tables<'menu_items'>[]> {
  const { data, count } = await supabaseAdmin
    .from('menu_items')
    .select('*', { count: 'exact' })
    .eq('store_id', storeId)
    .order('sort_order')
    .order('id')
    .limit(MANAGED_ITEMS_MAX)
    .throwOnError();
  if (count !== null && count > MANAGED_ITEMS_MAX) {
    logger.warn({ storeId, total: count, shown: MANAGED_ITEMS_MAX }, 'Managed menu truncated');
  }
  return data;
}

/** The fields both writes share, in row form; undefined stays undefined, so an edit changes only what was sent. */
function toRow(input: UpdateMenuItemInput): TablesUpdate<'menu_items'> {
  return {
    name: input.name,
    description: input.description,
    price_paise: input.price === undefined ? undefined : rupeesToPaise(input.price),
    category: input.category,
    diet: input.diet,
    is_popular: input.isPopular,
    is_available: input.isAvailable,
  };
}

/**
 * The sort_order that puts an item last in `category`, or last on the menu for a new category. A category's place is
 * its first item's (groupByCategory), so an item keeping its old place in a new category could move the whole category.
 */
async function lastPlaceIn(storeId: string, category: string): Promise<number> {
  const last = async (inCategory: boolean) => {
    let query = supabaseAdmin
      .from('menu_items')
      .select('sort_order')
      .eq('store_id', storeId)
      .is('archived_at', null);
    if (inCategory) query = query.eq('category', category);
    const { data } = await query
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
      .throwOnError();
    return data?.sort_order;
  };
  return ((await last(true)) ?? (await last(false)) ?? 0) + 1;
}

/** A new item, last in its category (a new category goes last on the menu). It has no photo until one is uploaded. */
export async function createMenuItem(
  storeId: string,
  input: CreateMenuItemInput,
  ctx: RequestContext,
): Promise<Tables<'menu_items'>> {
  const { data } = await supabaseAdmin
    .from('menu_items')
    .insert({
      ...toRow(input),
      name: input.name,
      description: input.description,
      price_paise: rupeesToPaise(input.price),
      category: input.category,
      stock_quantity: input.stockQuantity,
      store_id: storeId,
      sort_order: await lastPlaceIn(storeId, input.category),
    })
    .select('*')
    .single()
    // The audit and menu.changed triggers read who and which request from these.
    .setHeader('x-actor', JSON.stringify(ctx.actor))
    .setHeader('x-request-id', ctx.requestId)
    .throwOnError();
  invalidateMenus(storeId);
  return data;
}

/** Edits one of this store's items. Another store's item, an unknown id or an archived item (read-only) is 404. */
export async function updateMenuItem(
  storeId: string,
  itemId: string,
  input: UpdateMenuItemInput,
  ctx: RequestContext,
): Promise<Tables<'menu_items'>> {
  if (!isUuid(itemId)) throw notFound('Item not found.');
  const row = toRow(input);
  if (input.category !== undefined) {
    const { data: current } = await supabaseAdmin
      .from('menu_items')
      .select('category')
      .eq('id', itemId)
      .eq('store_id', storeId)
      .maybeSingle()
      .throwOnError();
    if (current && current.category !== input.category) {
      row.sort_order = await lastPlaceIn(storeId, input.category);
    }
  }
  const { data } = await supabaseAdmin
    .from('menu_items')
    .update(row)
    .eq('id', itemId)
    .eq('store_id', storeId)
    .is('archived_at', null)
    .select('*')
    .maybeSingle()
    .setHeader('x-actor', JSON.stringify(ctx.actor))
    .setHeader('x-request-id', ctx.requestId)
    .throwOnError();
  if (!data) throw notFound('Item not found.');
  invalidateMenus(storeId);
  return data;
}

/**
 * Archives one of this store's items: it leaves the menu and is switched off (a check constraint keeps it off), and
 * the row stays for the orders and copies that point at it. Archiving it again changes nothing; another store's item
 * or an unknown id is 404.
 */
export async function archiveMenuItem(
  storeId: string,
  itemId: string,
  ctx: RequestContext,
): Promise<void> {
  if (!isUuid(itemId)) throw notFound('Item not found.');
  const { data } = await supabaseAdmin
    .from('menu_items')
    .update({ archived_at: new Date().toISOString(), is_available: false })
    .eq('id', itemId)
    .eq('store_id', storeId)
    .is('archived_at', null)
    .select('id')
    .maybeSingle()
    .setHeader('x-actor', JSON.stringify(ctx.actor))
    .setHeader('x-request-id', ctx.requestId)
    .throwOnError();
  if (data) {
    invalidateMenus(storeId);
    return;
  }
  const { data: existing } = await supabaseAdmin
    .from('menu_items')
    .select('id')
    .eq('id', itemId)
    .eq('store_id', storeId)
    .maybeSingle()
    .throwOnError();
  if (!existing) throw notFound('Item not found.');
}
