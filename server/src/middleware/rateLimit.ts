import type { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { env } from '../utils/env';
import { rateLimited } from '../utils/errors';

/**
 * Who a limit counts against. `user` is the signed-in account (after requireAuth), falling back to the address for
 * an unauthenticated request; `ip` is the address alone. The campus Wi-Fi puts hundreds of customers behind one
 * address, so the per-address limits are generous and the per-user ones do the real work (docs/CONFIGURATION.md).
 */
export type RateLimitKey = 'user' | 'ip';

export interface RateLimitOptions {
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
export function createRateLimiter({ windowMs, limit, keyBy }: RateLimitOptions): RequestHandler {
  if (limit === 0) return (_req, _res, next) => next();
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const address = ipKeyGenerator(req.ip ?? '');
      return keyBy === 'user' && req.user ? `user:${req.user.id}` : `ip:${address}`;
    },
    handler: (_req, res, next, options) => {
      res.set('Retry-After', String(Math.ceil(options.windowMs / 1000)));
      next(rateLimited());
    },
  });
}

/** Every /api request, by address: a flood guard, not a fairness rule (RATE_LIMIT_IP_MAX). */
export const ipLimiter = createRateLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_IP_MAX,
  keyBy: 'ip',
});

/** Writes by a signed-in account: placing orders, moving them, saving settings (RATE_LIMIT_WRITE_MAX). */
export const writeLimiter = createRateLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_WRITE_MAX,
  keyBy: 'user',
});

/** Account creation, by address: there is no user yet (RATE_LIMIT_REGISTER_MAX). */
export const registerLimiter = createRateLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_REGISTER_MAX,
  keyBy: 'ip',
});
