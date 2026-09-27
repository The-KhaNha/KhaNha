import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg';
  as?: 'div' | 'section' | 'article';
  /** 'cancel' = the slate-tinted card used for a cancelled order. Set here so it wins over the default surface. */
  tone?: 'default' | 'cancel';
}

const paddings = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-5' } as const;
const tones = {
  default: 'border-line/70 bg-surface',
  cancel: 'border-cancel-500/15 bg-cancel-50',
} as const;

/** White card on cream: the 1px line border keeps it crisp, the warm shadow lifts it. */
export function Card({
  padding = 'md',
  as: Tag = 'div',
  tone = 'default',
  className,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cn('rounded-[28px] border shadow-card', tones[tone], paddings[padding], className)}
      {...rest}
    />
  );
}
