import { PostgrestError } from '@supabase/supabase-js';
import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { errorHandler, loggedAtDebug } from '../../src/middleware/errorHandler';
import {
  AppError,
  IntegrationError,
  InvariantError,
  clientOutdated,
  forbidden,
  idempotencyKeyReused,
  insufficientStock,
  notFound,
  payloadTooLarge,
  rateLimited,
  unauthorized,
  validationError,
} from '../../src/utils/errors';

describe('AppError factories', () => {
  it('validationError is 400 VALIDATION_ERROR with no details', () => {
    const err = validationError('Name is required.');
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toBe('Name is required.');
    expect(err.details).toBeUndefined();
  });

  it('unauthorized is 401 UNAUTHORIZED with a default message', () => {
    const err = unauthorized();
    expect(err.status).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.message).toBe('Please sign in to continue.');
  });

  it('unauthorized accepts a custom message', () => {
    expect(unauthorized('Your session has expired. Please sign in again.').message).toBe(
      'Your session has expired. Please sign in again.',
    );
  });

  it('forbidden is 403 FORBIDDEN with a default message', () => {
    const err = forbidden();
    expect(err.status).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).toBe('You do not have permission to do that.');
  });

  it('notFound is 404 NOT_FOUND with a default message', () => {
    const err = notFound();
    expect(err.status).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('We could not find what you were looking for.');
  });

  describe('insufficientStock', () => {
    it('names the item and sets details when some units remain', () => {
      const err = insufficientStock('item-1', 'Cheese Toast', 1);
      expect(err.status).toBe(400);
      expect(err.code).toBe('INSUFFICIENT_STOCK');
      expect(err.message).toBe('Only 1 Cheese Toast left. Reduce the quantity in your cart.');
      expect(err.details).toEqual({ menuItemId: 'item-1', name: 'Cheese Toast', available: 1 });
    });

    it('uses "just sold out" wording when available is 0', () => {
      const err = insufficientStock('item-1', 'Cheese Toast', 0);
      expect(err.message).toBe('Cheese Toast just sold out.');
      expect(err.details).toEqual({ menuItemId: 'item-1', name: 'Cheese Toast', available: 0 });
    });
  });

  it('every factory error has name AppError (for instanceof checks in the error handler)', () => {
    expect(validationError('x').name).toBe('AppError');
    expect(unauthorized().name).toBe('AppError');
  });
});

