-- P3.4 (PR 03): the menu editor's quick edits. Each is one statement, so menu_items_changed emits one menu.changed
-- (none when nothing changed). Both take the store's menu lock, a transaction advisory lock, so two of them on one
-- store run one after the other: a reorder is never mixed with another, and a reorder and a bulk switch never lock
-- the same items in opposite orders (a deadlock). place_order takes no such lock; its stock update only waits for an
-- item row a quick edit is changing, until that edit commits.

-- The store's menu lock; NOT_FOUND for a missing store.
create function public.lock_store_menu(p_store_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.stores where id = p_store_id) then
    raise exception using message = 'NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('store_menu:' || p_store_id::text, 0));
end;
$$;

revoke execute on function public.lock_store_menu(uuid) from public, anon, authenticated;
grant execute on function public.lock_store_menu(uuid) to service_role;

-- p_item_ids must be every unarchived item of the store, each once. An id that is not this store's item at all (another
-- store's, or unknown) is NOT_FOUND, as the API answers for someone else's resource; any other mismatch (a stale list:
-- an item missing, an archived one, a repeat) is VALIDATION_ERROR. Either changes nothing.
create function public.reorder_menu(
  p_store_id uuid,
  p_item_ids uuid[],
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
  perform public.lock_store_menu(p_store_id);

  if exists (
    select 1 from unnest(p_item_ids) as t(id)
     where not exists (select 1 from public.menu_items m where m.id = t.id and m.store_id = p_store_id)
  ) then
    raise exception using message = 'NOT_FOUND';
  end if;
  if coalesce(cardinality(p_item_ids), 0) = 0
     or cardinality(p_item_ids) <> (select count(distinct id) from unnest(p_item_ids) as t(id))
     or (select array_agg(id order by id) from public.menu_items where store_id = p_store_id and archived_at is null)
        is distinct from (select array_agg(id order by id) from unnest(p_item_ids) as t(id)) then
    raise exception using message = 'VALIDATION_ERROR';
  end if;

  update public.menu_items m
     set sort_order = t.position
    from unnest(p_item_ids) with ordinality as t(id, position)
   where m.id = t.id and m.store_id = p_store_id and m.sort_order is distinct from t.position;
end;
$$;

-- "Sold out: all juices": switches the listed items (p_item_ids), or every item of p_category, on or off; archived
-- items are never touched. A list naming anything but this store's unarchived items, or a category with none, is
-- NOT_FOUND and changes nothing. Returns how many items the edit covered (a repeat counts them again, emits nothing).
create function public.set_menu_availability(
  p_store_id uuid,
  p_is_available boolean,
  p_item_ids uuid[] default null,
  p_category text default null,
  p_actor jsonb default null,
  p_request_id text default null
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);
  if (p_item_ids is null) = (p_category is null) or p_is_available is null then
    raise exception using message = 'VALIDATION_ERROR';
  end if;
  perform public.lock_store_menu(p_store_id);

  select coalesce(array_agg(id), '{}') into v_ids
    from public.menu_items
   where store_id = p_store_id and archived_at is null
     and (id = any (p_item_ids) or category = p_category);
  if cardinality(v_ids) = 0
     or (p_item_ids is not null and cardinality(v_ids) <> (select count(distinct id) from unnest(p_item_ids) as t(id)))
  then
    raise exception using message = 'NOT_FOUND';
  end if;

  update public.menu_items
     set is_available = p_is_available
   where id = any (v_ids) and is_available is distinct from p_is_available;
  return cardinality(v_ids);
end;
$$;

revoke execute on function public.reorder_menu(uuid, uuid[], jsonb, text) from public, anon, authenticated;
grant execute on function public.reorder_menu(uuid, uuid[], jsonb, text) to service_role;
revoke execute on function public.set_menu_availability(uuid, boolean, uuid[], text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.set_menu_availability(uuid, boolean, uuid[], text, jsonb, text) to service_role;
