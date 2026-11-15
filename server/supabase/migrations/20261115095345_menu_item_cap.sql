-- At most 500 live (unarchived) items per store, templates included (/break at the P3 close). The public menu shows
-- 500 (MENU_ITEMS_MAX in server/src/services/menu.service.ts; the parity test is server/test/api/menu-cap.test.ts),
-- so an item past it was invisible to customers while its manager kept editing it, and a reorder of the full list
-- could never succeed. One trigger covers every way an item is made: the API's insert (createMenuItem), a new branch
-- (create_store_from_template, ensure_brand_template) and a template push (push_template_items).

-- Holds to the end of this transaction: no insert can commit between the ranking below and the trigger's creation. It
-- blocks writes to menu_items only for the migration's own few milliseconds (reads and place_order's row locks go on).
lock table public.menu_items in share row exclusive mode;

-- 1. A store already past the cap keeps the 500 its customers see (the public menu's order: sort_order, then id) and
-- the rest are archived, as a manager archiving them would (archived items stay for orders and lineage).
with ranked as (
  select id, row_number() over (partition by store_id order by sort_order, id) as place
    from public.menu_items
   where archived_at is null
)
update public.menu_items m
   set archived_at = now(), is_available = false
  from ranked r
 where r.id = m.id and r.place > 500;

-- 2. The cap. A statement trigger, so a push of 500 rows counts each store once. It takes the store's menu lock (the
-- key reorder_menu takes) before counting: two inserts at 499 then count one after the other, and the second, which
-- sees the first's committed row in its fresh statement, is refused. place_order never takes this lock, so an order
-- never waits on a menu edit. Insert only: nothing un-archives an item or moves it to another store.
create function public.menu_items_enforce_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_store uuid;
  v_live integer;
begin
  for v_store in select distinct store_id from new_rows order by store_id loop
    perform pg_advisory_xact_lock(hashtextextended('store_menu:' || v_store::text, 0));
    select count(*) into v_live from public.menu_items where store_id = v_store and archived_at is null;
    if v_live > 500 then
      raise exception using message = 'MENU_FULL', detail = json_build_object('max', 500)::text;
    end if;
  end loop;
  return null;
end;
$$;
revoke execute on function public.menu_items_enforce_cap() from public, anon, authenticated, service_role;

create trigger menu_items_enforce_cap
  after insert on public.menu_items
  referencing new table as new_rows
  for each statement execute function public.menu_items_enforce_cap();

