import type { ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useParams } from 'react-router-dom';
import { Hourglass } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Skeleton } from '../components/Skeleton';
import { useAuthStore } from '../features/auth/authStore';
import { GoLive } from '../features/manage/GoLive';
import {
  MANAGE_TABS,
  TEMPLATE_TABS,
  canEditMenu,
  canEditSettings,
  canManage,
  canPublish,
  ownStoreId,
} from '../features/manage/manageRules';
import { useManagedStore, useMyBrands } from '../features/manage/useManage';
import { useStoreByRef, useStores } from '../features/stores/useStores';
import { cn } from '../lib/cn';
import { ManageSettingsTab } from './ManageSettings';
import { ManageTeamTab } from './ManageTeam';
import { NotFoundPage } from './NotFound';
import { ManageHoursPage } from './ManageHours';
import { ManageMenuTab } from './ManageMenu';
import { ManageProfileTab } from './ManageProfile';
import { ManageStockTab } from './ManageStock';

const ComingNext = () => (
  <EmptyState
    icon={Hourglass}
    tone="neutral"
    title="Coming next"
    description="This part of the store's management is on its way."
  />
);

const Loading = () => (
  <div className="pt-4" aria-busy aria-label="Loading the store">
    <Skeleton className="h-24" />
  </div>
);

/**
 * `/manage/:storeSlug/*`: the tabs, for a store the account manages. The owner's and a manager's own stores are read
 * through the manage route at any status (a DRAFT branch, the template); an admin reads the public store. Anyone else
 * gets the not-found page.
 */
export function ManageStorePage() {
  const { storeSlug = '' } = useParams();
  const user = useAuthStore((s) => s.user);
  const owner = !!user && user.ownedBrands.length > 0;
  const brands = useMyBrands(owner);
  const ownId = user ? ownStoreId(user, brands.data, storeSlug) : null;
  const brandsPending = owner && !brands.data && !brands.error;
  const managed = useManagedStore(ownId);
  const adminView = !!user && user.role === 'ADMIN' && !ownId && !brandsPending;
  const pub = useStoreByRef(storeSlug, undefined, adminView);
  const { retry: reloadStores } = useStores();

  if (!user || brandsPending) return <Loading />;
  if (!ownId && !adminView) {
    if (brands.error)
      return (
        <ErrorState
          compact
          title="Unable to load your stores."
          message={brands.error.message}
          onRetry={brands.reload}
          unreachable={brands.error.isUnreachable}
        />
      );
    return <NotFoundPage />;
  }

  const source = ownId
    ? managed
    : { data: pub.store, isLoading: pub.isLoading, error: pub.error, reload: pub.retry };
  if (source.error?.status === 404) return <NotFoundPage />;
  if (!source.data && source.isLoading) return <Loading />;

  const view = managed.data
    ? { ...managed.data.store, brand: managed.data.brand }
    : pub.store
      ? { ...pub.store, isTemplate: false, status: 'ACTIVE' as const }
      : null;
  if (!view)
    return (
      <ErrorState
        compact
        title="Unable to load the store."
        message={source.error?.message}
        onRetry={source.reload}
        unreachable={source.error?.isUnreachable}
      />
    );
  if (!ownId && !canManage(user, view)) return <NotFoundPage />;

  // Every write here can change what the store shows, its checklist, and the lists that name it.
  const refresh = () => {
    if (ownId) managed.reload();
    else pub.retry();
    if (owner) brands.reload();
    reloadStores();
  };

  const allowed = (path: string) =>
    (!view.isTemplate || TEMPLATE_TABS.includes(path)) &&
    (path !== 'settings' || canEditSettings(user, view)) &&
    ((path !== 'stock' && path !== 'profile') || canEditMenu(user, view));
  const tabs = MANAGE_TABS.filter((t) => allowed(t.path));
  const elements: Record<string, ReactNode> = {
    menu: <ManageMenuTab store={view} />,
    stock: <ManageStockTab store={view} />,
    profile: managed.data && <ManageProfileTab store={managed.data.store} onSaved={refresh} />,
    hours: <ManageHoursPage store={view} onChanged={refresh} />,
    settings: <ManageSettingsTab storeId={view.id} />,
    team: <ManageTeamTab store={view} user={user} />,
  };

  return (
    <div className="pt-4">
      {source.error && (
        <ErrorState
          compact
          className="mb-3"
          title="Showing the saved store"
          message="We couldn't refresh it just now."
          retryLabel="Retry"
          onRetry={source.reload}
          unreachable={source.error.isUnreachable}
        />
      )}
      <h1 className="text-xl font-extrabold">
        {view.isTemplate ? `${view.brand.name}: brand template` : view.name}
      </h1>
      {view.isTemplate && (
        <p className="text-caption text-muted">
          New branches start as a copy of this menu, profile and settings.
        </p>
      )}
      {managed.data && !view.isTemplate && canPublish(user, view.brand.id) && (
        <GoLive store={managed.data.store} missing={managed.data.missing} onChanged={refresh} />
      )}
      {/* Wraps at large text sizes: the tabs no longer fit one row of a phone at 200%. */}
      <nav aria-label="Manage" className="mt-3 flex flex-wrap gap-1 border-b border-line/70">
        {tabs.map(({ path, label }) => (
          <NavLink
            key={path}
            to={`/manage/${view.slug}/${path}`}
            className={({ isActive }) =>
              cn(
                'grid min-h-11 flex-auto place-items-center whitespace-nowrap border-b-2 px-3 text-sm font-semibold',
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
        <Route index element={<Navigate to={view.isTemplate ? 'menu' : 'hours'} replace />} />
        {tabs.map(({ path }) => (
          <Route key={path} path={path} element={elements[path] ?? <ComingNext />} />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  );
}
