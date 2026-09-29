# ADR-003: The payment aggregator and money model are chosen in P4

## Status

Proposed

## Date

2026-09-28

## Context

The app has no online payments yet. The product owner set three constraints:

- Razorpay's ~2% per transaction is not viable.
- 99% of payments will be UPI, and 99% will be under ₹2,000.
- The pilot may run for 6–12 months on a temporary 0% rate before switching.

Where marketplace money may sit is regulated (RBI PA Directions), and the tax treatment depends on the money model.
Sales, KYC and legal review take weeks. The research is in [PAYMENT_OPTIONS.md][payment_options].

## Options considered

1. **Choose the aggregator (PA) and money model on evidence in P4, and design payments to hold for any provider.**
2. **Razorpay at list price.** Rejected: a 2% UPI platform fee, and Route needs ₹40 lakh of turnover.
3. **Holding marketplace money in our own account.** Rejected: it conflicts with the RBI PA Directions.
4. **Returning money by separate transfer (payout) instead of a refund.** Rejected: there is no dispute linkage, so a
   complaint can still become a chargeback and the customer is refunded twice.

## Decision

The payment aggregator and money model are **chosen on evidence in P4**. The proposal is Cashfree with Easy Split and
0% UPI in writing, with a fallback ladder (P4.5). Every design choice made before then holds for any provider:

- UPI intent and QR;
- payment captured, then refunded on rejection;
- server-side status plus signed webhooks as the truth;
- refunds via the PA's API, to the original payment method;
- one payout port for model A (the PA's deferred split) and model B (merchant of record with scheduled payouts).

This ADR is completed in P4.7: the provider, the plan and its rate, the money model (A or B), the hold mechanism, the
pilot's promotion and its end date, and the reasons.

## Consequences

- No payment code is written before P4 decides; P5 builds against a `PaymentGateway` port and a fake gateway.
- Switching providers stays cheap, and is planned from day one (P5.12). A later switch is recorded in a new ADR that
  supersedes this one.
- The CA's and lawyer's views, a written UPI rate and a submitted merchant application are preconditions for
  acceptance.
- The adapters, `PAYMENT_PROVIDER` / `active_payment_provider` values, env names and CSP hosts follow the choice.

## Links

- [P4 — Payment aggregator research and selection][p4--payment-aggregator-research-and-selection]
- [P4.4 Money model options][p4.4],
  [P4.5 Recommendation and fallback ladder][p4.5],
  [P4.7 Decision and ADR-003][p4.7]
- [P5.1 Payment gateway port and adapter][p5.1],
  [P5.6 Ledger and escrow][p5.6],
  [P5.12 Switching providers after the promotion][p5.12]
- [Decisions needed][decisions-needed] (items 1 and 3)
- [PAYMENT_OPTIONS.md][payment_options]

[payment_options]: ../../plans/PAYMENT_OPTIONS.md
[p4--payment-aggregator-research-and-selection]: ../../plans/ROADMAP.md#p4--payment-aggregator-research-and-selection
[p4.4]: ../../plans/ROADMAP.md#p44-money-model-options
[p4.5]: ../../plans/ROADMAP.md#p45-recommendation-and-fallback-ladder
[p4.7]: ../../plans/ROADMAP.md#p47-decision-and-adr-003
[p5.1]: ../../plans/ROADMAP.md#p51-payment-gateway-port-and-adapter
[p5.6]: ../../plans/ROADMAP.md#p56-ledger-and-escrow
[p5.12]: ../../plans/ROADMAP.md#p512-switching-providers-after-the-promotion
[decisions-needed]: ../../plans/ROADMAP.md#decisions-needed
