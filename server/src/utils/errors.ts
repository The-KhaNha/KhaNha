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
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'CLIENT_OUTDATED'
  | 'RATE_LIMITED'
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

/** Which request field an error is about, so a form can show the message on that field instead of a banner. */
export interface FieldErrorDetails {
  field: string;
}

/** Which order an idempotency key already placed, so the client can send the customer to it. */
export interface ReplayedOrderDetails {
  orderId: string;
  orderNumber: number;
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
    public readonly details?: ItemErrorDetails | ReplayedOrderDetails | FieldErrorDetails,
    /** Extra fields for the error handler's log line only; never sent to the client. */
    public readonly logFields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** `field` names the top-level request field at fault (`customerPhone`, `email`), when there is one. */
export const validationError = (message: string, field?: string): AppError =>
  new AppError(400, 'VALIDATION_ERROR', message, field ? { field } : undefined);

export const unauthorized = (message = 'Please sign in to continue.'): AppError =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have permission to do that.'): AppError =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'We could not find what you were looking for.'): AppError =>
  new AppError(404, 'NOT_FOUND', message);

/** The body is over JSON_BODY_LIMIT_BYTES: refused on its declared length (app.ts) or by body-parser (errorHandler). */
export const payloadTooLarge = (): AppError =>
  new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');

/**
 * Too many requests from one account or address in the window (middleware/rateLimit.ts). The log line says which
 * limiter refused and whether it counted an account or an address, so a burst can be told apart.
 */
export const rateLimited = (limiter: string, keyedBy: 'user' | 'ip'): AppError =>
  new AppError(
    429,
    'RATE_LIMITED',
    'Too many requests. Please wait a minute and try again.',
    undefined,
    { limiter, keyedBy },
  );

/**
 * The key already placed an order, and this request asks for something else under it (a cart changed after a Pay
 * whose answer was lost). Refused rather than replayed, so the customer is never told they paid for items the
 * kitchen will not see.
 */
export const idempotencyKeyReused = (orderId: string, orderNumber: number): AppError =>
  new AppError(
    409,
    'IDEMPOTENCY_KEY_REUSED',
    `Your earlier order #${orderNumber} already went through. Pay again to order what is in your cart now.`,
    { orderId, orderNumber },
  );

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
