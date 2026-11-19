/** The providers an adapter exists for. `none` is not one: it is the absence of a provider (production until G3). */
export type PaymentProvider = 'fake';

/** Where the customer goes to pay. An `sdk` mode is added by the provider's adapter only if P4's spike needs it. */
export interface CheckoutSession {
  mode: 'redirect';
  url: string;
}

export type GatewayPaymentStatus = 'PENDING' | 'PAID' | 'FAILED';
export type GatewayRefundStatus = 'PENDING' | 'PROCESSED' | 'FAILED';

export interface CreateGatewayOrder {
  /** Our order id: the provider's idempotency key, so a retried create returns the same gateway order. */
  orderId: string;
  amountPaise: number;
  customer: { id: string; name?: string; phone?: string };
  /** Where the provider sends the browser after the payment page. */
  returnUrl: string;
  /** Where the provider posts its webhooks. */
  notifyUrl: string;
  expiresAt: Date;
}

export interface GatewayOrderStatus {
  gatewayOrderId: string;
  status: GatewayPaymentStatus;
  amountPaise: number;
}

export interface GatewayRefund {
  refundId: string;
  status: GatewayRefundStatus;
  amountPaise: number;
}

/** A webhook whose signature checked out. Only ids and states: a handler re-reads anything else from the provider. */
export type GatewayEvent =
  | { kind: 'payment'; gatewayOrderId: string; status: GatewayPaymentStatus }
  | { kind: 'refund'; gatewayOrderId: string; refundId: string; status: GatewayRefundStatus };

/**
 * A payment provider (P5.1). Amounts are paise everywhere; only an adapter converts to its provider's unit. Every
 * call that can reach the provider fails with an IntegrationError when it cannot be reached, and every write
 * carries our own id so a retry cannot charge or refund twice.
 */
export interface PaymentGateway {
  readonly provider: PaymentProvider;
  createOrder(
    input: CreateGatewayOrder,
  ): Promise<{ gatewayOrderId: string; session: CheckoutSession }>;
  getOrderStatus(gatewayOrderId: string): Promise<GatewayOrderStatus>;
  /** The verified event, or null for a bad signature or a body that is not one of the provider's events. */
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): GatewayEvent | null;
  /** Idempotent on `refundId` (ours): a repeat returns the first refund. */
  refund(input: {
    gatewayOrderId: string;
    refundId: string;
    amountPaise: number;
    note: string;
  }): Promise<GatewayRefund>;
  getRefund(gatewayOrderId: string, refundId: string): Promise<GatewayRefund>;
}
