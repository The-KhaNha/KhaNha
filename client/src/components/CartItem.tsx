import { CircleAlert, UtensilsCrossed } from 'lucide-react';
import { lineLimit, lineProblem, problemLabel } from '../features/cart/cartRules';
import { useCartStore, type CartLine } from '../features/cart/cartStore';
import { cn } from '../lib/cn';
import { FoodPhoto } from './FoodPhoto';
import { Price } from './Price';
import { QuantityStepper, StepperNote } from './QuantityStepper';

interface CartItemProps {
  line: CartLine;
}

/**
 * One cart line. The stepper is the quiet outlined variant so "Proceed to Checkout" stays the only paprika fill.
 * A line the shop can no longer fulfil (sold out, or more than is left) gets a paprika ring, a label naming
 * the problem and a one-tap Fix that trims it to what is available or removes it.
 */
export function CartItem({ line }: CartItemProps) {
  const increment = useCartStore((s) => s.increment);
  const decrement = useCartStore((s) => s.decrement);
  const remove = useCartStore((s) => s.remove);
  const fix = useCartStore((s) => s.fix);
  const limit = lineLimit(line.maxQuantity);
  const problem = lineProblem(line);
  const soldOut = problem?.kind === 'sold-out';

  return (
    <li
      data-flagged={problem ? true : undefined}
      className={cn(
        'flex items-center gap-3.5 py-3.5 animate-fade-in',
        problem && '-mx-2 my-1 rounded-[20px] px-2 ring-2 ring-brand-500',
      )}
    >
      <FoodPhoto src={line.imageUrl} muted={soldOut} className="h-[72px] w-[72px] shrink-0 rounded-[14px]">
        {!line.imageUrl && (
          <UtensilsCrossed className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-muted" aria-hidden />
        )}
      </FoodPhoto>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 wrap-anywhere text-[16px] font-bold leading-[1.3]">{line.name}</p>
        <p className="mt-0.5 text-[13px] text-muted">
          <Price value={line.unitPrice} /> each
        </p>
        <Price value={line.unitPrice * line.quantity} className="mt-1 block text-[20px] font-extrabold leading-none" />
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <QuantityStepper
          tone="neutral"
          removable
          quantity={line.quantity}
          max={limit}
          onIncrement={() => increment(line.menuItemId)}
          onDecrement={() => decrement(line.menuItemId)}
          label={`${line.name} quantity`}
        />
        {problem ? (
          <p role="status" className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-bold text-brand-700">
            <CircleAlert className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
            {problemLabel(problem)}
          </p>
        ) : (
          line.quantity >= limit && <StepperNote maxQuantity={line.maxQuantity} className="mt-1.5" />
        )}
        <div className="-mr-1.5 mt-1 flex items-center gap-1">
          {problem && (
            <button
              type="button"
              onClick={() => fix(line.menuItemId)}
              aria-label={problem.kind === 'over-limit' ? `Set ${line.name} to ${problem.available}` : `Remove ${line.name}`}
              className="h-8 rounded-lg bg-brand-50 px-2.5 text-[13px] font-bold text-brand-700 transition-colors hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              {soldOut ? 'Remove' : 'Fix'}
            </button>
          )}
          {!soldOut && (
            <button
              type="button"
              onClick={() => remove(line.menuItemId)}
              aria-label={`Remove ${line.name}`}
              className="h-8 rounded-lg px-1.5 text-[13px] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-cancel-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
