import { useMemo } from 'react';
import { ReceiptText } from 'lucide-react';
import type { Order } from '../types/api';
import { ButtonLink } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { OrderCard, OrderCardSkeleton } from '../components/OrderCard';
import { Skeleton } from '../components/Skeleton';
import { ReplaceCartSheet } from '../features/cart/ReplaceCartSheet';
import { useReorder } from '../features/cart/useReorder';
import { isActive } from '../features/orders/orderStatus';
import { useOrders } from '../features/orders/useOrders';

function newestFirst(a: Order, b: Order): number {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}

export function OrdersPage() {
  const { orders, isLoading, error, retry } = useOrders();
  const { reorder, reorderingId, replace } = useReorder();

  const { active, past } = useMemo(() => {
    const sorted = [...(orders ?? [])].sort(newestFirst);
    return {
      active: sorted.filter((o) => isActive(o.status)),
      past: sorted.filter((o) => !isActive(o.status)),
    };
  }, [orders]);

  if (isLoading) {
    return (
      <div className="space-y-3 pt-4" aria-busy aria-label="Loading orders">
        <Skeleton className="mb-3 h-3 w-24" round />
        {Array.from({ length: 3 }, (_, i) => (
          <OrderCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error && !orders) {
    return (
      <ErrorState
        title="Unable to load your orders."
        message={error.message}
        onRetry={retry}
        unreachable={error.isUnreachable}
        code={error.code}
      />
    );
  }

  if (!orders || orders.length === 0) {
    return (
      <EmptyState
        icon={ReceiptText}
        title="No orders yet."
        description="Your next quick pickup is just a few taps away."
        action={
          <ButtonLink to="/menu" size="lg">
            Browse Menu
          </ButtonLink>
        }
      />
    );
  }

  return (
    <div className="pt-4">
      {active.length > 0 && (
        <OrderGroup
          title="In progress"
          orders={active}
          onReorder={reorder}
          reorderingId={reorderingId}
        />
      )}
      {past.length > 0 && (
        <OrderGroup
          title="Past orders"
          orders={past}
          onReorder={reorder}
          reorderingId={reorderingId}
          className={active.length > 0 ? 'mt-7' : undefined}
        />
      )}
      {replace && <ReplaceCartSheet {...replace} />}
    </div>
  );
}

interface OrderGroupProps {
  title: string;
  orders: Order[];
  onReorder: (order: Order) => void;
  reorderingId: string | null;
  className?: string;
}

function OrderGroup({ title, orders, onReorder, reorderingId, className }: OrderGroupProps) {
  return (
    <section className={className} aria-label={title}>
      <h2 className="eyebrow mb-3 text-muted">{title}</h2>
      <div className="space-y-3">
        {orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            onReorder={(o) => void onReorder(o)}
            reordering={reorderingId === order.id}
          />
        ))}
      </div>
    </section>
  );
}
