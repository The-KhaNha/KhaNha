import type { StoreAccess } from '../domain/permissions';
import type { Role, StoreRole, StoreStatus } from './enums';

/** The authenticated caller, attached to `req.user` by `requireAuth`. */
export interface AuthUser {
  id: string;
  role: Role;
  /** The stores the caller works at, read with the profile on every request. */
  memberships: { storeId: string; role: StoreRole }[];
  /** The brands the caller owns: OWNER of every store of each (ADR-001). */
  ownedBrandIds: string[];
}

/** The store a store route names, set by `requireStore` with the caller's access there. */
export interface StoreContext {
  id: string;
  brandId: string;
  status: StoreStatus;
  timezone: string;
}

/**
 * Who caused a write: recorded with the domain event it emits and its audit row. The roadmap's actor shape; a job's
 * writes will use another `type` (`actor_type` in the database). `storeRole` is the capacity a store-scoped request
 * acted in; the audit row records it as `actor_role` in place of the profile role.
 */
type Actor = { type: 'USER'; id: string; role: Role; storeRole?: StoreAccess };

/** What a write records about the request behind it, built once per request by its controller. */
export interface RequestContext {
  actor: Actor;
  requestId: string;
}
