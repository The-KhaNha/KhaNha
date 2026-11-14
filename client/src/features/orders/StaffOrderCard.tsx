import { orderLineOptions } from '../menu/modifierRules';
import { useState, type AnimationEvent } from 'react';
import { CircleAlert, MessageSquareText, UserRound } from 'lucide-react';
import type { Order, OrderStatus } from '../../types/api';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Price } from '../../components/Price';
import { Skeleton } from '../../components/Skeleton';
import { StatusBadge } from '../../components/StatusBadge';
import { TimeText } from '../../components/TimeText';
import { cn } from '../../lib/cn';
import { isTerminal, statusMeta } from './orderStatus';

interface StaffOrderCardProps {
  order: Order;
  pending: boolean;
  error?: string;
  onChangeStatus: (order: Order, status: OrderStatus) => void;
  /** True when this order arrived after the first fetch: plays the arrival flash once. */
  fresh?: boolean;
  /** True while the card fades out because it no longer matches the active filter. */
  leaving?: boolean;
}

/**
 * Kitchen ticket. The status colour lives in the pill and the 4px left rail; the action button is
 * always paprika so staff can hit it without reading. The total + actions sit at the bottom of the
 * card (mt-auto) so buttons line up across a grid row whatever the ticket length.
 */
export function StaffOrderCard({
  order,
  pending,
  error,
  onChangeStatus,
  fresh = false,
  leaving = false,
}: StaffOrderCardProps) {
  const meta = statusMeta(order.status);
  const finished = isTerminal(order.status);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  // Capture "fresh" at mount so later re-renders (polls, the clock) don't restart the flash.
  const [entering, setEntering] = useState(fresh);
  const nextStatus = meta.next;

  function handleAnimationEnd(event: AnimationEvent<HTMLElement>) {
    if (event.target === event.currentTarget && event.animationName === 'ring-flash')
      setEntering(false);
  }

  return (
    <article
      onAnimationEnd={handleAnimationEnd}
      className={cn(
        'relative flex min-w-0 flex-col overflow-hidden rounded-card border bg-surface p-5 pl-6 shadow-card transition-opacity duration-200',
        finished ? 'border-line/50 opacity-60' : 'border-line/70',
        order.status === 'READY' && 'ring-2 ring-success-500/40',
        leaving ? 'animate-card-leave' : entering && 'ring-flash',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 w-1 transition-colors duration-200',
          meta.railClass,
        )}
      />

      <div
        className={cn('flex min-w-0 flex-1 flex-col', entering && !leaving && 'animate-fade-up')}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-number font-extrabold leading-none tabular-nums tracking-tight">
              #{order.orderNumber}
            </p>
            <p className="mt-1.5 text-caption text-muted">
              <TimeText iso={order.createdAt} withDay />
            </p>
          </div>
          <StatusBadge status={order.status} size="md" />
        </div>

        <p className="mt-4 flex items-start gap-1.5 text-sm font-semibold text-ink">
          <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
          {/* <bdi>: a direction override typed into the name or note (U+202E) stays inside it instead of reversing the
              phone or the rest of the line. */}
          <span className="min-w-0 wrap-anywhere">
            <bdi>{order.customerName}</bdi>
            {order.customerPhone && (
              <span className="font-normal tabular-nums text-muted"> · {order.customerPhone}</span>
            )}
          </span>
        </p>

        <ul className="mt-3 space-y-1.5 text-body">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 wrap-anywhere">
                <span className="font-bold tabular-nums">{item.quantity} ×</span> {item.name}
                {/* The kitchen makes the line from this: full size and weight, never a muted footnote. */}
                {orderLineOptions(item) && (
                  <span className="block font-semibold">{orderLineOptions(item)}</span>
                )}
              </span>
              <Price value={item.lineTotal} className="shrink-0 text-muted" />
            </li>
          ))}
        </ul>

        {order.note && (
          <div className="mt-3 flex items-start gap-2 rounded-2xl bg-gold-50 px-3.5 py-2.5 text-sm text-gold-700">
            <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p className="min-w-0 wrap-anywhere">
              <span className="font-bold">Note:</span> <bdi>{order.note}</bdi>
            </p>
          </div>
        )}

        <div className="mt-auto">
          <div className="mt-4 flex items-baseline justify-between border-t border-line/70 pt-4">
            <span className="text-sm font-semibold text-muted">Total</span>
            <Price value={order.total} className="text-lg font-extrabold" />
          </div>

          {error && (
            <p
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-xl bg-brand-50 px-3 py-2 text-caption font-semibold text-brand-700 animate-fade-in"
            >
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 wrap-anywhere">{error}</span>
            </p>
          )}

          {nextStatus && meta.actionLabel && (
            <div className="mt-4 space-y-2">
              <Button
                size="lg"
                fullWidth
                loading={pending}
                onClick={() => onChangeStatus(order, nextStatus)}
              >
                {meta.actionLabel}
              </Button>

              {meta.canCancel &&
                (confirmingCancel ? (
                  <div className="flex items-center gap-2 animate-fade-in">
                    <Button
                      variant="danger"
                      fullWidth
                      loading={pending}
                      onClick={() => onChangeStatus(order, 'CANCELLED')}
                    >
                      Yes, cancel order
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setConfirmingCancel(false)}
                      disabled={pending}
                    >
                      Keep
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost-danger"
                    fullWidth
                    onClick={() => setConfirmingCancel(true)}
                    disabled={pending}
                  >
                    Cancel order
                  </Button>
                ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function StaffOrderCardSkeleton() {
  return (
    <Card padding="lg" className="relative overflow-hidden pl-6">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-surface-2" />
      <div className="flex items-start justify-between">
        <div>
          <Skeleton className="h-9 w-24" />
          <Skeleton className="mt-2 h-3 w-28" />
        </div>
        <Skeleton className="h-7 w-24" round />
      </div>
      <Skeleton className="mt-4 h-4 w-32" />
      <div className="mt-3 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
      <div className="mt-4 flex justify-between border-t border-line/70 pt-4">
        <Skeleton className="h-4 w-10" />
        <Skeleton className="h-6 w-16" />
      </div>
      <Skeleton className="mt-4 h-14 w-full rounded-control" />
      <Skeleton className="mx-auto mt-3 h-4 w-20" />
    </Card>
  );
}
