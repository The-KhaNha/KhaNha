import { memo, useRef } from 'react';
import type { MenuItem } from '../types/api';
import { availableQuantity, lineLimit } from '../features/cart/cartRules';
import { selectQuantityOf, useCartStore } from '../features/cart/cartStore';
import { cn } from '../lib/cn';
import { cardClasses } from './Card';
import { AddControl } from './AddControl';
import { FoodPhoto } from './FoodPhoto';
import { PopularBadge } from './PopularBadge';
import { Price } from './Price';
import { Skeleton } from './Skeleton';
import { StockPill } from './StockPill';

interface FoodCardProps {
  item: MenuItem;
  onOpen: (item: MenuItem) => void;
  showPopularBadge?: boolean;
}

/**
 * Menu list card: 112px photo, ink price, filled Add that swaps to a stepper once the item is in the cart.
 * Items about to run out carry a gold "Only N left" chip until the cart holds all that is left;
 * from then on the stepper's note ("Only N available") says it instead.
 *
 * Memoised: the menu page re-renders when its sheet opens, and a menu can hold 500 cards whose props (the item, a
 * stable onOpen) have not changed.
 */
export const FoodCard = memo(function FoodCard({
  item,
  onOpen,
  showPopularBadge = true,
}: FoodCardProps) {
  const photoRef = useRef<HTMLSpanElement>(null);
  const inCart = useCartStore(selectQuantityOf(item.id));
  const unavailable = !item.isAvailable;
  const showStock = inCart < lineLimit(availableQuantity(item));

  return (
    <article
      className={cardClasses(
        // flex-wrap + the text column's basis: at large text the column drops under the photo instead of pushing
        // the price and Add off the screen.
        'group flex flex-wrap gap-3.5 p-3 transition-[translate,scale,box-shadow] duration-[180ms] ease-out hover:-translate-y-0.5 hover:shadow-card-hover',
        'tile',
      )}
    >
      {/* The title button is the card's single tab stop; the photo is a pointer-only duplicate of it. */}
      <button
        type="button"
        onClick={() => onOpen(item)}
        tabIndex={-1}
        aria-hidden
        className="relative shrink-0 self-start rounded-control transition-transform duration-[120ms] active:scale-[0.98] focus:outline-none"
      >
        <FoodPhoto
          ref={photoRef}
          src={item.imageUrl}
          muted={unavailable}
          className="h-28 w-28 rounded-control"
          imgClassName="transition-transform duration-[400ms] ease-out group-hover:scale-[1.04]"
        >
          {showPopularBadge && item.isPopular && !unavailable && <PopularBadge />}
        </FoodPhoto>
      </button>

      <div className="flex min-w-0 flex-[1_1_9.5rem] flex-col">
        <button
          type="button"
          onClick={() => onOpen(item)}
          className="min-h-11 min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <h3
            className={cn(
              'truncate text-base font-bold leading-[1.3]',
              unavailable && 'text-muted',
            )}
          >
            {item.name}
          </h3>
          <p className="mt-0.5 line-clamp-2 text-caption leading-snug text-muted">
            {item.description}
          </p>
        </button>

        {showStock && <StockPill item={item} className="mt-1.5 self-start" />}

        {/* items-start + a 44px price box keeps the price centred on the stepper even when a note hangs below it. */}
        <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
          <Price
            value={item.price}
            className={cn(
              'inline-flex h-11 items-center text-lead font-extrabold',
              unavailable && 'text-muted',
            )}
          />
          <AddControl item={item} photoRef={photoRef} />
        </div>
      </div>
    </article>
  );
});

export function FoodCardSkeleton() {
  return (
    <div className={cardClasses('flex gap-3.5 p-3', 'tile')}>
      <Skeleton className="h-28 w-28 shrink-0 rounded-control" />
      <div className="flex flex-1 flex-col">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="mt-2 h-3 w-full" />
        <Skeleton className="mt-1.5 h-3 w-4/5" />
        <div className="mt-auto flex items-center justify-between">
          <Skeleton className="h-5 w-12" />
          <Skeleton className="h-11 w-[5.25rem]" round />
        </div>
      </div>
    </div>
  );
}
