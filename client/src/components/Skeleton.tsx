import { cn } from '../lib/cn';

interface SkeletonProps {
  className?: string;
  /** Rounded-full for avatars/pills. */
  round?: boolean;
}

/**
 * Placeholder block: sunken surface-2 with a soft white sweep. Shape it with width/height classes
 * so it matches the final layout 1:1. The sweep is static under prefers-reduced-motion.
 */
export function Skeleton({ className, round = false }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'relative overflow-hidden bg-surface-2',
        round ? 'rounded-full' : 'rounded-xl',
        className,
      )}
    >
      <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-shimmer" />
    </div>
  );
}
