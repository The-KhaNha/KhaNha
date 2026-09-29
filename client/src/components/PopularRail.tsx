import { useCallback, useEffect, useRef, useState } from 'react';
import { Flame } from 'lucide-react';
import type { MenuItem } from '../types/api';
import { availableQuantity, lineLimit } from '../features/cart/cartRules';
import { selectQuantityOf, useCartStore } from '../features/cart/cartStore';
import { cn } from '../lib/cn';
import { cardClasses } from './Card';
import { AddControl } from './AddControl';
import { FoodPhoto } from './FoodPhoto';
import { Price } from './Price';
import { Skeleton } from './Skeleton';
import { StockPill } from './StockPill';

interface PopularRailProps {
  items: MenuItem[];
  onOpen: (item: MenuItem) => void;
  /** Section id used by the chips + scroll spy. */
  id: string;
}

const CARD_WIDTH_CLASS = 'w-[188px]';

/**
 * Horizontal, snap-scrolling rail of big 160px photos: the appetite cue at the top of the menu.
 * On desktop the right edge fades into the page until the last card is in view, so it reads as scrollable.
 */
export function PopularRail({ items, onOpen, id }: PopularRailProps) {
  const scroller = useRef<HTMLUListElement>(null);
  const [atEnd, setAtEnd] = useState(false);

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, items.length]);

  return (
    <section id={`section-${id}`} aria-labelledby={`heading-${id}`} className="pt-5">
      <h2 id={`heading-${id}`} className="eyebrow mb-3 flex items-center gap-1.5 text-muted">
        <Flame className="h-3.5 w-3.5 text-gold-500" fill="currentColor" aria-hidden />
        Popular
      </h2>
      <div className="relative -mx-4">
        <ul
          ref={scroller}
          onScroll={measure}
          className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 pt-1 scroll-px-4"
        >
          {items.map((item) => (
            <RailCard key={item.id} item={item} onOpen={onOpen} />
          ))}
        </ul>
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 right-0 hidden w-16 bg-gradient-to-l from-bg to-transparent transition-opacity duration-200 md:block',
            atEnd && 'opacity-0',
          )}
        />
      </div>
    </section>
  );
}

/**
 * Same add control and stock chip as the list card; the section heading already says Popular, so no chip on the photo.
 * Cards stretch to the tallest one in the rail so a stock chip on one never leaves the row ragged.
 */
function RailCard({ item, onOpen }: { item: MenuItem; onOpen: (item: MenuItem) => void }) {
  const photoRef = useRef<HTMLSpanElement>(null);
  const inCart = useCartStore(selectQuantityOf(item.id));
  const unavailable = !item.isAvailable;
  const showStock = inCart < lineLimit(availableQuantity(item));

  return (
    <li className={cn(CARD_WIDTH_CLASS, 'flex shrink-0 snap-start')}>
      <article
        className={cardClasses(
          'group flex w-full flex-col p-2 transition-[translate,scale,box-shadow] duration-[180ms] ease-out hover:-translate-y-0.5 hover:shadow-card-hover',
          'tile',
        )}
      >
        <button
          type="button"
          onClick={() => onOpen(item)}
          aria-label={`View ${item.name}`}
          className="block w-full rounded-control transition-transform duration-[120ms] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <FoodPhoto
            ref={photoRef}
            src={item.imageUrl}
            muted={unavailable}
            eager
            sizes="188px"
            className="h-40 w-full rounded-control"
            imgClassName="transition-transform duration-[400ms] ease-out group-hover:scale-[1.04]"
          />
        </button>
        <h3
          className={cn(
            'mt-2.5 truncate px-1 text-body font-bold leading-snug',
            unavailable && 'text-muted',
          )}
        >
          {item.name}
        </h3>
        {showStock && <StockPill item={item} className="ml-1 mt-1.5 self-start" />}
        <div className="mt-auto flex items-start justify-between gap-2 pl-1 pt-1.5">
          <Price
            value={item.price}
            className={cn(
              'inline-flex h-11 shrink-0 items-center text-lead font-extrabold',
              unavailable && 'text-muted',
            )}
          />
          <AddControl item={item} photoRef={photoRef} />
        </div>
      </article>
    </li>
  );
}

export function PopularRailSkeleton() {
  return (
    <div className="pt-5">
      <Skeleton className="h-3 w-20" />
      <div className="no-scrollbar -mx-4 mt-3 flex gap-3 overflow-hidden px-4 pt-1">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className={cardClasses(cn(CARD_WIDTH_CLASS, 'shrink-0 p-2'), 'tile')}>
            <Skeleton className="h-40 w-full rounded-control" />
            <Skeleton className="mt-3 h-4 w-3/4" />
            <div className="mt-2 flex items-center justify-between">
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-11 w-[5.25rem]" round />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
