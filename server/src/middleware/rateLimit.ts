import type { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit, type AugmentedRequest } from 'express-rate-limit';
import { env } from '../utils/env';
import { rateLimited } from '../utils/errors';
import { verifyBearer } from './auth';

/**
 * Who a limit counts against. `user` is the signed-in account: `req.user` after requireAuth, or else the verified
 * bearer token (a forged or expired one does not count as an account), falling back to the address for an anonymous
 * request; `ip` is the address alone. The campus Wi-Fi puts hundreds of customers behind one address, so a signed-in
 * customer is always counted on their own (docs/CONFIGURATION.md).
 */
type RateLimitKey = 'user' | 'ip';

export interface RateLimitOptions {
  /** Named in the 429 log line (`limiter`). */
  name: string;
  /** The window in ms. */
  windowMs: number;
  /** Requests allowed per key per window. 0 turns the limiter off (a pass-through). */
  limit: number;
  keyBy: RateLimitKey;
}

/**
 * Fixed-window counters in this process's memory, one per key. A second API instance counts separately, which only
 * loosens the limit by the instance count. Answers 429 RATE_LIMITED through the error handler (envelope, log line)
 * with Retry-After and the draft-7 RateLimit headers.
 */
export function createRateLimiter({
  name,
  windowMs,
  limit,
  keyBy,
}: RateLimitOptions): RequestHandler {
  if (limit === 0) return (_req, _res, next) => next();
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: async (req) => {
      const address = `ip:${ipKeyGenerator(req.ip ?? '')}`;
      if (keyBy === 'ip') return address;
      if (req.user) return `user:${req.user.id}`;
      // Before requireAuth (the flood limiter on every /api request): the token itself. Unreachable JWKS or a bad
      // token counts against the address; requireAuth answers for it later.
      const { data } = await verifyBearer(req).catch(() => ({ data: null }));
      return data?.userClaims ? `user:${data.userClaims.id}` : address;
    },
    handler: (req, res, next, options) => {
      // The time left in this key's window, as the RateLimit header says, not the whole window: a client that honours
      // Retry-After would otherwise wait longer than it has to.
      const info = (req as AugmentedRequest).rateLimit;
      const resetTime = info?.resetTime;
      const seconds = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(options.windowMs / 1000);
      res.set('Retry-After', String(seconds));
      const keyedBy = info?.key.startsWith('user:') ? 'user' : 'ip';
      // `used` counts this request too, so the first refusal in the window is the one just past the limit.
      next(rateLimited(name, keyedBy, seconds, !info || info.used === info.limit + 1));
    },
  });
}

/**
 * Every /api request: a flood guard, not a fairness rule (RATE_LIMIT_IP_MAX). A signed-in caller has their own count,
 * so a campus of customers behind one address does not share one; anonymous traffic is counted per address.
 */
export const floodLimiter = createRateLimiter({
  name: 'flood',
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_IP_MAX,
  keyBy: 'user',
});

/** Writes by a signed-in account: placing orders, moving them, saving settings (RATE_LIMIT_WRITE_MAX). */
export const writeLimiter = createRateLimiter({
  name: 'write',
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_WRITE_MAX,
  keyBy: 'user',
});

/** Account creation, by address: there is no user yet (RATE_LIMIT_REGISTER_MAX). */
export const registerLimiter = createRateLimiter({
  name: 'register',
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_REGISTER_MAX,
  keyBy: 'ip',
});
