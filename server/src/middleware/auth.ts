import type { Request, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { verifyCredentials } from '@supabase/server/core';
import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { accessFor, can, type Capability } from '../domain/permissions';
import { getStoreById } from '../services/store.service';
import type { AuthUser, RequestContext, StoreContext } from '../types/auth';
import { env } from '../utils/env';
import { forbidden, IntegrationError, notFound, unauthorized } from '../utils/errors';
import { isUuid } from '../utils/ids';
import { supabaseAdmin, supabaseEnv } from '../utils/supabase';

const SESSION_EXPIRED = 'Your session has expired. Please sign in again.';

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
  const token = readBearerToken(req.header('authorization'));
  if (!token) throw unauthorized();

  const { data: auth, error } = await verifyBearer(req);
  // Supabase Auth unreachable (its signing keys could not be fetched): a 503 the client may retry.
  if (error?.code === 'JWKS_FETCH_FAILED') {
    throw new IntegrationError('supabase-auth', 'verify', true, { cause: error });
  }
  // Any other 5xx means this server is misconfigured (no JWKS, no keys): not the caller's fault, and not transient.
  if (error && error.status >= 500) throw error;
  if (!auth?.userClaims) throw unauthorized(SESSION_EXPIRED);

  // One read for the role and every store standing, so a removed membership stops working on the next request.
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select(
      'id, role, memberships:store_memberships!store_memberships_user_id_fkey(store_id, role), brands!brands_owner_id_fkey(id)',
    )
    .eq('id', auth.userClaims.id)
    .maybeSingle()
    .throwOnError();
  if (!profile) throw unauthorized('That account no longer exists. Please sign in again.');

  await enforceSessionIdle(auth.jwtClaims?.session_id, profile.id, token, req.log);
  req.user = {
    id: profile.id,
    role: profile.role,
    memberships: profile.memberships.map((m) => ({ storeId: m.store_id, role: m.role })),
    ownedBrandIds: profile.brands.map((b) => b.id),
  };
  next();
};

/** How often one API process records a session's use: one RPC per active session per 5 minutes per instance. */
export const SESSION_TOUCH_EVERY_MS = 5 * 60 * 1000;
/**
 * session id → when this process last checked it, and whether it was refused. Roughly time order, so the sweep stops
 * at the first fresh entry: an entry is stamped with its request's start but set when the RPC answers, so under
 * concurrency an expired one can sit behind a fresher one and outlive the window by at most one RPC's latency.
 */
const checked = new Map<string, { at: number; refused: boolean }>();
/** session id → the check still waiting on its RPC, shared by every request that arrives meanwhile. */
const inFlight = new Map<string, Promise<'ok' | 'refused'>>();
// A failing check (the function missing before its migration lands) fails the same way for every session, so it logs
// once per window per process, with how many failures it stayed quiet about since the last line.
let idleCheckErrorAt = Number.NEGATIVE_INFINITY;
let idleCheckErrorsSuppressed = 0;

/**
 * The server's half of the idle sign-out (ADR-011): a sign-in unused for SESSION_IDLE_DAYS, or no longer live in
 * Supabase Auth (signed out or revoked, while its access token has up to an hour left), is refused with a 401 and
 * revoked, so its refresh token stops working too. A refusal is remembered for the window, so a replayed token costs
 * no RPC and no sign-out call. Fails open: if the check itself fails (the function missing on an environment the
 * migration has not reached, a dropped connection), the request goes on and the failure is logged; the token was
 * already verified, and the client keeps its own idle cap.
 */
export async function enforceSessionIdle(
  sessionId: unknown,
  userId: string,
  token: string,
  log: Logger,
  now = Date.now(),
): Promise<void> {
  // Every Supabase Auth access token carries one; without it there is no session to key the check on.
  if (typeof sessionId !== 'string' || !isUuid(sessionId)) return;
  for (const [id, { at }] of checked) {
    if (now - at < SESSION_TOUCH_EVERY_MS) break;
    checked.delete(id);
  }
  const seen = checked.get(sessionId);
  if (seen?.refused) throw unauthorized(SESSION_EXPIRED);
  if (seen) return;

  // A page load sends several requests at once: they share one check instead of one RPC each.
  let check = inFlight.get(sessionId);
  if (!check) {
    check = checkSession(sessionId, userId, token, log, now).finally(() =>
      inFlight.delete(sessionId),
    );
    inFlight.set(sessionId, check);
  }
  if ((await check) === 'refused') throw unauthorized(SESSION_EXPIRED);
}

