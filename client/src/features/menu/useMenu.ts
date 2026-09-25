import { useEffect } from 'react';
import { fetchMenu } from '../../services/menu';
import { useResource } from '../../lib/useResource';
import { useCartStore } from '../cart/cartStore';

/**
 * Loads the menu once, with error + retry. Every load also refreshes the cart's stock limits
 * (never its prices), so a line that sold out meanwhile is flagged before the customer tries to pay.
 */
export function useMenu() {
  const { data, isLoading, error, reload } = useResource(fetchMenu, { key: 'menu' });

  useEffect(() => {
    if (data) useCartStore.getState().syncAvailability(data.categories.flatMap((category) => category.items));
  }, [data]);

  return { menu: data, isLoading, error, retry: reload };
}