-- 3. push_template_items takes each branch's menu lock, in id order, before it locks any copy row. Without it a push
-- could hold a copy row and wait for the lock in the cap's trigger while reorder_menu held the lock and waited for
-- that row. From the body in 20261114083650_modifier_copies.sql; new: the lock. Same signature, so the grants stand.
create or replace function public.push_template_items(
  p_brand_id uuid,
  p_template_item_ids uuid[],
  p_store_ids uuid[],
  p_fields text[],
  p_actor jsonb default null,
  p_request_id text default null
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_template uuid;
  v_items uuid[] := array(select distinct unnest(p_template_item_ids));
  v_stores uuid[] := array(select distinct unnest(p_store_ids));
  v_fields text[] := array(select distinct unnest(p_fields));
  v_updated uuid[];
  v_inserted uuid[];
  v_modified uuid[];
  v_store record;
begin
  if cardinality(v_items) = 0 or cardinality(v_stores) = 0 or cardinality(v_fields) = 0
     or not v_fields <@ array['name', 'description', 'price', 'category', 'diet', 'photo', 'modifiers'] then
    raise exception using message = 'VALIDATION_ERROR';
  end if;

  select template_store_id into v_template from public.brands where id = p_brand_id;
  -- Refused whole: an item that is not a live item of this brand's template, or a store that is not one of its live
  -- branches (another brand's store, the template, a suspended or archived branch), changes nothing anywhere. The
  -- template items are locked: a second push of the same items waits for this one (so it then sees the copies made
  -- here and makes no duplicate), and so does an edit or archive of them.
  if v_template is null
     or (select count(*) from (
           select id from public.menu_items
            where store_id = v_template and archived_at is null and id = any(v_items)
            order by id
              for update
         ) as locked) <> cardinality(v_items)
     or (select count(*) from public.stores
          where brand_id = p_brand_id and not is_template and status in ('DRAFT', 'ACTIVE')
            and id = any(v_stores)) <> cardinality(v_stores) then
    raise exception using message = 'NOT_FOUND';
  end if;

  -- The branches' menu locks, before any of their rows (see above).
  perform pg_advisory_xact_lock(hashtextextended('store_menu:' || s.id::text, 0))
     from unnest(v_stores) as s (id)
    order by s.id;

  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);

  -- Only copies that differ in a chosen field: one that already matches is not written, counted, audited or announced.
  with w as (
    update public.menu_items m
       set name = case when 'name' = any(v_fields) then t.name else m.name end,
           description = case when 'description' = any(v_fields) then t.description else m.description end,
           price_paise = case when 'price' = any(v_fields) then t.price_paise else m.price_paise end,
           category = case when 'category' = any(v_fields) then t.category else m.category end,
           diet = case when 'diet' = any(v_fields) then t.diet else m.diet end,
           image_url = case when 'photo' = any(v_fields) then t.image_url else m.image_url end,
           image_variants = case when 'photo' = any(v_fields) then t.image_variants else m.image_variants end
      from public.menu_items t
     where t.id = m.template_item_id
       and t.id = any(v_items)
       and m.store_id = any(v_stores)
       and m.archived_at is null
       and (
         ('name' = any(v_fields) and m.name is distinct from t.name)
         or ('description' = any(v_fields) and m.description is distinct from t.description)
         or ('price' = any(v_fields) and m.price_paise is distinct from t.price_paise)
         or ('category' = any(v_fields) and m.category is distinct from t.category)
         or ('diet' = any(v_fields) and m.diet is distinct from t.diet)
         or ('photo' = any(v_fields)
             and (m.image_url is distinct from t.image_url or m.image_variants is distinct from t.image_variants))
       )
    returning m.id
  )
  select coalesce(array_agg(id), '{}') into v_updated from w;

  -- A branch without a live copy gets the whole item (a copy of only some fields would be half an item), after its
  -- own items, in the template's order. It starts untracked: the branch counts its own stock.
  with w as (
    insert into public.menu_items (
      store_id, category, name, description, price_paise, image_url, image_variants, diet, is_available, is_popular,
      sort_order, stock_quantity, template_item_id
    )
    select s.id, t.category, t.name, t.description, t.price_paise, t.image_url, t.image_variants, t.diet,
           t.is_available, t.is_popular,
           coalesce((select max(sort_order) from public.menu_items where store_id = s.id), 0)
             + row_number() over (partition by s.id order by t.sort_order, t.id),
           null, t.id
      from unnest(v_stores) as s (id)
      cross join public.menu_items t
     where t.id = any(v_items)
       and t.archived_at is null
       and not exists (
         select 1 from public.menu_items c
          where c.store_id = s.id and c.template_item_id = t.id and c.archived_at is null
       )
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_inserted from w;

  -- A new copy is a whole item, its modifiers included (announced by its insert), reusing the branch's group copies
  -- as they are. With `modifiers`, every chosen copy's groups are made to match the template's.
  if 'modifiers' = any(v_fields) then
    v_modified := public.copy_template_modifiers(array(
      select id from public.menu_items
       where template_item_id = any(v_items) and store_id = any(v_stores) and archived_at is null
    ), true);
    for v_store in
      select store_id, jsonb_agg(id order by id) as item_ids
        from public.menu_items
       where id = any(v_modified) and not id = any(v_inserted) and not id = any(v_updated)
       group by store_id
    loop
      perform public.emit_event(
        'menu.changed', 'store', v_store.store_id, v_store.store_id, jsonb_build_object('itemIds', v_store.item_ids),
        p_actor, p_request_id
      );
    end loop;
  else
    v_modified := public.copy_template_modifiers(v_inserted, false);
  end if;

  return (select count(*) from (select unnest(v_updated) union select unnest(v_inserted)
                                union select unnest(v_modified)) as changed);
end;
$$;
