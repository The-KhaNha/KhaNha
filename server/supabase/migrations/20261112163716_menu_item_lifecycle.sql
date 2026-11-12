-- P3.4 (PR 02): menu items are created, edited and archived through the API. A new item may have no photo yet, carries
-- a diet marker, and an archived one stays (orders and lineage point at it) but leaves the menu and cannot be ordered.
create type public.diet_marker as enum ('VEG', 'NON_VEG', 'EGG');

alter table public.menu_items
  add column diet public.diet_marker,
  -- { "400": url, "900": url }: written by the image pipeline (PR 10); nothing reads it before then.
  add column image_variants jsonb,
  alter column image_url drop not null,
  -- The bounds of schemas/limits.ts LIMITS.menuItem (test/api/menu-items.test.ts keeps them equal).
  add constraint menu_items_name_length check (char_length(name) between 2 and 80),
  add constraint menu_items_description_length check (char_length(description) <= 300),
  add constraint menu_items_category_length check (char_length(category) between 1 and 40),
  add constraint menu_items_price_paise_max check (price_paise <= 10000000),
  -- Archiving switches the item off, so place_order refuses it as ITEM_UNAVAILABLE with no change of its own, and
  -- nothing can switch an archived item back on.
  add constraint menu_items_archived_unavailable check (archived_at is null or not is_available);

-- An order line copies the item's photo, which may now be missing.
alter table public.order_items alter column image_url drop not null;

-- Audited on insert too, and on the fields the editor adds. Stock stays out (P3.5 gives it its own trail).
drop trigger menu_items_audit on public.menu_items;
create trigger menu_items_audit
  after insert or update of name, price_paise, is_available, image_url, category, description, diet, archived_at
  on public.menu_items
  for each row execute function public.audit_row_change(
    'menu_item.changed', 'name', 'price_paise', 'is_available', 'image_url', 'category', 'description', 'diet',
    'archived_at'
  );

-- menu.changed, in the transaction of any write that changed what a menu shows: one event per store per statement,
-- so a bulk edit or a reorder is one event. A stock move (every order) or a lineage link is not a menu change. The
-- actor and request id come as for audit_row_change: app.actor from a function, else the Data API's headers.
create function public.menu_items_emit_changed()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  v_actor jsonb := coalesce(nullif(current_setting('app.actor', true), '')::jsonb, (v_headers ->> 'x-actor')::jsonb);
  v_request_id text := coalesce(nullif(current_setting('app.request_id', true), ''), v_headers ->> 'x-request-id');
  v_store record;
begin
  -- plpgsql plans a query when it first runs it, so the insert branch never touches old_rows (which it lacks).
  if tg_op = 'INSERT' then
    for v_store in
      select store_id, jsonb_agg(id order by id) as item_ids from new_rows group by store_id
    loop
      perform public.emit_event(
        'menu.changed', 'store', v_store.store_id, v_store.store_id, jsonb_build_object('itemIds', v_store.item_ids),
        v_actor, v_request_id
      );
    end loop;
  else
    for v_store in
      select n.store_id, jsonb_agg(n.id order by n.id) as item_ids
        from new_rows n join old_rows o on o.id = n.id
       where to_jsonb(n) - 'stock_quantity' - 'template_item_id' is distinct from
             to_jsonb(o) - 'stock_quantity' - 'template_item_id'
       group by n.store_id
    loop
      perform public.emit_event(
        'menu.changed', 'store', v_store.store_id, v_store.store_id, jsonb_build_object('itemIds', v_store.item_ids),
        v_actor, v_request_id
      );
    end loop;
  end if;
  return null;
end;
$$;

revoke execute on function public.menu_items_emit_changed() from public, anon, authenticated, service_role;

create trigger menu_items_changed_on_insert
  after insert on public.menu_items
  referencing new table as new_rows
  for each statement execute function public.menu_items_emit_changed();
create trigger menu_items_changed_on_update
  after update on public.menu_items
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.menu_items_emit_changed();

-- The copies (PR 01) carry the new item columns too: a branch keeps the template's diet markers and photo variants.
-- Same signatures, so the grants stand.
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

-- A new branch of `p_brand_id`: a DRAFT copy of the template's settings and unarchived items, each item linked to
-- its template item. Hours are not copied (a branch sets its own). A taken slug fails the whole call.
create or replace function public.create_store_from_template(
  p_brand_id uuid,
  p_name text,
  p_slug text,
  p_area text default null,
  p_address_line text default null,
  p_actor jsonb default null,
  p_request_id text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_template record;
  v_store uuid;
begin
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);
  select * into v_template from public.stores
   where id = public.ensure_brand_template(p_brand_id, p_actor, p_request_id);

  insert into public.stores (
    brand_id, name, slug, area, address_line, tagline, description, image_url, timezone, prep_time_min_minutes,
    prep_time_max_minutes, max_quantity_per_item, low_stock_threshold, staff_order_list_limit,
    last_order_minutes_before_close, status
  )
  values (
    p_brand_id, p_name, p_slug, p_area, p_address_line, v_template.tagline, v_template.description,
    v_template.image_url, v_template.timezone, v_template.prep_time_min_minutes, v_template.prep_time_max_minutes,
    v_template.max_quantity_per_item, v_template.low_stock_threshold, v_template.staff_order_list_limit,
    v_template.last_order_minutes_before_close, 'DRAFT'
  )
  returning id into v_store;

  insert into public.menu_items (
    store_id, category, name, description, price_paise, image_url, image_variants, diet, is_available, is_popular,
    sort_order, stock_quantity, template_item_id
  )
  select v_store, category, name, description, price_paise, image_url, image_variants, diet, is_available, is_popular,
         sort_order, stock_quantity, id
    from public.menu_items
   where store_id = v_template.id and archived_at is null;

  perform public.emit_event(
    'store.created', 'store', v_store, v_store,
    jsonb_build_object('brandId', p_brand_id, 'templateStoreId', v_template.id), p_actor, p_request_id
  );
  return v_store;
end;
$$;
