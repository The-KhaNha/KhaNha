-- A published store keeps its weekly hours (decided 2026-11-23). Publishing checks for hours, but an ACTIVE store
-- could then save an empty week, and a store with no hours reads OPEN around the clock (domain/schedule.ts).
-- set_store_hours now refuses an empty week while the store is ACTIVE, under the same store lock publishing waits on,
-- with the publish refusal's code and detail: STORE_NOT_READY { missing: ['hours'] }. To close for good, unpublish (or
-- pause); to close for a day, add an exception. Otherwise the function is unchanged.
create or replace function public.set_store_hours(
  p_store_id uuid,
  p_hours jsonb,
  p_actor jsonb default null,
  p_request_id text default null
)
-- Security definer: the API's role may not insert into audit_log (append-only; the triggers write it as the owner).
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);

  -- One writer per store at a time, so the old week read below is the one replaced.
  perform 1 from public.stores where id = p_store_id for update;
  if not found then
    raise exception using message = 'NOT_FOUND';
  end if;

  if jsonb_array_length(p_hours) = 0
     and exists (select 1 from public.stores where id = p_store_id and status = 'ACTIVE') then
    raise exception using
      message = 'STORE_NOT_READY',
      detail = jsonb_build_object('missing', jsonb_build_array('hours'))::text;
  end if;

  with parsed as (
    select (e ->> 'dayOfWeek')::int as day, (e ->> 'opensAt')::time as opens, (e ->> 'closesAt')::time as closes
      from jsonb_array_elements(p_hours) e
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'dayOfWeek', day, 'opensAt', to_char(opens, 'HH24:MI'), 'closesAt', to_char(closes, 'HH24:MI')
         ) order by day, opens, closes), '[]'::jsonb)
    into v_new
    from parsed;

  if exists (
    with spans as (
      select (e ->> 'dayOfWeek')::int * 1440 + extract(hour from (e ->> 'opensAt')::time)::int * 60
               + extract(minute from (e ->> 'opensAt')::time)::int as s,
             case when (e ->> 'closesAt')::time <= (e ->> 'opensAt')::time then 1440 else 0 end
               + extract(hour from (e ->> 'closesAt')::time)::int * 60
               + extract(minute from (e ->> 'closesAt')::time)::int
               + (e ->> 'dayOfWeek')::int * 1440 as f
        from jsonb_array_elements(p_hours) e
    ), numbered as (select row_number() over () as n, s, f from spans)
    select 1
      from numbered a
      join numbered b on a.n < b.n
      cross join (values (-10080), (0), (10080)) as shift (w)
     where a.s < b.f + shift.w and b.s + shift.w < a.f
  ) then
    raise exception using message = 'VALIDATION_ERROR';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'dayOfWeek', day_of_week, 'opensAt', to_char(opens_at, 'HH24:MI'), 'closesAt', to_char(closes_at, 'HH24:MI')
         ) order by day_of_week, opens_at, closes_at), '[]'::jsonb)
    into v_old
    from public.store_hours
   where store_id = p_store_id;

  if v_old = v_new then
    return false;
  end if;

  delete from public.store_hours where store_id = p_store_id;
  insert into public.store_hours (store_id, day_of_week, opens_at, closes_at)
  select p_store_id, (e ->> 'dayOfWeek')::int, (e ->> 'opensAt')::time, (e ->> 'closesAt')::time
    from jsonb_array_elements(v_new) e;

  insert into public.audit_log (
    actor_type, actor_id, actor_role, store_id, action, entity_type, entity_id, changes, request_id
  )
  values (
    coalesce(p_actor ->> 'type', 'SYSTEM')::public.actor_type,
    (p_actor ->> 'id')::uuid,
    coalesce(p_actor ->> 'storeRole', p_actor ->> 'role'),
    p_store_id,
    'store_hours.changed',
    'store_hours',
    p_store_id::text,
    jsonb_build_object('week', jsonb_build_array(v_old, v_new)),
    nullif(p_request_id, '')
  );

  -- The store id only: an event never carries more than ids.
  perform public.emit_event('store.hours_changed', 'store', p_store_id, p_store_id, '{}'::jsonb, p_actor, p_request_id);
  return true;
end;
$$;

revoke execute on function public.set_store_hours(uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.set_store_hours(uuid, jsonb, jsonb, text) to service_role;
