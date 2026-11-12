import type { ReactNode } from 'react';
import { LogOut, UserRound } from 'lucide-react';
import { Button, ButtonLink } from '../../components/Button';
import { Wordmark } from '../../components/Wordmark';
import { formatAgo, formatTime } from '../../lib/format';
import { useNow } from '../../lib/useNow';

interface StaffHeaderProps {
  /** The store's name, from the signed-in user's membership. */
  storeName?: string;
  /** Timestamp of the last successful orders fetch. */
  updatedAt: number | null;
  /** True when the last fetch failed and nothing has loaded yet. */
  offline: boolean;
  onLogout: () => void;
  /** The pause control, in a row of its own so it never moves the board when the store loads. */
  pause?: ReactNode;
  /** The filter row, rendered inside the sticky header. */
  children?: ReactNode;
}

/** Sticky dashboard header: wordmark, shop name, live clock + freshness, log out. */
export function StaffHeader({
  storeName,
  updatedAt,
  offline,
  onLogout,
  pause,
  children,
}: StaffHeaderProps) {
  // The clock lives here, not in the page: a tick re-renders the header, never the board of cards below it.
  const now = useNow(1000);
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
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2 text-right">
          {/* As wide as the longest status ("Updated 59 min ago"): if its width followed the text, the cluster would
              fit beside the wordmark while "Connecting…" and wrap under it once the first poll landed, moving the
              board down. */}
          <div className="min-w-[7.5rem] leading-tight">
            <p className="text-body font-bold tabular-nums">{formatTime(now)}</p>
            <p className="whitespace-nowrap text-2xs text-muted">
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
      {pause && (
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 px-4 sm:px-6">
          {/* The heading is hidden on a phone: the pause row names the store it acts on. */}
          {storeName && <p className="truncate text-body font-bold sm:hidden">{storeName}</p>}
          {pause}
        </div>
      )}
      {children && <div className="mx-auto max-w-6xl px-4 sm:px-6">{children}</div>}
    </header>
  );
}
