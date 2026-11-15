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

  // Stock is synced once per menu load: a later lines change must not undo a checkout correction (setAvailability).
  useEffect(() => {
    if (!data) return;
    const cart = useCartStore.getState();
    if (cartHoldsOtherStore(cart, data.store.id)) return;
    cart.setLimits(data.rules);
    cart.syncAvailability(
      data.categories.flatMap((category) => category.items),
      data.modifierGroups,
    );
  }, [data]);

  // Lines that arrive later (another tab's cart rehydrated into this one) get only their choices checked.
  // syncOptions hands back the same state when nothing changed, so this settles after one pass.
  const lines = useCartStore((s) => s.lines);
  useEffect(() => {
    if (!data) return;
    const cart = useCartStore.getState();
    if (cartHoldsOtherStore(cart, data.store.id)) return;
    cart.syncOptions(
      data.categories.flatMap((category) => category.items),
      data.modifierGroups,
    );
  }, [data, lines]);

  return { menu: data, isLoading, error, retry: reload };
}
