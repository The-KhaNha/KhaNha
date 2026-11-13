import { useState, type FormEvent } from 'react';
import { History, Minus, PackageOpen, Plus } from 'lucide-react';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { Skeleton } from '../../components/Skeleton';
import { cn } from '../../lib/cn';
import { formatDayTime } from '../../lib/format';
import type { StockChange } from '../../services/stock';
import type { ManagedMenuItem } from '../../types/api';
import { describeMovement, stockLevel, type StockLevel } from './stockRules';
import { useStock, useStockMovements } from './useStock';

interface StockListProps {
  store: { id: string; slug: string };
}

const LEVEL_TEXT: Record<StockLevel, string> = {
  untracked: 'text-muted',
  out: 'text-brand-700',
  low: 'text-gold-700',
  ok: 'text-ink',
};

/**
 * The store's stock, one row per live item: −/+ by one, "Set" a count (or stop counting), "Mark sold out", and the item's
 * last changes on demand. Used at `/manage/:storeSlug/stock` and as the staff board's Stock view.
 */
export function StockList({ store }: StockListProps) {
  const stock = useStock(store);
  const [setting, setSetting] = useState<string | null>(null);
  const [historyOf, setHistoryOf] = useState<string | null>(null);

  if (stock.isLoading)
    return (
      <div className="space-y-3 pt-4" aria-busy aria-label="Loading the stock">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  if (!stock.data)
    return (
      <ErrorState
        compact
        className="mt-4"
        title="Stock didn't load"
        message={stock.error?.message}
        onRetry={stock.retry}
        unreachable={stock.error?.isUnreachable}
      />
    );
  const { items, lowStockThreshold } = stock.data;

  return (
    <div className="pt-4">
      {stock.error && (
        <ErrorState
          compact
          className="mb-3"
          title="Showing the last stock we loaded"
          message="We couldn't refresh it just now."
          onRetry={stock.retry}
          unreachable={stock.error.isUnreachable}
        />
      )}
      {stock.writeError && (
        <p role="alert" className="mb-3 text-caption font-medium text-brand-700">
          {stock.writeError}
        </p>
      )}
      {items.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title="No items yet"
          description="Items added to the menu appear here."
        />
      ) : (
        <ul className="divide-y divide-line/70">
          {items.map((item) => (
            <StockRow
              key={item.id}
              item={item}
              level={stockLevel(item.stockQuantity, lowStockThreshold)}
              busy={stock.pendingIds.has(item.id)}
              setting={setting === item.id}
              historyOpen={historyOf === item.id}
              writes={stock.writes}
              storeId={store.id}
              onChange={(change, guess) => void stock.change(item.id, change, guess)}
              onSetting={(open) => setSetting(open ? item.id : null)}
              onHistory={() => setHistoryOf(historyOf === item.id ? null : item.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface StockRowProps {
  item: ManagedMenuItem;
  level: StockLevel;
  busy: boolean;
  setting: boolean;
  historyOpen: boolean;
  storeId: string;
  writes: number;
  onChange: (change: StockChange, guess?: number | null) => void;
  onSetting: (open: boolean) => void;
  onHistory: () => void;
}

function StockRow({
  item,
  level,
  busy,
  setting,
  historyOpen,
  storeId,
  writes,
  onChange,
  onSetting,
  onHistory,
}: StockRowProps) {
  const count = item.stockQuantity;
  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{item.name}</p>
          <p className="truncate text-caption text-muted">
            {item.category}
            {level === 'low' && <span className="font-semibold text-gold-700"> · Running low</span>}
            {level === 'out' && <span className="font-semibold text-brand-700"> · Sold out</span>}
          </p>
        </div>
        <p
          className={cn('shrink-0 text-lg font-extrabold tabular-nums', LEVEL_TEXT[level])}
          aria-label={count === null ? `${item.name}: not counted` : `${item.name}: ${count} left`}
        >
          {count === null ? <span className="text-sm font-semibold">Not counted</span> : count}
        </p>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <IconButton
          label={`One less ${item.name}`}
          icon={<Minus className="h-4 w-4" />}
          disabled={busy || count === null || count === 0}
          onClick={() => count !== null && onChange({ adjust: -1 }, count - 1)}
        />
        <IconButton
          label={`One more ${item.name}`}
          icon={<Plus className="h-4 w-4" />}
          disabled={busy || count === null}
          onClick={() => count !== null && onChange({ adjust: 1 }, count + 1)}
        />
        <Button variant="secondary" disabled={busy} onClick={() => onSetting(!setting)}>
          Set
        </Button>
        <Button
          variant="ghost"
          disabled={busy || count === 0}
          onClick={() => onChange({ set: 0 }, 0)}
        >
          Mark sold out
        </Button>
        <IconButton
          label={`History of ${item.name}`}
          aria-expanded={historyOpen}
          icon={<History className="h-4 w-4" />}
          className="ml-auto"
          onClick={onHistory}
        />
      </div>
      {setting && (
        <SetForm
          item={item}
          onSubmit={(value) => {
            onSetting(false);
            onChange(value === null ? { untracked: true } : { set: value }, value);
          }}
          onCancel={() => onSetting(false)}
        />
      )}
      {/* Keyed by the writes made here: one made while it is open refetches it (CLAUDE.md §8). */}
      {historyOpen && <StockHistory key={writes} storeId={storeId} itemId={item.id} />}
    </li>
  );
}

/** A count to set; "Stop counting" leaves only the per-order cap. The server judges the upper bound. */
function SetForm({
  item,
  onSubmit,
  onCancel,
}: {
  item: ManagedMenuItem;
  onSubmit: (value: number | null) => void;
  onCancel: () => void;
}) {
  const [raw, setRaw] = useState(item.stockQuantity === null ? '' : String(item.stockQuantity));
  const [touched, setTouched] = useState(false);
  const valid = /^\d+$/.test(raw.trim());

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (valid) onSubmit(Number(raw.trim()));
  }

  return (
    <form onSubmit={submit} noValidate className="mt-2 rounded-control bg-surface-2 p-3">
      <Input
        label={`New count for ${item.name}`}
        inputMode="numeric"
        autoFocus
        value={raw}
        error={touched && !valid ? 'Enter a whole number.' : undefined}
        onChange={(e) => setRaw(e.target.value)}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit">Save</Button>
        {item.stockQuantity !== null && (
          <Button variant="ghost" onClick={() => onSubmit(null)}>
            Stop counting
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function StockHistory({ storeId, itemId }: { storeId: string; itemId: string }) {
  const { data, isLoading, error, reload } = useStockMovements(storeId, itemId);
  if (isLoading) return <Skeleton className="mt-2 h-16" />;
  if (!data)
    return (
      <ErrorState
        compact
        className="mt-2"
        title="History didn't load"
        message={error?.message}
        onRetry={reload}
        unreachable={error?.isUnreachable}
      />
    );
  if (data.length === 0)
    return <p className="mt-2 text-caption text-muted">No changes by hand yet.</p>;
  return (
    <ol className="mt-2 space-y-1 rounded-control bg-surface-2 p-3 text-caption">
      {data.map((m) => (
        <li key={m.id} className="flex flex-wrap justify-between gap-x-3">
          <span className="font-semibold tabular-nums">{describeMovement(m)}</span>
          <span className="text-muted">
            {m.actor?.name ?? 'Someone'} · {formatDayTime(m.createdAt)}
          </span>
        </li>
      ))}
    </ol>
  );
}
