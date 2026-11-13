import { useState } from 'react';
import { CalendarClock, Lock } from 'lucide-react';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Skeleton } from '../components/Skeleton';
import { useAuthStore } from '../features/auth/authStore';
import { ExceptionList } from '../features/manage/ExceptionList';
import { WeekGrid } from '../features/manage/WeekGrid';
import {
  exceptionBody,
  sameWeek,
  weekFromHours,
  weekIsComplete,
  weekToHours,
  type Week,
} from '../features/manage/hoursRules';
import { canEditHours } from '../features/manage/manageRules';
import { useResource } from '../lib/useResource';
import { ApiError } from '../services/api';
import { fetchManagedHours } from '../services/manageStores';
import {
  createScheduleException,
  deleteScheduleException,
  saveStoreHours,
} from '../services/stores';
import type { StoreSummary } from '../types/api';

const messageOf = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';

interface ManageHoursPageProps {
  store: Pick<StoreSummary, 'id' | 'brand'>;
  /** Reloads the store the shell shows and the public store list (the open state changes with the hours). */
  onChanged: () => void;
}

/** `/manage/:storeSlug/hours`: the weekly hours and special days of a store its manager or owner may edit. */
export function ManageHoursPage({ store, onChanged }: ManageHoursPageProps) {
  const user = useAuthStore((s) => s.user);
  const allowed = !!user && canEditHours(user, store);
  // Not persisted: only an editor reads it, and a stale week must never be what someone edits.
  const { data, isLoading, error, reload } = useResource(() => fetchManagedHours(store.id), {
    key: `manage:hours:${store.id}`,
    enabled: allowed,
  });
  const [week, setWeek] = useState<Week | null>(null);
  const [busy, setBusy] = useState(false);
  const [weekError, setWeekError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // A fresh answer replaces the week only when it holds no unsaved edit (derived during render, the React way).
  const [synced, setSynced] = useState(data);
  if (data !== synced) {
    const clean = !week || !synced || sameWeek(week, weekFromHours(synced.hours));
    setSynced(data);
    if (clean) setWeek(data ? weekFromHours(data.hours) : null);
  }

  if (!allowed)
    return (
      <EmptyState
        icon={Lock}
        tone="neutral"
        title="Only the store's manager or owner can edit hours"
        description="You can open this store's management as an admin, but the opening hours are theirs to change."
      />
    );
  if (error && !data)
    return (
      <ErrorState
        compact
        title="Unable to load the hours."
        message={error.message}
        onRetry={reload}
        unreachable={error.isUnreachable}
      />
    );
  if (!data || !week || isLoading)
    return (
      <div className="space-y-3 pt-4" aria-busy aria-label="Loading the hours">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );

  // Every change reloads the hours, and through the shell the store and the store list (CLAUDE.md §8). The shell owns
  // the list resource: one here too would fetch the same list twice.
  const reloadAll = () => {
    reload();
    onChanged();
  };
  const mutate = async (write: () => Promise<unknown>): Promise<string | null> => {
    setBusy(true);
    try {
      await write();
      reloadAll();
      return null;
    } catch (err) {
      return messageOf(err);
    } finally {
      setBusy(false);
    }
  };

  const dirty = !sameWeek(week, weekFromHours(data.hours));
  return (
    <div className="pt-4">
      {error && (
        <ErrorState
          compact
          className="mb-3"
          title="Showing the saved hours"
          message="We couldn't refresh them just now."
          retryLabel="Retry"
          onRetry={reload}
          unreachable={error.isUnreachable}
        />
      )}
      <p className="text-sm text-muted">Times are in the store's time zone ({data.timezone}).</p>
      {data.hours.length === 0 && !dirty && (
        <EmptyState
          className="py-8"
          icon={CalendarClock}
          title="No opening hours yet"
          description="Without weekly hours the store is open whenever it is switched on. Add the days it trades."
        />
      )}
      <div className="mt-3">
        <WeekGrid week={week} onChange={setWeek} disabled={busy} />
      </div>
      {weekError && (
        <p role="alert" className="mt-3 text-caption font-medium text-brand-700">
          {weekError}
        </p>
      )}
      <Button
        fullWidth
        className="mt-3"
        loading={busy}
        disabled={!dirty || !weekIsComplete(week)}
        onClick={async () =>
          setWeekError(await mutate(() => saveStoreHours(store.id, weekToHours(week))))
        }
      >
        Save hours
      </Button>
      {dirty && weekToHours(week).length === 0 && (
        <p className="mt-2 text-caption text-muted">
          With no weekly hours the store is open whenever it is switched on.
        </p>
      )}

      <ExceptionList
        exceptions={data.exceptions}
        busy={busy}
        onAdd={(draft) => mutate(() => createScheduleException(store.id, exceptionBody(draft)))}
        onRemove={async (id) =>
          setRemoveError(await mutate(() => deleteScheduleException(store.id, id)))
        }
      />
      {removeError && (
        <p role="alert" className="mt-3 text-caption font-medium text-brand-700">
          {removeError}
        </p>
      )}
    </div>
  );
}
