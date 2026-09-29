import type { CSSProperties } from 'react';
import type { OrderStatus } from '../types/api';
import { isActive, statusMeta } from '../features/orders/orderStatus';
import { cn } from '../lib/cn';

interface StatusBadgeProps {
  status: OrderStatus;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Tinted status pill. The dot pulses only while the order is still moving, with the app's one soft pulse (never a
 * stock Tailwind loop: the design allows two looping animations, docs/DESIGN.md "Motion").
 */
export function StatusBadge({ status, size = 'sm', className }: StatusBadgeProps) {
  const meta = statusMeta(status);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-semibold transition-colors duration-300',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
        meta.badgeClass,
        className,
      )}
    >
      <span
        className={cn(
          'inline-flex h-1.5 w-1.5 rounded-full bg-current',
          isActive(status) && 'animate-pulse-soft',
        )}
        style={
          isActive(status) ? ({ '--pulse-color': meta.pulseColor } as CSSProperties) : undefined
        }
      />
      {meta.label}
    </span>
  );
}
