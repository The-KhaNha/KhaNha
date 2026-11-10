import type { Role } from './enums';

/** The authenticated caller, attached to `req.user` by `requireAuth`. */
export interface AuthUser {
  id: string;
  role: Role;
}

/**
 * Who caused a write: recorded with the domain event it emits and its audit row. The roadmap's actor shape; a job's
 * writes will use another `type` (`actor_type` in the database).
 */
type Actor = { type: 'USER'; id: string; role: Role };

/** What a write records about the request behind it, built once per request by its controller. */
export interface RequestContext {
  actor: Actor;
  requestId: string;
}
