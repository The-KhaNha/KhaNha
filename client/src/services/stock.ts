import type { ManagedMenuItem, StockList, StockMovement } from '../types/api';
import { request } from './api';

const base = (storeId: string, tail: string) => `/stores/${encodeURIComponent(storeId)}${tail}`;

/** One change: a new count, a change by some units (WASTE when thrown away), or no longer counted. */
export type StockChange =
  { set: number } | { adjust: number; reason?: 'MANUAL_ADJUST' | 'WASTE' } | { untracked: true };

export const fetchStock = (storeId: string) => request<StockList>(base(storeId, '/stock'));

/** Answers the stock afterwards (null: no longer counted). */
export const changeStock = async (storeId: string, itemId: string, change: StockChange) =>
  (
    await request<{ stockQuantity: ManagedMenuItem['stockQuantity'] }>(
      base(storeId, `/menu-items/${encodeURIComponent(itemId)}/stock`),
      { method: 'PATCH', body: change },
    )
  ).stockQuantity;

export const fetchStockMovements = async (storeId: string, itemId: string) =>
  (
    await request<{ movements: StockMovement[] }>(
      base(storeId, `/stock-movements?itemId=${encodeURIComponent(itemId)}`),
    )
  ).movements;
