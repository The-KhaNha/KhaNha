import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Store as StoreIcon } from 'lucide-react';
import { ButtonLink } from '../components/Button';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import type { Order, OrderStatus } from '../types/api';
import { useAuthStore } from '../features/auth/authStore';
import { PauseControl } from '../features/orders/PauseControl';
import { useStoreByRef } from '../features/stores/useStores';
import { useConfig } from '../features/config/useConfig';
import {
  STAFF_FILTERS,
  matchesFilter,
  type StaffFilter,
  type StaffFilterKey,
} from '../features/orders/orderStatus';
import { StaffBoard } from '../features/orders/StaffBoard';
import { StaffFilters } from '../features/orders/StaffFilters';
import { StaffHeader } from '../features/orders/StaffHeader';
import { useOrders } from '../features/orders/useOrders';
import {
  countByFilter,
  queueOrder,
  visibleActionErrors,
  type StaffActionError,
} from '../features/orders/staffBoardRules';
import { ApiError } from '../services/api';
import { updateOrderStatus } from '../services/orders';
import { StockList } from '../features/stock/StockList';
import { canSeeStock } from '../features/stock/stockRules';
import { cn } from '../lib/cn';

/** The 200ms --animate-card-leave plus a 20ms margin, so the card is removed just after it finishes fading. */
const LEAVE_MS = 220;

