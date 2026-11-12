import { useCallback } from 'react';
import type { OrderStatus } from '../../types/api';
import { fetchOrders, fetchStoreOrders } from '../../services/orders';
import { useResource } from '../../lib/useResource';
import { useConfig } from '../config/useConfig';

interface UseOrdersOptions {
  status?: OrderStatus;
  /** The staff board of this store (`GET /api/stores/:storeId/orders`); without it, the signed-in customer's own. */
  storeId?: string;
  /** Whose list: the customer's own (config `polling.ordersMs`) or the staff board (`polling.staffBoardMs`). */
  audience?: 'customer' | 'staff';
}

/** Lists orders (own for customers, all for staff) and polls. */
export function useOrders({ status, storeId, audience = 'customer' }: UseOrdersOptions = {}) {
  const { polling } = useConfig();
  const pollMs = audience === 'staff' ? polling.staffBoardMs : polling.ordersMs;
  const fetcher = useCallback(
    () => (storeId ? fetchStoreOrders(storeId) : fetchOrders(status)),
    [storeId, status],
  );
  const { data, isLoading, error, reload, mutate, updatedAt } = useResource(fetcher, {
    key: `orders:${storeId ?? 'own'}:${status ?? 'all'}`,
    pollInterval: () => pollMs,
  });

  return { orders: data, isLoading, error, retry: reload, mutate, updatedAt };
}
