import { useState, type AnimationEvent, type CSSProperties } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { limitCaption } from '../features/cart/cartRules';
import { selectLimits, useCartStore } from '../features/cart/cartStore';
import { cn } from '../lib/cn';
import { useChangeKey } from '../lib/useChangeKey';

interface QuantityStepperProps {
  quantity: number;
  onIncrement: () => void;
  /** At the minimum this removes the line (trash icon) when `removable`; otherwise the minus is disabled. */
  onDecrement: () => void;
  min?: number;
  /** The plus refuses once the quantity reaches this: it looks disabled and a tap only shakes the pill. */
  max?: number;
  tone?: 'brand' | 'neutral';
  /** Defaults to true for the brand tone (menu cards) and false for neutral (the sheet's local count). */
  removable?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  label?: string;
}

/**
 * Pill stepper. The digit rolls up on increment / down on decrement, the minus crossfades into a trash
 * can at the minimum when the line can be removed, and the pressed half flashes. Both halves are >= 44px tap targets.
 * At `max` the plus stays tappable so the refusal is felt (a short shake) rather than silently ignored;
 * the caller says why underneath (see StepperNote).
 */
export function QuantityStepper({
  quantity,
  onIncrement,
  onDecrement,
  min = 1,
  max,
  tone = 'brand',
  removable = tone === 'brand',
  size = 'sm',
  className,
  label = 'Quantity',
}: QuantityStepperProps) {
  const atMin = quantity <= min;
  const atMax = max !== undefined && quantity >= max;
  const showTrash = removable && atMin;
  const disableMinus = !removable && atMin;
  const { key, direction } = useChangeKey(quantity);
  const [shaking, setShaking] = useState(false);

  function handleIncrement() {
    if (atMax) setShaking(true);
    else onIncrement();
  }

  function handleAnimationEnd(event: AnimationEvent<HTMLDivElement>) {
    if (event.animationName === 'shake') setShaking(false);
  }

  // Neutral uses an outer ring, not a border: a border would eat 2px of the 44px height and shrink both tap targets.
  const shell =
    tone === 'brand'
      ? 'bg-brand-500 text-white shadow-brand'
      : 'bg-surface text-ink ring-1 ring-line shadow-hairline';
  const half = cn(
    'relative grid h-full place-items-center transition-[background-color,translate,scale] duration-[120ms]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-40',
    tone === 'brand' ? 'focus-visible:ring-white/70' : 'focus-visible:ring-focus',
    size === 'sm' ? 'w-11' : 'w-12',
  );
  const pressable =
    tone === 'brand'
      ? 'active:scale-95 hover:bg-white/15 active:bg-white/25'
      : 'active:scale-95 hover:bg-surface-2 active:bg-line';

  return (
    <div
      role="group"
      aria-label={label}
      onAnimationEnd={handleAnimationEnd}
      className={cn(
        'inline-flex items-center overflow-hidden rounded-full',
        shell,
        size === 'sm' ? 'h-11' : 'h-12',
        shaking && 'animate-shake',
        className,
      )}
    >
      <button
        type="button"
        onClick={onDecrement}
        disabled={disableMinus}
        aria-label={showTrash ? 'Remove' : 'Decrease quantity'}
        className={cn(half, pressable)}
      >
        <span className="relative block h-4 w-4">
          <Minus
            className={cn(
              'absolute inset-0 h-4 w-4 transition-opacity duration-150',
              showTrash && 'opacity-0',
            )}
            aria-hidden
          />
          <Trash2
            className={cn(
              'absolute inset-0 h-4 w-4 transition-opacity duration-150',
              !showTrash && 'opacity-0',
            )}
            aria-hidden
          />
        </span>
      </button>
      <span
        aria-live="polite"
        className={cn(
          'grid min-w-6 place-items-center text-center font-bold tabular-nums',
          size === 'sm' ? 'text-body' : 'text-base',
        )}
      >
        <span
          key={key}
          className="block animate-count-in"
          style={{ '--roll': direction > 0 ? '8px' : '-8px' } as CSSProperties}
        >
          {quantity}
        </span>
      </span>
      <button
        type="button"
        onClick={handleIncrement}
        aria-disabled={atMax || undefined}
        aria-label={atMax ? `Maximum ${max} reached` : 'Increase quantity'}
        className={cn(half, atMax ? 'cursor-not-allowed opacity-40' : pressable)}
      >
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

interface StepperNoteProps {
  /** The line's stock limit; null/undefined = none, so only the per-order cap applies. */
  maxQuantity: number | null | undefined;
  /** How many are already in the cart, when the stepper counts from zero (the item sheet). */
  inCart?: number;
  className?: string;
}

/** Why the plus stopped: gold for a stock limit ("Only 2 available"), muted for the per-order cap. */
export function StepperNote({ maxQuantity, inCart = 0, className }: StepperNoteProps) {
  const limits = useCartStore(selectLimits);
  const stockLimited =
    maxQuantity !== null && maxQuantity !== undefined && maxQuantity < limits.maxQuantityPerItem;
  return (
    <p
      className={cn(
        'text-2xs font-semibold tabular-nums',
        stockLimited ? 'text-gold-700' : 'text-muted',
        className,
      )}
    >
      {limitCaption(maxQuantity, limits)}
      {inCart > 0 && ` · ${inCart} in your cart`}
    </p>
  );
}
