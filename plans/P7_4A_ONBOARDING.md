# P7.4a — Onboard a restaurant from the admin page: implementation plan

The smallest slice of [ROADMAP.md P7.4](ROADMAP.md#p74-platform-admin-dashboard) "Onboarding" that delivers one
flow: **a platform ADMIN creates a brand and invites its owner; the invited person signs in with that email, accepts,
becomes `brands.owner_id`, and lands in `/manage`, where they open stores and invite managers and staff** (both of
which already exist), behind admin MFA. Four pull requests into the phase branch `feat/P7-4a`, then one into `dev`.

> **Status: decided (the user, 22 November 2026).** D2 as recommended; D6 refuses an ADMIN; D9 a phase branch; admin
> MFA (PR 04) lands before the production release that carries the admin screen. The rest as recommended. Every
> "exists" row below was read from the code on `dev` at `4dbc843`.

## What exists and what changes

| Area                       | Today (verified in the code)                                                                                                         | This plan                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Brand rows                 | Made only by the seed (`server/scripts/seed.ts` `upsertBrand`); P2 decision D6; `brand.routes.ts` says "until P7.4"                  | `POST /api/admin/brands` through a new `create_brand` SQL function                                           |
| `brands.owner_id`          | **Already nullable** (`on delete set null`); the production seed leaves it null (`ownerIds` is empty there)                          | No column change. An ownerless brand is a normal state, listed with "Invite owner"                           |
| `brands.status`            | `store_status`, default `DRAFT`; the seed writes `ACTIVE`; **no application code reads it**                                          | New brands are written `ACTIVE`, like seeded ones (D7)                                                       |
| What customers see         | Only stores, and only `ACTIVE` ones; a brand has no public page                                                                      | Nothing: a brand with no active store is invisible to customers by construction                              |
| Brand template             | `ensure_brand_template` makes an **empty template for a brand with no store** (`20261112144103_brand_template.sql`)                  | `create_brand` calls it, so every brand has its template from the first moment (D8)                          |
| First store                | `POST /api/brands/:brandId/stores` → `create_store_from_template`; owner only, anyone else 404                                       | Unchanged; works for a zero-store brand                                                                      |
| `/manage` with zero stores | `Manage.tsx` renders each owned brand's heading, its template row (when it has one) and "Open a branch"; route is `RequireAuth` only | Works as is. Adds one hint line and a test (PR 02)                                                           |
| Team invites               | `store_invites`, `accept_store_invite`, `team.service.ts`, `POST /api/me/invites/accept`, `/join#<token>`, `inviteAcceptLimiter`     | Unchanged. Their helpers and limiter are reused (D1)                                                         |
| Owner invites              | None. The owner is set by the seed or in SQL                                                                                         | New `brand_invites` table, `accept_brand_invite`, `POST /api/me/brand-invites/accept`, `/join/owner#<token>` |
| Admin API                  | `admin.routes.ts`: settings, audit, flags, all behind `requireAuth, requireAdmin`                                                    | Adds brands list/create and owner-invite create/revoke to the same router                                    |
| Admin page                 | `Admin.tsx`: site settings only                                                                                                      | Adds a "Restaurants" section above the settings (D10)                                                        |
| Session                    | `req.user.ownedBrandIds` is read from `brands` on every request (`middleware/auth.ts`)                                               | Unchanged: ownership takes effect on the next request with no token refresh                                  |

## What this plan does not build

| Roadmap P7.4 item                                                | Why not now                                                           | Picked up by                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------ |
| The wizard's stores step (admin enters address, hours, settings) | The owner already does this in `/manage` (P3.1, D6)                   | Not planned: the owner owns it |
| Payout account, KYC, penny drop                                  | Money path; needs P5's provider work                                  | P5 / P7.4 proper               |
| Menu import (CSV)                                                | Not needed to open a store                                            | P7.4 proper                    |
| Go-live checklist and "activate" by the admin                    | `store_readiness` and owner publish already gate a store going public | P7.4 "Stores" section          |
| Suspend or archive a brand or store, "view as"                   | Separate theme                                                        | P7.4 "Stores" section          |
| Transferring ownership, removing an owner                        | Rare; a wrong owner is fixed in SQL meanwhile (D4)                    | P7.4 "Users" section           |
| Emailing the invite                                              | Nothing sends mail before P6.3 (P2 decision D3)                       | P6.3                           |
| Pagination and search of the brand list                          | A capped list is enough for a pilot                                   | P7.4 console                   |

## Decisions

| #   | Decision                                                                     | Recommended                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Alternative                                                                                                                                                                                              | PR     |
| --- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| D1  | Extend `store_invites` or add `brand_invites`?                               | **New `brand_invites` table.** `store_invites.store_id` is `not null`, its role is the two-value `store_role` enum, its open-invite index is `(store_id, email)`, its audit rows reach a store's trail through `store_id`, and `accept_store_invite` returns a `store_memberships` row that the deployed client reads as `membership.store`. Making all of that polymorphic means a nullable `store_id`, an `OWNER` value in an enum `store_memberships.role` shares, and a `create or replace` of a live security function. Reused instead: `hashToken`, `audited`, the email rule of `createInviteSchema`, `acceptInviteSchema`, `INVITE_EXPIRY_DAYS`, `inviteAcceptLimiter`, `Join.tsx`, and the invite-link panel | Extend `store_invites` with `brand_id` and a kind column                                                                                                                                                 | 01     |
| D2  | One accept endpoint or two?                                                  | **A second endpoint, `POST /api/me/brand-invites/accept`, and a second link path, `/join/owner#<token>`.** `POST /api/me/invites/accept` keeps its exact response, so the deployed client cannot meet a shape it does not know. Both routes share the one `inviteAcceptLimiter` instance, so guesses are counted together                                                                                                                                                                                                                                                                                                                                                                                             | One endpoint that tries the store invite and then the brand invite, answering `{ membership }` or `{ brand }`: one link shape, but `membership` becomes optional in a response the deployed client reads | 02     |
| D3  | How many open owner invites per brand?                                       | **One.** Creating a new one revokes the open one. The token is shown once, so "the admin lost the link" must have an answer, and this is it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Refuse with 409 until the admin revokes by hand                                                                                                                                                          | 01     |
| D4  | May an invite replace an existing owner?                                     | **No.** An invite can be created, and accepted, only while `owner_id is null`; otherwise 409 `BRAND_HAS_OWNER` (create) or the uniform 404 (accept). So no invite can take a brand away from its owner. Transfer is deferred; the fallback is `update public.brands set owner_id = null where id = '…';` in SQL, then a new invite                                                                                                                                                                                                                                                                                                                                                                                    | Build transfer now                                                                                                                                                                                       | 01, 02 |
| D5  | The invitee already owns another brand                                       | **Allowed.** `ownedBrandIds` is a list and `listMyBrands`/`Manage.tsx` already render several brands                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Refuse                                                                                                                                                                                                   | 02     |
| D6  | An ADMIN account accepts an owner invite (including one it issued to itself) | **Refused** (the user): `accept_brand_invite` answers an `ADMIN` profile with the same uniform 404, so "ADMIN has no staff powers" stays literal and an admin cannot quietly gain a seeded store's customer orders. A speed bump only (a second address defeats it); the audit rows and MFA (PR 04) are the real controls                                                                                                                                                                                                                                                                                                                                                                                             | Allow, audited                                                                                                                                                                                           | 02     |
| D7  | A new brand's `status`                                                       | **`ACTIVE`**, as the seed writes. Nothing reads the column; leaving the `DRAFT` default would make new brands differ from seeded ones for no effect today and a surprise later                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Leave `DRAFT` until P7.4's activate step                                                                                                                                                                 | 01     |
| D8  | When is the brand's template made?                                           | **In `create_brand`.** Every existing brand has one (the P3 backfill), and the owner then sees "Brand template" in `/manage` at once and can build the menu before the first branch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Leave it to the first `create_store_from_template`                                                                                                                                                       | 01     |
| D9  | Branch model                                                                 | **A phase branch, `feat/P7-4a`** (the user), cut from `dev`. PRs 01 to 04 target it and the agent merges each once clear; the phase branch's PR into `dev` is the user's (workflow.md §21 "Who merges"). This plan file ships in PR 01 as `plans/P7_4A_ONBOARDING.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Straight into `dev`                                                                                                                                                                                      | all    |
| D10 | Where on `/admin`                                                            | **One "Restaurants" section above "Site settings"** on the existing page. Tabs arrive with the P7.4 console                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `/admin/restaurants` as its own lazy route now                                                                                                                                                           | 03     |
| D11 | Invite lifetime                                                              | **Reuse `INVITE_EXPIRY_DAYS` (7).** One platform constant for both invite kinds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | A separate constant                                                                                                                                                                                      | 01     |
| D12 | Create brand and invite in one call?                                         | **Two calls** (create, then invite), made in sequence by the form. A brand with no owner and no invite is already a normal, listed, recoverable state (after a revoke or an expiry), so an atomic pair buys nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | One `create_brand_with_invite` function                                                                                                                                                                  | 01, 03 |

## Who implements

PRs 01, 02 and 04 decide who owns a brand and who is an admin: **auth and permissions, so the main agent implements
them itself** (CLAUDE.md §17). PR 03 is a client screen over finished endpoints with its files, tests and verify step named here: a `sonnet`
implementer may take it. Each PR: the §13 gate in every package touched, `/post-change`, and
`pnpm run change` (01: `--server minor`; 02: `--server minor --client minor`; 03: `--client minor`; 04:
`--server minor --client minor`).

## The pull requests

### PR 01 — Server: brands and owner invites for the admin

- [ ] Merged

As built: the close-then-insert of an owner invite is one SQL function, `create_brand_invite` (it locks the brand
row and refuses an owned brand), not two Data API calls with a retry, after review; `brand_invites` also has a plain
`(brand_id)` index for its foreign key (schema-guard). `database-lockdown.test.ts` checks every object from the catalog,
so it needs no names. The log check is its own file, `admin-brands-logs.test.ts`.

**Theme:** an admin creates a brand, lists brands, and issues or revokes an owner invite. Nothing can accept one yet.
Estimated 650 lines counted (tests included).

**Migration** `server/supabase/migrations/<ts>_brand_invites.sql` (use the `db-migration` skill; run `schema-guard`
first and record its verdict):

```sql
create table public.brand_invites (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) between 3 and 320),
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (accepted_at is null or revoked_at is null)
);
-- One open invite per brand (D3). An expired one still counts, so the API closes open ones before it inserts.
create unique index brand_invites_open_key on public.brand_invites (brand_id)
  where accepted_at is null and revoked_at is null;
