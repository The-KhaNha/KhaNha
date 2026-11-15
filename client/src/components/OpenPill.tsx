import type { OpenStateName } from '../types/api';
import { cn } from '../lib/cn';

interface OpenPillProps {
  state: OpenStateName;
  /** The server's ready-to-show text ("Closes at 9:00 PM", "Closed for Diwali"); the state's name when absent. */
  label?: string | null;
  className?: string;
}

const LOOKS: Record<OpenStateName, { text: string; ink: string; dot: string }> = {
  OPEN: { text: 'Open', ink: 'text-success-700', dot: 'bg-success-500' },
  CLOSING_SOON: { text: 'Closing soon', ink: 'text-gold-700', dot: 'bg-gold-500' },
  PAUSED: { text: 'Paused', ink: 'text-gold-700', dot: 'bg-gold-500' },
  CLOSED: { text: 'Closed', ink: 'text-cancel-700', dot: 'bg-cancel-500' },
  UNAVAILABLE: { text: 'Unavailable', ink: 'text-cancel-700', dot: 'bg-cancel-500' },
};

/** The store's open state as a pill; an open store gets a slow green pulse, one of the two looping animations allowed in the app. */
export function OpenPill({ state, label, className }: OpenPillProps) {
  const look = LOOKS[state];
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-xs font-bold leading-tight shadow-sm',
        look.ink,
        className,
      )}
    >
      <span
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          look.dot,
          state === 'OPEN' && 'pulse-soft [--pulse-color:var(--color-success-500)]',
        )}
      />
      {label ?? look.text}
    </span>
  );
}
