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
        <section className="relative overflow-hidden rounded-[28px] bg-success-500 p-6 text-white shadow-ready animate-glow-pulse">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-16 -left-6 h-44 w-44 rounded-full bg-white/10"
          />
          <div className="eyebrow relative flex items-center gap-2 text-[13px] text-white">
            <PackageCheck className="h-5 w-5" aria-hidden /> Ready for pickup
          </div>
          <h2 className="relative mt-3 text-[30px] font-extrabold leading-tight">
            Your order is ready!
          </h2>
          <p className="relative mt-4 text-[72px] font-extrabold leading-none tabular-nums tracking-tight animate-check-pop">
            #{order.orderNumber}
          </p>
          <p className="relative mt-2 text-[17px] font-bold text-white">{order.store.name}</p>
          <p className="relative mt-4 text-[17px] font-bold">Head to the pickup counter.</p>
          <p className="relative mt-1 text-[15px] font-semibold text-white">
            Tell the staff your order number.
          </p>
        </section>
      </div>
    );
  }

  if (order.status === 'COLLECTED') {
    return (
      <Card as="section" padding="lg" className="animate-scale-in">
        <div className="flex items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-success-50 text-success-700 animate-party-in">
            <PartyPopper className="h-7 w-7" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-[24px] font-extrabold leading-tight">Order collected!</h2>
            <p className="mt-1 text-[15px] text-muted">{meta.customerCopy}</p>
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
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[22px] font-extrabold leading-tight">
              Order <span className="tabular-nums">#{order.orderNumber}</span>
            </h2>
            <p className="mt-0.5 text-sm text-muted">{order.store.name}</p>
          </div>
          <StatusBadge status={order.status} size="md" className="bg-surface" />
        </div>
        <p className="mt-4 text-[15px] leading-relaxed text-muted">{meta.customerCopy}</p>
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[26px] font-extrabold leading-[1.15]">
            Order <span className="tabular-nums">#{order.orderNumber}</span>
          </h2>
          <p className="mt-0.5 text-[14px] text-muted">{order.store.name}</p>
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
        <div>
          <p className="text-[15px] font-bold">{meta.customerTitle}</p>
          <p className="text-[13px] text-muted">{meta.customerCopy}</p>
        </div>
      </div>
    </Card>
  );
}
