import { Hourglass } from 'lucide-react';
import type { MenuItem } from '../types/api';
import { isLowStock } from '../features/cart/cartRules';
import { selectLimits, useCartStore } from '../features/cart/cartStore';
import { cn } from '../lib/cn';

interface StockPillProps {
  item: Pick<MenuItem, 'isAvailable' | 'stockQuantity'>;
  className?: string;
}

/**
 * Gold "Only N left" chip for an in-stock item that is about to run out. Renders nothing otherwise.
 * It sits beside the item's text: never on the photo (Popular's spot) and never on a control.
 */
export function StockPill({ item, className }: StockPillProps) {
  const limits = useCartStore(selectLimits);
  if (!isLowStock(item, limits)) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-gold-50 px-2 py-0.5 text-2xs font-bold leading-4 text-gold-700 tabular-nums',
        className,
      )}
    >
      <Hourglass className="h-3 w-3" strokeWidth={2.5} aria-hidden />
      Only {item.stockQuantity} left
    </span>
  );
}
