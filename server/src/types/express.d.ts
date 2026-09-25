import type { AuthUser } from './auth';

declare global {
  namespace Express {
    interface Request {
      /** Present once `requireAuth` has verified the bearer token. */
      user?: AuthUser;
    }
  }
}

export {};
