# ADR-001: Brands are templates for their stores

## Status

Accepted with amendments (2026-10-24), by the user: a brand is a template its stores copy, not a live catalog they
override; staff memberships are per store only; the brand owner is the one role that sees across stores.

## Date

2026-09-28 (proposed), 2026-10-24 (accepted)

## Context

Today the app serves one café: one `stores` row, one menu, and store roles held in `profiles.role` (`STAFF`). The
roadmap needs many restaurants, some of them chains with several branches, each with its own staff, hours, stock and
settings, served by one app.

## Options considered

1. **Brands own stores through a live catalog.** A brand catalog feeds per-store listings, and each branch overrides
   only price, stock and availability; memberships can cover a whole brand. Rejected by the user: each outlet must be
   free to change anything, and staff of one outlet must not reach another.
2. **Per-store menus only, no brand.** Rejected: a new branch starts from nothing, and analytics have no key to
   compare branches.
3. **Brands as templates.** A store is created as a copy of its brand's template and then changes freely; the owner
   can push a later template change to chosen stores.

## Decision

A brand is the business. It holds a **template**: everything a store is configured with when it is created (the menu
with its categories, items, prices and photos, and the store settings). Each store is created as a copy of its
brand's template and from then on is its own entity: it can change anything.

- **Copy at creation, push on demand.** A template edit reaches only stores created after it, unless the owner pushes
  it to chosen stores. A push overwrites the pushed fields in those stores' copies and is audited.
- **Lineage for analytics.** Each copied menu item keeps `template_item_id`, the template item it came from, so
  analytics can compare the same dish across stores after a rename or a price change.
- **The brand owner** is recorded on the brand. The owner sees analytics across all the brand's stores, edits the
  template, pushes changes, and is treated as `OWNER` of every store of the brand (no membership rows needed).
  Analytics are the only view across a brand's stores.
- **Store roles are memberships per store only.** A manager or staff member of one outlet cannot see or act on
  another; there is no brand-wide staff role.
- A single café is a brand with one store, so today's data migrates as exactly that: its menu becomes both the
  template and the store's copy.
- `profiles.role` keeps only platform-level meaning: `CUSTOMER` or `ADMIN`. `STAFF` survives for the transition.
- Every store-scoped route names its store (`/api/stores/:storeId/...`), and every query inside goes through a scoping
  helper that adds `store_id`.

## Consequences

- Each outlet runs independently day to day, with no override layer to reason about.
- Template and stores drift apart by design; bringing them back together is an explicit, audited push.
- Cross-branch analytics roll up by brand and by template item.
- New tables (`brands` with its owner, the brand template, store memberships), `menu_items.template_item_id`, and an
  expand/backfill/contract migration of `stores`.
- The legacy endpoints (`GET /api/store`, `GET /api/menu`, `POST /api/orders`, `PATCH /api/orders/:id/status`) serve
  a configured default store until the contract step, so the deployed client keeps working.
- A missed store filter becomes a cross-tenant leak risk, mitigated by the scoping helper, a lint rule and a tenant
  isolation test matrix on every store endpoint; the brand analytics endpoints are scoped by the brand owner.
- The roadmap's P2 and P3.1 sections still describe the live catalog with per-store overrides and brand-scoped
  memberships; they are rewritten to this model before P2 is planned.

## Links

- [P2 — Multi-store and multi-branch][p2--multi-store-and-multi-branch], [Design (HLD)][design-hld]
- [P2.1 Brands and stores v2][p2.1]
- [P2.2 Memberships and store roles][p2.2]
- [P2.7 Compatibility and contract][p2.7]
- [P3.1 Catalog for multi-branch brands][p3.1]
- [Roles and permissions (target)][roles-and-permissions-target]

[p2--multi-store-and-multi-branch]: ../../plans/ROADMAP.md#p2--multi-store-and-multi-branch
[design-hld]: ../../plans/ROADMAP.md#design-hld
[p2.1]: ../../plans/ROADMAP.md#p21-brands-and-stores-v2
[p2.2]: ../../plans/ROADMAP.md#p22-memberships-and-store-roles
[p2.7]: ../../plans/ROADMAP.md#p27-compatibility-and-contract
[p3.1]: ../../plans/ROADMAP.md#p31-catalog-for-multi-branch-brands
[roles-and-permissions-target]: ../../plans/ROADMAP.md#roles-and-permissions-target
