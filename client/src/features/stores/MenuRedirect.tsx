import { Navigate } from 'react-router-dom';
import { StoreCardSkeleton } from '../../components/StoreCard';
import { useStores } from './useStores';

/**
 * The old `/menu` (links in the cart, orders and checkout screens, bookmarks): with one active store, its menu; else
 * the list. ponytail: the cart's own store takes over here once a cart belongs to a store (P2 PR 12).
 */
export function MenuRedirect() {
  const { stores, isLoading } = useStores();
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
