import type { Request, RequestHandler } from 'express';
import { verifyCredentials } from '@supabase/server/core';
import type { AuthUser, RequestContext } from '../types/auth';
import { forbidden, IntegrationError, unauthorized } from '../utils/errors';
import { supabaseAdmin, supabaseEnv } from '../utils/supabase';

function readBearerToken(header: string | undefined): string | undefined {
  const [scheme, token] = header?.split(' ') ?? [];
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

/** verifyCredentials' answer, or neither claims nor an error when the request carries no token. */
type Verification = Awaited<ReturnType<typeof verifyCredentials>> | { data: null; error: null };
const verifications = new WeakMap<Request, Promise<Verification>>();

/**
 * Checks the request's bearer token against the project's JWKS, once per request: the flood limiter (to count a
 * signed-in caller on their own) and requireAuth both ask. Resolves to no claims when there is no token.
 */
export function verifyBearer(req: Request): Promise<Verification> {
  let pending = verifications.get(req);
  if (!pending) {
    const token = readBearerToken(req.header('authorization'));
    pending = token
      ? verifyCredentials(
          { token, apikey: null },
          { auth: 'user', audience: 'authenticated', env: supabaseEnv },
        )
      : Promise.resolve({ data: null, error: null });
    verifications.set(req, pending);
  }
  return pending;
}

/**
 * Requires a valid Supabase Auth access token for a user whose profile still exists; attaches `req.user`.
 * The token is checked against the project's JWKS, so tokens from another project (e.g. staging vs production) fail.
 * The role comes from the profile, not the token, so promoting or demoting staff takes effect on the next request.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  if (!readBearerToken(req.header('authorization'))) throw unauthorized();

  const { data: auth, error } = await verifyBearer(req);
  // Supabase Auth unreachable (its signing keys could not be fetched): a 503 the client may retry.
  if (error?.code === 'JWKS_FETCH_FAILED') {
    throw new IntegrationError('supabase-auth', 'verify', true, { cause: error });
  }
  // Any other 5xx means this server is misconfigured (no JWKS, no keys): not the caller's fault, and not transient.
  if (error && error.status >= 500) throw error;
  if (!auth?.userClaims) throw unauthorized('Your session has expired. Please sign in again.');

  const { data: user } = await supabaseAdmin
    .from('profiles')
    .select('id, role')
    .eq('id', auth.userClaims.id)
    .maybeSingle()
    .throwOnError();
  if (!user) throw unauthorized('That account no longer exists. Please sign in again.');

  req.user = user;
  next();
};

/** Must run after `requireAuth`. */
export const requireStaff: RequestHandler = (req, _res, next) => {
  if (currentUser(req).role !== 'STAFF') throw forbidden('Only staff can do that.');
  next();
};

/**
 * Must run after `requireAuth`. ADMIN is the site-wide developer role (the admin dashboard), separate from staff:
 * an admin has no staff powers and staff cannot change site settings.
 */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (currentUser(req).role !== 'ADMIN') throw forbidden('Only admins can do that.');
  next();
};

/** Reads the user set by `requireAuth`; throws if the route forgot to require it. */
export function currentUser(req: { user?: AuthUser }): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** Who is asking, and which request: a write records them with the event it emits and its audit row. */
export function requestContext(req: Request): RequestContext {
  const { id, role } = currentUser(req);
  return { actor: { type: 'USER', id, role }, requestId: String(req.id) };
}
