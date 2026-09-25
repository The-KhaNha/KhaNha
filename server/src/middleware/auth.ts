import type { RequestHandler } from 'express';
import { verifyCredentials } from '@supabase/server/core';
import type { AuthUser } from '../types/auth';
import { forbidden, unauthorized } from '../utils/errors';
import { supabaseAdmin, supabaseEnv } from '../utils/supabase';

function readBearerToken(header: string | undefined): string | undefined {
  const [scheme, token] = header?.split(' ') ?? [];
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

/**
 * Requires a valid Supabase Auth access token for a user whose profile still exists; attaches `req.user`.
 * The token is checked against the project's JWKS, so tokens from another project (e.g. staging vs production) fail.
 * The role comes from the profile, not the token, so promoting or demoting staff takes effect on the next request.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = readBearerToken(req.header('authorization'));
  if (!token) throw unauthorized();

  const { data: auth, error } = await verifyCredentials(
    { token, apikey: null },
    { auth: 'user', audience: 'authenticated', env: supabaseEnv },
  );
  // 5xx means this server is misconfigured (e.g. the JWKS cannot be fetched): not the caller's fault.
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

/** Reads the user set by `requireAuth`; throws if the route forgot to require it. */
export function currentUser(req: { user?: AuthUser }): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
