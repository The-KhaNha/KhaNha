import { Navigate } from 'react-router-dom';
import { Store as StoreIcon } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { StoreCard, StoreCardSkeleton } from '../components/StoreCard';
import { HomeHero } from '../features/stores/HomeHero';
import { groupByArea } from '../features/stores/storeRules';
import { useStores } from '../features/stores/useStores';

/**
 * `/`: the stores, grouped by area, over the paprika field. With one active store there is nothing to choose, so the
 * visitor goes straight to its page.
 */
export function StoreListPage() {
  const { stores, isLoading, error, retry, updatedAt } = useStores();

  // Only on a fresh answer: leaving on a saved one would drop the refresh, and the saved list would never learn of a
  // second store.
  if (stores?.length === 1 && updatedAt !== null)
    return <Navigate to={`/s/${stores[0]!.slug}`} replace />;

  return (
    <div className="pb-6">
      <HomeHero />
      <div className="relative -mt-14">
        {isLoading ? (
          <div className="space-y-3" aria-busy aria-label="Loading stores">
            {[0, 1, 2].map((i) => (
              <StoreCardSkeleton key={i} variant="compact" />
            ))}
          </div>
        ) : error && !stores?.length ? (
          <ErrorState
            compact
            title="Unable to load the stores."
            message={error.message}
            onRetry={retry}
            unreachable={error.isUnreachable}
          />
        ) : stores && stores.length === 0 ? (
          <EmptyState
            icon={StoreIcon}
            title="No stores are open for ordering."
            description="Check back in a little while."
          />
        ) : (
          stores && (
            <>
              {/* Saved copy shown, refresh failed: keep it, but say so. */}
              {error && (
                <ErrorState
                  compact
                  className="mb-3"
                  title="Showing saved stores"
                  message="We couldn't refresh them just now."
                  retryLabel="Retry"
                  onRetry={retry}
                  unreachable={error.isUnreachable}
                />
              )}
              {groupByArea(stores).map((group, g) => (
                <section
                  key={group.area === null ? 'no-area' : `area:${group.area}`}
                  className={g > 0 ? 'mt-6' : undefined}
                >
                  {group.area && <h2 className="eyebrow mb-3 text-muted">{group.area}</h2>}
                  <ul className="space-y-3">
                    {group.stores.map((store, i) => (
                      <li key={store.id}>
                        <StoreCard variant="compact" store={store} priority={g === 0 && i === 0} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )
        )}
      </div>
    </div>
  );
}
