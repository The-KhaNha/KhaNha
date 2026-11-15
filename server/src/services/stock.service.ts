import { LIMITS } from '../schemas/limits';
import type { AdjustStockInput } from '../schemas/stock.schema';
import type { RequestContext } from '../types/auth';
import { notFound, stockBelowZero, validationError } from '../utils/errors';
import { isUuid } from '../utils/ids';
import type { StockMovementRow } from '../utils/serializers';
import { raisedByDatabase, supabaseAdmin } from '../utils/supabase';
import { invalidateMenus } from './menu.service';

/** The newest movements GET /stock-movements returns: the recent trail, not a report (P7.1 builds those). */
export const STOCK_MOVEMENTS_MAX = 50;

/**
 * Changes one item's stock by hand through adjust_stock, which writes the movement and the event. Returns the stock
 * afterwards (null: not tracked). Another store's or an archived item is 404.
 */
export async function adjustStock(
  storeId: string,
  itemId: string,
  input: AdjustStockInput,
  ctx: RequestContext,
): Promise<number | null> {
  if (!isUuid(itemId)) throw notFound('Item not found.');
  let stock: number | null;
  try {
    const { data } = await supabaseAdmin
      .rpc('adjust_stock', {
        p_store_id: storeId,
        p_menu_item_id: itemId.toLowerCase(),
        p_set: input.set,
        p_delta: input.adjust,
        p_untracked: input.untracked ?? false,
        p_reason: input.reason,
        p_actor: ctx.actor,
        p_request_id: ctx.requestId,
      })
      .throwOnError();
    stock = data;
  } catch (err) {
    if (raisedByDatabase(err, 'NOT_FOUND')) throw notFound('Item not found.');
    if (raisedByDatabase(err, 'STOCK_TOO_HIGH'))
      throw validationError(`Stock can be at most ${LIMITS.menuItem.stockMax}.`, 'adjust');
    // zod refuses these first; the function checks the same rules, so this is only a backstop.
    if (raisedByDatabase(err, 'VALIDATION_ERROR'))
      throw validationError('That stock change is not valid.', 'set');
    if (raisedByDatabase(err, 'STOCK_UNTRACKED'))
      throw validationError("This item's stock is not counted. Set a number first.", 'adjust');
    const short = raisedByDatabase(err, 'INSUFFICIENT_STOCK');
    if (short)
      throw stockBelowZero(String(short.menuItemId), String(short.name), Number(short.available));
    throw err;
  }
  invalidateMenus(storeId);
  return stock;
}

/** The store's newest stock movements, of one item when `itemId` is given, with who made each. */
export async function listStockMovements(
  storeId: string,
  itemId?: string,
): Promise<StockMovementRow[]> {
  let query = supabaseAdmin
    .from('stock_movements')
    .select(
      'id, menu_item_id, delta, resulting_quantity, reason, created_at, actor:profiles!stock_movements_actor_id_fkey(id, name)',
    )
    .eq('store_id', storeId);
  if (itemId) query = query.eq('menu_item_id', itemId.toLowerCase());
  const { data } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(STOCK_MOVEMENTS_MAX)
    .throwOnError();
  return data;
}
