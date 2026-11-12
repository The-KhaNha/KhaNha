import { useCartStore } from '../cart/cartStore';
import { useStoreMenu } from '../stores/useStoreMenu';

/**
 * The menu of the cart's store (Cart and Checkout), with error + retry; every load refreshes the cart's stock limits
 * (never its prices). An empty cart names no store: nothing loads.
 */
export function useMenu() {
  const storeSlug = useCartStore((s) => s.storeSlug);
  return useStoreMenu(storeSlug ?? '', storeSlug !== null);
}
