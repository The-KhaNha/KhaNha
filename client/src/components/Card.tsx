import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  as?: 'div' | 'section' | 'article';
  /** 'cancel' = the slate-tinted card used for a cancelled order. Set here so it wins over the default surface. */
  tone?: 'default' | 'cancel';
}

const paddings = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-5', xl: 'p-6 md:p-8' } as const;
const tones = {
  default: 'border-line/70 bg-surface',
  cancel: 'border-cancel-500/15 bg-cancel-50',
} as const;

const base = 'rounded-card border shadow-card';

/** The default card's classes, for a component that picks its root element itself (ErrorState's compact box). */
export function cardClasses(extra?: string) {
  return cn(base, tones.default, extra);
}

/** White card on cream: the 1px line border keeps it crisp, the warm shadow lifts it. */
export function Card({
  padding = 'md',
  as: Tag = 'div',
  tone = 'default',
  className,
  ...rest
}: CardProps) {
  return <Tag className={cn(base, tones[tone], paddings[padding], className)} {...rest} />;
}
