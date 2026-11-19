import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gatewayFor, paymentGateway } from '../../src/integrations/payments';
import {
  FAKE_SIGNATURE_HEADER,
  setFakeOutcome,
  signFakeWebhook,
} from '../../src/integrations/payments/fake';
import { env } from '../../src/utils/env';
import { AppError, IntegrationError } from '../../src/utils/errors';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import { localSql } from '../setup/helpers';
import { gatewayContract } from '../unit/payments-port.contract';

gatewayContract(() => gatewayFor('fake'), {
  pay: async (id) => {
    await setFakeOutcome(id, 'PAID');
  },
  signedWebhook: (body) => ({
    rawBody: Buffer.from(body),
    headers: { [FAKE_SIGNATURE_HEADER]: signFakeWebhook(body) },
  }),
});

const provider = env.PAYMENT_PROVIDER;
afterEach(() => {
  env.PAYMENT_PROVIDER = provider;
});

async function fakeOrder(returnUrl = 'http://localhost:5173/checkout/return?o=1') {
  return gatewayFor('fake').createOrder({
    orderId: randomUUID(),
    amountPaise: 12_345,
    customer: { id: randomUUID() },
    returnUrl,
    notifyUrl: 'http://localhost:8000/api/webhooks/payments',
    expiresAt: new Date(Date.now() + 600_000),
  });
}

describe('paymentGateway()', () => {
  it('is the fake by default outside production', () => {
    expect(paymentGateway().provider).toBe('fake');
  });

  it('answers 409 PAYMENTS_NOT_ENABLED when no provider is configured', () => {
    env.PAYMENT_PROVIDER = 'none';
    expect(() => paymentGateway()).toThrow(
      expect.objectContaining({ status: 409, code: 'PAYMENTS_NOT_ENABLED' }) as AppError,
    );
  });
});

describe('the fake payment page', () => {
  it('shows the amount and the three outcomes', async () => {
    const { session } = await fakeOrder();
    const res = await api().get(session.url).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('12345 paise');
    expect(res.text.match(/<form method="post"/g)).toHaveLength(3);
  });

  it('carries the API security headers, so the page needs no script or style', async () => {
    const { session } = await fakeOrder();
    const res = await api().get(session.url).expect(200);
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.text).not.toMatch(/<script|<style|style=/i);
  });

  it('pays and sends the browser back to the return URL', async () => {
    const { gatewayOrderId } = await fakeOrder('http://localhost:5173/back');
    const res = await api().post(`/api/fake-gateway/${gatewayOrderId}/pay`).expect(303);
    expect(res.headers.location).toBe('http://localhost:5173/back');
    await expect(gatewayFor('fake').getOrderStatus(gatewayOrderId)).resolves.toMatchObject({
      status: 'PAID',
    });
  });

  it('keeps a paid order paid when a later button says fail', async () => {
    const { gatewayOrderId } = await fakeOrder();
    await api().post(`/api/fake-gateway/${gatewayOrderId}/pay`).expect(303);
    await api().post(`/api/fake-gateway/${gatewayOrderId}/fail`).expect(303);
    await expect(gatewayFor('fake').getOrderStatus(gatewayOrderId)).resolves.toMatchObject({
      status: 'PAID',
    });
  });

  it('is 404 for an unknown id and 400 for a bad outcome', async () => {
    await api().get(`/api/fake-gateway/${randomUUID()}`).expect(404);
    await api().post(`/api/fake-gateway/${randomUUID()}/pay`).expect(404);
    const { gatewayOrderId } = await fakeOrder();
    await api().post(`/api/fake-gateway/${gatewayOrderId}/refund`).expect(400);
  });

  it('does not exist unless the provider is the fake (production never is)', async () => {
    const { session } = await fakeOrder();
    env.PAYMENT_PROVIDER = 'none';
    await api().get(session.url).expect(404);
  });
});

describe('the fake gateway when the database is unreachable', () => {
  it('fails every call with a retryable IntegrationError, not a raw transport error', async () => {
    const gateway = gatewayFor('fake');
    const fail = () => {
      throw new TypeError('fetch failed');
    };
    const from = vi.spyOn(supabaseAdmin, 'from').mockImplementation(fail);
    const rpc = vi.spyOn(supabaseAdmin, 'rpc').mockImplementation(fail);
    try {
      const id = randomUUID();
      const calls = [
        gateway.createOrder({
          orderId: id,
          amountPaise: 100,
          customer: { id },
          returnUrl: 'http://localhost:5173/x',
          notifyUrl: 'http://localhost:8000/api/webhooks/payments',
          expiresAt: new Date(Date.now() + 600_000),
        }),
        gateway.getOrderStatus(id),
        gateway.getRefund(id, 'r1'),
        gateway.refund({ gatewayOrderId: id, refundId: 'r1', amountPaise: 100, note: 'x' }),
      ];
      for (const result of await Promise.allSettled(calls)) {
        expect(result).toMatchObject({
          status: 'rejected',
          reason: expect.objectContaining({ name: 'IntegrationError', retryable: true }),
        });
      }
    } finally {
      from.mockRestore();
      rpc.mockRestore();
    }
  });
});

