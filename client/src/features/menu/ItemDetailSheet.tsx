import { useCallback, useEffect, useRef, useState, type AnimationEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ShoppingBag, X } from 'lucide-react';
import type { MenuItem } from '../../types/api';
import { Button } from '../../components/Button';
import { FoodPhoto } from '../../components/FoodPhoto';
import { PopularBadge } from '../../components/PopularBadge';
import { Price } from '../../components/Price';
import { QuantityStepper, StepperNote } from '../../components/QuantityStepper';
import { StockPill } from '../../components/StockPill';
import { IconButton } from '../../components/IconButton';
import { cn } from '../../lib/cn';
import { useFocusTrap } from '../../lib/useFocusTrap';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { useAddToCart } from '../cart/useAddToCart';
import { availableQuantity, lineLimit } from '../cart/cartRules';
import { selectLimits, selectQuantityOf, useCartStore } from '../cart/cartStore';

interface ItemDetailSheetProps {
  item: MenuItem | null;
  onClose: () => void;
}

type Phase = 'open' | 'added' | 'closing';

/** How long the green "Added" state holds before the sheet slides away. */
const ADDED_HOLD_MS = 600;
/** Safety net in case animationend never fires (e.g. the tab is hidden). */
const CLOSE_FALLBACK_MS = 400;

/**
 * Bottom sheet on phones, centred dialog on desktop. Escape and the backdrop close it.
 * Focus moves to the close button on open, stays inside while open, and returns to the card afterwards.
 * "Add to Cart" flips the CTA green, holds, then the sheet animates out before unmounting.
 * The local count can only go as high as what is left after what the cart already holds.
 */
