# ADR-004: Money in paise in the database, rupees at the API

## Status

Accepted with amendments (2026-10-24), by the user: every money column in the database is paise, and rupees exist
only at the API boundary, instead of rupees and paise side by side in the database.

## Date

2026-09-28 (proposed), 2026-10-24 (accepted)

## Context

Menu and order amounts are whole rupees (`integer`) today, and the deployed client reads them in that unit. A price
such as ₹49.50 cannot be stored at all. The payments and ledger domain needs fractional amounts: commissions and fees
are not whole rupees, and gateways work in their own minor units.

## Options considered

1. **Rupees for orders and menus, paise for payments and the ledger, with one conversion module.** Rejected by the
   user: two units in one database, where every sum or comparison across the line is a possible bug.
2. **Paise everywhere, the API included.** Rejected: a breaking API change for the deployed client.
3. **Paise in the database, rupees at the API.** One unit in storage; the API's existing rupee fields stay as they
   are.

## Decision

Every money column is paise in `bigint`, and its name says so (`price_paise`, `total_paise`). The API's existing
menu and order fields (`price`, `total`, `unitPrice`, `lineTotal`) keep whole rupees, converted by the serializers.
Only one module, `server/src/utils/money.ts`, converts between units. New API fields carry paise and say so in their
name (`amountPaise`). Each gateway adapter converts paise to its provider's own unit.

- While a rupee API field exists for a column, the database refuses a value that is not a whole rupee for it (a
  `check (… % 100 = 0)`), so the rupee field can never round. A fractional price first needs a paise field that the
  client reads; only then does the check go.
- The existing rupee columns (`menu_items.price`, `orders.total`, `order_items.unit_price`, `order_items.line_total`)
  move by expand → migrate → contract: add the `_paise` columns, backfill ×100, move the SQL functions, readers and
  writers over, and drop the rupee columns in a later release. The phase plan that does it says when.

## Consequences

- One unit in storage: SQL sums, the ledger and payments never mix units.
- The API contract for menus and orders does not change (CLAUDE.md §2).
- Every conversion goes through `money.ts`; a conversion anywhere else is a bug.
- `place_order` and every function that sums money are rewritten once, in the migration that moves the columns.

## Links

- [Data model (target)][data-model-target]
- [P5.1 Payment gateway port and adapter][p5.1]
- [P5.6 Ledger and escrow][p5.6]

[data-model-target]: ../../plans/ROADMAP.md#data-model-target
[p5.1]: ../../plans/ROADMAP.md#p51-payment-gateway-port-and-adapter
[p5.6]: ../../plans/ROADMAP.md#p56-ledger-and-escrow
