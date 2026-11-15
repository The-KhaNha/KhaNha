import { useCallback } from 'react';
import { dropPersisted, useResource } from '../../lib/useResource';
import {
  archiveModifierGroup,
  createModifierGroup,
  fetchModifierGroups,
  setItemModifierGroups,
  updateModifierGroup,
  type ModifierGroupInput,
} from '../../services/manageModifiers';

/**
 * The store's modifier groups for the menu editor (P3.2). Every write reloads them and drops the saved public menu
 * (`menu:<slug>`, `menu:<id>`), whose items name their groups (CLAUDE.md §8). Writes throw the ApiError, so the
 * editor can show it.
 */
export function useModifierGroups(store: { id: string; slug: string }, enabled = true) {
  const { data, error, reload } = useResource(() => fetchModifierGroups(store.id), {
    // Not persisted: a manager's own list.
    key: `manage:modifiers:${store.id}`,
    enabled,
  });

  const refresh = useCallback(() => {
    dropPersisted(`menu:${store.slug}`);
    dropPersisted(`menu:${store.id}`);
    reload();
  }, [store.id, store.slug, reload]);

  const after =
    <A extends unknown[]>(write: (...args: A) => Promise<unknown>) =>
    async (...args: A) => {
      try {
        await write(...args);
      } finally {
        refresh();
      }
    };

  return {
    groups: data?.groups ?? null,
    itemGroupIds: data?.itemGroupIds ?? {},
    error,
    retry: reload,
    save: after((groupId: string | null, input: ModifierGroupInput) =>
      groupId
        ? updateModifierGroup(store.id, groupId, input)
        : createModifierGroup(store.id, input),
    ),
    archive: after((groupId: string) => archiveModifierGroup(store.id, groupId)),
    setItemGroups: after((itemId: string, groupIds: string[]) =>
      setItemModifierGroups(store.id, itemId, groupIds),
    ),
  };
}
