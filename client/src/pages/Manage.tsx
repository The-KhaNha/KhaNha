import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ChevronRight, Lock, Plus } from 'lucide-react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Skeleton } from '../components/Skeleton';
import { useAuthStore } from '../features/auth/authStore';
import { OpenBranch } from '../features/manage/OpenBranch';
import { pickerEntries, type PickerEntry } from '../features/manage/manageRules';
import { useMyBrands } from '../features/manage/useManage';
import { useStores } from '../features/stores/useStores';

function EntryLink({ entry }: { entry: PickerEntry }) {
  return (
    <Card padding="none">
      <Link
        to={`/manage/${entry.slug}`}
        className="flex min-h-14 items-center justify-between gap-3 rounded-card px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <span className="min-w-0">
          <span className="block truncate font-semibold">{entry.name}</span>
          {entry.note && <span className="block text-caption text-muted">{entry.note}</span>}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      </Link>
    </Card>
  );
}

/**
 * `/manage`: the stores this account manages. An owner sees each brand's template first, its branches at every status,
 * and "Open a branch"; a manager their stores; an admin the public ones. One store and nothing to open: straight to it.
 */
export function ManagePage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const owner = !!user && user.ownedBrands.length > 0;
  const brands = useMyBrands(owner);
  const { stores, isLoading, error, retry, updatedAt } = useStores();
  const [opening, setOpening] = useState<string | null>(null);
  const admin = user?.role === 'ADMIN';
  const rows = user ? pickerEntries(user, brands.data, admin ? stores : null) : [];
  const own = new Set(
    (brands.data ?? []).flatMap((b) => [b.template?.id, ...b.stores.map((s) => s.id)]),
  );
  const others = rows.filter((r) => !own.has(r.id));

  // An admin's list is the public one: only a fresh answer may decide (a saved list must not decide who manages what).
  if (!owner && rows.length === 1 && (!admin || updatedAt !== null))
    return <Navigate to={`/manage/${rows[0]!.slug}`} replace />;

  if (!user || (owner && brands.isLoading && !brands.data) || (admin && isLoading && !stores))
    return (
      <div className="space-y-3 pt-4" aria-busy aria-label="Loading your stores">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  const failure =
    owner && brands.error
      ? { error: brands.error, retry: brands.reload }
      : admin && error
        ? { error, retry }
        : null;
  if (failure && rows.length === 0)
    return (
      <ErrorState
        compact
        title="Unable to load your stores."
        message={failure.error.message}
        onRetry={failure.retry}
        unreachable={failure.error.isUnreachable}
      />
    );
  if (rows.length === 0 && !owner)
    return (
      <EmptyState
        icon={Lock}
        tone="neutral"
        title="No stores to manage"
        description="You are not an owner or manager of any store. Ask the store's owner to invite you."
      />
    );

  return (
    <div className="space-y-6 pt-4">
      {failure && (
        <ErrorState
          compact
          title="Showing saved stores"
          message="We couldn't refresh them just now."
          retryLabel="Retry"
          onRetry={failure.retry}
          unreachable={failure.error.isUnreachable}
        />
      )}
      {(brands.data ?? []).map((brand) => (
        <section key={brand.id} aria-label={brand.name}>
          <h2 className="mb-2 font-bold">{brand.name}</h2>
          <ul className="space-y-3">
            {rows
              .filter((r) => r.id === brand.template?.id || brand.stores.some((s) => s.id === r.id))
              .map((entry) => (
                <li key={entry.id}>
                  <EntryLink entry={entry} />
                </li>
              ))}
          </ul>
          {opening === brand.id ? (
            <OpenBranch
              brandId={brand.id}
              onCancel={() => setOpening(null)}
              onOpened={(store) => {
                brands.reload();
                navigate(`/manage/${store.slug}/profile`);
              }}
            />
          ) : (
            <Button
              variant="secondary"
              className="mt-3"
              iconLeft={<Plus className="h-4 w-4" aria-hidden />}
              onClick={() => setOpening(brand.id)}
            >
              Open a branch
            </Button>
          )}
        </section>
      ))}
      {others.length > 0 && (
        <ul className="space-y-3">
          {others.map((entry) => (
            <li key={entry.id}>
              <EntryLink entry={entry} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
