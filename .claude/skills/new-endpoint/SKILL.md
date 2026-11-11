---
name: new-endpoint
description: Step-by-step recipe for adding or changing an API endpoint in food-pickup (Express 5 + zod + Supabase) — schema, service, controller, route, DTOs on both sides, error codes, logging, docs and tests, in that order. Use it whenever you add a route, change a request or response shape, add a query parameter, add an error code, or wire a new client service call, even if the user just says "add an API for X" or "the app needs to fetch Y".
---

# New or changed endpoint

Follow the layers in order: each step leans on the previous one, and skipping one is how the client and server
drift apart. Run `/before-write` first if any new service or table is involved. Load
`Skill(agent-skills:api-and-interface-design)`, and `Skill(agent-skills:security-and-hardening)` when auth, orders,
money or user data are involved.

1. **Schema** — `server/src/schemas/<area>.schema.ts`: a zod schema for body/query/params with real bounds (lengths,
   counts, enums; zod strips unknown fields by default). Export `XInput` / `XQuery` with `z.infer`. Reuse
   helpers from `schemas/common.ts`.
2. **Service** — `server/src/services/<area>.service.ts`: the business rules. Takes the `AuthUser` and the parsed
   input. Scope every query by the user explicitly (`supabaseAdmin` bypasses RLS). Another user's resource is
   `notFound()`, never `forbidden()`, so ids do not leak. Never trust client prices or totals. A multi-step write that
   must be atomic goes into a SQL function (use `/db-migration`), called with `p_` params, and its P0001 errors are
   decoded with `raisedByDatabase`.
3. **Errors** — throw `AppError` factories from `utils/errors.ts`. A new code goes into the `ErrorCode` union there
   first. Never build a message from an email, phone or token.
4. **Controller** — `server/src/controllers/<area>.controller.ts`: thin; no try/catch (Express 5 forwards rejections to
   `errorHandler`). Serialize with `utils/serializers.ts`.
5. **Route** — `server/src/routes/<area>.routes.ts`: `requireAuth` / `requireStaff` → `validate(schema)` → controller.
   Mount new routers in `routes/index.ts`.
6. **DTOs** — add or change `XDto` in `server/src/types/api.ts` and the matching `X` in `client/src/types/api.ts` in
   the same change. Additive changes only for fields the deployed client reads: the old client must keep working.
7. **Client** — a function in `client/src/services/<area>.ts` calling `request<T>()`; GETs exposed through a
   `features/<area>/use*.ts` hook on `useResource`; after a mutation call `reload()`/`mutate()` on every affected
   resource. The server's `ApiError.message` is written for users, so show it as is; a failed load renders
   `ErrorState` (`unreachable` when `err.isUnreachable`); per-cart-line problems go through `describeProblem` in
   `features/cart/cartRules.ts`.
8. **Logging** — a business event (something placed, changed, cancelled) gets one `req.log.info({ ids… }, 'Thing
   happened')` in the controller. Failures are already logged by `errorHandler`; do not log and rethrow. See
   `docs/LOGGING.md`.
9. **Docs** — `docs/API.md` (method, path, auth, role, body, response, status and error codes, limits) and
   `docs/PERMISSIONS.md` when a role or ownership rule is involved.
10. **Tests** — a Supertest suite in `server/test/api/` covering the matrix in `docs/TESTING.md` (auth, role,
    validation bounds, 404s, business rules, concurrency where it applies, error envelope). Staging-safe →
    `*.safe.test.ts`.
11. **Gate** — `pnpm run typecheck && pnpm run lint && pnpm test` in both packages, then curl the endpoint on local with
    a real token (CLAUDE.md "CRUD / lifecycle verification").

This is a major change: finish with `/post-change`.