describe('the fake gateway under concurrency', () => {
  it('never refunds more than was paid when refunds race', async () => {
    const gateway = gatewayFor('fake');
    const { gatewayOrderId } = await fakeOrder();
    await setFakeOutcome(gatewayOrderId, 'PAID');
    // Five refunds of 5,000 against 12,345 paid: the row lock lets two through.
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        gateway.refund({
          gatewayOrderId,
          refundId: randomUUID(),
          amountPaise: 5_000,
          note: 'race',
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(IntegrationError);
    }
    const [row] = localSql<{ refunded: number }>(
      `select coalesce(sum((r.value ->> 'amountPaise')::bigint), 0)::int as refunded
         from public.fake_gateway_orders o, jsonb_each(o.refunds) r where o.id = '${gatewayOrderId}'`,
    );
    expect(row?.refunded).toBe(10_000);
  });

  it('issues one gateway order when createOrder races on the same order id', async () => {
    const gateway = gatewayFor('fake');
    const input = {
      orderId: randomUUID(),
      amountPaise: 900,
      customer: { id: randomUUID() },
      returnUrl: 'http://localhost:5173/back',
      notifyUrl: 'http://localhost:8000/api/webhooks/payments',
      expiresAt: new Date(Date.now() + 600_000),
    };
    const created = await Promise.all(Array.from({ length: 5 }, () => gateway.createOrder(input)));
    expect(new Set(created.map((c) => c.gatewayOrderId)).size).toBe(1);
    const [row] = localSql<{ n: number }>(
      `select count(*)::int as n from public.fake_gateway_orders where order_id = '${input.orderId}'`,
    );
    expect(row?.n).toBe(1);
  });
});

describe('the fake webhook edge cases', () => {
  const secret = env.FAKE_GATEWAY_SECRET;
  afterEach(() => {
    env.FAKE_GATEWAY_SECRET = secret;
  });
  const sign = (body: string) => ({
    rawBody: Buffer.from(body),
    headers: { [FAKE_SIGNATURE_HEADER]: signFakeWebhook(body) },
  });

  it('answers null when no secret is set, and refuses to sign', () => {
    const { rawBody, headers } = sign(
      JSON.stringify({ kind: 'payment', gatewayOrderId: randomUUID(), status: 'PAID' }),
    );
    env.FAKE_GATEWAY_SECRET = undefined;
    expect(gatewayFor('fake').verifyWebhook(rawBody, headers)).toBeNull();
    expect(() => signFakeWebhook('x')).toThrow(IntegrationError);
  });

  it.each([
    ['not JSON', 'not json'],
    ['JSON that is not an event', '{"hello":"world"}'],
    ['an unknown kind', JSON.stringify({ kind: 'dispute', gatewayOrderId: randomUUID() })],
    [
      'a bad status',
      JSON.stringify({ kind: 'payment', gatewayOrderId: randomUUID(), status: 'X' }),
    ],
    ['a non-uuid id', JSON.stringify({ kind: 'payment', gatewayOrderId: '1', status: 'PAID' })],
    ['an array', '[]'],
  ])('answers null for a correctly signed body that is %s', (_name, body) => {
    const { rawBody, headers } = sign(body);
    expect(gatewayFor('fake').verifyWebhook(rawBody, headers)).toBeNull();
  });

  it('answers null for a signature that is not hex, the wrong length, or repeated', () => {
    const rawBody = Buffer.from('{}');
    for (const bad of ['zz', '', 'ab', signFakeWebhook(rawBody) + '00']) {
      expect(
        gatewayFor('fake').verifyWebhook(rawBody, { [FAKE_SIGNATURE_HEADER]: bad }),
      ).toBeNull();
    }
    expect(
      gatewayFor('fake').verifyWebhook(rawBody, { [FAKE_SIGNATURE_HEADER]: ['a', 'b'] }),
    ).toBeNull();
  });
});

describe('fake gateway retention', () => {
  it('is purged nightly by its own job, which keeps a week', async () => {
    // Own row, so the purge assertion does not depend on rows left by earlier tests.
    const { gatewayOrderId } = await fakeOrder();
    expect(
      localSql(
        "select schedule, command from cron.job where jobname = 'purge-fake-gateway-orders'",
      ),
    ).toEqual([{ schedule: '47 21 * * *', command: 'select public.purge_fake_gateway_orders()' }]);
    const [purged] = localSql<{ n: number }>(
      "select public.purge_fake_gateway_orders(now() + interval '8 days') as n",
    );
    expect(purged?.n).toBeGreaterThan(0);
    expect(
      localSql(`select 1 from public.fake_gateway_orders where id = '${gatewayOrderId}'`),
    ).toHaveLength(0);
  });
});
