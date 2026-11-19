import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PaymentGateway } from '../../src/integrations/payments/port';
import { IntegrationError } from '../../src/utils/errors';

/** What a test does that only a person could do at the provider's page. */
export interface GatewayDriver {
  pay(gatewayOrderId: string): Promise<void>;
  /** A webhook body signed as the provider would send it, with its headers. */
  signedWebhook(body: string): { rawBody: Buffer; headers: Record<string, string> };
}

const newOrder = (amountPaise = 25_000) => ({
  orderId: randomUUID(),
  amountPaise,
  customer: { id: randomUUID() },
  returnUrl: 'http://localhost:5173/orders/return',
  notifyUrl: 'http://localhost:8000/api/webhooks/payments',
  expiresAt: new Date(Date.now() + 10 * 60 * 1000),
});

/**
 * The suite every PaymentGateway adapter must pass (P5.1): run against the fake here, and against each provider's
 * sandbox by its adapter's PR. Not a test file itself (no `.test.ts`), so it runs only where it is called.
 */
export function gatewayContract(make: () => PaymentGateway, driver: GatewayDriver): void {
  describe(`PaymentGateway contract: ${make().provider}`, () => {
    it('creates an order idempotently on our order id', async () => {
      const gateway = make();
      const input = newOrder();
      const first = await gateway.createOrder(input);
      const again = await gateway.createOrder(input);
      expect(again.gatewayOrderId).toBe(first.gatewayOrderId);
      expect(first.session.mode).toBe('redirect');
      await expect(gateway.getOrderStatus(first.gatewayOrderId)).resolves.toEqual({
        gatewayOrderId: first.gatewayOrderId,
        status: 'PENDING',
        amountPaise: input.amountPaise,
      });
    });

    it('refuses a retried create whose amount changed', async () => {
      const gateway = make();
      const input = newOrder(10_000);
      await gateway.createOrder(input);
      await expect(gateway.createOrder({ ...input, amountPaise: 15_000 })).rejects.toBeInstanceOf(
        IntegrationError,
      );
    });

    it('fails a status read of an unknown id as an IntegrationError', async () => {
      await expect(make().getOrderStatus(randomUUID())).rejects.toBeInstanceOf(IntegrationError);
    });

    it('refunds idempotently on our refund id, and never more than was paid', async () => {
      const gateway = make();
      const { gatewayOrderId } = await gateway.createOrder(newOrder(10_000));
      await driver.pay(gatewayOrderId);
      const refund = { gatewayOrderId, refundId: randomUUID(), amountPaise: 6_000, note: 'test' };
      const first = await gateway.refund(refund);
      const again = await gateway.refund(refund);
      expect(again).toEqual(first);
      expect(first).toMatchObject({ refundId: refund.refundId, amountPaise: 6_000 });
      await expect(gateway.getRefund(gatewayOrderId, refund.refundId)).resolves.toEqual(first);
      // 6,000 of 10,000 is refunded: another 6,000 would be more than was paid.
      await expect(gateway.refund({ ...refund, refundId: randomUUID() })).rejects.toBeInstanceOf(
        IntegrationError,
      );
    });

    it('refuses to refund an order that was not paid', async () => {
      const gateway = make();
      const { gatewayOrderId } = await gateway.createOrder(newOrder());
      await expect(
        gateway.refund({ gatewayOrderId, refundId: randomUUID(), amountPaise: 100, note: 'test' }),
      ).rejects.toBeInstanceOf(IntegrationError);
    });

    it('verifies a signed webhook, and a tampered one to null', async () => {
      const gateway = make();
      const { gatewayOrderId } = await gateway.createOrder(newOrder());
      const { rawBody, headers } = driver.signedWebhook(
        JSON.stringify({ kind: 'payment', gatewayOrderId, status: 'PAID' }),
      );
      expect(gateway.verifyWebhook(rawBody, headers)).toEqual({
        kind: 'payment',
        gatewayOrderId,
        status: 'PAID',
      });
      const tampered = Buffer.from(rawBody.toString('utf8').replace('PAID', 'FAILED'));
      expect(gateway.verifyWebhook(tampered, headers)).toBeNull();
      expect(gateway.verifyWebhook(rawBody, {})).toBeNull();
    });
  });
}
