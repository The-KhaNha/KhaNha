import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { cn } from '../lib/cn';
import { Wordmark } from './Wordmark';

export type TopBarTone = 'default' | 'brand';

interface TopBarProps {
  /** Page title; omit to show the wordmark. */
  title?: string;
  /** Where the back arrow goes; omit to hide it. */
  backTo?: string;
  /** 'brand' paints the bar paprika so the Home hero field runs from the top of the viewport. */
  tone?: TopBarTone;
  right?: ReactNode;
  /** Max-width classes for the inner row; must match the page column (App passes it). */
  widthClass?: string;
}

export function TopBar({ title, backTo, tone = 'default', right, widthClass = 'max-w-md md:max-w-lg' }: TopBarProps) {
  const brand = tone === 'brand';
  return (
    <header
      className={cn(
        'sticky top-0 z-40',
        brand ? 'bg-brand-500 text-white' : 'border-b border-line/60 bg-bg/90 text-ink backdrop-blur-md',
      )}
    >
      <div className={cn('mx-auto flex h-14 items-center gap-1 px-4', widthClass)}>
        {backTo && (
          <Link
            to={backTo}
            aria-label="Back"
            className={cn(
              '-ml-2 grid h-11 w-11 place-items-center rounded-full transition-[background-color,translate,scale] duration-150 active:scale-95',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
              brand ? 'hover:bg-white/15' : 'hover:bg-surface-2',
            )}
          >
            <ChevronLeft className="h-6 w-6" aria-hidden />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          {title ? (
            <h1 className="truncate text-[17px] font-bold">{title}</h1>
          ) : (
            <Link to="/" className="inline-flex rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40" aria-label="Food Pickup home">
              <Wordmark tone={brand ? 'inverse' : 'default'} />
            </Link>
          )}
        </div>
        {right && <div className="flex items-center gap-2">{right}</div>}
      </div>
    </header>
  );
}
