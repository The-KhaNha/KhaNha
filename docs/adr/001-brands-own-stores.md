# ADR-001: Brands own stores

## Status

Proposed

## Date

2026-09-28

## Context

Today the app serves one café: one `stores` row, one menu, and store roles held in `profiles.role` (`STAFF`). The
roadmap needs many restaurants, some of them chains with several branches, each with its own staff, hours, stock and
settings, served by one app.

## Options considered

1. **Brands own stores.** A brand is the business (and, by default, the payee). A store is one physical pickup point,
   a branch, with its own address, hours, pause switch, stock, staff and settings. A brand catalog feeds per-store
   listings.
2. **Per-store menus only.** Each store keeps its own independent menu. Rejected: every chain edit becomes N edits,
   and cross-branch analytics has no key.

## Decision

Brands own stores (branches). A brand catalog feeds per-store listings (price override, stock, availability). Store
roles are memberships, scoped to a store or to a whole brand.

- A single café is a brand with one store, so today's data migrates as exactly that.
- `profiles.role` keeps only platform-level meaning: `CUSTOMER` or `ADMIN`. `STAFF` survives for the transition.
- Every store-scoped route names its store (`/api/stores/:storeId/...`), and every query inside goes through a scoping
  helper that adds `store_id`.

## Consequences

- A chain edits its catalog once; each branch only overrides price, stock and availability.
- Analytics can roll up across branches by brand and catalog item.
- New tables (`brands`, memberships, the brand catalog) and an expand/backfill/contract migration of `stores`.
- The legacy endpoints (`GET /api/store`, `GET /api/menu`, `POST /api/orders`, `PATCH /api/orders/:id/status`) serve
  a configured default store until the contract step, so the deployed client keeps working.
- A missed store filter becomes a cross-tenant leak risk, mitigated by the scoping helper, a lint rule and a tenant
  isolation test matrix on every store endpoint.

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