create index brand_invites_created_by_idx on public.brand_invites (created_by);
create index brand_invites_accepted_by_idx on public.brand_invites (accepted_by);

alter table public.brand_invites enable row level security;
revoke all on public.brand_invites from anon, authenticated;

-- Never token_hash.
create trigger brand_invites_audit
  after insert or update or delete on public.brand_invites
  for each row execute function public.audit_row_change(
    'brand_invite.changed', 'email', 'accepted_at', 'revoked_at'
  );

-- A brand and its empty template, in one transaction (D7, D8). A taken slug fails the call (23505).
create function public.create_brand(
  p_name text, p_slug text, p_actor jsonb default null, p_request_id text default null
) returns uuid language plpgsql set search_path = '' as $$
declare v_brand uuid;
begin
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);
  insert into public.brands (name, slug, status) values (p_name, p_slug, 'ACTIVE') returning id into v_brand;
  perform public.ensure_brand_template(v_brand, p_actor, p_request_id);
  perform public.emit_event('brand.created', 'brand', v_brand, null, '{}'::jsonb, p_actor, p_request_id);
  return v_brand;
end; $$;
revoke execute on function public.create_brand(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_brand(text, text, jsonb, text) to service_role;
```

Checked: `audit_row_change` reads the store from `store_id` with a `coalesce`, so a row without that column audits
with a null store; `domain_events.store_id` is nullable; `brands_audit` fires on update only, which is why the
insert goes through a function that emits `brand.created`.

**Endpoints** (all on `adminRouter`, so `requireAuth, requireAdmin`; writes add `writeLimiter`; every response
`Cache-Control: no-store` because it carries owner and invitee emails):

| Method | Path                                           | Request                                                                                            | Response                                                                                         | Errors                                                                             |
| ------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| GET    | `/api/admin/brands`                            | none                                                                                               | 200 `{ brands: AdminBrandDto[] }`, by name, capped at `STORE_LIST_MAX` (warn when the cap bites) | 401, 403                                                                           |
| POST   | `/api/admin/brands`                            | `{ name, slug? }`: `createStoreSchema.pick({ name, slug })`, slug from `slugFromName` when omitted | 201 `{ brand: AdminBrandDto }`                                                                   | 400 `VALIDATION_ERROR` (with `field`), 409 `SLUG_TAKEN`                            |
| POST   | `/api/admin/brands/:brandId/invites`           | `{ email }`: `createInviteSchema.pick({ email })`                                                  | 201 `{ invite: BrandInviteDto, token }`; the token only here                                     | 404 `NOT_FOUND` (unknown brand or id not a uuid), 409 `BRAND_HAS_OWNER` (new code) |
| DELETE | `/api/admin/brands/:brandId/invites/:inviteId` | none                                                                                               | 204; a second revoke is 204                                                                      | 404 (unknown, another brand's, or accepted)                                        |

`AdminBrandDto = { id, name, slug, createdAt, branchCount, owner: { id, name, email } | null, invite: BrandInviteDto | null }`
(`branchCount` excludes the template; `invite` is the open one). `BrandInviteDto = { id, email, expiresAt, createdAt }`.

**Files**

- `server/src/schemas/admin.schema.ts`: `createBrandSchema`, `createBrandInviteSchema` (both picks, no new rules).
- `server/src/services/adminBrand.service.ts` (new): `listBrands`, `createBrand` (the RPC; 23505 → `slugTaken()`),
  `createOwnerInvite` (brand exists and `owner_id is null`, else `brandHasOwner()`; revoke the open invite; insert.
  A 23505 on `brand_invites_open_key` means two admins invited at once: repeat the revoke-and-insert once, then
  rethrow), `revokeOwnerInvite`. Run `reuse-scout` first.
- `server/src/services/team.service.ts`: export `hashToken` and `audited` (move both to `utils/invites.ts` only if the
  import would otherwise cross from one service into another against the layering rule; check `backend.md` §4).
- `server/src/controllers/admin.controller.ts`, `server/src/routes/admin.routes.ts`.
- `server/src/utils/errors.ts`: `BRAND_HAS_OWNER` in `ErrorCode`, `brandHasOwner()` (409, "That restaurant already
  has an owner.").
- `server/src/utils/serializers.ts`, `server/src/types/api.ts`, and the client copy in `client/src/types/api.ts`
  (types only, no screen yet): `AdminBrandDto`, `BrandInviteDto`, the error code.
- `server/src/types/database.ts` regenerated.
- `server/src/routes/brand.routes.ts`: drop "until P7.4" from the comment.

**Logging:** `Brand created` `{ brandId, by }`, `Owner invite created` `{ brandId, inviteId, by }`,
`Owner invite revoked` `{ brandId, inviteId, by }`. Never the email or the token.

**Tests** `server/test/api/admin-brands.test.ts` (same helpers as `team.test.ts`):

- 401 anonymous and 403 for CUSTOMER, STAFF, MANAGER and an OWNER on all four routes.
- Create: 201 with a template store and no branches; a `brand.created` event and a `store.created`
  (`isTemplate: true`) event; slug made from the name; 409 on a taken slug with nothing left behind; zod bounds
  (name 1 and 81 characters, bad slug, unknown key).
- Invite: 201 with a 43-character token; the row holds the sha-256, never the token; a second invite revokes the
  first (one open row); 409 `BRAND_HAS_OWNER` on a seeded, owned brand; 404 on an unknown brand; the email is stored
  lower-cased; an `audit_log` row with the admin as actor and no `token_hash` in `changes`.
- Revoke: 204, then 204 again; 404 for another brand's invite.
- List: owner shown for a seeded brand, `invite` for the new one, `Cache-Control: no-store`.
- Logs (extend `team-logs.test.ts`): no token and no email in any line these routes write.
- `rate-limit-routes.safe.test.ts` / `rate-limit-wiring.safe.test.ts`: the three writes are behind `writeLimiter`;
  `database-lockdown.test.ts`: `brand_invites` and `create_brand` are closed to `anon` and `authenticated` (add
  them where those tests list objects by name).

**Docs:** `docs/API.md` (the four routes, `BRAND_HAS_OWNER`, the DTOs, the rate-limit sentence),
`docs/SCHEMA.md` (`brand_invites`, `create_brand`, "created through the seed until P7.4" on `brands`),
`docs/PERMISSIONS.md` (route matrix rows; a new "Owner invites" section; the admin row of what an ADMIN may do),
`docs/JOBS.md` (`brand.created`), `docs/BACKEND_STRUCTURE.md` (the new service), `docs/CONFIGURATION.md`
(`INVITE_EXPIRY_DAYS` now covers both kinds), `plans/ROADMAP.md` P7.4 (link to this plan), `CLAUDE.md` §2 only if
the sentence about who creates brands needs it.

**Verify:** the §13 gate in `server/`; then with a real admin token against the local API: create a brand, list it,
invite, invite again (the first link's row is revoked), revoke, and read `domain_events` and `audit_log` for each
step (backend.md §14).

### PR 02 — An invited owner accepts and lands in `/manage` (server and client)

- [ ] Merged

As built: `accept_brand_invite` locks the brand row before the invite, in `create_brand_invite`'s order (review found
the reverse order could deadlock an accept against a re-issue). The admin's invite form refuses an admin's email up
front (400 on `email`), since D6 makes such an invite unacceptable; the SQL refusal stays as the backstop. `Join.tsx`
keeps its in-memory token with its kind. The signed-out join view is centred and padded (it ran edge to edge).

**Theme:** the accept path end to end. Estimated 600 lines counted.

**Migration** `server/supabase/migrations/<ts>_accept_brand_invite.sql`:

```sql
-- Every refusal is the same NOT_FOUND, as in accept_store_invite: unknown token, another account's invite, expired,
-- revoked, used by someone else, or a brand that has an owner by now (D4). A repeat by the account that accepted it
-- returns the brand and changes nothing.
create function public.accept_brand_invite(
  p_token_hash text, p_user_id uuid, p_email text,
  p_actor jsonb default null, p_request_id text default null, p_now timestamptz default now()
) returns public.brands language plpgsql set search_path = '' as $$
declare
  v_invite public.brand_invites;
  v_brand public.brands;
begin
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);

  select * into v_invite from public.brand_invites where token_hash = p_token_hash for update;
  if not found or v_invite.email is distinct from lower(p_email) then
    raise exception using message = 'NOT_FOUND';
  end if;
  select * into v_brand from public.brands where id = v_invite.brand_id for update;

  if v_invite.accepted_at is not null then
    if v_invite.accepted_by = p_user_id and v_brand.owner_id = p_user_id then
      return v_brand;
    end if;
    raise exception using message = 'NOT_FOUND';
  end if;
  if v_invite.revoked_at is not null or v_invite.expires_at <= p_now or v_brand.owner_id is not null then
    raise exception using message = 'NOT_FOUND';
  end if;
  -- D6: an ADMIN never becomes an owner through an invite.
  if exists (select 1 from public.profiles where id = p_user_id and role = 'ADMIN') then
    raise exception using message = 'NOT_FOUND';
  end if;

  update public.brands set owner_id = p_user_id where id = v_brand.id returning * into v_brand;
  update public.brand_invites set accepted_at = p_now, accepted_by = p_user_id where id = v_invite.id;
  perform public.emit_event(
    'brand.owner_joined', 'brand_invite', v_invite.id, null,
    jsonb_build_object('brandId', v_brand.id), p_actor, p_request_id
  );
  return v_brand;
