# ADR-004: Rupees for orders and menus, paise for payments and the ledger

## Status

Proposed

## Date

2026-09-28

## Context

Menu and order amounts are whole rupees (`integer`) today, and the deployed client reads them in that unit. The
payments and ledger domain needs fractional amounts: commissions and fees are not whole rupees, and gateways work in
their own minor units.

## Options considered

1. **Keep order and menu money in whole rupees; use paise in `bigint` for payments and the ledger, with one
   conversion module.**
2. **Move everything to paise now.** Rejected: a breaking API change for no user benefit yet.

## Decision

Order and menu money stays in whole rupees. Payments and the ledger use paise in `bigint`. Only one module,
`server/src/utils/money.ts`, converts between the two. Each gateway adapter converts paise to its provider's own
unit.

## Consequences

- The API contract for menus and orders does not change (CLAUDE.md §2).
- Two units live side by side, so every conversion must go through `money.ts`; conversions elsewhere are bugs.
- Payment and ledger columns, DTO fields and gateway inputs carry paise (for example `amountPaise`).

## Links

- [Data model (target)][data-model-target]
- [P5.1 Payment gateway port and adapter][p5.1]
- [P5.6 Ledger and escrow][p5.6]

[data-model-target]: ../../plans/ROADMAP.md#data-model-target
[p5.1]: ../../plans/ROADMAP.md#p51-payment-gateway-port-and-adapter
[p5.6]: ../../plans/ROADMAP.md#p56-ledger-and-escrow
