import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Order, OrderStatus } from '../types/api';
import { useAuthStore } from '../features/auth/authStore';
import { useStore } from '../features/menu/useStore';
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
import { useNow } from '../lib/useNow';

/** The 200ms --animate-card-leave plus a 20ms margin, so the card is removed just after it finishes fading. */
const LEAVE_MS = 220;

/** The kitchen board: owns polling, filtering and status changes; the header, filters and grid are presentational. */
export function StaffDashboardPage() {
  const { orders, isLoading, error, retry, mutate, updatedAt } = useOrders({
    audience: 'staff',
  });
  const { store } = useStore();
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const now = useNow(1000);

  const [filterKey, setFilterKey] = useState<StaffFilterKey>('ALL');
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
    setPendingIds((prev) => new Set(prev).add(order.id));
    setActionErrors((prev) => {
      const { [order.id]: _removed, ...rest } = prev;
      return rest;
    });
    try {
      const updated = await updateOrderStatus(order.id, status);
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
        storeName={store?.name}
        now={now}
        updatedAt={updatedAt}
        offline={error !== null}
        onLogout={handleLogout}
      >
        <StaffFilters value={filterKey} counts={counts} onChange={selectFilter} />
      </StaffHeader>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
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
      </main>
    </div>
  );
}
