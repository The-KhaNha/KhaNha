import { RotateCcw } from 'lucide-react';
import type { Order } from '../types/api';
import { isTerminal } from '../features/orders/orderStatus';
import { Button, ButtonLink } from './Button';
import { Card } from './Card';
import { FoodPhoto } from './FoodPhoto';
import { Price } from './Price';
import { Skeleton } from './Skeleton';
import { StatusBadge } from './StatusBadge';
import { TimeText } from './TimeText';

interface OrderCardProps {
  order: Order;
  onReorder?: (order: Order) => void;
  reordering?: boolean;
}

const MAX_THUMBS = 3;

export function summarizeItems(order: Order): string {
  return order.items.map((item) => `${item.quantity} × ${item.name}`).join(', ');
}

export function OrderCard({ order, onReorder, reordering = false }: OrderCardProps) {
  const finished = isTerminal(order.status);
  const thumbs = order.items.slice(0, MAX_THUMBS);
  const overflow = order.items.length - thumbs.length;

  return (
    <Card as="article" className="animate-fade-up">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[17px] font-bold tabular-nums">Order #{order.orderNumber}</h3>
          <p className="mt-0.5 text-[13px] text-muted">
            {order.store.name} · <TimeText iso={order.createdAt} withDay />
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="flex shrink-0 -space-x-2" aria-hidden>
          {thumbs.map((item) => (
            <FoodPhoto
              key={item.id}
              // Older orders may predate item photos on the API; FoodPhoto shows its cream placeholder for them.
              src={item.imageUrl ?? null}
              className="h-10 w-10 rounded-full ring-2 ring-surface"
            />
          ))}
          {overflow > 0 && (
            <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-[12px] font-bold tabular-nums text-muted ring-2 ring-surface">
              +{overflow}
            </span>
          )}
        </div>
        <p className="min-w-0 line-clamp-2 wrap-anywhere text-sm leading-snug text-muted">{summarizeItems(order)}</p>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line/70 pt-4">
        <Price value={order.total} className="text-lg font-extrabold" />
        <div className="flex items-center gap-2">
          {finished && onReorder && (
            <Button
              variant="tint"
              onClick={() => onReorder(order)}
              loading={reordering}
              iconLeft={<RotateCcw className="h-4 w-4" aria-hidden />}
              className="rounded-full"
            >
              Order Again
            </Button>
          )}
          <ButtonLink to={`/orders/${order.id}`} variant="secondary">
            View Order
          </ButtonLink>
        </div>
      </div>
    </Card>
  );
}

export function OrderCardSkeleton() {
  return (
    <div className="rounded-[28px] border border-line/70 bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between">
        <div>
          <Skeleton className="h-5 w-28" />
          <Skeleton className="mt-2 h-3 w-40" />
        </div>
        <Skeleton className="h-6 w-20" round />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="flex -space-x-2">
          <Skeleton className="h-10 w-10 ring-2 ring-surface" round />
          <Skeleton className="h-10 w-10 ring-2 ring-surface" round />
        </div>
        <Skeleton className="h-3.5 w-3/5" />
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-line/70 pt-4">
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-11 w-28 rounded-[14px]" />
      </div>
    </div>
  );
}
