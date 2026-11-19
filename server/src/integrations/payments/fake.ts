import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../../utils/env';
import { IntegrationError } from '../../utils/errors';
import { raisedByDatabase, supabaseAdmin } from '../../utils/supabase';
import type { GatewayEvent, GatewayPaymentStatus, GatewayRefund, PaymentGateway } from './port';

export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';

/** The provider refused or does not know the id: a retry would get the same answer. */
const refused = (operation: string, reason: string) =>
  new IntegrationError('fake', operation, false, { cause: new Error(reason) });

/** The fake's webhook signature: HMAC-SHA256 of the raw body, hex. Throws when no secret is set (staging unset). */
export function signFakeWebhook(rawBody: string | Buffer): string {
  const key = env.FAKE_GATEWAY_SECRET;
  if (!key) throw refused('sign', 'FAKE_GATEWAY_SECRET is not set');
  return createHmac('sha256', key).update(rawBody).digest('hex');
}

const eventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('payment'),
    gatewayOrderId: z.uuid(),
    status: z.enum(['PENDING', 'PAID', 'FAILED']),
  }),
  z.object({
    kind: z.literal('refund'),
    gatewayOrderId: z.uuid(),
    refundId: z.string().min(1).max(100),
    status: z.enum(['PENDING', 'PROCESSED', 'FAILED']),
  }),
]);

function verifyFakeWebhook(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): GatewayEvent | null {
  const key = env.FAKE_GATEWAY_SECRET;
  const given = headers[FAKE_SIGNATURE_HEADER];
  if (!key || typeof given !== 'string') return null;
  const expected = Buffer.from(signFakeWebhook(rawBody), 'hex');
  const actual = Buffer.from(given, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = eventSchema.safeParse(JSON.parse(rawBody.toString('utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function findOrder(gatewayOrderId: string, operation: string) {
  const { data } = await supabaseAdmin
    .from('fake_gateway_orders')
    .select('amount_paise, status, refunds')
    .eq('id', gatewayOrderId)
    .maybeSingle()
    .throwOnError();
  if (!data) throw refused(operation, 'unknown gateway order');
  return data;
}

/**
 * What the payment page's buttons (and tests) do: the customer paid, failed or walked away. A paid order stays paid,
 * as at a real provider. Returns where the browser goes next. Posting the signed webhook arrives with the webhook
 * route (P5 PR 10). null for an id the fake never issued.
 */
export async function setFakeOutcome(
  gatewayOrderId: string,
  status: GatewayPaymentStatus,
): Promise<{ returnUrl: string } | null> {
  const { data: order } = await supabaseAdmin
    .from('fake_gateway_orders')
    .select('status, return_url')
    .eq('id', gatewayOrderId)
    .maybeSingle()
    .throwOnError();
  if (!order) return null;
  if (order.status !== 'PAID') {
    await supabaseAdmin
      .from('fake_gateway_orders')
      .update({ status })
      .eq('id', gatewayOrderId)
      .neq('status', 'PAID')
      .throwOnError();
  }
  return { returnUrl: order.return_url };
}

/** The page's view of one order; null for an id the fake never issued. */
export async function fakeOrderForPage(
  gatewayOrderId: string,
): Promise<{ amountPaise: number; status: GatewayPaymentStatus } | null> {
  const { data } = await supabaseAdmin
    .from('fake_gateway_orders')
    .select('amount_paise, status')
    .eq('id', gatewayOrderId)
    .maybeSingle()
    .throwOnError();
  return data && { amountPaise: data.amount_paise, status: data.status as GatewayPaymentStatus };
}

function refundOf(refundId: string, value: unknown): GatewayRefund {
  const refund = value as { amountPaise: number; status: GatewayRefund['status'] };
  return { refundId, amountPaise: refund.amountPaise, status: refund.status };
}

/**
 * A provider of our own for local, CI and staging (P5.1): it keeps its orders in `fake_gateway_orders`, because the
 * API, the worker and the reconciler are separate processes, and its payment page is served by the API itself
 * (`routes/fakeGateway.routes.ts`). Refused in production by utils/env.
 */
export function fakeGateway(): PaymentGateway {
  return {
    provider: 'fake',

    async createOrder({ orderId, amountPaise, returnUrl, notifyUrl, expiresAt }) {
      // Idempotent on our order id, as a provider's receipt or order reference is: a retry returns the first order.
      await supabaseAdmin
        .from('fake_gateway_orders')
        .upsert(
          {
            order_id: orderId,
            amount_paise: amountPaise,
            return_url: returnUrl,
            notify_url: notifyUrl,
            expires_at: expiresAt.toISOString(),
          },
          { onConflict: 'order_id', ignoreDuplicates: true },
        )
        .throwOnError();
      const { data } = await supabaseAdmin
        .from('fake_gateway_orders')
        .select('id, amount_paise')
        .eq('order_id', orderId)
        .single()
        .throwOnError();
      // A provider never charges a retry a different amount: an amount that moved is a bug on our side, loudly.
      if (data.amount_paise !== amountPaise)
        throw refused('createOrder', 'amount differs from the first create');
      // Same origin as the app: /api is proxied to the API in every environment.
      return {
        gatewayOrderId: data.id,
        session: { mode: 'redirect', url: `/api/fake-gateway/${data.id}` },
      };
    },

    async getOrderStatus(gatewayOrderId) {
      const order = await findOrder(gatewayOrderId, 'getOrderStatus');
      return {
        gatewayOrderId,
        status: order.status as GatewayPaymentStatus,
        amountPaise: order.amount_paise,
      };
    },

    verifyWebhook: verifyFakeWebhook,

    async refund({ gatewayOrderId, refundId, amountPaise }) {
      try {
        const { data } = await supabaseAdmin
          .rpc('fake_gateway_refund', {
            p_id: gatewayOrderId,
            p_refund_id: refundId,
            p_amount_paise: amountPaise,
          })
          .throwOnError();
        return refundOf(refundId, data);
      } catch (err) {
        if (raisedByDatabase(err, 'NOT_FOUND')) throw refused('refund', 'unknown gateway order');
        if (raisedByDatabase(err, 'FAKE_REFUND_REFUSED')) throw refused('refund', 'refund refused');
        throw err;
      }
    },

    async getRefund(gatewayOrderId, refundId) {
      const order = await findOrder(gatewayOrderId, 'getRefund');
      const refund = (order.refunds as Record<string, unknown>)[refundId];
      if (!refund) throw refused('getRefund', 'unknown refund');
      return refundOf(refundId, refund);
    },
  };
}
