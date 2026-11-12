export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'PAYLOAD_TOO_LARGE'
  | 'ITEM_NOT_FOUND'
  | 'ITEM_UNAVAILABLE'
  | 'INSUFFICIENT_STOCK'
  | 'STORE_CLOSED'
  | 'STORE_PAUSED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'EMAIL_TAKEN'
  | 'INVALID_STATUS_TRANSITION'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'MEMBERSHIP_EXISTS'
  | 'PRICE_CHANGED'
  | 'SLUG_TAKEN'
  | 'STORE_NOT_READY'
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

/** How long until the window that refused the request resets: the Retry-After header's number, in the body. */
export interface RateLimitDetails {
  kind: 'rateLimit';
  retryAfterSeconds: number;
}

/** When a closed store opens next (ISO 8601), for a client that shows a countdown. */
export interface StoreClosedDetails {
  kind: 'storeClosed';
  nextChangeAt: string;
}

/**
 * Every shape `error.details` can take. The first three predate `kind` and stay untagged, because the deployed client
 * reads them by `code`; every new shape carries a `kind` (docs/API.md "Error details").
 */
/** When a paused store takes orders again (ISO 8601), or null when it is paused until someone resumes it. */
export interface StorePausedDetails {
  kind: 'storePaused';
  pausedUntil: string | null;
}

/** What a store still needs before it can be published (P3.1): `address`, `hours`, `menu`. */
export interface StoreNotReadyDetails {
  kind: 'storeNotReady';
  missing: string[];
}

export type ErrorDetails =
  | ItemErrorDetails
  | ReplayedOrderDetails
  | FieldErrorDetails
  | RateLimitDetails
  | StoreClosedDetails
  | StorePausedDetails
  | StoreNotReadyDetails;

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

/** A job failed in a way a later attempt may not (a timeout, a provider's 5xx): the runner retries it with backoff. */
export class RetryableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RetryableError';
  }
}

/** A job that can never succeed (bad input, a rule that forbids it): the runner dead-letters it at once. */
export class PermanentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PermanentError';
  }
}

/**
 * A programmer error: a state the code assumes cannot happen. Logged at error with `invariant: true` so it stands
 * apart from a failing dependency: a dead letter in a job, 500 INTERNAL in a request (like any unknown error).
 */
export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantError';
  }
}

/** An expected failure that maps straight to an HTTP status and a user-friendly message. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetails,
    /** Extra fields for the error handler's log line only; never sent to the client. */
    public readonly logFields?: Record<string, string>,
    /** Logs at debug instead of the status's usual level: a repeat nobody needs to read twice. */
    public readonly logLevel?: 'debug',
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
 * limiter refused and whether it counted an account or an address, so a burst can be told apart. Only the first
 * refusal per key per window logs at warn: a client hammering the limit would otherwise write a line per request.
 */
export const rateLimited = (
  limiter: string,
  keyedBy: 'user' | 'ip',
  retryAfterSeconds: number,
  firstInWindow: boolean,
): AppError =>
  new AppError(
    429,
    'RATE_LIMITED',
    'Too many requests. Please wait a minute and try again.',
    { kind: 'rateLimit', retryAfterSeconds },
    { limiter, keyedBy },
    firstInWindow ? undefined : 'debug',
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

/** An item switched off, by the API's check or by place_order's when it was switched off in between. */
export const itemUnavailable = (menuItemId: string, name: string): AppError =>
  new AppError(
    400,
    'ITEM_UNAVAILABLE',
    `${name} is currently unavailable. Please remove it from your cart.`,
    {
      menuItemId,
      name,
      available: 0,
    },
  );

/** Another store already has the slug a new branch asked for (or was given from its name). */
export const slugTaken = (): AppError =>
  new AppError(409, 'SLUG_TAKEN', 'Another store already uses that web address. Choose another.', {
    field: 'slug',
  });

/** A publish refused because the store is not ready; `missing` says what to add. */
export const storeNotReady = (missing: string[]): AppError =>
  new AppError(
    409,
    'STORE_NOT_READY',
    'Add an address, weekly hours and at least one available item before publishing.',
    { kind: 'storeNotReady', missing },
  );

/** The email already works at the store, or already has an open invite there (P2.2). */
export const membershipExists = (): AppError =>
  new AppError(
    409,
    'MEMBERSHIP_EXISTS',
    'That person is already on the team or has an open invite.',
  );

/**
 * The store is closed, by the API's check or by place_order's when it closed in between. `opening` is the next
 * opening when the schedule knows it: the message names it ("Campus Cafe opens at 9:00 AM") and the details carry it.
 */
export const storeClosed = (
  storeName: string,
  opening?: { nextChangeAt: Date; when: string },
): AppError =>
  opening
    ? new AppError(400, 'STORE_CLOSED', `${storeName} opens ${opening.when}.`, {
        kind: 'storeClosed',
        nextChangeAt: opening.nextChangeAt.toISOString(),
      })
    : new AppError(
        400,
        'STORE_CLOSED',
        `${storeName} is closed right now. Please come back when it opens.`,
      );

/** The store paused new orders (P2.5): "Campus Cafe has paused new orders. Back at 3:40 PM." */
export const storePaused = (
  storeName: string,
  back: { pausedUntil: Date; when: string } | null,
): AppError =>
  new AppError(
    409,
    'STORE_PAUSED',
    back
      ? `${storeName} has paused new orders. Back ${back.when}.`
      : `${storeName} has paused new orders.`,
    { kind: 'storePaused', pausedUntil: back?.pausedUntil.toISOString() ?? null },
  );

/**
 * An item's price is not the one the customer saw (a cart line's `expectedUnitPrice`), or it changed between the API's
 * read (the amount charged) and place_order's, which refuses to store any other price. No `details`: the message
 * names the item and its new price, and the cart reprices on the next menu read.
 */
export const priceChanged = (menuItemId: string, name: string, price: number): AppError =>
  new AppError(
    409,
    'PRICE_CHANGED',
    `The price of ${name} just changed to ₹${price}. Please review your order.`,
    undefined,
    { menuItemId },
  );
