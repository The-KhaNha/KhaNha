-- P3.2 PR 14: editing a store's modifier groups. A group is saved whole, with its options, in one function, so a menu
-- never offers a half-edited group; an item's groups are set in another. Each write that changed something emits one
-- menu.changed with the caller as actor (a repeat changes nothing and emits nothing). Bounds the API also checks
-- (MODIFIER_LIMITS) are checked here again where they depend on stored rows.

-- Creates (p_group_id null) or overwrites a live group of p_store_id. p_options is the whole list, in order:
-- [{ id?, name, priceDeltaPaise, isDefault, isAvailable }]. An entry with an id updates that live option of this
-- group (any other id is NOT_FOUND); one without an id is new; a live option left out is archived (old orders keep
-- their snapshots). Refused with VALIDATION_ERROR: a group past p_max_groups (the API's
-- MODIFIER_LIMITS.groupsPerStore, so the number has one copy), min_select above the available options, or more
-- defaults than max_select.
create function public.save_modifier_group(
  p_store_id uuid,
  p_name text,
  p_min_select integer,
  p_max_select integer,
  p_options jsonb,
  p_max_groups integer,
  p_group_id uuid default null,
  p_actor jsonb default null,
  p_request_id text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_group uuid := p_group_id;
  v_changed integer := 0;
  v_rows integer;
  v_available integer;
  v_defaults integer;
begin
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);

  if v_group is null then
    -- The store's row is locked so two creates cannot both see 19 groups.
    perform 1 from public.stores where id = p_store_id for update;
    if (select count(*) from public.modifier_groups where store_id = p_store_id and archived_at is null) >= p_max_groups then
      raise exception using message = 'VALIDATION_ERROR', detail = '{"field":"name","reason":"groups"}';
    end if;
    insert into public.modifier_groups (store_id, name, min_select, max_select, sort_order)
    values (
      p_store_id, p_name, p_min_select, p_max_select,
      coalesce((select max(sort_order) + 1 from public.modifier_groups where store_id = p_store_id), 0)
    )
    returning id into v_group;
    v_changed := 1;
  else
    perform 1 from public.modifier_groups
     where id = v_group and store_id = p_store_id and archived_at is null
       for update;
    if not found then
      raise exception using message = 'NOT_FOUND';
    end if;
    update public.modifier_groups
       set name = p_name, min_select = p_min_select, max_select = p_max_select
     where id = v_group and (name, min_select, max_select) is distinct from (p_name, p_min_select, p_max_select);
    get diagnostics v_rows = row_count;
    v_changed := v_changed + v_rows;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_options) e
     where e ->> 'id' is not null
       and not exists (
         select 1 from public.modifier_options o
          where o.id = (e ->> 'id')::uuid and o.group_id = v_group and o.archived_at is null
       )
  ) then
    raise exception using message = 'NOT_FOUND';
  end if;

  update public.modifier_options
     set archived_at = now()
   where group_id = v_group and archived_at is null
     and id not in (select (e ->> 'id')::uuid from jsonb_array_elements(p_options) e where e ->> 'id' is not null);
  get diagnostics v_rows = row_count;
  v_changed := v_changed + v_rows;

  update public.modifier_options o
     set name = e.v ->> 'name', price_delta_paise = (e.v ->> 'priceDeltaPaise')::bigint,
         is_default = (e.v ->> 'isDefault')::boolean, is_available = (e.v ->> 'isAvailable')::boolean,
         sort_order = e.ord - 1
    from jsonb_array_elements(p_options) with ordinality as e (v, ord)
   where o.id = (e.v ->> 'id')::uuid
     and (o.name, o.price_delta_paise, o.is_default, o.is_available, o.sort_order)
         is distinct from (e.v ->> 'name', (e.v ->> 'priceDeltaPaise')::bigint, (e.v ->> 'isDefault')::boolean,
                           (e.v ->> 'isAvailable')::boolean, (e.ord - 1)::integer);
  get diagnostics v_rows = row_count;
  v_changed := v_changed + v_rows;

  insert into public.modifier_options (group_id, name, price_delta_paise, is_default, is_available, sort_order)
  select v_group, e.v ->> 'name', (e.v ->> 'priceDeltaPaise')::bigint, (e.v ->> 'isDefault')::boolean,
         (e.v ->> 'isAvailable')::boolean, e.ord - 1
    from jsonb_array_elements(p_options) with ordinality as e (v, ord)
   where e.v ->> 'id' is null;
  get diagnostics v_rows = row_count;
  v_changed := v_changed + v_rows;

  -- A required group that cannot be filled would refuse every order of its items.
  select count(*) filter (where is_available), count(*) filter (where is_default)
    into v_available, v_defaults
    from public.modifier_options where group_id = v_group and archived_at is null;
  if p_min_select > v_available then
    raise exception using message = 'VALIDATION_ERROR', detail = '{"field":"minSelect","reason":"options"}';
  end if;
  if v_defaults > p_max_select then
    raise exception using message = 'VALIDATION_ERROR', detail = '{"field":"options","reason":"defaults"}';
  end if;

  if v_changed > 0 then
    perform public.emit_event(
      'menu.changed', 'store', p_store_id, p_store_id, jsonb_build_object('groupIds', jsonb_build_array(v_group)),
      p_actor, p_request_id
    );
  end if;
  return v_group;
