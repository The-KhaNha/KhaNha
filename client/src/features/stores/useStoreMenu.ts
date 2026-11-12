import { useEffect } from 'react';
import { fetchStoreMenu } from '../../services/stores';
import { useResource } from '../../lib/useResource';
import { useCartStore } from '../cart/cartStore';
import { cartHoldsOtherStore } from './storeRules';

/**
 * A store's menu (`/s/:storeSlug/menu`). Like useMenu, every load hands the store's limits to the cart and flags lines
 * that sold out. Keyed by the ref in the URL: the id is not known until the first answer. Another store's menu never touches the cart.
 */
export function useStoreMenu(storeRef: string, enabled = true) {
  const { data, isLoading, error, reload } = useResource(() => fetchStoreMenu(storeRef), {
    key: `menu:${storeRef}`,
    persist: true,
    enabled,
  });

  useEffect(() => {
    if (!data) return;
    const cart = useCartStore.getState();
    if (cartHoldsOtherStore(cart, data.store.id)) return;
    const items = data.categories.flatMap((category) => category.items);
    cart.setLimits(data.rules);
    cart.syncAvailability(items);
  }, [data]);

  return { menu: data, isLoading, error, retry: reload };
}
