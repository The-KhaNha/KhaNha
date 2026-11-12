import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Price } from '../../components/Price';
import { cn } from '../../lib/cn';
import { useChangeKey } from '../../lib/useChangeKey';
import { selectCount, selectStoreName, selectTotal, useCartStore } from './cartStore';

interface CartBarProps {
  /** Max-width classes matching the page column (App passes it). */
  widthClass?: string;
}

/**
 * Floating ink "View cart" bar above the bottom nav. The total rolls whenever it changes. Hidden on a short screen (a
 * phone on its side, `short:`), where the bars together once covered every item: the TopBar's cart button, on every
 * route that has this bar, still shows the count and opens the cart.
 */
export function CartBar({ widthClass = 'max-w-md md:max-w-lg' }: CartBarProps) {
  const count = useCartStore(selectCount);
  const total = useCartStore(selectTotal);
  const storeName = useCartStore(selectStoreName);
  const totalKey = useChangeKey(total);
  const countKey = useChangeKey(count);

  if (count === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 short:hidden">
      <div className={cn('mx-auto px-4 pb-3', widthClass)}>
        <Link
          to="/cart"
          className="pointer-events-auto flex h-14 items-center gap-3 rounded-2xl bg-ink-fill pl-3 pr-4 text-white shadow-float transition-transform duration-[120ms] active:scale-[0.98] animate-bar-up focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <span className="grid h-8 min-w-8 place-items-center overflow-hidden rounded-lg bg-brand-500 px-2 text-sm font-bold tabular-nums">
            <span
              key={countKey.key}
              className="block animate-count-in"
              style={{ '--roll': countKey.direction > 0 ? '8px' : '-8px' } as CSSProperties}
            >
              {count}
            </span>
          </span>
          {/* The label gives way, never the money: a clipped total would mislead. */}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-bold">
              View cart
              <span className="ml-2 font-medium text-white/60">
                · {count} item{count === 1 ? '' : 's'}
              </span>
            </span>
            {storeName && (
              <span className="block truncate text-2xs font-medium text-white/60">{storeName}</span>
            )}
          </span>
          <span className="shrink-0 overflow-hidden">
            <Price
              key={totalKey.key}
              value={total}
              className="block text-body font-bold animate-count-in"
            />
          </span>
          <ArrowRight className="h-4 w-4 text-white/70" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
