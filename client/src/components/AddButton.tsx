import { Plus } from 'lucide-react';
import { cn } from '../lib/cn';

interface AddButtonProps {
  onAdd: () => void;
  disabled?: boolean;
  className?: string;
  /** The accessible name; "Add to cart" unless the tap does something else (opens an item's choices). */
  label?: string;
}

/**
 * Filled paprika "+ Add" pill: the one "order it" trigger beside every photo.
 * Feedback lives elsewhere (photo flight, stepper swap, cart badge), so this button stays quiet.
 */
export function AddButton({
  onAdd,
  disabled = false,
  className,
  label = 'Add to cart',
}: AddButtonProps) {
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'inline-flex h-11 min-w-[5.25rem] items-center justify-center gap-1 rounded-full bg-brand-500 px-4 text-body font-bold text-white shadow-brand',
        'transition-[background-color,translate,scale,box-shadow] duration-[120ms] ease-out hover:bg-brand-deep hover:shadow-brand-hover active:scale-[0.94]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        'disabled:opacity-50',
        className,
      )}
    >
      <Plus className="h-4 w-4" strokeWidth={2.75} aria-hidden />
      Add
    </button>
  );
}