end; $$;
-- revoke from public, anon, authenticated; grant to service_role (as accept_store_invite).
```

The `brands` update is audited by the existing `brands_audit` trigger (`brand.changed`, `owner_id`), with the actor
from `app.actor`.

**Endpoint**

| Method | Path                           | Request                                    | Response                            | Errors                                                                                          |
| ------ | ------------------------------ | ------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| POST   | `/api/me/brand-invites/accept` | `acceptInviteSchema` (reused): `{ token }` | 200 `{ brand: { id, name, slug } }` | 401; 404 `NOT_FOUND` "That invite is not valid any more." for every refusal; 429 `RATE_LIMITED` |

`requireAuth` → `inviteAcceptLimiter` (the same instance as the store route) → `validate` → controller → service.
`POST /api/me/invites/accept` is not touched.

**Server files:** `routes/me.routes.ts`, `controllers/team.controller.ts` (`acceptOwnerInvite`),
`services/adminBrand.service.ts` or `team.service.ts` (`acceptOwnerInvite`: read the profile's email, call the RPC,
map `NOT_FOUND`; put it beside `acceptInvite` and reuse `hashToken`), `types/database.ts` regenerated. Log
`Owner invite accepted` `{ brandId }`.

**Client files**

- `client/src/services/manage.ts`: `acceptOwnerInvite(token)`.
- `client/src/features/auth/authStore.ts`: `addOwnedBrand(brand)`, beside `addMembership` and for the same reason
  (the session's brands predate the accept).
- `client/src/pages/Join.tsx`: a `kind?: 'team' | 'owner'` prop. `owner` calls `acceptOwnerInvite`, then
  `addOwnedBrand`, then `navigate('/manage', { replace: true })`; the signed-out copy reads "Set up your restaurant"
  and the two buttons carry `next=%2Fjoin%2Fowner` (`useAuthRedirect` already admits any in-app path). The token
  handling (fragment read, `replaceState`, in-memory only) is shared and unchanged.
- `client/src/App.tsx`: `<Route path="/join/owner" element={<JoinPage kind="owner" />} />`;
  `client/src/appShell.ts`: its title.
- `client/src/pages/Manage.tsx`: when an owned brand has no branches, one line under its heading: "No branches yet.
  Set up the menu in the brand template, then open your first branch." Nothing else changes there.

**Tests**

- `server/test/api/brand-invite-accept.test.ts`: the accepter's next request has the brand in `GET /api/brands/mine`
  and may `POST /api/brands/:brandId/stores` (201) and then invite a manager at that store (201); the uniform 404
  matrix (unknown token, another account's email, expired via `p_now`, revoked, accepted by someone else, brand
  already owned); a repeat by the accepter is 200 with one `brand.owner_joined` event in total; two accounts cannot
  both win (`Promise.all`, exactly one 200); an account that already owns a brand ends with two (D5); an ADMIN accepting
  is the uniform 404 and the brand stays ownerless (D6); 401 anonymous; the limiter is shared (the two accept routes count against one limit);
  `audit_log` has `brand.changed` with the accepter as actor; no token or email in the logs.
- `client/src/pages/Join.test.tsx`: `kind="owner"` calls the owner endpoint, adds the brand and goes to `/manage`;
  signed out, both links carry `next=/join/owner`; a 404 shows the invalid-link message and drops the token.
- `client/src/pages/Manage.test.tsx`: an owner whose brand has a template and no branches sees the template row, the
  hint and "Open a branch", and is not redirected.
- `client/src/features/auth/authStore` test: `addOwnedBrand` adds once.

**Docs:** `docs/API.md` (the route, the SQL-error table row for `accept_brand_invite`, the rate-limit sentence),
`docs/SCHEMA.md` (`accept_brand_invite`), `docs/PERMISSIONS.md` ("Owner invites": accept rules, D4 to D6, the
`/join/owner#<token>` link, the unverified-email limitation applied to owners, the SQL fallback for a wrong owner;
route matrix row), `docs/JOBS.md` (`brand.owner_joined`), `docs/FRONTEND_STRUCTURE.md` (the route, the `Join` prop,
the store action), `docs/ARCHITECTURE.md` only if it has an invite flow diagram.

