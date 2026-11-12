import type { ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useParams } from 'react-router-dom';
import { Hourglass } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Skeleton } from '../components/Skeleton';
import { useAuthStore } from '../features/auth/authStore';
import { MANAGE_TABS, canEditSettings, canManage } from '../features/manage/manageRules';
import { useStoreByRef } from '../features/stores/useStores';
import { cn } from '../lib/cn';
import { ManageSettingsTab } from './ManageSettings';
import { ManageTeamTab } from './ManageTeam';
import { NotFoundPage } from './NotFound';

const ComingNext = () => (
  <EmptyState
    icon={Hourglass}
    tone="neutral"
    title="Coming next"
    description="This part of the store's management is on its way."
  />
);

/** `/manage/:storeSlug/*`: the tabs, for a store the account manages (anyone else gets the not-found page). */
export function ManageStorePage() {
  const { storeSlug = '' } = useParams();
  const user = useAuthStore((s) => s.user);
  const { store, isLoading, error, retry } = useStoreByRef(storeSlug);

  if (error?.status === 404 || (store && user && !canManage(user, store))) return <NotFoundPage />;
  if (error && !store)
    return (
      <ErrorState
        compact
        title="Unable to load the store."
        message={error.message}
        onRetry={retry}
        unreachable={error.isUnreachable}
      />
    );
  if (!store || !user || isLoading)
    return (
      <div className="pt-4" aria-busy aria-label="Loading the store">
        <Skeleton className="h-24" />
      </div>
    );

  // An admin holds no `settings.edit`: the tab is not offered (and its route is the not-found page).
  const tabs = MANAGE_TABS.filter((t) => t.path !== 'settings' || canEditSettings(user, store));
  const elements: Record<string, ReactNode> = {
    settings: <ManageSettingsTab storeId={store.id} />,
    team: <ManageTeamTab store={store} user={user} />,
  };

  return (
    <div className="pt-4">
      {error && (
        <ErrorState
          compact
          className="mb-3"
          title="Showing the saved store"
          message="We couldn't refresh it just now."
          retryLabel="Retry"
          onRetry={retry}
          unreachable={error.isUnreachable}
        />
      )}
      <h1 className="text-xl font-extrabold">{store.name}</h1>
      <nav aria-label="Manage" className="mt-3 flex gap-1 border-b border-line/70">
        {tabs.map(({ path, label }) => (
          <NavLink
            key={path}
            to={`/manage/${store.slug}/${path}`}
            className={({ isActive }) =>
              cn(
                'grid min-h-11 flex-1 place-items-center border-b-2 text-sm font-semibold',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
                isActive ? 'border-brand-600 text-brand-600' : 'border-transparent text-muted',
              )
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to="hours" replace />} />
        {tabs.map(({ path }) => (
          <Route key={path} path={path} element={elements[path] ?? <ComingNext />} />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  );
}
