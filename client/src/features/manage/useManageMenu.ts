import { useCallback, useState } from 'react';
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
export function useManageMenu(store: { id: string; slug: string }, enabled = true) {
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
  }, [store.id, store.slug, reload]);

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

  return {
    items: data ? liveItems(data) : null,
    isLoading,
    error,
    retry: reload,
    writeError,
    /** Flips at once and rolls back when the server refuses. */
    toggle: (item: ManagedMenuItem) => {
      const next = !item.isEnabled;
      patchLocal(new Set([item.id]), next);
      return attempt(
        () => updateMenuItem(store.id, item.id, { isAvailable: next }),
        () => patchLocal(new Set([item.id]), !next),
      );
    },
    soldOutCategory: (category: string) =>
      attempt(() => setAvailability(store.id, { category }, false)),
    move: (id: string, direction: -1 | 1) => {
      const current = data ? liveItems(data) : [];
      const next = moveItem(current, id, direction);
      if (!next) return Promise.resolve();
      mutate(() => next);
      return attempt(
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
      if (item) await updateMenuItem(store.id, item.id, input);
      else await createMenuItem(store.id, input);
      refresh();
    },
    archive: (item: ManagedMenuItem) => attempt(() => archiveMenuItem(store.id, item.id)),
  };
}
