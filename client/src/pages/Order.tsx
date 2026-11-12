import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MessageSquareText } from 'lucide-react';
import type { OrderStatus } from '../types/api';
import { Card } from '../components/Card';
import { ErrorState } from '../components/ErrorState';
import { Price } from '../components/Price';
import { Skeleton } from '../components/Skeleton';
import { StatusTracker } from '../components/StatusTracker';
import { TimeText } from '../components/TimeText';
import { ReplaceCartSheet } from '../features/cart/ReplaceCartSheet';
import { useReorder } from '../features/cart/useReorder';
import { OrderHero } from '../features/orders/OrderHero';
import { amountLabel, timelineLabel } from '../features/orders/orderStatus';
import { useOrder } from '../features/orders/useOrder';
import { APP_TITLE } from '../config/app';

export function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const { order, isLoading, error, retry } = useOrder(id);
  const { reorder, reorderingId, replace } = useReorder();

  const status = order?.status;
  const orderNumber = order?.orderNumber;
  const previousStatus = useRef<OrderStatus | null>(null);
  // The status the page first showed. The hero is the page's largest paint, so it must not start inside an entrance
  // fade (Chrome would count it seconds late, at its next repaint); only a status a poll brings later plays one.
  const [firstStatus, setFirstStatus] = useState<OrderStatus | null>(null);
  if (status && firstStatus === null) setFirstStatus(status);

  // The READY moment: buzz the phone once when a poll flips into READY, and flag the tab title.
  useEffect(() => {
    if (!status) return;
    const previous = previousStatus.current;
    previousStatus.current = status;
    if (previous !== null && previous !== 'READY' && status === 'READY') {
      navigator.vibrate?.([40, 60, 40]);
    }
  }, [status]);

  useEffect(() => {
    if (status !== 'READY' || orderNumber === undefined) return;
    document.title = `Ready · #${orderNumber} — ${APP_TITLE}`;
    return () => {
      document.title = APP_TITLE;
    };
  }, [status, orderNumber]);

  if (isLoading) return <OrderSkeleton />;

  if (error && !order) {
    return (
      <ErrorState
        title="Unable to load your order."
        message={error.status === 404 ? "We couldn't find this order." : error.message}
        onRetry={retry}
        unreachable={error.isUnreachable}
        code={error.code}
      />
    );
  }

  if (!order) return null;

  const when = timelineLabel(order);

  return (
    <div className="space-y-4 pt-4">
      {/* Keyed on status so each state plays its entrance once when a poll changes it. */}
      <OrderHero
        key={order.status}
        entrance={firstStatus !== null && order.status !== firstStatus}
        order={order}
        onReorder={() => void reorder(order)}
        reordering={reorderingId === order.id}
      />

      {error && (
        <p
          role="status"
          className="rounded-2xl bg-gold-50 px-4 py-2.5 text-center text-caption font-semibold text-gold-700 animate-fade-in"
        >
          Live updates paused — reconnecting…
        </p>
      )}

      <Card padding="lg">
        <StatusTracker status={order.status} />
        <dl className="mt-6 grid grid-cols-2 gap-3 border-t border-line/70 pt-5">
          <div>
            <dt className="eyebrow text-muted">{amountLabel(order)}</dt>
            <dd className="mt-1.5">
              <Price value={order.total} className="text-xl font-extrabold leading-none" />
            </dd>
          </div>
          <div>
            <dt className="eyebrow text-muted">{when.label}</dt>
            <dd className="mt-1.5 text-xl font-extrabold leading-none">
              <TimeText iso={when.iso} />
            </dd>
          </div>
        </dl>
      </Card>

      <Card padding="lg">
        <h3 className="eyebrow text-muted">Items</h3>
        <ul className="mt-3 divide-y divide-line/70">
          {order.items.map((item) => (
            <li
              key={item.id}
              className="flex items-baseline justify-between gap-3 py-2.5 text-body first:pt-0 last:pb-0"
            >
              <span className="min-w-0 wrap-anywhere">
                <span className="font-bold tabular-nums">{item.quantity} ×</span> {item.name}
              </span>
              <Price value={item.lineTotal} className="shrink-0 font-semibold" />
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-baseline justify-between border-t border-line/70 pt-3">
          <span className="font-bold">Total</span>
          <Price value={order.total} className="text-lg font-extrabold" />
        </div>
        {order.note && (
          <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-gold-50 px-4 py-3 text-sm text-gold-700">
            <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p className="min-w-0 wrap-anywhere">
              <span className="font-bold">Note:</span> <bdi>{order.note}</bdi>
            </p>
          </div>
        )}
      </Card>

      <p className="wrap-anywhere pb-2 text-center text-caption text-muted">
        Placed <TimeText iso={order.createdAt} withDay /> · Picking up as{' '}
        <bdi>{order.customerName}</bdi>
      </p>
      {replace && <ReplaceCartSheet {...replace} />}
    </div>
  );
}

function OrderSkeleton() {
  return (
    <div className="space-y-4 pt-4" aria-busy aria-label="Loading order">
      <Card padding="lg">
        <div className="flex items-start justify-between">
          <div>
            <Skeleton className="h-7 w-36" />
            <Skeleton className="mt-2 h-3.5 w-24" />
          </div>
          <Skeleton className="h-7 w-24" round />
        </div>
        <Skeleton className="mt-5 h-16 w-full rounded-2xl" />
      </Card>
      <Card padding="lg">
        <div className="flex items-start justify-between">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex w-16 flex-col items-center">
              <Skeleton className="h-10 w-10" round />
              <Skeleton className="mt-2 h-3 w-12" />
            </div>
          ))}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 border-t border-line/70 pt-5">
          <div>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-6 w-20" />
          </div>
          <div>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-6 w-24" />
          </div>
        </div>
      </Card>
      <Card padding="lg">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="mt-3 h-4 w-5/6" />
        <Skeleton className="mt-4 h-5 w-full" />
      </Card>
    </div>
  );
}
