-- P2.2 (PR 09): a store's team grows by invite. An invite names an email and a role; the inviter shares a link that
-- carries a token, shown once (nothing sends mail before P6.3). Only the token's sha-256 is stored. Accepting needs a
-- signed-in account with that email, and goes through accept_store_invite, which settles it in one transaction.
create table public.store_invites (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  role public.store_role not null,
  -- The account that may accept it, lower-cased by the API (auth.users keeps emails lower-cased too).
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
-- One open invite per email per store: inviting twice is 409 MEMBERSHIP_EXISTS. An expired one still counts as open
-- here, so the API revokes a store's expired invites for that email before it inserts.
create unique index store_invites_open_email_key
  on public.store_invites (store_id, email)
  where accepted_at is null and revoked_at is null;
create index store_invites_store_id_idx on public.store_invites (store_id);
create index store_invites_created_by_idx on public.store_invites (created_by);
create index store_invites_accepted_by_idx on public.store_invites (accepted_by);

-- Only the API (secret key) reads or writes invites (docs/PERMISSIONS.md "Database").
alter table public.store_invites enable row level security;
revoke all on public.store_invites from anon, authenticated;

-- Never token_hash: the audit trail is readable by the store's managers (GET /api/stores/:storeId/audit).
create trigger store_invites_audit
  after insert or update or delete on public.store_invites
  for each row execute function public.audit_row_change(
    'invite.changed', 'role', 'email', 'accepted_at', 'revoked_at'
  );

-- Every refusal is the same NOT_FOUND: unknown token, another account's invite, expired, revoked, used by someone
-- else, or an existing member of another role (the invite stays open for the owner to sort out). One answer, so a
-- token cannot be probed. A repeat by the account that accepted it returns the membership and changes nothing.
create function public.accept_store_invite(
  p_token_hash text,
  p_user_id uuid,
  p_email text,
  p_actor jsonb default null,
  p_request_id text default null,
  p_now timestamptz default now()
)
returns public.store_memberships
language plpgsql
set search_path = ''
as $$
declare
  v_invite public.store_invites;
  v_member public.store_memberships;
begin
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);

  select * into v_invite from public.store_invites where token_hash = p_token_hash for update;
  if not found or v_invite.email <> lower(p_email) then
    raise exception using message = 'NOT_FOUND';
  end if;

  if v_invite.accepted_at is not null then
    if v_invite.accepted_by = p_user_id then
      select * into v_member
        from public.store_memberships
       where user_id = p_user_id and store_id = v_invite.store_id;
      if found then
        return v_member;
      end if;
    end if;
    raise exception using message = 'NOT_FOUND';
  end if;

  if v_invite.revoked_at is not null or v_invite.expires_at <= p_now then
    raise exception using message = 'NOT_FOUND';
  end if;

  insert into public.store_memberships (user_id, store_id, role, created_by)
  values (p_user_id, v_invite.store_id, v_invite.role, v_invite.created_by)
  on conflict (user_id, store_id) do nothing
  returning * into v_member;
  if v_member.id is null then
    -- Already a member: the same role consumes the invite; another role would change it, which an invite never does.
    select * into v_member
      from public.store_memberships
     where user_id = p_user_id and store_id = v_invite.store_id;
    if v_member.role <> v_invite.role then
      raise exception using message = 'NOT_FOUND';
    end if;
  end if;

  update public.store_invites
     set accepted_at = p_now, accepted_by = p_user_id
   where id = v_invite.id;

  -- Ids and the role only: an event never carries personal data.
  perform public.emit_event(
    'store.member_joined', 'store_invite', v_invite.id, v_invite.store_id,
    jsonb_build_object('membershipId', v_member.id, 'role', v_invite.role),
    p_actor, p_request_id
  );
  return v_member;
end;
$$;

revoke execute on function public.accept_store_invite(text, uuid, text, jsonb, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.accept_store_invite(text, uuid, text, jsonb, text, timestamptz)
  to service_role;
