-- P2.2 (PR 09b): accepting a store invite (store_invites, the previous migration) in one transaction.

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
  -- `is distinct from`: a null email (an account with none) must refuse, not slip past the comparison.
  if not found or v_invite.email is distinct from lower(p_email) then
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
    -- Not found: the membership was removed between the conflict and this read; the invite stays open for a retry.
    if not found or v_member.role <> v_invite.role then
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
