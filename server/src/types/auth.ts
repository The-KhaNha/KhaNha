import type { Role } from './enums';

/** The authenticated caller, attached to `req.user` by `requireAuth`. */
export interface AuthUser {
  id: string;
  role: Role;
}

/**
 * Who caused a write: recorded with the domain event it emits and, from P1 PR 06, its audit row. The roadmap's actor
 * shape; a job's writes will use another `type`.
 */
type Actor = { type: 'USER'; id: string; role: Role };

/** What a write records about the request behind it, built once per request by its controller. */
export interface RequestContext {
  actor: Actor;
  requestId: string;
}
