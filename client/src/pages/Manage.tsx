import { Navigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Skeleton } from '../components/Skeleton';
import { StoreCard } from '../components/StoreCard';
import { useAuthStore } from '../features/auth/authStore';
import { managedStores } from '../features/manage/manageRules';
import { useStores } from '../features/stores/useStores';

/** `/manage`: the stores this account manages. One goes straight to it; none is a dead end. */
export function ManagePage() {
  const user = useAuthStore((s) => s.user);
  const { stores, isLoading, error, retry, updatedAt } = useStores();
  const mine = user && stores ? managedStores(user, stores) : null;

  // Only on a fresh answer, as on `/`: a saved list must not decide who manages what.
  if (mine?.length === 1 && updatedAt !== null)
    return <Navigate to={`/manage/${mine[0]!.slug}`} replace />;

  if (!user || (isLoading && !stores))
    return (
      <div className="space-y-3 pt-4" aria-busy aria-label="Loading your stores">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  if (error && !mine?.length)
    return (
      <ErrorState
        compact
        title="Unable to load your stores."
        message={error.message}
        onRetry={retry}
        unreachable={error.isUnreachable}
      />
    );
  if (!mine?.length)
    return (
      <EmptyState
        icon={Lock}
        tone="neutral"
        title="No stores to manage"
        description="You are not an owner or manager of any store. Ask the store's owner to invite you."
      />
    );

  return (
    <ul className="space-y-3 pt-4">
      {mine.map((store) => (
        <li key={store.id}>
          <StoreCard variant="compact" store={store} to={`/manage/${store.slug}`} />
        </li>
      ))}
    </ul>
  );
}
