-- P3.2 PR 13c: a template's modifier groups travel with its items. A branch's copy of a group or option remembers the
-- template row it came from (lineage, like menu_items.template_item_id, never by name), so a later push finds and
-- overwrites it instead of making a second one. A new branch gets every group of its items; a push gets them when
-- it carries the new `modifiers` field, and a branch's brand-new copy of an item always does (a whole item).

alter table public.modifier_groups
  add column template_group_id uuid references public.modifier_groups (id) on delete set null;
alter table public.modifier_options
  add column template_option_id uuid references public.modifier_options (id) on delete set null;
-- One live copy per branch per template row: what a push looks up, and what stops two pushes making two.
create unique index modifier_groups_template_copy_idx
  on public.modifier_groups (store_id, template_group_id)
  where template_group_id is not null and archived_at is null;
create unique index modifier_options_template_copy_idx
  on public.modifier_options (group_id, template_option_id)
  where template_option_id is not null and archived_at is null;

-- Makes the modifiers of the given branch copies match their template items': the template's live groups and options
-- are copied where the branch has no live copy, and overwritten where it has one (name, bounds, deltas, defaults and
-- order; an option's availability is the branch's own, like an item's); an option the template archived is archived
-- in the copy; and each copy offers the copies of its template item's groups, in its order. A group the branch made
-- itself (no lineage) is never touched, nor its links. Returns the copies whose modifiers changed. The caller locks
-- the template items and sets app.actor and app.request_id.
create function public.copy_template_modifiers(p_copy_item_ids uuid[])
returns uuid[]
language plpgsql
set search_path = ''
as $$
declare
  v_stores uuid[] := '{}';
  v_changed uuid[];
begin
  create temp table pg_temp.tm_copies on commit drop as
    select c.id as copy_id, c.store_id, c.template_item_id as template_item_id
      from public.menu_items c
     where c.id = any(p_copy_item_ids) and c.template_item_id is not null and c.archived_at is null;
  create temp table pg_temp.tm_groups on commit drop as
    select distinct cp.store_id, g.id as template_group_id
      from pg_temp.tm_copies cp
      join public.menu_item_modifier_groups l on l.menu_item_id = cp.template_item_id
      join public.modifier_groups g on g.id = l.group_id and g.archived_at is null;
  -- Two pushes of different items sharing a group would both copy it into a branch, and the second would fail on the
  -- unique index: the second waits here instead, and its next statement sees the first's copies.
  perform 1 from public.modifier_groups
   where id in (select template_group_id from pg_temp.tm_groups) order by id for update;

  with w as (
    insert into public.modifier_groups (store_id, name, min_select, max_select, sort_order, template_group_id)
    select tg.store_id, g.name, g.min_select, g.max_select, g.sort_order, g.id
      from pg_temp.tm_groups tg
      join public.modifier_groups g on g.id = tg.template_group_id
     where not exists (
       select 1 from public.modifier_groups c
        where c.store_id = tg.store_id and c.template_group_id = g.id and c.archived_at is null
     )
    returning store_id
  )
  select v_stores || coalesce(array_agg(store_id), '{}') into v_stores from w;

  with w as (
    update public.modifier_groups c
       set name = g.name, min_select = g.min_select, max_select = g.max_select, sort_order = g.sort_order
      from pg_temp.tm_groups tg
      join public.modifier_groups g on g.id = tg.template_group_id
     where c.store_id = tg.store_id and c.template_group_id = g.id and c.archived_at is null
       and (c.name, c.min_select, c.max_select, c.sort_order)
           is distinct from (g.name, g.min_select, g.max_select, g.sort_order)
    returning c.store_id
  )
  select v_stores || coalesce(array_agg(store_id), '{}') into v_stores from w;

  -- The branch's live copy of each template group in scope, now that every one exists.
  create temp table pg_temp.tm_group_copies on commit drop as
    select tg.store_id, tg.template_group_id, c.id as copy_group_id
      from pg_temp.tm_groups tg
      join public.modifier_groups c
        on c.store_id = tg.store_id and c.template_group_id = tg.template_group_id and c.archived_at is null;

  with w as (
    insert into public.modifier_options (
      group_id, name, price_delta_paise, is_default, is_available, sort_order, template_option_id
    )
    select gc.copy_group_id, o.name, o.price_delta_paise, o.is_default, o.is_available, o.sort_order, o.id
      from pg_temp.tm_group_copies gc
      join public.modifier_options o on o.group_id = gc.template_group_id and o.archived_at is null
     where not exists (
       select 1 from public.modifier_options c
        where c.group_id = gc.copy_group_id and c.template_option_id = o.id and c.archived_at is null
     )
    returning group_id
  )
  select v_stores || coalesce(array_agg(gc.store_id), '{}') into v_stores
    from w join pg_temp.tm_group_copies gc on gc.copy_group_id = w.group_id;

  with w as (
    update public.modifier_options c
       set name = o.name, price_delta_paise = o.price_delta_paise, is_default = o.is_default,
           sort_order = o.sort_order,
           archived_at = case when o.archived_at is null then null else now() end
      from pg_temp.tm_group_copies gc
      join public.modifier_options o on o.group_id = gc.template_group_id
     where c.group_id = gc.copy_group_id and c.template_option_id = o.id and c.archived_at is null
       and (
         (c.name, c.price_delta_paise, c.is_default, c.sort_order)
           is distinct from (o.name, o.price_delta_paise, o.is_default, o.sort_order)
         or o.archived_at is not null
       )
    returning c.group_id
  )
  select v_stores || coalesce(array_agg(gc.store_id), '{}') into v_stores
    from w join pg_temp.tm_group_copies gc on gc.copy_group_id = w.group_id;

  -- The links: a copy offers exactly the copies of its template item's live groups, in the template's order, plus
  -- whatever groups of the branch's own it has.
  with w as (
    delete from public.menu_item_modifier_groups l
     using pg_temp.tm_copies cp, public.modifier_groups c
     where l.menu_item_id = cp.copy_id and c.id = l.group_id and c.template_group_id is not null
       and not exists (
         select 1
           from pg_temp.tm_group_copies gc
           join public.menu_item_modifier_groups tl
             on tl.menu_item_id = cp.template_item_id and tl.group_id = gc.template_group_id
          where gc.store_id = cp.store_id and gc.copy_group_id = c.id
       )
    returning cp.store_id
  )
  select v_stores || coalesce(array_agg(store_id), '{}') into v_stores from w;

  with w as (
    insert into public.menu_item_modifier_groups (menu_item_id, group_id, sort_order)
    select cp.copy_id, gc.copy_group_id, tl.sort_order
      from pg_temp.tm_copies cp
      join public.menu_item_modifier_groups tl on tl.menu_item_id = cp.template_item_id
      join pg_temp.tm_group_copies gc on gc.store_id = cp.store_id and gc.template_group_id = tl.group_id
    on conflict (menu_item_id, group_id) do update set sort_order = excluded.sort_order
      where public.menu_item_modifier_groups.sort_order is distinct from excluded.sort_order
    returning (select store_id from public.menu_items where id = menu_item_id) as store_id
  )
  select v_stores || coalesce(array_agg(store_id), '{}') into v_stores from w;

  -- ponytail: per store, not per item: a group copy is shared by a branch's items, so a change to it is a change to
  -- every copy in scope there. Exact per item if the push sheet ever shows which items changed.
  select coalesce(array_agg(copy_id), '{}') into v_changed
    from pg_temp.tm_copies where store_id = any(v_stores);
  drop table pg_temp.tm_copies, pg_temp.tm_groups, pg_temp.tm_group_copies;
  return v_changed;
end;
$$;

revoke execute on function public.copy_template_modifiers(uuid[]) from public, anon, authenticated;

-- From the body in 20261112163716_menu_item_lifecycle.sql; new: the copies take their template items' modifiers.
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

  perform public.copy_template_modifiers(array(select id from public.menu_items where store_id = v_store));

  perform public.emit_event(
    'store.created', 'store', v_store, v_store,
    jsonb_build_object('brandId', p_brand_id, 'templateStoreId', v_template.id), p_actor, p_request_id
  );
  return v_store;
end;
$$;

-- From the body in 20261113140540_push_template_items.sql; new: the `modifiers` field, a new copy's modifiers, and the
-- count is of distinct copies (an item and its modifiers changed in one push is one copy). A modifier-only change
-- touches no menu_items row, so it announces its own menu.changed per store.
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

  -- A new copy is a whole item, its modifiers included (announced by its insert). With `modifiers`, every copy's.
  if 'modifiers' = any(v_fields) then
    v_modified := public.copy_template_modifiers(array(
      select id from public.menu_items
       where template_item_id = any(v_items) and store_id = any(v_stores) and archived_at is null
    ));
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
    v_modified := public.copy_template_modifiers(v_inserted);
  end if;

  return (select count(*) from (select unnest(v_updated) union select unnest(v_inserted)
                                union select unnest(v_modified)) as changed);
end;
$$;
