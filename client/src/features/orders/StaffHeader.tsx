import type { ReactNode } from 'react';
import { LogOut, UserRound } from 'lucide-react';
import { Button, ButtonLink } from '../../components/Button';
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
export function StaffHeader({
  storeName,
  now,
  updatedAt,
  offline,
  onLogout,
  children,
}: StaffHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/90 backdrop-blur-md">
      {/* min-h + wrap: at large text the clock and Log out move to a second line instead of off the screen. */}
      <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        <Wordmark />
        <span className="hidden text-line sm:inline">|</span>
        <h1 className="hidden min-w-0 truncate text-body font-bold sm:block">
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
            <p className="text-body font-bold tabular-nums">{formatTime(now)}</p>
            <p className="text-2xs text-muted">
              {updatedAt
                ? `Updated ${formatAgo(updatedAt, now.getTime())}`
                : offline
                  ? 'Offline'
                  : 'Connecting…'}
            </p>
          </div>
          {/* The board is full-screen with no bottom nav: this is staff's way to their profile and settings. */}
          <ButtonLink
            to="/profile"
            variant="secondary"
            aria-label="Profile"
            iconLeft={<UserRound className="h-4 w-4" aria-hidden />}
          >
            <span className="hidden sm:inline">Profile</span>
          </ButtonLink>
          <Button
            variant="secondary"
            onClick={onLogout}
            aria-label="Log out"
            iconLeft={<LogOut className="h-4 w-4" aria-hidden />}
          >
            <span className="hidden sm:inline">Log out</span>
          </Button>
        </div>
      </div>
      {children && <div className="mx-auto max-w-6xl px-4 sm:px-6">{children}</div>}
    </header>
  );
}
