import { Navigate } from 'react-router-dom';
import { StoreCardSkeleton } from '../../components/StoreCard';
import { useCartStore } from '../cart/cartStore';
import { useStores } from './useStores';

/**
 * The old `/menu` (links in the cart, orders and checkout screens, bookmarks): the menu of the store the cart holds
 * items from; with an empty cart, the one active store's menu; else the list.
 */
export function MenuRedirect() {
  const { stores, isLoading } = useStores();
  const cartSlug = useCartStore((s) => (s.lines.length > 0 ? s.storeSlug : null));
  if (cartSlug) return <Navigate to={`/s/${cartSlug}/menu`} replace />;
  if (isLoading)
    return (
      <div className="space-y-3 p-4" aria-busy aria-label="Loading stores">
        {[0, 1, 2].map((i) => (
          <StoreCardSkeleton key={i} variant="compact" />
        ))}
      </div>
    );
  return <Navigate to={stores?.length === 1 ? `/s/${stores[0]!.slug}/menu` : '/'} replace />;
}