**Verify:** the §13 gate in `server/` and `client/` with the e2e smoke; then by hand at 390px throttled: create a
brand and an invite with curl (PR 01), open `/join/owner#<token>` signed out, register with the invited email, land
on `/manage`, open the first branch, invite a staff member from its Team tab. Confirm the token never appears in
the address bar after load, in the API log or in `audit_log`.

### PR 03 — Client: the Restaurants section on `/admin`

- [ ] Merged

**Theme:** the admin's screen. Estimated 650 lines counted. A `sonnet` implementer may take it.

**Files**

- `client/src/services/admin.ts`: `fetchAdminBrands`, `createBrand`, `createOwnerInvite`, `revokeOwnerInvite`.
- `client/src/features/admin/useAdminBrands.ts`: `useResource`, **not persisted** (it holds emails; frontend.md §2c).
- `client/src/components/InviteLink.tsx` (new, moved out of `ManageTeam.tsx`): the "shown only once" panel with
  Copy, Share and Done. `ManageTeam.tsx` uses it, with no change in behaviour; the admin section uses it with
  `/join/owner#<token>`. Run `reuse-scout` first; add it to `docs/COMPONENTS.md`.
- `client/src/features/admin/Restaurants.tsx` (new): a form (restaurant name, owner email; `Input`, `Button`,
  `validateEmail`) that creates the brand and then the invite and shows the link; if the invite call fails after the
  brand was made, the brand appears in the list with "Invite owner" and the error is shown, never a second brand.
  The list, one `Card` row per brand: name, branch count, then one of: the owner's name and email; "Invite open for
  `<email>`, expires `<TimeText>`" with **New link** and **Revoke** (`ConfirmSheet`); or "No owner" with **Invite
  owner** (an email field inline). `Skeleton` while loading, `EmptyState` for no brands, `ErrorState` with retry,
  field errors from `details.field`, `SLUG_TAKEN` and `BRAND_HAS_OWNER` shown as their messages. Every mutation
  reloads the list. Tap targets ≥ 44px, long emails wrap (`wrap-anywhere`), no horizontal scroll at 360px.
