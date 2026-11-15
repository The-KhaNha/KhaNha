import type { RefObject } from 'react';
import type { MenuItem } from '../types/api';
import { availableQuantity, lineLimit, unavailableLabel } from '../features/cart/cartRules';
import { useAddToCart } from '../features/cart/useAddToCart';
import { selectLimits, selectQuantityOf, useCartStore } from '../features/cart/cartStore';
import { flyToCart } from '../lib/flyToCart';
import { isCustomisable } from '../features/menu/modifierRules';
import { AddButton } from './AddButton';
import { QuantityStepper, StepperNote } from './QuantityStepper';

interface AddControlProps {
  item: MenuItem;
  /** The card's photo: where the fly-to-cart clone takes off from. */
  photoRef: RefObject<HTMLElement>;
  /** Opens the item sheet: an item with choices is added from there, with them (P3.2). */
  onCustomise: () => void;
}

/**
 * The one "order it" control on every menu card (list card and Popular rail alike):
 * a Sold out / Unavailable pill, the filled paprika Add, or the stepper once the item is in the cart.
 * The stepper stops at the item's stock (or the per-order cap) and says so underneath.
 */
export function AddControl({ item, photoRef, onCustomise }: AddControlProps) {
  const quantity = useCartStore(selectQuantityOf(item.id));
  const limits = useCartStore(selectLimits);
  const addToCart = useAddToCart();
  const increment = useCartStore((s) => s.increment);
  const decrement = useCartStore((s) => s.decrement);

  function handleAdd() {
    if (!addToCart(item)) return;
    if (photoRef.current) flyToCart(photoRef.current, item.imageUrl);
  }

  if (!item.isAvailable) {
    return (
      <span className="self-center rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-muted">
        {unavailableLabel(item)}
      </span>
    );
  }

  // Its lines differ by their options, so one stepper here could not say which line it steps: the sheet adds.
  if (isCustomisable(item))
    return <AddButton onAdd={onCustomise} label={`Choose options for ${item.name}`} />;

  const maxQuantity = availableQuantity(item);
  const limit = lineLimit(maxQuantity, limits);

  if (quantity > 0) {
    return (
      <div className="flex flex-col items-end">
        <span className="inline-flex origin-right animate-stepper-in">
          <QuantityStepper
            quantity={quantity}
            max={limit}
            onIncrement={() => increment(item.id)}
            onDecrement={() => decrement(item.id)}
            label={`${item.name} quantity`}
          />
        </span>
        {quantity >= limit && <StepperNote maxQuantity={maxQuantity} className="mt-1" />}
      </div>
    );
  }

  return <AddButton onAdd={handleAdd} />;
}
