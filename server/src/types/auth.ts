import type { Role } from '@prisma/client';

/** The authenticated caller, attached to `req.user` by `requireAuth`. */
export interface AuthUser {
  id: string;
  role: Role;
}
