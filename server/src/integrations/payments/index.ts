import { env } from '../../utils/env';
import { paymentsNotEnabled } from '../../utils/errors';
import { fakeGateway } from './fake';
import type { PaymentGateway, PaymentProvider } from './port';

let fake: PaymentGateway | null = null;

/** The adapter for a payment's own provider: status checks, refunds and reconciliation never use the default. */
export function gatewayFor(provider: PaymentProvider): PaymentGateway {
  switch (provider) {
    case 'fake':
      fake ??= fakeGateway();
      return fake;
  }
}

/**
 * The provider PAYMENT_PROVIDER names, for a new checkout; read on every call (a test switches it). With `none`
 * (production until a merchant account is live) it throws 409 PAYMENTS_NOT_ENABLED, and nothing else in the API
 * needs a provider, so production still starts and serves menus.
 */
export function paymentGateway(): PaymentGateway {
  if (env.PAYMENT_PROVIDER === 'none') throw paymentsNotEnabled();
  return gatewayFor(env.PAYMENT_PROVIDER);
}
