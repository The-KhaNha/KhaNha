import { formatPrice } from '../lib/format';
import { cn } from '../lib/cn';

interface PriceProps {
  value: number;
  className?: string;
}

/** "₹1,240" with tabular numerals. */
export function Price({ value, className }: PriceProps) {
  return <span className={cn('tabular-nums', className)}>{formatPrice(value)}</span>;
}