- `client/src/pages/Admin.tsx`: render the section above "Site settings" (D10).
- `client/e2e/onboarding.spec.ts` (new, following `manage.spec.ts`): the admin creates a restaurant and copies the
  link; a second browser context registers with that email through the link, lands on `/manage`, and opens a branch.

**Tests:** `features/admin/Restaurants.test.tsx` (create shows the link once and reloads; the half-failed create;
revoke confirms and reloads; new link replaces the old row; loading, empty and error states); `Admin.test.tsx`
(both sections render); `ManageTeam.test.tsx` stays green unchanged, which is the guard on the extraction;
`services` test for the four calls if `services/` has that pattern for admin.

**Docs:** `docs/COMPONENTS.md` (`InviteLink`), `docs/FRONTEND_STRUCTURE.md` (the feature files, the service calls,
the e2e spec), `docs/TESTING.md` (the new spec), `README.md` demo walk-through if it lists the admin page,
`plans/ROADMAP.md` (tick the onboarding slice, note what is left of P7.4).

**Verify:** the §13 gate in `client/` with the e2e smoke; the visual gate at 390px throttled and 1280px; `ui-verifier`
through `/post-change`; bundle budget (`client/perf-budget.json`) unchanged for the customer routes, since `/admin`
is its own lazy chunk (confirm that it is).