export function ItemDetailSheet({ item, onClose }: ItemDetailSheetProps) {
  const addToCart = useAddToCart();
  const inCart = useCartStore(selectQuantityOf(item?.id ?? ''));
  const limits = useCartStore(selectLimits);
  const reducedMotion = useReducedMotion();
  const [quantity, setQuantity] = useState(1);
  const [phase, setPhase] = useState<Phase>('open');
  const holdTimer = useRef<number | undefined>(undefined);
  const fallbackTimer = useRef<number | undefined>(undefined);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, item !== null);

  const requestClose = useCallback(() => setPhase('closing'), []);

  // A new item starts fresh; reset during render rather than in the effect below.
  const [shownItem, setShownItem] = useState(item);
  if (item !== shownItem) {
    setShownItem(item);
    setQuantity(1);
    setPhase('open');
  }

  useEffect(() => {
    if (!item) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(holdTimer.current);
      window.clearTimeout(fallbackTimer.current);
    };
  }, [item, requestClose]);

  // Fallback so the sheet always unmounts even if the exit animation event is lost.
  useEffect(() => {
    if (phase !== 'closing') return;
    fallbackTimer.current = window.setTimeout(onClose, CLOSE_FALLBACK_MS);
    return () => window.clearTimeout(fallbackTimer.current);
  }, [phase, onClose]);

  if (!item) return null;

  const unavailable = !item.isAvailable;
  const maxQuantity = availableQuantity(item);
  // How many more can still go in the cart: the stock (or per-order cap) minus what is already there.
  const room = Math.max(0, lineLimit(maxQuantity, limits) - inCart);
  const canAdd = !unavailable && room > 0;
  // The stepper's note explains the limit; while it shows, the "Only N left" chip would only repeat it.
  const showNote = canAdd ? quantity >= room : !unavailable;
  const closing = phase === 'closing';
  const added = phase === 'added';
  const titleId = `item-${item.id}-title`;

  function handleAdd() {
    if (!item || phase !== 'open' || !canAdd) return;
    // Asked first (another store's cart): the replace sheet takes over, so this one just closes.
    if (!addToCart(item, Math.min(quantity, room))) return requestClose();
    setPhase('added');
    holdTimer.current = window.setTimeout(requestClose, ADDED_HOLD_MS);
  }

  function handleAnimationEnd(event: AnimationEvent<HTMLDivElement>) {
    if (closing && event.target === event.currentTarget) onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={requestClose}
        tabIndex={-1}
        className={cn(
          'absolute inset-0 bg-overlay/45 backdrop-blur-[2px]',
          closing ? 'animate-fade-out' : 'animate-fade-in',
        )}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onAnimationEnd={handleAnimationEnd}
        className={cn(
          'relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-card bg-surface shadow-float outline-none md:max-w-[480px] md:rounded-card',
          closing
            ? 'animate-sheet-down md:animate-fade-out'
            : 'animate-sheet-up md:animate-scale-in',
        )}
      >
        <div className="relative shrink-0">
          <FoodPhoto
            src={item.imageUrl}
            srcSet={item.imageSrcSet}
            alt={item.name}
            eager
            muted={unavailable}
            sizes="(min-width: 768px) 480px, 100vw"
            className="aspect-[4/3] w-full rounded-none"
            imgClassName={cn('origin-center', !reducedMotion && 'animate-photo-zoom')}
          >
            {item.isPopular && !unavailable && (
              <PopularBadge className="left-4 top-4 px-2 py-1 text-2xs" />
            )}
          </FoodPhoto>
          {/* Cream fade so the photo melts into the text (no dark scrim on food). */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-surface to-transparent"
          />
          <span
            aria-hidden
            className="absolute left-1/2 top-2 h-1 w-9 -translate-x-1/2 rounded-full bg-white/85 md:hidden"
          />
          <IconButton
            label="Close"
            tone="floating"
            onClick={requestClose}
            data-autofocus
            className="absolute right-3 top-3"
            icon={<X className="h-5 w-5" aria-hidden />}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1 animate-fade-up [animation-delay:40ms]">
          <p className="eyebrow text-muted">{item.category}</p>
          <h2 id={titleId} className="mt-1 wrap-anywhere text-title font-extrabold leading-tight">
            {item.name}
          </h2>
          <p className="mt-2 text-body leading-relaxed text-muted">{item.description}</p>
          <div className="mt-5 flex items-center justify-between gap-4">
            <div className="flex flex-col items-start">
              <Price value={item.price} className="text-title font-extrabold leading-none" />
              {!showNote && <StockPill item={item} className="mt-2.5" />}
            </div>
            {unavailable ? (
              <span className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-muted">
                {item.stockQuantity === 0 ? 'Sold out' : 'Currently unavailable'}
              </span>
            ) : room === 0 ? (
              <StepperNote maxQuantity={maxQuantity} inCart={inCart} className="text-right" />
            ) : (
              <div className="flex flex-col items-end">
                <QuantityStepper
                  tone="neutral"
                  size="md"
                  quantity={quantity}
                  max={room}
                  onIncrement={() => setQuantity((q) => Math.min(room, q + 1))}
                  onDecrement={() => setQuantity((q) => Math.max(1, q - 1))}
                />
                {showNote && (
                  <StepperNote maxQuantity={maxQuantity} inCart={inCart} className="mt-1.5" />
                )}
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-line/70 p-4 pb-safe animate-fade-up [animation-delay:80ms]">
          <div className="pb-2">
            <Button
              size="lg"
              fullWidth
              variant={added ? 'success' : 'primary'}
              disabled={!canAdd || closing}
              onClick={handleAdd}
              iconLeft={
                added ? (
                  <Check className="h-5 w-5 animate-check-pop" strokeWidth={3} aria-hidden />
                ) : (
                  <ShoppingBag className="h-5 w-5" aria-hidden />
                )
              }
            >
              {unavailable ? (
                item.stockQuantity === 0 ? (
                  'Sold out'
                ) : (
                  'Currently unavailable'
                )
              ) : room === 0 ? (
                'Already in your cart'
              ) : added ? (
                'Added'
              ) : (
                <>
                  Add to Cart <span className="text-white/70">·</span>{' '}
                  <Price value={item.price * Math.min(quantity, room)} />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
