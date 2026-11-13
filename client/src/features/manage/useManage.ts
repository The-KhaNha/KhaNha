import { useResource } from '../../lib/useResource';
import { fetchStoreSettings, fetchTeam } from '../../services/manage';
import { fetchManagedStore, fetchMyBrands } from '../../services/manageStores';

// Not persisted: a store's limits and its team are the manager's own data, never kept past the page.
export const useStoreSettings = (storeId: string) =>
  useResource(() => fetchStoreSettings(storeId), { key: `manage:settings:${storeId}` });

export const useTeam = (storeId: string) =>
  useResource(() => fetchTeam(storeId), { key: `manage:team:${storeId}` });

/** The brands the account owns, each with its branches (every status) and its template. Only an owner asks. */
export const useMyBrands = (enabled: boolean) =>
  useResource(fetchMyBrands, { key: 'manage:brands', enabled });

/** The store as its managers see it (any status) and its go-live checklist; `id` null waits. */
export const useManagedStore = (id: string | null) =>
  useResource(() => fetchManagedStore(id!), { key: `manage:store:${id}`, enabled: id !== null });
