import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, CircleAlert, Info, Plus, ShoppingBag, X } from 'lucide-react';
import { Button, ButtonLink } from '../components/Button';
import { Card } from '../components/Card';
import { IconButton } from '../components/IconButton';
import { CartItem } from '../components/CartItem';
import { EmptyState } from '../components/EmptyState';
import { Price } from '../components/Price';
import { describeProblems, lineProblem } from '../features/cart/cartRules';
import {
  selectCount,
  selectLimits,
  selectLines,
  selectStoreName,
  selectTotal,
  useCartStore,
} from '../features/cart/cartStore';
import { readReorderNotice } from '../features/cart/useReorder';
import { useMenu } from '../features/menu/useMenu';
import { cn } from '../lib/cn';

export function CartPage() {
  const lines = useCartStore(selectLines);
  const limits = useCartStore(selectLimits);
  const count = useCartStore(selectCount);
  const total = useCartStore(selectTotal);
  const storeName = useCartStore(selectStoreName);
  const clear = useCartStore((s) => s.clear);
  const location = useLocation();
  const navigate = useNavigate();
  // Loading the menu here refreshes each line's stock limit (never its price), so problems show before checkout.
  useMenu();

  const notice = readReorderNotice(location.state);
  const flagged = lines.filter((line) => lineProblem(line, limits, lines) !== null);
  const dismissNotice = () => navigate(location.pathname, { replace: true, state: null });

  if (lines.length === 0) {
    return (
      <>
        {notice.length > 0 && <ReorderNotice lines={notice} onDismiss={dismissNotice} />}
        <EmptyState
          icon={ShoppingBag}
          title="Your cart is empty."
          description="Add something tasty from the menu and it will show up here."
          action={
            <ButtonLink to="/menu" size="lg">
              Browse Menu
            </ButtonLink>
          }
        />
      </>
    );
  }

  return (
    <div className="pt-4 animate-fade-up">
      {notice.length > 0 && (
        <ReorderNotice lines={notice} onDismiss={dismissNotice} className="mb-4" />
      )}

      {storeName && <p className="eyebrow mb-2 wrap-anywhere text-muted">From {storeName}</p>}
      <Card padding="none" className="px-4">
        <ul className="divide-y divide-line/70">
          {lines.map((line) => (
            <CartItem key={line.lineKey} line={line} />
          ))}
        </ul>
      </Card>

      {/* Wraps at large text so "Clear cart" drops to its own line instead of off the screen. */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3">
        <Link
          to="/menu"
          className="inline-flex h-11 items-center gap-1 rounded-control px-2 text-body font-semibold text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <Plus className="h-4 w-4" aria-hidden /> Continue shopping
        </Link>
        <Button variant="ghost-danger" onClick={clear}>
          Clear cart
        </Button>
      </div>

      <Card className="mt-4" padding="lg">
        <dl className="space-y-2.5 text-body">
          <div className="flex justify-between text-muted">
            <dt>
              Items <span className="tabular-nums">({count})</span>
            </dt>
            <dd>
              <Price value={total} />
            </dd>
          </div>
          <div className="flex items-baseline justify-between border-t border-line/70 pt-3">
            <dt className="text-base font-bold">Total</dt>
            <dd>
              <Price value={total} className="text-number font-extrabold leading-none" />
            </dd>
          </div>
        </dl>
        <p className="mt-3 inline-flex items-center gap-1.5 text-caption text-muted">
          <Check className="h-3.5 w-3.5 text-success-500" strokeWidth={3} aria-hidden />
          No taxes or hidden fees. You pay exactly this.
        </p>
        {flagged.length > 0 ? (
          <>
            <Button
              size="lg"
              fullWidth
              className="mt-5"
              disabled
              iconRight={<ArrowRight className="h-5 w-5" aria-hidden />}
            >
              Proceed to Checkout
            </Button>
            <p
              role="status"
              className="mt-3 flex items-start justify-center gap-1.5 text-center text-caption font-semibold text-brand-700"
            >
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
              <span>
                {describeProblems(flagged, limits)} Fix {flagged.length === 1 ? 'it' : 'them'} above
                to continue.
              </span>
            </p>
          </>
        ) : (
          <ButtonLink
            to="/checkout"
            size="lg"
            fullWidth
            className="mt-5"
            iconRight={<ArrowRight className="h-5 w-5" aria-hidden />}
          >
            Proceed to Checkout
          </ButtonLink>
        )}
      </Card>
    </div>
  );
}

interface ReorderNoticeProps {
  lines: string[];
  onDismiss: () => void;
  className?: string;
}

/** After "Order Again": what could not be added in full, item by item. Gold = heads-up, not an error. */
function ReorderNotice({ lines, onDismiss, className }: ReorderNoticeProps) {
  return (
    <div
      role="status"
      className={cn(
        'mt-4 flex items-start gap-3 rounded-2xl bg-gold-50 px-4 py-3 text-gold-700 animate-fade-in',
        className,
      )}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-sm leading-snug">
        <p className="font-bold">Not everything could be added</p>
        <ul className="mt-1 space-y-0.5">
          {lines.map((line) => (
            <li key={line} className="wrap-anywhere">
              {line}
            </li>
          ))}
        </ul>
      </div>
      {/* 44px to tap; the negative margins keep the 32px look of the notice's corner. */}
      <IconButton
        label="Dismiss"
        tone="gold"
        onClick={onDismiss}
        className="-mr-3 -mt-2.5"
        icon={<X className="h-4 w-4" aria-hidden />}
      />
    </div>
  );
}
