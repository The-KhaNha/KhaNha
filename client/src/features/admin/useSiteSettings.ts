import { fetchSiteSettings } from '../../services/admin';
import { useResource } from '../../lib/useResource';

/** The admin's view of the site settings. Not persisted: admin-only data never goes in localStorage. */
export function useSiteSettings() {
  const { data, isLoading, error, reload, mutate } = useResource(fetchSiteSettings, {
    key: 'admin:settings',
  });
  return { settings: data, isLoading, error, retry: reload, mutate };
}
