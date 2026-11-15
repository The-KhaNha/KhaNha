-- P3.1 (PR 01b, D6): a brand's owner opens a branch (create_store_from_template, PR 01), edits its profile, and
-- publishes it once it is ready; unpublishing takes it back to DRAFT. SUSPENDED and ARCHIVED stay operator states.

-- The bounds of schemas/limits.ts LIMITS.store (test/api/store-lifecycle.test.ts keeps them equal). The name allows 80,
-- like brands.name, because a template is named after its brand.
alter table public.stores
  add constraint stores_name_length check (char_length(name) between 2 and 80),
  add constraint stores_address_line_length check (char_length(address_line) between 1 and 200),
  add constraint stores_contact_phone_format check (contact_phone ~ '^\+?[0-9]{10,15}$');

-- stores_audit also watches the tagline and the description, which the profile editor now changes.
drop trigger stores_audit on public.stores;
create trigger stores_audit
  after update of name, slug, status, is_open, area, address_line, contact_phone, timezone, accepting_orders,
    paused_until, pause_reason, tagline, description on public.stores
  for each row execute function public.audit_row_change(
    'store.changed', 'name', 'slug', 'status', 'is_open', 'area', 'address_line', 'contact_phone', 'timezone',
    'accepting_orders', 'paused_until', 'pause_reason', 'tagline', 'description'
  );

-- store.changed, in the transaction of any update that changed a store's profile or status: a profile edit, a publish,
-- an unpublish, or an operator's status change in SQL. An update that writes the same values emits nothing. The
-- payload names the fields, never their values (an address or a phone is not an event's business). The actor and
-- request id come as for audit_row_change.
create function public.stores_emit_changed()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  v_actor jsonb := coalesce(nullif(current_setting('app.actor', true), '')::jsonb, (v_headers ->> 'x-actor')::jsonb);
  v_request_id text := coalesce(nullif(current_setting('app.request_id', true), ''), v_headers ->> 'x-request-id');
  v_fields jsonb;
begin
  select jsonb_agg(n.key order by n.key) into v_fields
    from jsonb_each(to_jsonb(new)) n
   where n.key in ('name', 'tagline', 'description', 'area', 'address_line', 'contact_phone', 'status')
     and n.value is distinct from to_jsonb(old) -> n.key;
  if v_fields is not null then
    perform public.emit_event(
      'store.changed', 'store', new.id, new.id, jsonb_build_object('fields', v_fields, 'status', new.status),
      v_actor, v_request_id
    );
  end if;
  return null;
end;
$$;

revoke execute on function public.stores_emit_changed() from public, anon, authenticated, service_role;

create trigger stores_changed
  after update of name, tagline, description, area, address_line, contact_phone, status on public.stores
  for each row execute function public.stores_emit_changed();

-- Publishes (p_status ACTIVE) or unpublishes (DRAFT) a branch under its row lock. Publishing needs an address, a weekly
-- hour and an item someone can order; it returns what is missing ('address', 'hours', 'menu') and changes nothing when
-- any is. A store already in p_status changes nothing and emits nothing. A template is NOT_FOUND, like the route; a
-- SUSPENDED or ARCHIVED store is INVALID_STATUS_TRANSITION (only an operator moves it).
create function public.set_store_status(
  p_store_id uuid,
  p_status public.store_status,
  p_actor jsonb default null,
  p_request_id text default null
)
returns text[]
language plpgsql
set search_path = ''
as $$
declare
  v_store record;
  v_missing text[] := '{}';
begin
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);
  if p_status not in ('ACTIVE', 'DRAFT') then
    raise exception using message = 'VALIDATION_ERROR';
  end if;

  select status, is_template, address_line into v_store from public.stores where id = p_store_id for update;
  if not found or v_store.is_template then
    raise exception using message = 'NOT_FOUND';
  end if;
  if v_store.status = p_status then
    return v_missing;
  end if;
  if v_store.status not in ('ACTIVE', 'DRAFT') then
    raise exception using message = 'INVALID_STATUS_TRANSITION';
  end if;

  if p_status = 'ACTIVE' then
    if nullif(btrim(v_store.address_line), '') is null then
      v_missing := v_missing || 'address'::text;
    end if;
    if not exists (select 1 from public.store_hours where store_id = p_store_id) then
      v_missing := v_missing || 'hours'::text;
    end if;
    if not exists (
      select 1 from public.menu_items
       where store_id = p_store_id and is_available and archived_at is null
         and (stock_quantity is null or stock_quantity > 0)
    ) then
      v_missing := v_missing || 'menu'::text;
    end if;
    if cardinality(v_missing) > 0 then
      return v_missing;
    end if;
  end if;

  -- stores_changed emits store.changed for this update.
  update public.stores set status = p_status where id = p_store_id;
  return v_missing;
end;
$$;

revoke execute on function public.set_store_status(uuid, public.store_status, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.set_store_status(uuid, public.store_status, jsonb, text) to service_role;
