import { useCallback, useRef, useState } from 'react';
import { dropPersisted, useResource } from '../../lib/useResource';
import { ApiError } from '../../services/api';
import {
  archiveMenuItem,
  createMenuItem,
  fetchManagedMenu,
  reorderMenu,
  setAvailability,
  updateMenuItem,
  type MenuItemInput,
} from '../../services/manageMenu';
import type { ManagedMenuItem } from '../../types/api';
import { liveItems, moveItem } from './menuRules';

/**
 * The menu editor's list and its writes. Every write reloads the list and drops the saved public menu
 * (`menu:<slug>` and `menu:<id>`), so the customer's next visit refetches it (CLAUDE.md §8).
 */
/** `onChanged` runs after every write too: the shell's go-live checklist counts the orderable items. */
export function useManageMenu(
  store: { id: string; slug: string },
  enabled = true,
  onChanged?: () => void,
) {
  const { data, isLoading, error, reload, mutate } = useResource(
    () => fetchManagedMenu(store.id),
    // Not persisted: a manager's own list, and a stale copy must never be what they edit.
    { key: `manage:menu:${store.id}`, enabled },
  );
  const [writeError, setWriteError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    dropPersisted(`menu:${store.slug}`);
    dropPersisted(`menu:${store.id}`);
    reload();
    onChanged?.();
  }, [store.id, store.slug, reload, onChanged]);

  /** Runs a write; on failure `rollback` restores what was shown, the message is kept and the list reloads. */
  const attempt = async (write: () => Promise<unknown>, rollback?: () => void) => {
    setWriteError(null);
    try {
      await write();
    } catch (err) {
      rollback?.();
      setWriteError(
        err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
      );
    }
    refresh();
  };

  const patchLocal = (ids: Set<string>, isEnabled: boolean) =>
    mutate((items) =>
      items.map((i) =>
        ids.has(i.id) ? { ...i, isEnabled, isAvailable: isEnabled && i.stockQuantity !== 0 } : i,
      ),
    );

  // Overlapping writes could land out of order, so a switch waits for its own write and a list write for all.
  // Refs guard a fast double tap before the next render; the state lets the page disable the controls.
  const pendingRef = useRef(new Set<string>());
  const listRef = useRef<'reorder' | 'soldOut' | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [listBusy, setListBusy] = useState<'reorder' | 'soldOut' | null>(null);

  const guarded = async (
    ids: string[] | null,
    kind: 'reorder' | 'soldOut' | null,
    write: () => Promise<unknown>,
    rollback: () => void,
  ) => {
    const p = pendingRef.current;
    if (listRef.current || (ids ? ids.some((id) => p.has(id)) : p.size > 0)) return;
    if (ids) ids.forEach((id) => p.add(id));
    else listRef.current = kind;
    setPendingIds(new Set(p));
    setListBusy(listRef.current);
    try {
      await attempt(write, rollback);
    } finally {
      if (ids) ids.forEach((id) => p.delete(id));
      else listRef.current = null;
      setPendingIds(new Set(p));
      setListBusy(listRef.current);
    }
  };

  return {
    items: data ? liveItems(data) : null,
    isLoading,
    error,
    retry: reload,
    writeError,
    pendingIds,
    listBusy,
    /** Flips at once and rolls back when the server refuses. */
    toggle: (item: ManagedMenuItem) => {
      const next = !item.isEnabled;
      const ids = new Set([item.id]);
      if (listRef.current || pendingRef.current.has(item.id)) return Promise.resolve();
      patchLocal(ids, next);
      return guarded(
        [item.id],
        null,
        () => updateMenuItem(store.id, item.id, { isAvailable: next }),
        () => patchLocal(ids, !next),
      );
    },
    soldOutCategory: (category: string) => {
      if (listRef.current || pendingRef.current.size > 0) return Promise.resolve();
      const current = data ? liveItems(data) : [];
      const ids = new Set(current.filter((i) => i.category === category).map((i) => i.id));
      patchLocal(ids, false);
      return guarded(
        null,
        'soldOut',
        () => setAvailability(store.id, { category }, false),
        () => mutate(() => current),
      );
    },
    move: (id: string, direction: -1 | 1) => {
      if (listRef.current || pendingRef.current.size > 0) return Promise.resolve();
      const current = data ? liveItems(data) : [];
      const next = moveItem(current, id, direction);
      if (!next) return Promise.resolve();
      mutate(() => next);
      return guarded(
        null,
        'reorder',
        () =>
          reorderMenu(
            store.id,
            next.map((i) => i.id),
          ),
        () => mutate(() => current),
      );
    },
    /** Throws the ApiError so the editor can show its field errors. */
    save: async (item: ManagedMenuItem | null, input: MenuItemInput) => {
      if (item) {
        const saved = await updateMenuItem(store.id, item.id, input);
        mutate((items) => items.map((i) => (i.id === saved.id ? saved : i)));
      } else {
        const saved = await createMenuItem(store.id, input);
        mutate((items) => [...items, saved]);
      }
      refresh();
    },
    archive: (item: ManagedMenuItem) => attempt(() => archiveMenuItem(store.id, item.id)),
  };
}
