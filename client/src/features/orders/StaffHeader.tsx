import type { ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import { Button } from '../../components/Button';
import { Wordmark } from '../../components/Wordmark';
import { formatAgo, formatTime } from '../../lib/format';

interface StaffHeaderProps {
  /** From GET /api/store; undefined while it loads. */
  storeName?: string;
  now: Date;
  /** Timestamp of the last successful orders fetch. */
  updatedAt: number | null;
  /** True when the last fetch failed and nothing has loaded yet. */
  offline: boolean;
  onLogout: () => void;
  /** The filter row, rendered inside the sticky header. */
  children?: ReactNode;
}

/** Sticky dashboard header: wordmark, shop name, live clock + freshness, log out. */
export function StaffHeader({ storeName, now, updatedAt, offline, onLogout, children }: StaffHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Wordmark />
        <span className="hidden text-line sm:inline">|</span>
        <h1 className="hidden min-w-0 truncate text-[15px] font-bold sm:block">
          {storeName ? (
            <>
              {storeName} <span className="text-muted">· Staff</span>
            </>
          ) : (
            'Staff'
          )}
        </h1>
        <div className="ml-auto flex items-center gap-3 text-right">
          <div className="leading-tight">
            <p className="text-[15px] font-bold tabular-nums">{formatTime(now)}</p>
            <p className="text-[11px] text-muted">
              {updatedAt ? `Updated ${formatAgo(updatedAt, now.getTime())}` : offline ? 'Offline' : 'Connecting…'}
            </p>
          </div>
          <Button variant="secondary" onClick={onLogout} aria-label="Log out" iconLeft={<LogOut className="h-4 w-4" aria-hidden />}>
            <span className="hidden sm:inline">Log out</span>
          </Button>
        </div>
      </div>
      {children && <div className="mx-auto max-w-6xl px-4 sm:px-6">{children}</div>}
    </header>
  );
}
