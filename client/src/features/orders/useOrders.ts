import { useCallback } from 'react';
import type { OrderStatus } from '../../types/api';
import { fetchOrders } from '../../services/orders';
import { useResource } from '../../lib/useResource';
import { useConfig } from '../config/useConfig';

interface UseOrdersOptions {
  status?: OrderStatus;
  /** Whose list: the customer's own (config `polling.ordersMs`) or the staff board (`polling.staffBoardMs`). */
  audience?: 'customer' | 'staff';
}

/** Lists orders (own for customers, all for staff) and polls. */
export function useOrders({ status, audience = 'customer' }: UseOrdersOptions = {}) {
  const { polling } = useConfig();
  const pollMs = audience === 'staff' ? polling.staffBoardMs : polling.ordersMs;
  const fetcher = useCallback(() => fetchOrders(status), [status]);
  const { data, isLoading, error, reload, mutate, updatedAt } = useResource(fetcher, {
    key: `orders:${status ?? 'all'}`,
    pollInterval: () => pollMs,
  });

  return { orders: data, isLoading, error, retry: reload, mutate, updatedAt };
}
