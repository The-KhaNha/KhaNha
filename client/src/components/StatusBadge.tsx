import type { OrderStatus } from '../types/api';
import { STATUS_META, isActive } from '../features/orders/orderStatus';
import { cn } from '../lib/cn';

interface StatusBadgeProps {
  status: OrderStatus;
  size?: 'sm' | 'md';
  className?: string;
}

/** Tinted status pill. The dot pings only while the order is still moving. */
export function StatusBadge({ status, size = 'sm', className }: StatusBadgeProps) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-semibold transition-colors duration-300',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
        meta.badgeClass,
        className,
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {isActive(status) && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
        )}
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
      </span>
      {meta.label}
    </span>
  );
}
