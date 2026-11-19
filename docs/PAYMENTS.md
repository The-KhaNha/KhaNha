# Payments

How the API talks to a payment provider (P5.1). The plan is [`plans/P5_PAYMENTS.md`](../plans/P5_PAYMENTS.md). Today
only the fake provider exists and no route takes a payment yet: checkout still uses `payment.service.ts`
([API.md](API.md#post-orders)). The checkout route that calls the port arrives in P5 PR 06, the webhook route in PR 10.

Code: `server/src/integrations/payments/` (`port.ts`, `fake.ts`, `index.ts`), `server/src/routes/fakeGateway.routes.ts`,
`server/src/controllers/fakeGateway.controller.ts`, `server/src/schemas/fakeGateway.schema.ts`.

## The port

`PaymentGateway` (`port.ts`) is the only thing the rest of the API knows about a provider.

| Member                                                                             | Does                                                                                                                                          |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`                                                                         | the `PaymentProvider` name (`'fake'` today); stored with a payment so later calls reach the same adapter                                      |
| `createOrder({ orderId, amountPaise, customer, returnUrl, notifyUrl, expiresAt })` | `{ gatewayOrderId, session }`; `session` is `{ mode: 'redirect', url }`. Idempotent on `orderId` (ours): a retry returns the first order      |
| `getOrderStatus(gatewayOrderId)`                                                   | `{ gatewayOrderId, status: 'PENDING' \| 'PAID' \| 'FAILED', amountPaise }`                                                                    |
| `verifyWebhook(rawBody, headers)`                                                  | the verified `GatewayEvent` (`payment` or `refund`: ids and states only), or `null` for a bad signature or an unknown body shape              |
| `refund({ gatewayOrderId, refundId, amountPaise, note })`                          | `{ refundId, status: 'PENDING' \| 'PROCESSED' \| 'FAILED', amountPaise }`. Idempotent on `refundId` (ours): a repeat returns the first refund |
| `getRefund(gatewayOrderId, refundId)`                                              | the same shape, read back                                                                                                                     |

Rules for every adapter:

- **Paise everywhere.** Amounts are integer paise in and out; only an adapter converts to its provider's unit.
- **Our ids are the idempotency keys.** A retried create or refund cannot charge or refund twice.
- **A provider that cannot be reached, or refuses, is an `IntegrationError`** (`utils/errors.ts`; `retryable` says
  whether asking again can help). Never swallow it, and wrap the cause with `{ cause }`
  ([LOGGING.md](LOGGING.md)).
- **The webhook body is read raw.** `verifyWebhook` takes the bytes the provider signed, never a re-serialized object.

## Choosing a provider

| Call                   | Use                                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paymentGateway()`     | a new checkout. Reads `PAYMENT_PROVIDER` on every call. With `none` it throws `paymentsNotEnabled()`, 409 `PAYMENTS_NOT_ENABLED` ([API.md](API.md#error-codes)) |
| `gatewayFor(provider)` | a payment that already exists (status checks, refunds, reconciliation): its own provider, never the default. Each adapter is built once, as `mediaStore()` is   |

`PAYMENT_PROVIDER` is `none` or `fake`; unset, it is `none` in production and `fake` elsewhere
([CONFIGURATION.md](CONFIGURATION.md#deployment-settings), [DEPLOYMENT.md](DEPLOYMENT.md#server-environment-variables)).
`productionProblems` in `utils/env.ts` refuses `fake` when `APP_ENV=production`: the API and worker exit. Nothing else
in the API needs a provider, so production starts and serves menus with `none`.

## The fake provider

A provider of our own for local development, CI and staging. It marks orders paid with no money, so production
refuses it.

**Decision.** The fake keeps its orders in the `fake_gateway_orders` table ([SCHEMA.md](SCHEMA.md#fake_gateway_orders)),
not in memory, because the API, the worker and the reconciler are separate processes that must see the same payment.
The cost is one table that exists in production, empty.

- **Session.** `createOrder` returns `{ mode: 'redirect', url: '/api/fake-gateway/<gatewayOrderId>' }`, same origin as
  the app (`/api` is proxied to the API in every environment).
- **Page.** `GET /api/fake-gateway/:gatewayOrderId` serves plain HTML with no script and no style: the amount in
  paise, the status and three buttons. Each button is a form post. Routes: [API.md](API.md#fake-gateway-non-production).
- **Outcomes.** `pay` sets `PAID`, `fail` sets `FAILED`, `pending` leaves it `PENDING`; the browser then goes to the
  order's `returnUrl` (303). A paid order stays paid, as at a real provider.
- **Refunds.** `fake_gateway_refund` ([SCHEMA.md](SCHEMA.md#fake_gateway_refund)) refunds a paid order only, never
  more than was paid in total, idempotently on our refund id; the refunds are a jsonb object keyed by that id. A refusal
  or an unknown order is an `IntegrationError` that is not retryable.
- **Signing.** A webhook is signed with HMAC-SHA256 of the raw body, hex, in the `x-fake-signature` header, keyed by
  `FAKE_GATEWAY_SECRET` (`signFakeWebhook`). The secret defaults only when `APP_ENV=local`; when it is unset (staging
  without it) the fake signs nothing and verifies no webhook. The page does not post its webhook yet: that arrives
  with the webhook route in P5 PR 10.
- **Retention.** `purge_fake_gateway_orders` deletes rows older than 7 days nightly, in its
  own pg_cron job, `purge-fake-gateway-orders` ([JOBS.md](JOBS.md#schedules)).

To pay locally: with `PAYMENT_PROVIDER` unset (so `fake`) and the API running, open the session URL
(`http://localhost:8000/api/fake-gateway/<gatewayOrderId>`) and press Pay. Until PR 06 no checkout route returns a
session, so tests and scripts create the order through `fakeGateway().createOrder(...)`.

## The contract suite

`server/test/unit/payments-port.contract.ts` exports `gatewayContract(make, driver)`, the suite every adapter must
pass. It is not a `.test.ts` file: each adapter's test calls it with a factory and a `GatewayDriver` (`pay` does what a
person would at the provider's page; `signedWebhook` signs a body as the provider would). The fake runs it in
`server/test/api/payments-fake.test.ts`; a real adapter's PR runs it against the provider's sandbox. It checks that:

- creating an order twice with one `orderId` returns one gateway order, a `redirect` session and `PENDING`;
- a status read of an unknown id fails as an `IntegrationError`;
- a refund is idempotent on our refund id, never exceeds what was paid, and an unpaid order refuses one;
- a signed webhook verifies to its event and a tampered body, or one with no signature, verifies to `null`.

Tests: [TESTING.md](TESTING.md).
