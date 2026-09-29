import { Flame } from 'lucide-react';
import { cn } from '../lib/cn';

interface PopularBadgeProps {
  className?: string;
}

/** Saffron "Popular" chip — the ONLY thing allowed on top of a food photo. */
export function PopularBadge({ className }: PopularBadgeProps) {
  return (
    <span
      className={cn(
        'absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full bg-gold-500 px-1.5 py-0.5 text-2xs font-extrabold leading-4 text-ink shadow-sm',
        className,
      )}
    >
      <Flame className="h-3 w-3" fill="currentColor" aria-hidden /> Popular
    </span>
  );
}
