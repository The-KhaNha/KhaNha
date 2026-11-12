import type { StoreAccess } from '../domain/permissions';
import type { AuthUser, StoreContext } from './auth';

declare global {
  namespace Express {
    interface Request {
      /** Present once `requireAuth` has verified the bearer token. */
      user?: AuthUser;
      /** Present once `requireStore` has admitted the caller to the route's store. */
      store?: StoreContext;
      storeAccess?: StoreAccess;
    }
  }
}

export {};
