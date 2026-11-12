import { useEffect } from 'react';
import { fetchStoreMenu } from '../../services/stores';
import { useResource } from '../../lib/useResource';
import { useCartStore } from '../cart/cartStore';

/**
 * A store's menu (`/s/:storeSlug/menu`). Like useMenu, every load hands the store's limits to the cart and flags lines
 * that sold out. Keyed by the ref in the URL: the id is not known until the first answer.
 */
export function useStoreMenu(storeRef: string) {
  const { data, isLoading, error, reload } = useResource(() => fetchStoreMenu(storeRef), {
    key: `menu:${storeRef}`,
    persist: true,
  });

  useEffect(() => {
    if (!data) return;
    const cart = useCartStore.getState();
    cart.setLimits(data.rules);
    cart.syncAvailability(data.categories.flatMap((category) => category.items));
  }, [data]);

  return { menu: data, isLoading, error, retry: reload };
}
