import { CircleAlert, UtensilsCrossed } from 'lucide-react';
import { lineAllowance, lineProblem, problemLabel } from '../features/cart/cartRules';
import { selectLimits, selectLines, useCartStore, type CartLine } from '../features/cart/cartStore';
import { cn } from '../lib/cn';
import { FoodPhoto } from './FoodPhoto';
import { Price } from './Price';
import { QuantityStepper, StepperNote } from './QuantityStepper';

interface CartItemProps {
  line: CartLine;
}

/** A 44px tap target around a 32px visible pill (PILL), so the row stays compact. */
const HIT_AREA = 'group grid h-11 min-w-11 place-items-center focus-visible:outline-none';
const PILL =
  'grid h-8 place-items-center rounded-lg text-caption transition-colors group-focus-visible:ring-2 group-focus-visible:ring-focus';

/**
 * One cart line. The stepper is the quiet outlined variant so "Proceed to Checkout" stays the only paprika fill.
 * A line the shop can no longer fulfil (sold out, or more than is left) gets a paprika ring, a label naming
 * the problem and a one-tap Fix that trims it to what is available or removes it.
 */
export function CartItem({ line }: CartItemProps) {
  const increment = useCartStore((s) => s.increment);
  const decrement = useCartStore((s) => s.decrement);
  const remove = useCartStore((s) => s.remove);
  const limits = useCartStore(selectLimits);
  const fix = useCartStore((s) => s.fix);
  const lines = useCartStore(selectLines);
  // The item's limit is shared by its lines (one per choice of options).
  const limit = lineAllowance(line, limits, lines);
  const problem = lineProblem(line, limits, lines);
  const soldOut = problem?.kind === 'sold-out';

  return (
    <li
      data-flagged={problem ? true : undefined}
      className={cn(
        // Wraps at large text: the stepper moves under the name instead of squeezing it to nothing.
        'flex flex-wrap items-center gap-3.5 py-3.5 animate-fade-in',
        problem && '-mx-2 my-1 rounded-tile px-2 ring-2 ring-brand-500',
      )}
    >
      <FoodPhoto
        src={line.imageUrl}
        muted={soldOut}
        className="h-[72px] w-[72px] shrink-0 rounded-control"
      >
        {!line.imageUrl && (
          <UtensilsCrossed
            className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-muted"
            aria-hidden
          />
        )}
      </FoodPhoto>
      <div className="min-w-0 flex-[1_1_4.5rem]">
        <p className="line-clamp-2 wrap-anywhere text-base font-bold leading-[1.3]">{line.name}</p>
        <p className="mt-0.5 text-caption text-muted">
          <Price value={line.unitPrice} /> each
        </p>
        <Price
          value={line.unitPrice * line.quantity}
          className="mt-1 block text-xl font-extrabold leading-none"
        />
      </div>
      <div className="ml-auto flex shrink-0 flex-col items-end">
        <QuantityStepper
          tone="neutral"
          removable
          quantity={line.quantity}
          max={limit}
          onIncrement={() => increment(line.lineKey)}
          onDecrement={() => decrement(line.lineKey)}
          label={`${line.name} quantity`}
        />
        {problem ? (
          <p
            role="status"
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-brand-700"
          >
            <CircleAlert className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
            {problemLabel(problem)}
          </p>
        ) : (
          line.quantity >= limit && (
            <StepperNote maxQuantity={line.maxQuantity} className="mt-1.5" />
          )
        )}
        {/* 44px buttons around the smaller visible pills; the negative margins keep the row's spacing. */}
        <div className="-my-1 -mr-1.5 flex items-center gap-1">
          {problem && (
            <button
              type="button"
              onClick={() => fix(line.lineKey)}
              aria-label={
                problem.kind === 'over-limit'
                  ? `Set ${line.name} to ${problem.available}`
                  : `Remove ${line.name}`
              }
              className={HIT_AREA}
            >
              <span
                className={cn(
                  PILL,
                  'bg-brand-50 px-2.5 font-bold text-brand-700 group-hover:bg-brand-100',
                )}
              >
                {soldOut ? 'Remove' : 'Fix'}
              </span>
            </button>
          )}
          {!soldOut && (
            <button
              type="button"
              onClick={() => remove(line.lineKey)}
              aria-label={`Remove ${line.name}`}
              className={HIT_AREA}
            >
              <span
                className={cn(
                  PILL,
                  'px-1.5 font-semibold text-muted group-hover:bg-surface-2 group-hover:text-cancel-700',
                )}
              >
                Remove
              </span>
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
