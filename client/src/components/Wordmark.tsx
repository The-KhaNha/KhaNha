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
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        className={cn(
          'grid place-items-center text-white',
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
          'font-extrabold tracking-tight',
          tone === 'inverse' ? 'text-white' : 'text-ink',
          size === 'sm' ? 'text-[17px]' : 'text-2xl',
        )}
      >
        {APP_TITLE}
      </span>
    </span>
  );
}
