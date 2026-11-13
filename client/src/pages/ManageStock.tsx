import { useState } from 'react';
import { Card } from '../components/Card';
import { ErrorState } from '../components/ErrorState';
import { Skeleton } from '../components/Skeleton';
import { Switch } from '../components/Switch';
import { useStoreSettings } from '../features/manage/useManage';
import { StockList } from '../features/stock/StockList';
import { ApiError } from '../services/api';
import { updateStoreSettings } from '../services/manage';

/** `/manage/:storeSlug/stock`: the stock list, and whether the store's staff may change it. */
export function ManageStockTab({ store }: { store: { id: string; slug: string } }) {
  return (
    <>
      <StaffStockSwitch storeId={store.id} />
      <StockList store={store} />
    </>
  );
}

/** Flips at once and rolls back when the server refuses. Never shown before the settings load (a guess could mislead). */
function StaffStockSwitch({ storeId }: { storeId: string }) {
  const { data, isLoading, error: loadError, mutate, reload } = useStoreSettings(storeId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (isLoading)
    return (
      <div className="mt-4" aria-busy aria-label="Loading the staff setting">
        <Skeleton className="h-20" />
      </div>
    );
  if (!data)
    return (
      <ErrorState
        compact
        className="mt-4"
        title="The staff setting didn't load"
        message={loadError?.message}
        onRetry={reload}
        unreachable={loadError?.isUnreachable}
      />
    );

  async function flip(next: boolean) {
    setSaving(true);
    setError(null);
    mutate((s) => ({ ...s, staffCanEditStock: next }));
    try {
      const saved = await updateStoreSettings(storeId, { staffCanEditStock: next });
      mutate(() => saved);
    } catch (err) {
      mutate((s) => ({ ...s, staffCanEditStock: !next }));
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card as="section" padding="md" className="mt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">Staff can change stock</p>
          <p className="text-caption text-muted">
            Off: only managers and the owner can. Staff see it after they reload the board.
          </p>
        </div>
        <Switch
          checked={data.staffCanEditStock}
          label="Staff can change stock"
          disabled={saving}
          onChange={(next) => void flip(next)}
        />
      </div>
      {error && (
        <p role="alert" className="mt-2 text-caption font-medium text-brand-700">
          {error}
        </p>
      )}
    </Card>
  );
}