/** One touch_session call and, for a refused session, its revoke. Records the outcome for the window. */
async function checkSession(
  sessionId: string,
  userId: string,
  token: string,
  log: Logger,
  now: number,
): Promise<'ok' | 'refused'> {
  const { data: active, error } = await supabaseAdmin.rpc('touch_session', {
    p_session_id: sessionId,
    p_user_id: userId,
    p_idle: `${env.SESSION_IDLE_DAYS} days`,
  });
  if (error) {
    // Counted as checked below, so a session asks again only after the window.
    if (now - idleCheckErrorAt >= SESSION_TOUCH_EVERY_MS) {
      log.error(
        { err: error, userId, suppressed: idleCheckErrorsSuppressed },
        'Session idle check failed',
      );
      idleCheckErrorAt = now;
      idleCheckErrorsSuppressed = 0;
    } else {
      idleCheckErrorsSuppressed += 1;
    }
  } else if (!active) {
    checked.set(sessionId, { at: now, refused: true });
    const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(token, 'local');
    // A session already gone (signed out, or revoked by an earlier refusal) answers session_not_found, which auth-js
    // turns into AuthSessionMissingError: nothing left to revoke. Any other failure leaves the refresh token alive.
    if (signOutError && !isAuthSessionMissingError(signOutError)) {
      log.warn({ err: signOutError, userId }, 'Idle session not revoked');
    }
    return 'refused';
  }
  checked.set(sessionId, { at: now, refused: false });
  return 'ok';
}

/**
 * Must run after `requireAuth`. ADMIN is the site-wide developer role (the admin dashboard), separate from staff:
 * an admin has no staff powers and staff cannot change site settings.
 */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (currentUser(req).role !== 'ADMIN') throw forbidden('Only admins can do that.');
  next();
};

/**
 * Must run after `requireAuth`, on a route with a `:storeId` param. Admits the caller to that store when their access
 * there holds `capability` (domain/permissions.ts), and sets `req.store` and `req.storeAccess`. A store the caller may
 * not know about (not ACTIVE, and they have no access there) is 404 like an unknown one; a store they can see but may
 * not do this at is 403.
 */
export function requireStore(capability: Capability): RequestHandler {
  return async (req, _res, next) => {
    const user = currentUser(req);
    const storeId = req.params.storeId;
    if (typeof storeId !== 'string' || !isUuid(storeId)) throw notFound('Store not found.');
    const store = await getStoreById(storeId.toLowerCase());
    const access = accessFor(user, { id: store.id, brandId: store.brand_id }, capability);
    if (store.status !== 'ACTIVE' && access === null) throw notFound('Store not found.');
    if (!can(access, capability)) throw forbidden('You cannot do that at this store.');
    req.store = {
      id: store.id,
      brandId: store.brand_id,
      status: store.status,
      timezone: store.timezone,
    };
    req.storeAccess = access ?? undefined;
    next();
  };
}

/** Reads the user set by `requireAuth`; throws if the route forgot to require it. */
export function currentUser(req: { user?: AuthUser }): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** Reads the store set by `requireStore`; throws if the route forgot to require it. */
export function currentStore(req: { store?: StoreContext }): StoreContext {
  if (!req.store) throw notFound('Store not found.');
  return req.store;
}

/** Who is asking, and which request: a write records them with the event it emits and its audit row. */
export function requestContext(req: Request): RequestContext {
  const { id, role } = currentUser(req);
  const actor = req.storeAccess
    ? { type: 'USER' as const, id, role, storeRole: req.storeAccess }
    : { type: 'USER' as const, id, role };
  return { actor, requestId: String(req.id) };
}
