import { useCallback } from 'react';
import type { OrderStatus } from '../../types/api';
import { fetchOrders } from '../../services/orders';
import { useResource } from '../../lib/useResource';

interface UseOrdersOptions {
  status?: OrderStatus;
  /** Poll interval in ms. Defaults to 8s (customer list). */
  pollMs?: number;
}

/** Lists orders (own for customers, all for staff) and polls. */
export function useOrders({ status, pollMs = 8000 }: UseOrdersOptions = {}) {
  const fetcher = useCallback(() => fetchOrders(status), [status]);
  const { data, isLoading, error, reload, mutate, updatedAt } = useResource(fetcher, {
    key: `orders:${status ?? 'all'}`,
    pollInterval: () => pollMs,
  });

  return { orders: data, isLoading, error, retry: reload, mutate, updatedAt };
}
