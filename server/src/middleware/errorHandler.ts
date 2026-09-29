import type { ErrorRequestHandler, RequestHandler } from 'express';
import { PostgrestError } from '@supabase/supabase-js';
import { ZodError } from 'zod';
import {
  AppError,
  IntegrationError,
  payloadTooLarge,
  type ErrorCode,
  type ItemErrorDetails,
  type FieldErrorDetails,
  type ReplayedOrderDetails,
} from '../utils/errors';
import { asDatabaseUnavailable } from '../utils/supabase';
import { describeIssue } from './validate';

interface ErrorDescription {
  status: number;
  code: ErrorCode;
  message: string;
  /** Which cart line an item error is about, or which order a reused idempotency key placed. */
  details?: ItemErrorDetails | ReplayedOrderDetails | FieldErrorDetails;
}

const UPSTREAM_UNAVAILABLE: ErrorDescription = {
  status: 503,
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'The service is temporarily unavailable. Please try again in a moment.',
};
const RETRY_AFTER_SECONDS = '5';

const INTERNAL: ErrorDescription = {
  status: 500,
  code: 'INTERNAL',
  message: 'Something went wrong. Please try again.',
};

/** Final non-error middleware: anything that reached here matched no route. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route matches ${req.method} ${req.path}.` },
  });
};

// Express only treats a 4-argument function as an error handler, so `_next` must stay.
export const errorHandler: ErrorRequestHandler = (thrown: unknown, req, res, _next) => {
  const err = asDatabaseUnavailable(thrown) ?? thrown;
  const { status, code, message, details } = describeError(err);
  if (err instanceof IntegrationError) res.set('Retry-After', RETRY_AFTER_SECONDS);
  // The one place a failed request is logged. Only 5xx carries the error and its stack; a 4xx is an expected
  // client error, and 401/403/429 are warn because a burst of them is worth noticing.
  // A 426 is debug: a stale tab keeps asking until it reloads, and each ask is expected.
  if (status >= 500) {
    const route = req.route ? `${req.baseUrl}${String(req.route.path)}` : req.path;
    req.log.error({ err, route, status, code, userId: req.user?.id }, 'Request failed');
  } else if (status === 426) req.log.debug({ status, code }, message);
  else req.log[[401, 403, 429].includes(status) ? 'warn' : 'info']({ status, code }, message);
  // The envelope is { error: { code, message } }, plus `details` for a cart-line error, a reused idempotency key or
  // the request field a validation error is about.
  res.status(status).json({ error: { code, message, ...(details && { details }) } });
};

function describeError(err: unknown): ErrorDescription {
  if (err instanceof AppError) return err;
  if (err instanceof IntegrationError) return UPSTREAM_UNAVAILABLE;
  if (err instanceof ZodError) {
    return { status: 400, code: 'VALIDATION_ERROR', message: describeIssue(err.issues[0]) };
  }
  if (err instanceof URIError) {
    // The router throws this when a path segment has bad percent-encoding (e.g. /api/orders/%E0).
    return { status: 400, code: 'BAD_REQUEST', message: 'The request URL is malformed.' };
  }
  if (err instanceof PostgrestError) return describeDatabaseError(err);
  return describeHttpError(err) ?? INTERNAL;
}

/** Postgres errors (SQLSTATE codes) that a client can cause despite validation; everything else is a real 500. */
function describeDatabaseError(err: PostgrestError): ErrorDescription {
  switch (err.code) {
    case '22001': // value too long for the column
      return { status: 400, code: 'VALIDATION_ERROR', message: 'One of the values is too long.' };
    case '22021': // invalid byte sequence, e.g. a NUL byte that slipped past validation
    case '22P05': // untranslatable character, the same for JSON arguments
      return { status: 400, code: 'VALIDATION_ERROR', message: 'Invalid characters in input.' };
    default:
      return INTERNAL;
  }
}

/**
 * body-parser and raw-body throw http-errors carrying a `type` and a 4xx `status`.
 * The two a client can realistically trigger get their own codes; the rest stay 4xx without a stack trace.
 */
function describeHttpError(err: unknown): ErrorDescription | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const { type, status } = err as { type?: unknown; status?: unknown };

  if (type === 'entity.too.large') return payloadTooLarge();
  if (type === 'entity.parse.failed') {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Malformed request body.' };
  }
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return { status, code: 'BAD_REQUEST', message: 'The request could not be processed.' };
  }
  return undefined;
}
