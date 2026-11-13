import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck, CircleDashed } from 'lucide-react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { ApiError } from '../../services/api';
import { publishStore, unpublishStore } from '../../services/manageStores';
import type { ManagedStore, PublishMissing } from '../../types/api';

const CHECKS: { key: PublishMissing; label: string; tab: string }[] = [
  { key: 'address', label: 'An address', tab: 'profile' },
  { key: 'hours', label: 'Opening hours', tab: 'hours' },
  { key: 'menu', label: 'An item customers can order', tab: 'menu' },
];

interface GoLiveProps {
  store: ManagedStore;
  missing: PublishMissing[];
  /** Reloads the store, its checklist and the lists that show it. */
  onChanged: () => void;
}

/**
 * The owner's publish card. A DRAFT branch shows the checklist (each item links to the tab that fixes it) and Publish,
 * enabled once all pass; the server still decides. A live one shows Unpublish behind a confirm.
 */
export function GoLive({ store, missing, onChanged }: GoLiveProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  if (store.status !== 'DRAFT' && store.status !== 'ACTIVE') return null;

  async function run(write: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await write();
      setConfirming(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  if (store.status === 'ACTIVE')
    return (
      <Card
        as="section"
        padding="md"
        className="mt-3 flex flex-wrap items-center justify-between gap-3"
      >
        <p className="text-sm">
          <span className="font-semibold text-success-700">Live.</span> Customers can find it and
          order.
        </p>
        <Button variant="ghost-danger" onClick={() => setConfirming(true)}>
          Unpublish
        </Button>
        {error && (
          <p role="alert" className="w-full text-caption font-medium text-brand-700">
            {error}
          </p>
        )}
        {confirming && (
          <ConfirmSheet
            title="Unpublish this branch?"
            text="It disappears from the store list and new orders stop. Orders already placed are still served."
            confirmLabel="Unpublish"
            busy={busy}
            onConfirm={() => void run(() => unpublishStore(store.id))}
            onCancel={() => setConfirming(false)}
          />
        )}
      </Card>
    );

  return (
    <Card as="section" padding="md" className="mt-3" aria-label="Go live">
      <h2 className="font-bold">Go live</h2>
      <p className="text-caption text-muted">This branch is a draft: nobody can see it yet.</p>
      <ul className="mt-2 space-y-1">
        {CHECKS.map(({ key, label, tab }) => {
          const done = !missing.includes(key);
          const Icon = done ? CircleCheck : CircleDashed;
          return (
            <li key={key}>
              <Link
                to={`/manage/${store.slug}/${tab}`}
                className="flex min-h-11 items-center gap-2 rounded-control px-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <Icon
                  className={done ? 'h-4 w-4 text-success-700' : 'h-4 w-4 text-muted'}
                  aria-hidden
                />
                <span className={done ? 'text-muted line-through' : 'font-semibold'}>{label}</span>
                <span className="sr-only">{done ? ': done' : ': still needed'}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-caption font-medium text-brand-700">
          {error}
        </p>
      )}
      <Button
        className="mt-3"
        fullWidth
        loading={busy}
        disabled={missing.length > 0}
        onClick={() => void run(() => publishStore(store.id))}
      >
        Publish
      </Button>
    </Card>
  );
}