/** The kitchen board: owns polling, filtering and status changes; the header, filters and grid are presentational. */
export function StaffDashboardPage() {
  const { storeSlug = '' } = useParams();
  const membership = useAuthStore((s) =>
    (s.user?.memberships ?? []).find((m) => m.storeSlug === storeSlug),
  );
  const storeId = membership?.storeId;
  const { polling } = useConfig();
  // Keeps polling in the Stock view: an unchanged list is a bodiless 304, and the board is current when staff switch back.
  const { orders, isLoading, error, retry, mutate, updatedAt } = useOrders({
    audience: 'staff',
    storeId,
  });
  const {
    store,
    mutate: mutateStore,
    error: storeError,
    retry: retryStore,
  } = useStoreByRef(storeSlug, polling.staffBoardMs);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const [filterKey, setFilterKey] = useState<StaffFilterKey>('ALL');
  const [view, setView] = useState<'orders' | 'stock'>('orders');
  const stockView = view === 'stock' && canSeeStock(membership);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [actionErrors, setActionErrors] = useState<Record<string, StaffActionError>>({});
  const [leavingIds, setLeavingIds] = useState<ReadonlySet<string>>(new Set());
  const leaveTimers = useRef<number[]>([]);

  // Orders seen since the board opened. The first fetch marks everything as seen; later arrivals flash.
  // Derived during render when `orders` changes (React's "adjust state on prop change" pattern).
  const [arrivals, setArrivals] = useState<{
    orders: Order[] | undefined;
    seen: ReadonlySet<string> | null;
    fresh: ReadonlySet<string>;
  }>({ orders: undefined, seen: null, fresh: new Set() });
  if (orders && orders !== arrivals.orders) {
    const { seen } = arrivals;
    setArrivals({
      orders,
      seen: new Set([...(seen ?? []), ...orders.map((o) => o.id)]),
      fresh: new Set(seen ? orders.filter((o) => !seen.has(o.id)).map((o) => o.id) : []),
    });
  }
  const freshIds = arrivals.fresh;

  useEffect(() => () => leaveTimers.current.forEach((t) => window.clearTimeout(t)), []);

  const filter: StaffFilter = STAFF_FILTERS.find((f) => f.key === filterKey) ?? STAFF_FILTERS[0]!;

  const counts = useMemo(() => countByFilter(orders ?? []), [orders]);

  const visible = useMemo(
    () =>
      (orders ?? [])
        .filter((o) => matchesFilter(o.status, filter) || leavingIds.has(o.id))
        .sort(queueOrder),
    [orders, filter, leavingIds],
  );

  function selectFilter(key: StaffFilterKey) {
    setFilterKey(key);
    setLeavingIds(new Set());
  }

  function scheduleLeave(id: string) {
    setLeavingIds((prev) => new Set(prev).add(id));
    const timer = window.setTimeout(() => {
      setLeavingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, LEAVE_MS);
    leaveTimers.current.push(timer);
  }

  async function changeStatus(order: Order, status: OrderStatus) {
    if (!storeId) return;
    setPendingIds((prev) => new Set(prev).add(order.id));
    setActionErrors((prev) => {
      const { [order.id]: _removed, ...rest } = prev;
      return rest;
    });
    try {
      const updated = await updateOrderStatus(storeId, order.id, status);
      if (!matchesFilter(updated.status, filter)) scheduleLeave(updated.id);
      mutate((list) => list.map((o) => (o.id === updated.id ? updated : o)));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Something went wrong.';
      const unreachable = err instanceof ApiError && err.isUnreachable;
      setActionErrors((prev) => ({
        ...prev,
        [order.id]: { message, unreachable, at: Date.now() },
      }));
      if (err instanceof ApiError && err.code === 'INVALID_STATUS_TRANSITION') retry();
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(order.id);
        return next;
      });
    }
  }

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-dvh">
      <StaffHeader
        storeName={membership?.storeName}
        updatedAt={updatedAt}
        offline={error !== null}
        onLogout={handleLogout}
        pause={
          storeId && (
            <PauseControl
              storeId={storeId}
              store={store ?? undefined}
              mutate={mutateStore}
              loadFailed={Boolean(storeError)}
              onRetry={retryStore}
            />
          )
        }
      >
        {canSeeStock(membership) && (
          <div role="group" aria-label="View" className="flex gap-1 pt-2">
            {(['orders', 'stock'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={cn(
                  'min-h-11 rounded-full px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  view === v ? 'bg-ink text-surface' : 'text-muted hover:bg-surface-2',
                )}
              >
                {v === 'orders' ? 'Orders' : 'Stock'}
              </button>
            ))}
          </div>
        )}
        {!stockView && <StaffFilters value={filterKey} counts={counts} onChange={selectFilter} />}
      </StaffHeader>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {stockView && storeId ? (
          <div className="mx-auto max-w-2xl">
            <StockList store={{ id: storeId, slug: storeSlug }} />
          </div>
        ) : (
          <StaffBoard
            orders={orders}
            visible={visible}
            isLoading={isLoading}
            error={error}
            filter={filter}
            pendingIds={pendingIds}
            actionErrors={visibleActionErrors(actionErrors, updatedAt)}
            freshIds={freshIds}
            leavingIds={leavingIds}
            onRetry={retry}
            onShowAll={() => selectFilter('ALL')}
            onChangeStatus={(o, status) => void changeStatus(o, status)}
          />
        )}
      </main>
    </div>
  );
}

const NO_MEMBERSHIPS: never[] = [];

/** `/staff`: the stores this account works at. With one there is nothing to choose, so it goes straight to its board. */
export function StaffStoresPage() {
  // The fallback outside the selector: a new [] on every read would re-render without end (zustand v5).
  const memberships = useAuthStore((s) => s.user?.memberships) ?? NO_MEMBERSHIPS;
  if (memberships.length === 1)
    return <Navigate to={`/staff/${memberships[0]!.storeSlug}`} replace />;
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="mb-4 text-xl font-bold">Choose a store</h1>
      {memberships.length === 0 ? (
        <EmptyState
          icon={StoreIcon}
          title="You are not on a store's team."
          description="Ask a manager to invite you."
          action={
            <ButtonLink to="/" variant="secondary" fullWidth>
              Browse stores
            </ButtonLink>
          }
        />
      ) : (
        <ul className="space-y-3">
          {memberships.map((m) => (
            <li key={m.storeId}>
              <Card padding="none">
                <Link
                  to={`/staff/${m.storeSlug}`}
                  className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 font-semibold"
                >
                  {m.storeName}
                  <span className="text-xs font-normal text-muted">
                    {m.role === 'MANAGER' ? 'Manager' : 'Staff'}
                  </span>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
