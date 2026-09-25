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
import { cn } from '../../lib/cn';
import { useFocusTrap } from '../../lib/useFocusTrap';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { availableQuantity, lineLimit } from '../cart/cartRules';
import { selectQuantityOf, useCartStore } from '../cart/cartStore';

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
  const add = useCartStore((s) => s.add);
  const inCart = useCartStore(selectQuantityOf(item?.id ?? ''));
  const reducedMotion = useReducedMotion();
  const [quantity, setQuantity] = useState(1);
  const [phase, setPhase] = useState<Phase>('open');
  const holdTimer = useRef<number | undefined>(undefined);
  const fallbackTimer = useRef<number | undefined>(undefined);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, item !== null);

  const requestClose = useCallback(() => {
    setPhase((current) => (current === 'closing' ? current : 'closing'));
  }, []);

  useEffect(() => {
    if (!item) return;
    setQuantity(1);
    setPhase('open');
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
  const room = Math.max(0, lineLimit(maxQuantity) - inCart);
  const canAdd = !unavailable && room > 0;
  // The stepper's note explains the limit; while it shows, the "Only N left" chip would only repeat it.
  const showNote = canAdd ? quantity >= room : !unavailable;
  const closing = phase === 'closing';
  const added = phase === 'added';
  const titleId = `item-${item.id}-title`;

  function handleAdd() {
    if (!item || phase !== 'open' || !canAdd) return;
    add(item, Math.min(quantity, room));
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
        className={cn('absolute inset-0 bg-ink/45 backdrop-blur-[2px]', closing ? 'animate-fade-out' : 'animate-fade-in')}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onAnimationEnd={handleAnimationEnd}
        className={cn(
          'relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-surface shadow-float outline-none md:max-w-[480px] md:rounded-[28px]',
          closing ? 'animate-sheet-down md:animate-fade-out' : 'animate-sheet-up md:animate-scale-in',
        )}
      >
        <div className="relative shrink-0">
          <FoodPhoto
            src={item.imageUrl}
            alt={item.name}
            eager
            muted={unavailable}
            className="aspect-[4/3] w-full rounded-none"
            imgClassName={cn('origin-center', !reducedMotion && 'animate-photo-zoom')}
          >
            {item.isPopular && !unavailable && <PopularBadge className="left-4 top-4 px-2 py-1 text-[11px]" />}
          </FoodPhoto>
          {/* Cream fade so the photo melts into the text (no dark scrim on food). */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-surface to-transparent" />
          <span aria-hidden className="absolute left-1/2 top-2 h-1 w-9 -translate-x-1/2 rounded-full bg-white/85 md:hidden" />
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            data-autofocus
            className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full bg-surface/95 text-ink shadow-sm transition-transform duration-[120ms] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1 animate-fade-up [animation-delay:40ms]">
          <p className="eyebrow text-muted">{item.category}</p>
          <h2 id={titleId} className="mt-1 wrap-anywhere text-[28px] font-extrabold leading-tight">
            {item.name}
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">{item.description}</p>
          <div className="mt-5 flex items-center justify-between gap-4">
            <div className="flex flex-col items-start">
              <Price value={item.price} className="text-[28px] font-extrabold leading-none" />
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
                {showNote && <StepperNote maxQuantity={maxQuantity} inCart={inCart} className="mt-1.5" />}
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
                item.stockQuantity === 0 ? 'Sold out' : 'Currently unavailable'
              ) : room === 0 ? (
                'Already in your cart'
              ) : added ? (
                'Added'
              ) : (
                <>
                  Add to Cart <span className="text-white/70">·</span> <Price value={item.price * Math.min(quantity, room)} />
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
