import { cn } from '../lib/cn';

interface SwitchProps {
  checked: boolean;
  /** Required: the switch shows no text of its own. */
  label: string;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/** An on/off switch (`role="switch"`), a 44px target around a small track. Flips at once; the caller rolls back. */
export function Switch({ checked, label, onChange, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-11 w-14 shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60',
        className,
      )}
    >
      <span
        className={cn(
          'absolute inset-x-1 top-2.5 h-6 rounded-full',
          checked ? 'bg-success-500' : 'bg-hint',
        )}
      />
      <span
        className={cn(
          'absolute left-2 top-3 h-4 w-4 rounded-full bg-surface transition-transform motion-reduce:transition-none',
          checked && 'translate-x-6',
        )}
      />
    </button>
  );
}
