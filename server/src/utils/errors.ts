export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'PAYLOAD_TOO_LARGE'
  | 'ITEM_NOT_FOUND'
  | 'ITEM_UNAVAILABLE'
  | 'INSUFFICIENT_STOCK'
  | 'STORE_CLOSED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'EMAIL_TAKEN'
  | 'INVALID_STATUS_TRANSITION'
  | 'CLIENT_OUTDATED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'INTERNAL';

/**
 * Which cart line an item error is about, so the client can point at it instead of saying "some item".
 * `available` is how many can still be ordered: 0 for a sold-out, unavailable or missing item.
 */
export interface ItemErrorDetails {
  menuItemId: string;
  name?: string;
  available: number;
}

/**
 * A dependency (Supabase's database or Auth, later the payment provider) failed or could not be reached. The error
 * handler answers 503 UPSTREAM_UNAVAILABLE with Retry-After, and logs it once at error with the whole cause chain.
 */
export class IntegrationError extends Error {
  constructor(
    public readonly provider: string,
    public readonly operation: string,
    public readonly retryable: boolean,
    options: { cause: unknown },
  ) {
    super(`${provider} ${operation} failed`, options);
    this.name = 'IntegrationError';
  }
}

/** An expected failure that maps straight to an HTTP status and a user-friendly message. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ItemErrorDetails,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const validationError = (message: string): AppError =>
  new AppError(400, 'VALIDATION_ERROR', message);

export const unauthorized = (message = 'Please sign in to continue.'): AppError =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have permission to do that.'): AppError =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'We could not find what you were looking for.'): AppError =>
  new AppError(404, 'NOT_FOUND', message);

/** The client build is older than site_settings.min_client_version: it must reload to get the current one. */
export const clientOutdated = (): AppError =>
  new AppError(
    426,
    'CLIENT_OUTDATED',
    'A new version of Food Pickup is available. Refresh the page to continue.',
  );

/** The customer asked for more than is left. Names the item so they know exactly which line to change. */
export const insufficientStock = (menuItemId: string, name: string, available: number): AppError =>
  new AppError(
    400,
    'INSUFFICIENT_STOCK',
    available === 0
      ? `${name} just sold out.`
      : `Only ${available} ${name} left. Reduce the quantity in your cart.`,
    { menuItemId, name, available },
  );
