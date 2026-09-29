import { Link, useLocation, useParams } from 'react-router-dom';
import { Check, Clock } from 'lucide-react';
import type { Order } from '../types/api';
import { ButtonLink } from '../components/Button';
import { ErrorState } from '../components/ErrorState';
import { DrawnCheck } from '../components/icons/DrawnCheck';
import { Skeleton } from '../components/Skeleton';
import { useOrder } from '../features/orders/useOrder';
import { formatPrice, formatTime } from '../lib/format';

/** The celebratory moment: drawn check, two rings, then everything staggers in and holds still. */
export function OrderSuccessPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const passedOrder = (location.state as { order?: Order } | null)?.order ?? null;
  const { order, isLoading, error, retry } = useOrder(id, passedOrder);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 py-12 text-center md:max-w-lg">
      <div className="relative">
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-success-500/30 animate-ring"
        />
        <div className="relative grid h-28 w-28 place-items-center rounded-full bg-success-500 text-white shadow-ready animate-check-pop">
          <DrawnCheck className="h-14 w-14" />
        </div>
      </div>

      <h1 className="mt-8 text-number font-extrabold leading-tight animate-fade-up">
        Order placed!
      </h1>

      {order ? (
        <div className="@container mt-2 flex w-full flex-col items-center">
          <p className="w-full text-order-number font-extrabold tabular-nums tracking-tight wrap-anywhere animate-fade-up [animation-delay:80ms]">
            #{order.orderNumber}
          </p>
          <div className="flex flex-col items-center animate-fade-up [animation-delay:160ms]">
            <p className="mt-2 text-lead font-semibold text-ink">{order.store.name}</p>
            <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-success-50 px-3.5 py-1.5 text-sm font-bold text-success-700">
              <Check className="h-4 w-4 text-success-500" strokeWidth={3} aria-hidden />
              {formatPrice(order.total)}{' '}
              {order.paymentStatus === 'PAID' ? 'Paid' : 'Payment pending'}
            </span>
            <p className="mt-5 inline-flex items-center gap-2 text-body font-semibold">
              <Clock className="h-4 w-4 text-brand-600" strokeWidth={2.5} aria-hidden /> Ready
              around {formatTime(order.estimatedReadyAt)}
            </p>
            <p className="mt-3 max-w-xs text-body leading-relaxed text-muted">
              Skip the queue and pick it up when it&rsquo;s ready.
            </p>
          </div>
        </div>
      ) : isLoading ? (
        <div className="mt-3 flex w-full flex-col items-center gap-3" aria-busy>
          <Skeleton className="h-16 w-44" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-28" round />
          <Skeleton className="h-4 w-44" />
        </div>
      ) : (
        error && (
          <ErrorState
            compact
            className="mt-4 w-full"
            title="Your order was placed, but we couldn't load its details."
            message={error.message}
            onRetry={retry}
            unreachable={error.isUnreachable}
          />
        )
      )}

      <div className="mt-10 flex w-full max-w-xs flex-col items-stretch gap-3 animate-fade-up [animation-delay:240ms]">
        <ButtonLink to={id ? `/orders/${id}` : '/orders'} size="lg" fullWidth>
          Track Order
        </ButtonLink>
        <Link
          to="/"
          className="inline-flex h-11 items-center justify-center rounded-control text-body font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
