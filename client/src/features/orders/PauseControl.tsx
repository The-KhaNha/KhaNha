import { useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { Store } from '../../types/api';
import { Button } from '../../components/Button';
import { useNow } from '../../lib/useNow';
import { ApiError } from '../../services/api';
import { pauseStore, resumeStore } from '../../services/stores';

const PRESETS: { label: string; minutes?: number }[] = [
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '60 min', minutes: 60 },
  { label: 'Until I resume' },
];

interface PauseControlProps {
  storeId: string;
  /** undefined while it loads: the button waits, and keeps its place. */
  store?: Store;
  /** The store resource's `mutate`: the tap shows its result at once, a failure puts the old store back. */
  mutate: (updater: (previous: Store) => Store) => void;
  /** The store could not be loaded and nothing is saved: say so and offer a retry, not a silently disabled button. */
  loadFailed?: boolean;
  onRetry?: () => void;
}

/** Pause new orders (15, 30, 60 minutes or until resumed) and Resume, for the staff header. Instant, with rollback. */
export function PauseControl({ storeId, store, mutate, loadFailed, onRetry }: PauseControlProps) {
  const now = useNow(15_000);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One request at a time: a late answer must never overwrite a newer change (pause, then Resume at once).
  const [pending, setPending] = useState(false);

  const until = store?.nextChangeAt ? Date.parse(store.nextChangeAt) : null;
  // A timed pause that ran out is over even before the next refresh says so.
  const paused = store?.openState === 'PAUSED' && (until === null || until > now.getTime());
  const minutesLeft = until === null ? null : Math.round((until - now.getTime()) / 60_000);

  async function change(next: Partial<Store>, request: () => Promise<Store>) {
    if (!store || pending) return;
    const previous = store;
    setPending(true);
    setChoosing(false);
    setError(null);
    mutate((s) => ({ ...s, ...next }));
    try {
      const saved = await request();
      mutate((s) => ({ ...s, ...saved }));
    } catch (err) {
      mutate(() => previous);
      // No answer: the server may have saved it all the same, so ask the store again instead of guessing.
      if (err instanceof ApiError && err.isUnreachable) onRetry?.();
      setError(
        err instanceof ApiError && err.isUnreachable
          ? "No connection: we couldn't confirm the change, so the store is being checked again."
          : err instanceof ApiError
            ? err.message
            : 'Something went wrong.',
      );
    } finally {
      setPending(false);
    }
  }

  const pause = (minutes: number | undefined, at: number) =>
    change(
      {
        openState: 'PAUSED',
        isOpen: false,
        openLabel: 'Paused',
        nextChangeAt: minutes ? new Date(at + minutes * 60_000).toISOString() : null,
      },
      () => pauseStore(storeId, minutes ? { minutes } : {}),
    );
  const resume = () =>
    change({ openState: 'OPEN', isOpen: true, openLabel: null, nextChangeAt: null }, () =>
      resumeStore(storeId),
    );

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-2 py-1">
      {paused ? (
        <>
          <p role="status" className="text-body font-semibold text-gold-700">
            {minutesLeft === null
              ? 'Orders paused until you resume'
              : `Orders paused · ${minutesLeft} min left`}
          </p>
          <Button
            variant="primary"
            disabled={pending}
            onClick={() => void resume()}
            iconLeft={<Play className="h-4 w-4" aria-hidden />}
          >
            Resume
          </Button>
        </>
      ) : choosing ? (
        <div
          role="group"
          aria-label="Pause new orders for"
          className="flex flex-wrap items-center gap-2"
        >
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              variant="tint"
              disabled={pending}
              onClick={() => void pause(p.minutes, Date.now())}
            >
              {p.label}
            </Button>
          ))}
          <Button variant="ghost" onClick={() => setChoosing(false)}>
            Cancel
          </Button>
        </div>
      ) : !store && loadFailed ? (
        <>
          <p role="alert" className="text-xs font-semibold text-cancel-700">
            Couldn't load the store, so pausing is unavailable.
          </p>
          <Button variant="ghost" onClick={onRetry}>
            Retry
          </Button>
        </>
      ) : (
        <Button
          variant="secondary"
          disabled={!store || pending}
          onClick={() => setChoosing(true)}
          iconLeft={<Pause className="h-4 w-4" aria-hidden />}
        >
          Pause orders
        </Button>
      )}
      {error && (
        <p role="alert" className="text-xs font-semibold text-cancel-700">
          {error}
        </p>
      )}
    </div>
  );
}
