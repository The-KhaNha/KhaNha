-- P3.1 (D6) go-live checklist: what a branch still lacks before it can be published, in one place. The manage screen
-- reads it (GET /stores/:storeId/manage) and set_store_status publishes only when it is empty, so the checklist the
-- owner sees and the rule the publish applies cannot drift apart.

-- 'address' (none, or blank), 'hours' (no weekly interval), 'menu' (no item someone can order: switched on, not
-- archived, and in stock or untracked). Empty: ready. An unknown store is empty too; callers check the store first.
create function public.store_publish_missing(p_store_id uuid)
returns text[]
language sql
stable
set search_path = ''
as $$
  select array_remove(array[
    case when nullif(btrim(s.address_line), '') is null then 'address' end,
    case when not exists (select 1 from public.store_hours h where h.store_id = s.id) then 'hours' end,
    case when not exists (
      select 1 from public.menu_items m
       where m.store_id = s.id and m.is_available and m.archived_at is null
         and (m.stock_quantity is null or m.stock_quantity > 0)
    ) then 'menu' end
  ], null)
    from public.stores s
   where s.id = p_store_id;
$$;

revoke execute on function public.store_publish_missing(uuid) from public, anon, authenticated;
grant execute on function public.store_publish_missing(uuid) to service_role;

-- Same signature and behaviour as 20261112173552_store_publish.sql; the checklist now comes from
-- store_publish_missing.
create or replace function public.set_store_status(
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

  select status, is_template into v_store from public.stores where id = p_store_id for update;
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
    v_missing := public.store_publish_missing(p_store_id);
    if cardinality(v_missing) > 0 then
      return v_missing;
    end if;
  end if;

  -- stores_changed emits store.changed for this update.
  update public.stores set status = p_status where id = p_store_id;
  return v_missing;
end;
$$;