### PR 04 — Admin MFA: every admin route needs `aal2`

- [ ] Merged

**Theme:** a leaked admin password alone opens nothing (ROADMAP P7.4 "Hardening"). Main agent (auth).

- **Supabase:** TOTP MFA (`[auth.mfa.totp] enroll_enabled = true, verify_enabled = true` in
  `server/supabase/config.toml`; on by default on hosted projects, every plan). A user step: confirm it in the
  production and staging dashboards.
- **Server:** `requireAdmin` (middleware/auth.ts) refuses an ADMIN whose verified token's `aal` claim is not `aal2`
  with 403 `MFA_REQUIRED` (new code), logged at `warn` like other 403s. The claim comes from the token the JWKS check
  already verified; nothing else changes for customers and members.
- **Client:** `/admin` shows an MFA step before the page when the session is `aal1`: enrol (QR code from
  `supabase.auth.mfa.enroll`, the secret as text for copying, verify the first code) when the account has no
  factor; otherwise a 6-digit code (`challenge` + `verify`). On success the session is `aal2` and the page loads.
  A `MFA_REQUIRED` answer from any admin call returns to that step. supabase-js stays behind `getSupabase()`.
- **Tests:** server: an ADMIN with an `aal1` token is 403 `MFA_REQUIRED` on every admin route, `aal2` passes
  (tokens from local Supabase: enrol a TOTP factor and verify a code computed with `node:crypto` HMAC, RFC 6238, in
  a test helper); CUSTOMER and members unchanged. Client: the step's states (enrol, code, wrong code, network
  error with retry) and that `/admin` waits for `aal2`.
