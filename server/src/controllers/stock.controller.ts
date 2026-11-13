import type { RequestHandler } from 'express';
import { currentStore, requestContext } from '../middleware/auth';
import type { AdjustStockInput, StockMovementsQuery } from '../schemas/stock.schema';
import * as stockService from '../services/stock.service';
import type { BodyHandler } from '../types/http';
import { toStockMovementDto } from '../utils/serializers';

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

/** GET /api/stores/:storeId/stock-movements?itemId=: the newest movements, of one item when given. */
export const listStockMovements: RequestHandler = async (req, res) => {
  const { itemId } = req.query as StockMovementsQuery;
  const rows = await stockService.listStockMovements(currentStore(req).id, itemId);
  res.json({ movements: rows.map(toStockMovementDto) });
};
