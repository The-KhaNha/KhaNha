-- P3.1 (PR 01): the brand template (ADR-001 as amended). A brand keeps one store row that is never public; a new
-- branch is a copy of it, and each copied item remembers the template item it came from.
alter table public.stores
  add column is_template boolean not null default false,
  add constraint stores_template_is_draft check (not is_template or status = 'DRAFT');
create unique index stores_one_template_per_brand on public.stores (brand_id) where is_template;
alter table public.brands
  add column template_store_id uuid unique references public.stores (id) on delete set null;

alter table public.menu_items
  add column template_item_id uuid references public.menu_items (id) on delete set null,
  -- Nothing sets it until the first delete path (PR 02); the copies below already skip archived items.
  add column archived_at timestamptz;
create index menu_items_template_item_id_idx on public.menu_items (template_item_id);

-- The brand's template, made on first call from its oldest store (menu and settings; hours stay per branch). Every
-- other store's items get their lineage by name and category. Idempotent: a brand that has a template keeps it. Returns its id.
create function public.ensure_brand_template(
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
        id, store_id, category, name, description, price_paise, image_url, is_available, is_popular, sort_order,
        stock_quantity
      )
      select new_id, v_template, category, name, description, price_paise, image_url, true, is_popular, sort_order,
             null
        from src
      returning id
    )
    update public.menu_items m set template_item_id = src.new_id from src where m.id = src.id;

    -- ponytail: by name and category; two template items alike in both link to either. Fine for the seed's branches.
    update public.menu_items m
       set template_item_id = t.id
      from public.menu_items t, public.stores s
     where t.store_id = v_template
       and s.id = m.store_id and s.brand_id = p_brand_id and not s.is_template and s.id <> v_source.id
       and m.template_item_id is null and m.name = t.name and m.category = t.category;
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
create function public.create_store_from_template(
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
    store_id, category, name, description, price_paise, image_url, is_available, is_popular, sort_order,
    stock_quantity, template_item_id
  )
  select v_store, category, name, description, price_paise, image_url, is_available, is_popular, sort_order,
         stock_quantity, id
    from public.menu_items
   where store_id = v_template.id and archived_at is null;

  perform public.emit_event(
    'store.created', 'store', v_store, v_store,
    jsonb_build_object('brandId', p_brand_id, 'templateStoreId', v_template.id), p_actor, p_request_id
  );
  return v_store;
end;
$$;

revoke execute on function
  public.ensure_brand_template(uuid, jsonb, text),
  public.create_store_from_template(uuid, text, text, text, text, jsonb, text)
from public, anon, authenticated;
grant execute on function
  public.ensure_brand_template(uuid, jsonb, text),
  public.create_store_from_template(uuid, text, text, text, text, jsonb, text)
to service_role;

-- Backfill: every existing brand gets its template (staging; a fresh database has no brands until the seed runs).
do $$
declare
  v_brand uuid;
begin
  for v_brand in select id from public.brands order by created_at loop
    perform public.ensure_brand_template(v_brand);
  end loop;
end;
$$;
