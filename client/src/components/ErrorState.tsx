import type { ReactNode } from 'react';
import { CircleAlert, RefreshCw, WifiOff } from 'lucide-react';
import { Button } from './Button';
import { cardClasses } from './Card';
import { useVersionStore } from '../features/version/versionStore';
import { cn } from '../lib/cn';

interface ErrorStateProps {
  title: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
  /** Use the "offline" glyph when the server can't be reached. */
  unreachable?: boolean;
  /** Compact variant for inline use inside a page section. */
  compact?: boolean;
  /** Custom buttons rendered instead of the single retry button. */
  actions?: ReactNode;
  className?: string;
}

/** Friendly failure block. Paprika tint + icon carries the meaning; no red text on cream. */
export function ErrorState({
  title,
  message = 'Something went wrong.',
  onRetry,
  retryLabel = 'Try Again',
  retrying = false,
  unreachable = false,
  compact = false,
  actions,
  className,
}: ErrorStateProps) {
  // This build is too old (426): retrying would only fail again, so the one useful action is loading the new build.
  const outdated = useVersionStore((s) => s.outdated);
  const Icon = unreachable ? WifiOff : CircleAlert;
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center text-center animate-fade-up',
        compact ? cardClasses('px-5 py-8') : 'px-6 py-14',
        className,
      )}
    >
      <div
        className={cn(
          'grid place-items-center rounded-full bg-brand-50 text-brand-600 animate-scale-in',
          compact ? 'h-14 w-14' : 'h-20 w-20',
        )}
      >
        <Icon className={compact ? 'h-6 w-6' : 'h-9 w-9'} strokeWidth={1.75} aria-hidden />
      </div>
      <h2 className={cn('mt-5 font-extrabold', compact ? 'text-lg' : 'text-xl')}>{title}</h2>
      <p className="mt-2 max-w-xs text-body leading-relaxed text-muted">{message}</p>
      {actions && (
        <div className="mt-6 flex w-full max-w-xs flex-col items-stretch gap-2">{actions}</div>
      )}
      {!actions && (outdated || onRetry) && (
        <Button
          variant="secondary"
          className="mt-6 min-w-40"
          onClick={outdated ? () => window.location.reload() : onRetry}
          loading={!outdated && retrying}
          iconLeft={<RefreshCw className="h-4 w-4" aria-hidden />}
        >
          {outdated ? 'Refresh' : retryLabel}
        </Button>
      )}
    </div>
  );
}