describe('errorHandler mapping', () => {
  function run(err: unknown, user?: { id: string }) {
    const logged: { level: string; fields: Record<string, unknown> }[] = [];
    const log = Object.fromEntries(
      ['error', 'warn', 'info', 'debug'].map((level) => [
        level,
        (fields: Record<string, unknown>) => logged.push({ level, fields }),
      ]),
    );
    const req = {
      log,
      path: '/orders',
      baseUrl: '/api',
      route: { path: '/orders' },
      user,
    } as unknown as Request;
    const headers: Record<string, string> = {};
    let status = 0;
    let body: unknown;
    const res = {
      set: (name: string, value: string) => {
        headers[name] = value;
        return res;
      },
      status: (code: number) => {
        status = code;
        return res;
      },
      json: (value: unknown) => {
        body = value;
        return res;
      },
    } as unknown as Response;
    errorHandler(err, req, res, () => {});
    return { status, body, headers, logged, res };
  }

  const fetchFailed = () =>
    Object.assign(new TypeError('fetch failed'), { cause: new Error('connect ECONNREFUSED') });

  it.each([
    [
      'an IntegrationError',
      new IntegrationError('supabase-auth', 'verify', true, { cause: new Error('x') }),
    ],
    ["undici's fetch failed (from .throwOnError())", fetchFailed()],
    [
      'a PostgREST-shaped transport error (empty code)',
      { code: '', message: 'TypeError: fetch failed' },
    ],
    ['a timeout', Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' })],
  ])('%s → 503 UPSTREAM_UNAVAILABLE with Retry-After: 5', (_label, err) => {
    const { status, body, headers, logged } = run(err, { id: 'u1' });
    expect(status).toBe(503);
    expect(body).toEqual({
      error: {
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'The service is temporarily unavailable. Please try again in a moment.',
      },
    });
    expect(headers['Retry-After']).toBe('5');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      level: 'error',
      fields: { route: '/api/orders', status: 503, code: 'UPSTREAM_UNAVAILABLE', userId: 'u1' },
    });
  });

  it('keeps an unknown error a 500 INTERNAL, without Retry-After', () => {
    const { status, body, headers } = run(new Error('boom'));
    expect(status).toBe(500);
    expect(body).toEqual({
      error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' },
    });
    expect(headers['Retry-After']).toBeUndefined();
  });

  it('answers an InvariantError 500 INTERNAL, logged at error with invariant: true', () => {
    const { status, body, logged } = run(new InvariantError('order has no lines'), { id: 'u1' });
    expect(status).toBe(500);
    expect(body).toEqual({
      error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' },
    });
    expect(logged).toEqual([
      expect.objectContaining({
        level: 'error',
        fields: expect.objectContaining({ invariant: true }),
      }),
    ]);
    expect(run(new Error('boom')).logged[0]?.fields).not.toHaveProperty('invariant', true);
  });

  it('keeps an AppError as it is, logged below error', () => {
    const { status, logged } = run(forbidden());
    expect(status).toBe(403);
    expect(logged[0]?.level).toBe('warn');
  });

  // docs/LOGGING.md: 401/403 and the first 429 per key per window warn (a burst is worth noticing, once), a repeat 429
  // and 426 debug (each repeat is expected), other 4xx info. A 4xx never carries err: the stack is only for 5xx.
  it.each([
    ['validationError', 400, 'info', validationError('x')],
    ['unauthorized', 401, 'warn', unauthorized()],
    ['forbidden', 403, 'warn', forbidden()],
    ['notFound', 404, 'info', notFound()],
    ['insufficientStock', 400, 'info', insufficientStock('i1', 'Tea', 0)],
    ['idempotencyKeyReused', 409, 'info', idempotencyKeyReused('o1', 7)],
    ['payloadTooLarge', 413, 'info', payloadTooLarge()],
    ['clientOutdated', 426, 'debug', clientOutdated()],
    ['rateLimited, the first in its window', 429, 'warn', rateLimited('flood', 'ip', 30, true)],
    ['rateLimited, a repeat in its window', 429, 'debug', rateLimited('flood', 'ip', 30, false)],
  ])('%s → %i, logged once at %s without err', (_name, status, level, err) => {
    const result = run(err, { id: 'u1' });
    expect(result.status).toBe(status);
    expect(result.logged).toHaveLength(1);
    expect(result.logged[0]?.level).toBe(level);
    expect(result.logged[0]?.fields).not.toHaveProperty('err');
  });

  it('a 429 log line says which limiter refused and what it counted, and the client never sees it', () => {
    const { logged, body } = run(rateLimited('write', 'user', 30, true), { id: 'u1' });
    expect(logged[0]?.fields).toMatchObject({ status: 429, limiter: 'write', keyedBy: 'user' });
    expect(JSON.stringify(body)).not.toMatch(/limiter|keyedBy/);
  });

  // app.ts's access line follows the error handler down to debug, so an expected repeat writes nothing louder.
  it.each([
    ['clientOutdated', true, clientOutdated()],
    ['a repeat rateLimited', true, rateLimited('write', 'user', 30, false)],
    ['a first rateLimited', false, rateLimited('write', 'user', 30, true)],
    ['forbidden', false, forbidden()],
    ['an unknown error', false, new Error('boom')],
  ])('%s: response marked as logged at debug is %s', (_label, quiet, err) => {
    expect(loggedAtDebug.has(run(err).res)).toBe(quiet);
  });

  // The client narrows new shapes on `kind` and old ones on `code` (docs/API.md "Error details").
  it.each([
    ['an item', insufficientStock('i1', 'Tea', 2), { menuItemId: 'i1', name: 'Tea', available: 2 }],
    ['a field', validationError('x', 'email'), { field: 'email' }],
    ['a replayed order', idempotencyKeyReused('o1', 7), { orderId: 'o1', orderNumber: 7 }],
    [
      'a rate limit',
      rateLimited('write', 'user', 42, true),
      { kind: 'rateLimit', retryAfterSeconds: 42 },
    ],
  ])('passes %s details through untouched', (_label, err, details) => {
    expect(run(err).body).toEqual({ error: { code: err.code, message: err.message, details } });
  });

  // A lone UTF-16 surrogate in an RPC argument makes PostgREST refuse the JSON (PGRST102) before Postgres sees it. Each
  // of these is a value the client sent, so it is a 400, never a 500 logged at error. PGRST102 is warn: validation
  // should have refused the value first, so one reaching PostgREST may be a server bug and must not hide at info.
  it.each([
    [
      'PGRST102 (an RPC argument PostgREST cannot read as JSON)',
      'PGRST102',
      'Invalid characters in input.',
      { level: 'warn', fields: { status: 400, code: 'VALIDATION_ERROR', dbCode: 'PGRST102' } },
    ],
    [
      '22021 (invalid byte sequence)',
      '22021',
      'Invalid characters in input.',
      { level: 'info', fields: { status: 400, code: 'VALIDATION_ERROR' } },
    ],
    [
      '22001 (value too long)',
      '22001',
      'One of the values is too long.',
      { level: 'info', fields: { status: 400, code: 'VALIDATION_ERROR' } },
    ],
  ])('maps PostgREST %s to 400 VALIDATION_ERROR', (_label, code, message, logLine) => {
    const err = new PostgrestError({
      message: 'Empty or invalid json',
      details: 'the raw body: x\ud800y',
      hint: '',
      code,
    });
    const { status, body, logged } = run(err, { id: 'u1' });
    expect(status).toBe(400);
    expect(body).toEqual({ error: { code: 'VALIDATION_ERROR', message } });
    // Exactly these fields: nothing of the error's details (the value the client sent) reaches the log.
    expect(logged).toEqual([logLine]);
  });

  it('does not treat an ordinary TypeError as a transport failure', () => {
    expect(run(new TypeError('x is not a function')).status).toBe(500);
  });
});