- **Docs:** `docs/PERMISSIONS.md` (admin MFA), `docs/API.md` (`MFA_REQUIRED`), `docs/DEPLOYMENT.md` (the dashboard
  step; recovery for a lost device: delete the factor in the dashboard, then enrol again), `docs/FRONTEND_STRUCTURE.md`.
- **Rollout:** the first admin request after the release asks the admin to enrol; nothing is locked out.

**Verify:** the gate in `server/` and `client/`; by hand: sign in as the seeded admin, enrol with an authenticator
app, sign out and in again, enter a code, reach `/admin`; a wrong code is refused.

## Risks and gotchas

- **The email is not verified at sign-up** (docs/PERMISSIONS.md "Known limitation"). Whoever holds the link and
  registers with that address becomes the owner, so the token is the secret, exactly as for managers, with a bigger
  prize. Mitigations in this plan: shown once, hashed at rest, 7 days, one open invite per brand, never replaces an
  owner, revocable, audited. The admin list shows who accepted. Undoing a wrong accept is SQL until transfer exists.
- **These endpoints raise the value of an admin account**: an admin can now create an owner. PR 04 requires MFA for
  every admin route, and the phase reaches `dev` (and so a release) only with PR 04 in it.
- **Production's seeded brands have no owner.** After PR 03 they show "Invite owner", which is the intended way to
  give the pilot café its owner instead of SQL; the owner must be a non-admin account (D6).
- **`create_brand` runs `ensure_brand_template`**, which names the template after the brand: the brand name must
  satisfy the store name check too. `createStoreSchema`'s `name` rule is reused for exactly that reason; a test
  creates a brand at both name bounds.
- **`slugTaken()`'s message says "another store"**. The code is right and stable; the copy is slightly off for a
  brand. Left as is unless the user wants a `message` argument.
- **Deployed-client compatibility:** every change is additive (new routes, new DTOs, one new error code that only new
  screens can receive). No `min_client_version` bump. An old client that opens `/join/owner` shows its not-found
  page with the token still in the address bar until the tab reloads into the new build; acceptable, as links are
  only issued from the new admin screen.
- **Two migrations, append-only once merged into `dev`.** Check for a second session's migrations with a later
  timestamp before each PR (`resolve-conflicts` covers the ordering check).

## Closing

After PR 04: run `/break` (auth and permissions changed), update `plans/ROADMAP.md` P7.4 with what remains, and walk
the whole flow on staging once `dev` deploys there.
