import { describe, expect, it } from 'vitest';
import {
  AppError,
  forbidden,
  insufficientStock,
  notFound,
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
