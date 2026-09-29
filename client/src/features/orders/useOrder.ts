import { useCallback } from 'react';
import type { Order } from '../../types/api';
import { fetchOrder } from '../../services/orders';
import { useResource } from '../../lib/useResource';
import { useConfig } from '../config/useConfig';
import { isTerminal } from './orderStatus';

/** Fetches one order and polls (config `polling.orderMs`) until it reaches a terminal status. */
export function useOrder(id: string | undefined, initialData: Order | null = null) {
  const { polling } = useConfig();
  const fetcher = useCallback(() => {
    if (!id) return Promise.reject(new Error('Missing order id'));
    return fetchOrder(id);
  }, [id]);

  const { data, isLoading, error, reload, mutate } = useResource(fetcher, {
    key: `order:${id ?? ''}`,
    initialData: initialData && initialData.id === id ? initialData : null,
    pollInterval: (order) => (isTerminal(order.status) ? null : polling.orderMs),
    enabled: Boolean(id),
  });

  return { order: data, isLoading, error, retry: reload, mutate };
}
