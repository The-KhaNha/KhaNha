-- Two ordering fixes found by the test-suite audit.
--
-- 1. A cancel gave its stock back with one UPDATE … FROM, which locks the item rows in whatever order the plan
--    visits them, while place_order decrements them one by one in menu_item_id order. A cancel and a placement of
--    the same items could each hold one row and wait for the other: a deadlock, which the API answers with a 500.
--    The cancel now locks the order's items in id order first, the same order place_order takes them in. The other
--    bulk writers of menu_items (the menu reorder, the bulk availability switch, the template push, the template's
--    creation and the bundled-photo move) had the same flaw against a placement and get the same lock.
--
-- 2. domain_events.occurred_at and audit_log.occurred_at defaulted to now(), the transaction's start. A transition
--    that waited on another's FOR UPDATE could be stamped before it, so an order's events or audit rows sorted by
--    occurred_at could read CANCELLED before PREPARING. clock_timestamp() is the moment the row is written, as
--    stock_movements.created_at already is.

create or replace function public.update_order_status(
  p_order_id uuid,
  p_next_status public.order_status,
  p_from_statuses public.order_status[],
  p_actor jsonb default null,
  p_request_id text default null
)
-- true when the status changed, false for a repeat (the API logs the two apart, as it does an idempotent replay).
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_current record;
begin
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);

  -- Locked: a second request for the same order waits here, then sees the first one's status (and the event's `from`
  -- is the status this transition really left).
  select status, order_number, store_id into v_current from public.orders where id = p_order_id for update;
  if not found then
    raise exception using message = 'NOT_FOUND';
  end if;

  -- A repeat of a transition that already happened (a retried request, two staff pressing READY) changes nothing,
  -- emits nothing and moves no stock. Only for a status some transition leads to: the API passes the statuses it may
  -- come from (its ALLOWED_TRANSITIONS), none for PLACED, so PLACED → PLACED stays an invalid transition.
  if v_current.status = p_next_status and cardinality(p_from_statuses) > 0 then
    return false;
  end if;

  if not (v_current.status = any (p_from_statuses)) then
    raise exception using
      message = 'INVALID_STATUS_TRANSITION',
      detail = jsonb_build_object('orderNumber', v_current.order_number, 'status', v_current.status)::text;
  end if;

  update public.orders set status = p_next_status where id = p_order_id;

  if p_next_status = 'CANCELLED' then
    -- In id order, as place_order takes them: two transactions that lock the same items in one order cannot deadlock.
    -- Only the rows the restock updates, in the restock's own mode: FOR NO KEY UPDATE does not wait on the FOR KEY
    -- SHARE a placement's order_items foreign key takes (FOR UPDATE would, and could deadlock on an untracked item).
    perform 1
      from public.menu_items
     where id in (select menu_item_id from public.order_items where order_id = p_order_id and reserved_quantity > 0)
       and stock_quantity is not null
     order by id
       for no key update;
    -- Only what this order took goes back: an item untracked when ordered reserved nothing, even if it is tracked
    -- now. An item untracked now (stock null) is left alone.
    update public.menu_items m
       set stock_quantity = m.stock_quantity + returned.quantity
      from (
        select menu_item_id, sum(reserved_quantity)::integer as quantity
        from public.order_items
        where order_id = p_order_id and reserved_quantity > 0
        group by menu_item_id
      ) as returned
     where m.id = returned.menu_item_id
       and m.stock_quantity is not null;
  end if;

  perform public.emit_event(
    'order.' || lower(p_next_status::text), 'order', p_order_id, v_current.store_id,
    jsonb_build_object('orderNumber', v_current.order_number, 'from', v_current.status, 'to', p_next_status),
    p_actor, p_request_id
  );
  return true;
end;
$$;

revoke execute on function
  public.update_order_status(uuid, public.order_status, public.order_status[], jsonb, text)
from public, anon, authenticated;

grant execute on function
  public.update_order_status(uuid, public.order_status, public.order_status[], jsonb, text)
to service_role;

-- The same rule for every other function that writes many menu_items rows at once: each locks the rows it will
-- change in id order first. Their bodies are otherwise unchanged (the latest definitions: reorder_menu and
-- set_menu_availability from 20261112183242, push_template_items from 20261115095345, ensure_brand_template from
-- 20261112163716, move_bundled_photo from 20261113183803).