end;
$$;

-- Archives a live group of p_store_id: the menu stops offering it at once (loadItemModifiers skips archived groups);
-- old orders keep their snapshots. A repeat changes nothing and emits nothing; another store's group is NOT_FOUND.
create function public.archive_modifier_group(
  p_store_id uuid,
  p_group_id uuid,
  p_actor jsonb default null,
  p_request_id text default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);
  update public.modifier_groups set archived_at = now()
   where id = p_group_id and store_id = p_store_id and archived_at is null;
  if not found then
    if exists (select 1 from public.modifier_groups where id = p_group_id and store_id = p_store_id) then
      return;
    end if;
    raise exception using message = 'NOT_FOUND';
  end if;
  perform public.emit_event(
    'menu.changed', 'store', p_store_id, p_store_id, jsonb_build_object('groupIds', jsonb_build_array(p_group_id)),
    p_actor, p_request_id
  );
end;
$$;

-- Sets which groups a live item of p_store_id offers, in order. Every group must be a live group of the same store
-- (another store's is NOT_FOUND, like the item). Returns false, and emits nothing, when the item already offers
-- exactly these, in this order.
create function public.set_item_modifier_groups(
  p_store_id uuid,
  p_item_id uuid,
  p_group_ids uuid[],
  p_actor jsonb default null,
  p_request_id text default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);
  -- Locked: two editors setting one item's groups at once would interleave their deletes and inserts.
  perform 1 from public.menu_items
   where id = p_item_id and store_id = p_store_id and archived_at is null
     for update;
  if not found
     or (select count(distinct id) from public.modifier_groups
          where id = any(p_group_ids) and store_id = p_store_id and archived_at is null) <> cardinality(p_group_ids)
     or cardinality(p_group_ids) <> (select count(distinct g) from unnest(p_group_ids) as g) then
    raise exception using message = 'NOT_FOUND';
  end if;

  if array(
       select l.group_id from public.menu_item_modifier_groups l
         join public.modifier_groups g on g.id = l.group_id and g.archived_at is null
        where l.menu_item_id = p_item_id
        order by l.sort_order, l.group_id
     ) = p_group_ids then
    return false;
  end if;

  delete from public.menu_item_modifier_groups
   where menu_item_id = p_item_id and group_id <> all(p_group_ids);
  insert into public.menu_item_modifier_groups (menu_item_id, group_id, sort_order)
  select p_item_id, u.g, u.ord - 1 from unnest(p_group_ids) with ordinality as u (g, ord)
  on conflict (menu_item_id, group_id) do update set sort_order = excluded.sort_order;

  perform public.emit_event(
    'menu.changed', 'store', p_store_id, p_store_id, jsonb_build_object('itemIds', jsonb_build_array(p_item_id)),
    p_actor, p_request_id
  );
  return true;
end;
$$;

revoke execute on function public.save_modifier_group(uuid, text, integer, integer, jsonb, integer, uuid, jsonb, text)
  from public, anon, authenticated;
revoke execute on function public.archive_modifier_group(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function public.set_item_modifier_groups(uuid, uuid, uuid[], jsonb, text)
  from public, anon, authenticated;
grant execute on function public.save_modifier_group(uuid, text, integer, integer, jsonb, integer, uuid, jsonb, text)
  to service_role;
grant execute on function public.archive_modifier_group(uuid, uuid, jsonb, text) to service_role;
grant execute on function public.set_item_modifier_groups(uuid, uuid, uuid[], jsonb, text) to service_role;
