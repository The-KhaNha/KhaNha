import type { RequestHandler } from 'express';
import { currentStore, requestContext } from '../middleware/auth';
import type { AdjustStockInput, StockMovementsQuery } from '../schemas/stock.schema';
import * as menuService from '../services/menu.service';
import * as stockService from '../services/stock.service';
import { getStoreById } from '../services/store.service';
import type { BodyHandler } from '../types/http';
import { toManagedMenuItemDto, toStockMovementDto } from '../utils/serializers';

// Stock by hand (P3.4, P3.5), every route after requireStore('stock.update').

/** PATCH /api/stores/:storeId/menu-items/:itemId/stock: answers the stock afterwards (null: not tracked). */
export const adjustStock: BodyHandler<AdjustStockInput> = async (req, res) => {
  const stockQuantity = await stockService.adjustStock(
    currentStore(req).id,
    String(req.params.itemId),
    req.body,
    requestContext(req),
  );
  res.json({ stockQuantity });
};

/**
 * GET /api/stores/:storeId/stock: the live items with their stock, and the store's low-stock threshold. Its own read,
 * not the editor's list (menu.edit) or the public menu (cached, and never a draft branch's): staff need it too.
 */
export const listStock: RequestHandler = async (req, res) => {
  const store = currentStore(req);
  const [items, row] = await Promise.all([
    menuService.listManagedItems(store.id),
    getStoreById(store.id),
  ]);
  res.json({
    items: items.filter((i) => i.archived_at === null).map(toManagedMenuItemDto),
    lowStockThreshold: row.low_stock_threshold,
  });
};

/** GET /api/stores/:storeId/stock-movements?itemId=: the newest movements, of one item when given. */
export const listStockMovements: RequestHandler = async (req, res) => {
  const { itemId } = req.query as StockMovementsQuery;
  const rows = await stockService.listStockMovements(currentStore(req).id, itemId);
  res.json({ movements: rows.map(toStockMovementDto) });
};
