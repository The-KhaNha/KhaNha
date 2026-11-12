import { useResource } from '../../lib/useResource';
import { fetchStoreSettings, fetchTeam } from '../../services/manage';

// Not persisted: a store's limits and its team are the manager's own data, never kept past the page.
export const useStoreSettings = (storeId: string) =>
  useResource(() => fetchStoreSettings(storeId), { key: `manage:settings:${storeId}` });

export const useTeam = (storeId: string) =>
  useResource(() => fetchTeam(storeId), { key: `manage:team:${storeId}` });
