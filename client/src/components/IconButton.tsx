import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> {
  /** Required: an icon alone says nothing to a screen reader. */
  label: string;
  icon: ReactNode;
  /** plain: on a card or page. floating: over a photo or sheet. gold: inside a gold notice. */
  tone?: 'plain' | 'floating' | 'gold';
}

const tones = {
  plain: 'text-muted hover:bg-surface-2 hover:text-ink',
  floating: 'bg-surface/95 text-ink shadow-sm active:scale-95',
  gold: 'text-ink hover:bg-gold-500/20',
} as const;

/** A round 44px icon-only button: the one tap target size and focus ring for every close, dismiss or toggle. */
export function IconButton({
  label,
  icon,
  tone = 'plain',
  type = 'button',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(
        'grid h-11 w-11 shrink-0 place-items-center rounded-full transition-[background-color,color,scale] duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50',
        tones[tone],
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}