create or replace function public.reorder_menu(
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

  -- The rows it changes first, in id order, as place_order and a cancel take them (see update_order_status above).
  perform 1
    from public.menu_items m
    join unnest(p_item_ids) with ordinality as t(id, position) on m.id = t.id
   where m.store_id = p_store_id and m.sort_order is distinct from t.position
   order by m.id
     for no key update of m;
  update public.menu_items m
     set sort_order = t.position
    from unnest(p_item_ids) with ordinality as t(id, position)
   where m.id = t.id and m.store_id = p_store_id and m.sort_order is distinct from t.position;
end;
$$;

create or replace function public.set_menu_availability(
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

  -- The rows it changes first, in id order, as place_order and a cancel take them (see update_order_status above).
  perform 1
    from public.menu_items
   where id = any (v_ids) and is_available is distinct from p_is_available
   order by id
     for no key update;
  update public.menu_items
     set is_available = p_is_available
   where id = any (v_ids) and is_available is distinct from p_is_available;
  return cardinality(v_ids);
end;
$$;

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

  -- The copies' rows first, in id order, as place_order and a cancel take them (see update_order_status above).
  perform 1
    from public.menu_items m
   where m.template_item_id = any (v_items) and m.store_id = any (v_stores) and m.archived_at is null
   order by m.id
     for no key update;

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

create or replace function public.ensure_brand_template(
  p_brand_id uuid,
  p_actor jsonb default null,
  p_request_id text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_brand record;
  v_source record;
  v_template uuid;
  v_slug text;
begin
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);

  select id, name, slug, description, template_store_id into v_brand
    from public.brands where id = p_brand_id for update;
  if not found then
    raise exception using message = 'NOT_FOUND';
  end if;
  if v_brand.template_store_id is not null then
    return v_brand.template_store_id;
  end if;

  select * into v_source from public.stores
   where brand_id = p_brand_id and not is_template
   order by created_at, id limit 1;

  -- A store may already hold `<brand>-template` (slugs are free text): then a suffix from the brand id keeps it unique.
  v_slug := left(v_brand.slug, 51) || '-template';
  if exists (select 1 from public.stores where slug = v_slug) then
    v_slug := left(v_brand.slug, 42) || '-template-' || left(md5(p_brand_id::text), 8);
  end if;

  if v_source.id is null then
    -- A brand with no store yet: an empty template on the column defaults.
    insert into public.stores (brand_id, name, slug, tagline, description, status, is_template)
    values (p_brand_id, v_brand.name, v_slug, '', v_brand.description, 'DRAFT', true)
    returning id into v_template;
  else
    insert into public.stores (
      brand_id, name, slug, tagline, description, image_url, timezone, prep_time_min_minutes, prep_time_max_minutes,
      max_quantity_per_item, low_stock_threshold, staff_order_list_limit, last_order_minutes_before_close,
      status, is_template
    )
    values (
      p_brand_id, v_brand.name, v_slug, v_source.tagline, v_source.description, v_source.image_url, v_source.timezone,
      v_source.prep_time_min_minutes, v_source.prep_time_max_minutes, v_source.max_quantity_per_item,
      v_source.low_stock_threshold, v_source.staff_order_list_limit, v_source.last_order_minutes_before_close,
      'DRAFT', true
    )
    returning id into v_template;
  end if;

  if v_source.id is not null then
    -- The branch's rows first, in id order, as place_order and a cancel take them (see update_order_status above).
    perform 1
      from public.menu_items
     where store_id = v_source.id and archived_at is null
     order by id
       for no key update;
    -- One statement: the CTE is materialized, so each source row keeps the one new id it was given.
    with src as (
      select m.*, gen_random_uuid() as new_id from public.menu_items m
       where m.store_id = v_source.id and m.archived_at is null
    ), ins as (
      insert into public.menu_items (
        id, store_id, category, name, description, price_paise, image_url, image_variants, diet, is_available,
        is_popular, sort_order, stock_quantity
      )
      select new_id, v_template, category, name, description, price_paise, image_url, image_variants, diet, true,
             is_popular, sort_order, null
        from src
      returning id
    )
    update public.menu_items m set template_item_id = src.new_id from src where m.id = src.id;

  end if;

  update public.brands set template_store_id = v_template where id = p_brand_id;
  perform public.emit_event(
    'store.created', 'store', v_template, v_template,
    jsonb_build_object('brandId', p_brand_id, 'isTemplate', true), p_actor, p_request_id
  );
  return v_template;
end;
$$;

create or replace function public.move_bundled_photo(
  p_store_id uuid,
  p_from text,
  p_to text,
  p_variants jsonb,
  p_actor jsonb default null,
  p_request_id text default null
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_items integer;
  v_lines integer;
begin
  -- Null-safe: a null in any of these must raise, not slip past the check and write nulls.
  if p_store_id is null or p_from is null or p_to is null
     or p_from not like '/images/%' or p_to not like '/media/%'
     or jsonb_typeof(p_variants) is distinct from 'array' then
    raise exception using message = 'VALIDATION_ERROR';
  end if;
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);

  -- The rows it changes first, in id order, as place_order and a cancel take them (see update_order_status above).
  perform 1
    from public.menu_items
   where store_id = p_store_id and image_url = p_from
   order by id
     for no key update;
  update public.menu_items
     set image_url = p_to, image_variants = p_variants
   where store_id = p_store_id and image_url = p_from;
  get diagnostics v_items = row_count;

  update public.order_items i
     set image_url = p_to
    from public.orders o
   where o.id = i.order_id and o.store_id = p_store_id and i.image_url = p_from;
  get diagnostics v_lines = row_count;

  return v_items + v_lines;
end;
$$;

revoke execute on function
  public.reorder_menu(uuid, uuid[], jsonb, text),
  public.set_menu_availability(uuid, boolean, uuid[], text, jsonb, text),
  public.push_template_items(uuid, uuid[], uuid[], text[], jsonb, text),
  public.ensure_brand_template(uuid, jsonb, text),
  public.move_bundled_photo(uuid, text, text, jsonb, jsonb, text)
from public, anon, authenticated;

grant execute on function
  public.reorder_menu(uuid, uuid[], jsonb, text),
  public.set_menu_availability(uuid, boolean, uuid[], text, jsonb, text),
  public.push_template_items(uuid, uuid[], uuid[], text[], jsonb, text),
  public.ensure_brand_template(uuid, jsonb, text),
  public.move_bundled_photo(uuid, text, text, jsonb, jsonb, text)
to service_role;

alter table public.domain_events alter column occurred_at set default clock_timestamp();
alter table public.audit_log alter column occurred_at set default clock_timestamp();
