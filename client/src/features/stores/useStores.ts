import { fetchStoreByRef, fetchStores } from '../../services/stores';
import { useResource } from '../../lib/useResource';

/** The active stores (the list at `/`). Public, so the last answer shows at once on the next visit. */
export function useStores() {
  const { data, isLoading, error, reload, updatedAt } = useResource(fetchStores, {
    key: 'stores',
    persist: true,
  });
  return { stores: data, isLoading, error, retry: reload, updatedAt };
}

/** One store by slug or id (`/s/:storeSlug`). */
export function useStoreByRef(storeRef: string) {
  const { data, isLoading, error, reload, mutate } = useResource(() => fetchStoreByRef(storeRef), {
    key: `store:${storeRef}`,
    persist: true,
  });
  return { store: data, isLoading, error, retry: reload, mutate };
}
