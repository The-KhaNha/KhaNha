import { fetchAdminBrands } from '../../services/admin';
import { useResource } from '../../lib/useResource';

/** The admin's Restaurants list. Not persisted: it holds owners' and invitees' emails. */
export const useAdminBrands = () => useResource(fetchAdminBrands, { key: 'admin:brands' });
