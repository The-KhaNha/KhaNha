import { Inbox, RefreshCw } from 'lucide-react';
import type { Order, OrderStatus } from '../../types/api';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import type { ApiError } from '../../services/api';
import type { StaffFilter } from './orderStatus';
import { StaffOrderCard, StaffOrderCardSkeleton } from './StaffOrderCard';

interface StaffBoardProps {
  /** null until the first fetch succeeds. */
  orders: Order[] | null;
  /** Orders matching the active filter (plus the ones still fading out), in queue order. */
  visible: Order[];
  isLoading: boolean;
  error: ApiError | null;
  filter: StaffFilter;
  pendingIds: ReadonlySet<string>;
  actionErrors: Record<string, string>;
  freshIds: ReadonlySet<string>;
  leavingIds: ReadonlySet<string>;
  onRetry: () => void;
  onShowAll: () => void;
  onChangeStatus: (order: Order, status: OrderStatus) => void;
}

/** The ticket grid with its loading, error and empty states. Rows stretch so ticket actions align. */
export function StaffBoard({
  orders,
  visible,
  isLoading,
  error,
  filter,
  pendingIds,
  actionErrors,
  freshIds,
  leavingIds,
  onRetry,
  onShowAll,
  onChangeStatus,
}: StaffBoardProps) {
  if (isLoading) {
    return (
      <div
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        aria-busy
        aria-label="Loading orders"
      >
        {Array.from({ length: 6 }, (_, i) => (
          <StaffOrderCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error && !orders) {
    return (
      <div className="mx-auto max-w-md">
        <ErrorState
          title="Unable to load orders."
          message={error.message}
          onRetry={onRetry}
          unreachable={error.isUnreachable}
        />
      </div>
    );
  }

  if (visible.length === 0) {
    const showingAll = filter.statuses === null;
    return (
      <div className="mx-auto max-w-md">
        <EmptyState
          icon={Inbox}
          tone="neutral"
          title="No orders right now."
          description={
            showingAll
              ? 'New orders will appear here automatically as customers place them.'
              : `Nothing in “${filter.label}” at the moment.`
          }
          action={
            showingAll ? undefined : (
              <Button variant="secondary" onClick={onShowAll}>
                Show all orders
              </Button>
            )
          }
        />
      </div>
    );
  }

  return (
    <>
      {error && (
        <p
          role="status"
          className="mb-4 inline-flex items-center gap-2 rounded-full bg-gold-50 px-4 py-2 text-[13px] font-semibold text-gold-700 animate-fade-in"
        >
          <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden /> Connection lost — retrying…
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((order) => (
          <StaffOrderCard
            key={order.id}
            order={order}
            pending={pendingIds.has(order.id)}
            error={actionErrors[order.id]}
            fresh={freshIds.has(order.id)}
            leaving={leavingIds.has(order.id)}
            onChangeStatus={onChangeStatus}
          />
        ))}
      </div>
    </>
  );
}
