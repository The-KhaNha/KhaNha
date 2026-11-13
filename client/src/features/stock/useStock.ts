import { useRef, useState } from 'react';
import { dropPersisted, useResource } from '../../lib/useResource';
import { ApiError } from '../../services/api';
import {
  changeStock,
  fetchStock,
  fetchStockMovements,
  type StockChange,
} from '../../services/stock';
import { useConfig } from '../config/useConfig';

/**
 * The stock screen's list and its writes. Polled at the staff board's pace (orders take stock too), never persisted:
 * stock is always the server's word. A write shows its result at once, rolls back when refused, and drops the saved
 * public menu so customers refetch it (CLAUDE.md §8).
 */
export function useStock(store: { id: string; slug: string }) {
  const { polling } = useConfig();
  const { data, isLoading, error, reload, mutate } = useResource(() => fetchStock(store.id), {
    key: `stock:${store.id}`,
    pollInterval: () => polling.staffBoardMs,
  });
  const [writeError, setWriteError] = useState<string | null>(null);
  // One write per item at a time: a ref stops a double tap before the next render; the state disables its controls.
  const pendingRef = useRef(new Set<string>());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());

  // Bumped by every write that lands, so an open history refetches even when the count came out the same.
  const [writes, setWrites] = useState(0);

  // Only the count: `isAvailable` is the server's to say, and the next load brings it.
  const setLocal = (itemId: string, stockQuantity: number | null, onlyIf?: number | null) =>
    mutate((list) => ({
      ...list,
      items: list.items.map((i) =>
        i.id === itemId && (onlyIf === undefined || i.stockQuantity === onlyIf)
          ? { ...i, stockQuantity }
          : i,
      ),
    }));

  /** `guess` is what to show while the write is in flight (undefined: leave it until the answer). */
  async function change(itemId: string, change: StockChange, guess?: number | null) {
    const before = data?.items.find((i) => i.id === itemId);
    if (!before || pendingRef.current.has(itemId)) return;
    pendingRef.current.add(itemId);
    setPendingIds(new Set(pendingRef.current));
    setWriteError(null);
    if (guess !== undefined) setLocal(itemId, guess);
    try {
      setLocal(itemId, await changeStock(store.id, itemId, change));
      setWrites((n) => n + 1);
      dropPersisted(`menu:${store.slug}`);
      dropPersisted(`menu:${store.id}`);
    } catch (err) {
      // Undo only our own guess: a poll that landed meanwhile has the newer count.
      if (guess !== undefined) setLocal(itemId, before.stockQuantity, guess);
      setWriteError(
        err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
      );
      reload();
    } finally {
      pendingRef.current.delete(itemId);
      setPendingIds(new Set(pendingRef.current));
    }
  }

  return { data, isLoading, error, retry: reload, writeError, pendingIds, writes, change };
}

/** An item's newest movements, loaded when its history is opened. */
export const useStockMovements = (storeId: string, itemId: string) =>
  useResource(() => fetchStockMovements(storeId, itemId), {
    key: `stock:movements:${storeId}:${itemId}`,
  });
