import { ShoppingBag } from 'lucide-react';
import { cn } from '../lib/cn';
import { APP_TITLE } from '../config/app';

interface WordmarkProps {
  size?: 'sm' | 'lg';
  /** 'inverse' sits on the paprika field: white text, translucent white disc. */
  tone?: 'default' | 'inverse';
  className?: string;
}

export function Wordmark({ size = 'sm', tone = 'default', className }: WordmarkProps) {
  return (
    // min-w-0 + truncate: at large text the name gives way and the mark stays whole, instead of pushing the header
    // past the screen edge.
    <span className={cn('inline-flex min-w-0 items-center gap-2.5', className)}>
      <span
        className={cn(
          'grid shrink-0 place-items-center text-white',
          tone === 'inverse' ? 'bg-white/15 ring-1 ring-white/25' : 'bg-brand-500 shadow-brand',
          size === 'sm' ? 'h-8 w-8 rounded-xl' : 'h-11 w-11 rounded-2xl',
        )}
      >
        <ShoppingBag
          className={size === 'sm' ? 'h-4 w-4' : 'h-6 w-6'}
          strokeWidth={2.25}
          aria-hidden
        />
      </span>
      <span
        className={cn(
          'truncate font-extrabold tracking-tight',
          tone === 'inverse' ? 'text-white' : 'text-ink',
          size === 'sm' ? 'text-lead' : 'text-2xl',
        )}
      >
        {APP_TITLE}
      </span>
    </span>
  );
}
