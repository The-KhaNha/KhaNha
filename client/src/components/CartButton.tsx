import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag } from 'lucide-react';
import { selectCount, useCartStore } from '../features/cart/cartStore';
import { cn } from '../lib/cn';
import { CART_LANDED_EVENT } from '../lib/flyToCart';
import { useChangeKey } from '../lib/useChangeKey';
import type { TopBarTone } from './TopBar';

interface CartButtonProps {
  tone?: TopBarTone;
}

const BADGE_FADE_MS = 150;

/**
 * Cart icon with a count badge. The badge pops on every count change and fades out when the cart empties.
 * The bag tilts when a flying photo lands on it (see lib/flyToCart).
 */
export function CartButton({ tone = 'default' }: CartButtonProps) {
  const count = useCartStore(selectCount);
  const { key: popKey } = useChangeKey(count);
  const [tilting, setTilting] = useState(false);

  // Keep the badge mounted briefly after the count hits 0 so it can fade out.
  const [shownCount, setShownCount] = useState(count);
  if (count > 0 && shownCount !== count) setShownCount(count);
  useEffect(() => {
    if (count > 0) return;
    const timer = window.setTimeout(() => setShownCount(0), BADGE_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [count]);

  useEffect(() => {
    const onLanded = () => setTilting(true);
    window.addEventListener(CART_LANDED_EVENT, onLanded);
    return () => window.removeEventListener(CART_LANDED_EVENT, onLanded);
  }, []);

  const brand = tone === 'brand';
  const leaving = count === 0 && shownCount > 0;

  return (
    <Link
      to="/cart"
      data-cart-target
      aria-label={count > 0 ? `Cart, ${count} item${count === 1 ? '' : 's'}` : 'Cart'}
      onAnimationEnd={(event) => {
        if (event.animationName === 'bag-tilt') setTilting(false);
      }}
      className={cn(
        'relative grid h-11 w-11 place-items-center rounded-full border transition-[background-color,translate,scale] duration-150 active:scale-95',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
        brand
          ? 'border-white/25 bg-white/15 text-white hover:bg-white/25 focus-visible:ring-white/60 focus-visible:ring-offset-brand-500'
          : 'border-line bg-surface text-ink shadow-hairline hover:bg-surface-2 focus-visible:ring-offset-bg',
        tilting && 'animate-bag-tilt',
      )}
    >
      <ShoppingBag className="h-5 w-5" strokeWidth={2} aria-hidden />
      {shownCount > 0 && (
        <span
          key={leaving ? 'leaving' : popKey}
          className={cn(
            'absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full px-1 text-2xs font-bold tabular-nums ring-2',
            brand ? 'bg-gold-500 text-on-gold ring-brand-500' : 'bg-brand-500 text-white ring-bg',
            leaving ? 'animate-fade-out' : 'animate-pop',
          )}
        >
          {shownCount}
        </span>
      )}
    </Link>
  );
}
