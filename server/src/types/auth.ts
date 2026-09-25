import type { Role } from './enums';

/** The authenticated caller, attached to `req.user` by `requireAuth`. */
export interface AuthUser {
  id: string;
  role: Role;
}
