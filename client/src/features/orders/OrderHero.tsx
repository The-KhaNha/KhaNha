import { PackageCheck, PartyPopper, RotateCcw } from 'lucide-react';
import type { Order } from '../../types/api';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { StatusBadge } from '../../components/StatusBadge';
import { cn } from '../../lib/cn';
import { statusMeta } from './orderStatus';
import { APP_TITLE } from '../../config/app';

interface OrderHeroProps {
  order: Order;
  onReorder: () => void;
  reordering: boolean;
}

/**
 * The top of the tracking page: changes character with the order's status.
 * Re-key it on `order.status` so each state plays its entrance once.
 */
export function OrderHero({ order, onReorder, reordering }: OrderHeroProps) {
  const meta = statusMeta(order.status);

  if (order.status === 'READY') {
    return (
      <div className="animate-scale-in">
        <section className="@container relative overflow-hidden rounded-card bg-success-500 p-6 text-white shadow-ready animate-glow-pulse">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-16 -left-6 h-44 w-44 rounded-full bg-white/10"
          />
          <div className="eyebrow relative flex items-center gap-2 text-caption text-white">
            <PackageCheck className="h-5 w-5" aria-hidden /> Ready for pickup
          </div>
          <h2 className="relative mt-3 text-number font-extrabold leading-tight">
            Your order is ready!
          </h2>
          <p className="relative mt-4 text-order-number font-extrabold tabular-nums tracking-tight wrap-anywhere animate-check-pop">
            #{order.orderNumber}
          </p>
          <p className="relative mt-2 text-lead font-bold text-white">{order.store.name}</p>
          <p className="relative mt-4 text-lead font-bold">Head to the pickup counter.</p>
          <p className="relative mt-1 text-body font-semibold text-white">
            Tell the staff your order number.
          </p>
        </section>
      </div>
    );
  }

  if (order.status === 'COLLECTED') {
    return (
      <Card as="section" padding="lg" className="animate-scale-in">
        {/* Wraps at large text: the column drops under the icon instead of being squeezed beside it. */}
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-success-50 text-success-700 animate-party-in">
            <PartyPopper className="h-7 w-7" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 basis-48">
            <h2 className="text-2xl font-extrabold leading-tight wrap-break-word">
              Order collected!
            </h2>
            <p className="mt-1 text-body text-muted">{meta.customerCopy}</p>
            <p className="mt-3 text-sm font-semibold text-ink">
              Order <span className="tabular-nums">#{order.orderNumber}</span> · {order.store.name}
            </p>
            <p className="mt-1 text-sm text-muted">Thanks for using {APP_TITLE}.</p>
          </div>
        </div>
        <Button
          size="lg"
          fullWidth
          className="mt-5"
          onClick={onReorder}
          loading={reordering}
          iconLeft={<RotateCcw className="h-5 w-5" aria-hidden />}
        >
          Order Again
        </Button>
      </Card>
    );
  }

  if (order.status === 'CANCELLED') {
    return (
      <Card as="section" padding="lg" tone="cancel" className="animate-scale-in">
        {/* On a phone the badge always takes its own line: beside the heading it only just fits, so the web font arriving (a few px narrower than the fallback) would pull it up and shift the page. */}
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
          <div>
            <h2 className="text-2xl font-extrabold leading-tight">
              Order <span className="tabular-nums">#{order.orderNumber}</span>
            </h2>
            <p className="mt-0.5 text-sm text-muted">{order.store.name}</p>
          </div>
          <StatusBadge status={order.status} size="md" className="bg-surface" />
        </div>
        <p className="mt-4 text-body leading-relaxed text-muted">{meta.customerCopy}</p>
        <Button
          variant="secondary"
          fullWidth
          className="mt-5"
          onClick={onReorder}
          loading={reordering}
          iconLeft={<RotateCcw className="h-4 w-4" aria-hidden />}
        >
          Order Again
        </Button>
      </Card>
    );
  }

  const Icon = meta.icon;
  return (
    <Card as="section" padding="lg" className="animate-scale-in">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
        <div>
          <h2 className="text-title font-extrabold leading-[1.15]">
            Order <span className="tabular-nums">#{order.orderNumber}</span>
          </h2>
          <p className="mt-0.5 text-sm text-muted">{order.store.name}</p>
        </div>
        <StatusBadge status={order.status} size="md" />
      </div>
      <div className="mt-5 flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3">
        <span
          className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors duration-300',
            meta.fillClass,
            meta.onFillClass,
          )}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 wrap-break-word">
          <p className="text-body font-bold">{meta.customerTitle}</p>
          <p className="text-caption text-muted">{meta.customerCopy}</p>
        </div>
      </div>
    </Card>
  );
}
