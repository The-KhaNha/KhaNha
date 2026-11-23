-- Restaurant onboarding (plans/P7_4A_ONBOARDING.md PR 01): a platform admin creates a brand and invites its owner by
-- email. Like store_invites, the link is shared by the admin (nothing sends mail before P6.3) and only the token's
-- hash is stored. accept_brand_invite (PR 02) turns an invite into brands.owner_id.

create table public.brand_invites (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  -- Lower-cased like auth.users keeps it, so the invite matches the account whatever case was typed.
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
-- One open invite per brand (D3): a new one closes the old first. An expired one still counts until it is closed.
create unique index brand_invites_open_key on public.brand_invites (brand_id)
  where accepted_at is null and revoked_at is null;
-- The open-invite index covers open rows only: this one serves the foreign key and the cascade for all of them.
create index brand_invites_brand_id_idx on public.brand_invites (brand_id);
create index brand_invites_created_by_idx on public.brand_invites (created_by);
create index brand_invites_accepted_by_idx on public.brand_invites (accepted_by);

-- Closed to the browser's key like every table (docs/PERMISSIONS.md "Database"): RLS on, no policies.
alter table public.brand_invites enable row level security;
revoke all on public.brand_invites from anon, authenticated;

-- Who invited which email to which brand, and who closed it. Never token_hash. brand_id is watched so an invite's
-- rows still name its brand after the brand (and so the invite, by cascade) is deleted.
create trigger brand_invites_audit
  after insert or update or delete on public.brand_invites
  for each row execute function public.audit_row_change(
    'brand_invite.changed', 'brand_id', 'email', 'accepted_at', 'revoked_at'
  );

-- A brand and its empty template in one transaction (D7, D8): the owner can build the menu before the first branch.
-- brands_audit fires on update only, so the creation is recorded by the event. A taken slug (the brand's, or the
-- template store's) fails the whole call with 23505.
create function public.create_brand(
  p_name text,
  p_slug text,
  p_actor jsonb default null,
  p_request_id text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_brand uuid;
begin
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);

  insert into public.brands (name, slug, status) values (p_name, p_slug, 'ACTIVE') returning id into v_brand;
  perform public.ensure_brand_template(v_brand, p_actor, p_request_id);
  perform public.emit_event('brand.created', 'brand', v_brand, null, jsonb_build_object('slug', p_slug), p_actor,
    p_request_id);
  return v_brand;
end;
$$;

revoke execute on function public.create_brand(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_brand(text, text, jsonb, text) to service_role;

-- An owner invite for an ownerless brand, in one transaction (D3, D4): the brand row is locked, so an accept or a
-- second admin cannot slip between the checks, the close of the open invite and the insert. Refusals raise P0001
-- NOT_FOUND (no such brand) or BRAND_HAS_OWNER. The token's hash comes from the API; the token never reaches SQL.
create function public.create_brand_invite(
  p_brand_id uuid,
  p_email text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_actor jsonb default null,
  p_request_id text default null,
  p_now timestamptz default now()
)
returns public.brand_invites
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid;
  v_invite public.brand_invites;
begin
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);

  select owner_id into v_owner from public.brands where id = p_brand_id for update;
  if not found then
    raise exception using message = 'NOT_FOUND';
  end if;
  if v_owner is not null then
    raise exception using message = 'BRAND_HAS_OWNER';
  end if;

  update public.brand_invites set revoked_at = p_now
   where brand_id = p_brand_id and accepted_at is null and revoked_at is null;
  insert into public.brand_invites (brand_id, email, token_hash, expires_at, created_by, created_at)
  values (p_brand_id, p_email, p_token_hash, p_expires_at, (p_actor->>'id')::uuid, p_now)
  returning * into v_invite;

  -- Ids only: an event never carries the email or the token's hash.
  perform public.emit_event(
    'brand.owner_invited', 'brand_invite', v_invite.id, null,
    jsonb_build_object('brandId', p_brand_id), p_actor, p_request_id
  );
  return v_invite;
end;
$$;

revoke execute on function public.create_brand_invite(uuid, text, text, timestamptz, jsonb, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_brand_invite(uuid, text, text, timestamptz, jsonb, text, timestamptz)
  to service_role;
