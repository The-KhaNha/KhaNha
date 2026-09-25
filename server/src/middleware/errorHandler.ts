import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError, type ErrorCode, type ItemErrorDetails } from '../utils/errors';
import { describeIssue } from './validate';

interface ErrorDescription {
  status: number;
  code: ErrorCode;
  message: string;
  /** Present on item errors only: which cart line the message is about. */
  details?: ItemErrorDetails;
}

const INTERNAL: ErrorDescription = { status: 500, code: 'INTERNAL', message: 'Something went wrong. Please try again.' };

/** Final non-error middleware: anything that reached here matched no route. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route matches ${req.method} ${req.path}.` },
  });
};

// Express only treats a 4-argument function as an error handler, so `_next` must stay.
export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  const { status, code, message, details } = describeError(err);
  // Only genuinely unknown failures are logged with a stack; every 4xx is an expected client error.
  if (status >= 500) console.error(err instanceof Error ? err.stack : err);
  // The envelope is { error: { code, message } }, plus `details` when an error is about one cart line.
  res.status(status).json({ error: { code, message, ...(details && { details }) } });
};

function describeError(err: unknown): ErrorDescription {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return { status: 400, code: 'VALIDATION_ERROR', message: describeIssue(err.issues[0]) };
  }
  if (err instanceof URIError) {
    // The router throws this when a path segment has bad percent-encoding (e.g. /api/orders/%E0).
    return { status: 400, code: 'BAD_REQUEST', message: 'The request URL is malformed.' };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) return describePrismaError(err);
  if (err instanceof Prisma.PrismaClientUnknownRequestError && isInvalidTextError(err)) {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Invalid characters in input.' };
  }
  return describeHttpError(err) ?? INTERNAL;
}

function describePrismaError(err: Prisma.PrismaClientKnownRequestError): ErrorDescription {
  switch (err.code) {
    case 'P2000': // value too long for the column
      return { status: 400, code: 'VALIDATION_ERROR', message: 'One of the values is too long.' };
    case 'P2002': // the only user-facing unique constraint is User.email
      return { status: 409, code: 'EMAIL_TAKEN', message: 'An account with this email already exists.' };
    case 'P2025': // a record the operation depends on was not found
      return { status: 404, code: 'NOT_FOUND', message: 'We could not find what you were looking for.' };
    default:
      return INTERNAL;
  }
}

/** Postgres rejects text it cannot encode (SQLSTATE 22021, e.g. a NUL byte that slipped past validation). */
function isInvalidTextError(err: Prisma.PrismaClientUnknownRequestError): boolean {
  return err.message.includes('22021') || err.message.includes('invalid byte sequence');
}

/**
 * body-parser and raw-body throw http-errors carrying a `type` and a 4xx `status`.
 * The two a client can realistically trigger get their own codes; the rest stay 4xx without a stack trace.
 */
function describeHttpError(err: unknown): ErrorDescription | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const { type, status } = err as { type?: unknown; status?: unknown };

  if (type === 'entity.too.large') {
    return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' };
  }
  if (type === 'entity.parse.failed') {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Malformed request body.' };
  }
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return { status, code: 'BAD_REQUEST', message: 'The request could not be processed.' };
  }
  return undefined;
}
