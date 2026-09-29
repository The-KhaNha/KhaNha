import { cn } from '../lib/cn';

interface OpenPillProps {
  isOpen: boolean;
  className?: string;
}

/** "Open" with a slow green pulse — one of the two looping animations allowed in the app. */
export function OpenPill({ isOpen, className }: OpenPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-xs font-bold shadow-sm',
        isOpen ? 'text-success-700' : 'text-cancel-700',
        className,
      )}
    >
      <span
        className={cn(
          'h-2 w-2 rounded-full',
          isOpen
            ? 'bg-success-500 pulse-soft [--pulse-color:var(--color-success-500)]'
            : 'bg-cancel-500',
        )}
      />
      {isOpen ? 'Open' : 'Closed'}
    </span>
  );
}
