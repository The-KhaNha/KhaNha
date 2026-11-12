import { useEffect } from 'react';
import { fetchMenu } from '../../services/menu';
import { useResource } from '../../lib/useResource';
import { useCartStore } from '../cart/cartStore';

/**
 * Loads the menu once, with error + retry. Every load also refreshes the cart's stock limits
 * (never its prices) and hands the store's limits to the cart and the stock pill, so a line that sold out meanwhile is flagged before the customer tries to pay.
 */
export function useMenu() {
  const { data, isLoading, error, reload } = useResource(fetchMenu, { key: 'menu', persist: true });

  useEffect(() => {
    if (!data) return;
    const cart = useCartStore.getState();
    cart.setLimits(data.rules);
    cart.syncAvailability(data.categories.flatMap((category) => category.items));
  }, [data]);

  return { menu: data, isLoading, error, retry: reload };
}
