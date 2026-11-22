-- Restaurant onboarding (plans/P7_4A_ONBOARDING.md PR 02): accepting an owner invite (brand_invites) in one
-- transaction makes the account the brand's owner.

-- Every refusal is the same NOT_FOUND, as in accept_store_invite, so a token cannot be probed: unknown token, another
-- account's invite, expired, revoked, used by someone else, a brand that has an owner by now (an invite never replaces
-- one, D4), or a platform ADMIN (D6: an admin never becomes an owner through an invite, so "ADMIN has no staff powers"
-- holds). A repeat by the account that accepted it returns the brand and changes nothing.
create function public.accept_brand_invite(
  p_token_hash text,
  p_user_id uuid,
  p_email text,
  p_actor jsonb default null,
  p_request_id text default null,
  p_now timestamptz default now()
)
returns public.brands
language plpgsql
set search_path = ''
as $$
declare
  v_brand_id uuid;
  v_invite public.brand_invites;
  v_brand public.brands;
begin
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);

  -- Locks in create_brand_invite's order, the brand row first and then the invite, or an admin re-issuing the link
  -- while the owner accepts it could deadlock.
  select brand_id into v_brand_id from public.brand_invites where token_hash = p_token_hash;
  if not found then
    raise exception using message = 'NOT_FOUND';
  end if;
  select * into v_brand from public.brands where id = v_brand_id for update;
  select * into v_invite from public.brand_invites where token_hash = p_token_hash for update;
  -- `is distinct from`: a null email (an account with none) must refuse, not slip past the comparison.
  if not found or v_invite.email is distinct from lower(p_email) then
    raise exception using message = 'NOT_FOUND';
  end if;

  if v_invite.accepted_at is not null then
    if v_invite.accepted_by = p_user_id and v_brand.owner_id = p_user_id then
      return v_brand;
    end if;
    raise exception using message = 'NOT_FOUND';
  end if;

  if v_invite.revoked_at is not null or v_invite.expires_at <= p_now or v_brand.owner_id is not null
     or exists (select 1 from public.profiles where id = p_user_id and role = 'ADMIN') then
    raise exception using message = 'NOT_FOUND';
  end if;

  -- brands_audit records the owner change, with the actor from app.actor.
  update public.brands set owner_id = p_user_id where id = v_brand.id returning * into v_brand;
  update public.brand_invites set accepted_at = p_now, accepted_by = p_user_id where id = v_invite.id;

  -- Ids only: an event never carries personal data.
  perform public.emit_event(
    'brand.owner_joined', 'brand_invite', v_invite.id, null,
    jsonb_build_object('brandId', v_brand.id), p_actor, p_request_id
  );
  return v_brand;
end;
$$;

revoke execute on function public.accept_brand_invite(text, uuid, text, jsonb, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.accept_brand_invite(text, uuid, text, jsonb, text, timestamptz)
  to service_role;
