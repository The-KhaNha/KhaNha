import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: 'brand' | 'neutral';
  className?: string;
}

const tones = {
  brand: 'bg-brand-50 text-brand-600',
  neutral: 'bg-surface-2 text-muted',
} as const;

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = 'brand',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn('flex flex-col items-center px-6 py-14 text-center animate-fade-up', className)}
    >
      <div
        className={cn(
          'grid h-20 w-20 place-items-center rounded-full animate-scale-in',
          tones[tone],
        )}
      >
        <Icon className="h-9 w-9" strokeWidth={1.75} aria-hidden />
      </div>
      <h2 className="mt-6 text-[20px] font-extrabold">{title}</h2>
      {description && (
        <p className="mt-2 max-w-xs text-[15px] leading-relaxed text-muted">{description}</p>
      )}
      {action && (
        <div className="mt-7 flex w-full max-w-xs flex-col items-stretch gap-2">{action}</div>
      )}
    </div>
  );
}
