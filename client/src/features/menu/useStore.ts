import { fetchStore } from '../../services/store';
import { useResource } from '../../lib/useResource';

/** Loads the single shop. */
export function useStore() {
  const { data, isLoading, error, reload } = useResource(fetchStore, { key: 'store' });
  return { store: data, isLoading, error, retry: reload };
}
