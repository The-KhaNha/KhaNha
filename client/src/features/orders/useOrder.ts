import { useCallback } from 'react';
import type { Order } from '../../types/api';
import { fetchOrder } from '../../services/orders';
import { useResource } from '../../lib/useResource';
import { isTerminal } from './orderStatus';

const POLL_MS = 4000;

/** Fetches one order and polls every 4s until it reaches a terminal status. */
export function useOrder(id: string | undefined, initialData: Order | null = null) {
  const fetcher = useCallback(() => {
    if (!id) return Promise.reject(new Error('Missing order id'));
    return fetchOrder(id);
  }, [id]);

  const { data, isLoading, error, reload, mutate } = useResource(fetcher, {
    key: `order:${id ?? ''}`,
    initialData: initialData && initialData.id === id ? initialData : null,
    pollInterval: (order) => (isTerminal(order.status) ? null : POLL_MS),
    enabled: Boolean(id),
  });

  return { order: data, isLoading, error, retry: reload, mutate };
}
