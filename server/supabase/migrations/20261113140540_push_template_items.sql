-- P3.1 template push (D2): the brand's owner sends chosen fields of chosen template items to chosen branches. A branch
-- whose copy of the item exists (by lineage, `template_item_id`, never by name) gets those fields overwritten; a branch
-- with no live copy gets a new one at the end of its menu. Stock, availability, sort order and popularity of an
-- existing copy are never pushed: they are the branch's own. One statement each for the update and the insert, so the
-- statement-level menu_items triggers emit one `menu.changed` per store, and every audit row carries this request id.

create function public.push_template_items(
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
  v_updated integer;
  v_inserted integer;
begin
  if cardinality(v_items) = 0 or cardinality(v_stores) = 0 or cardinality(v_fields) = 0
     or not v_fields <@ array['name', 'description', 'price', 'category', 'diet', 'photo'] then
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
     );
  get diagnostics v_updated = row_count;

  -- A branch without a live copy gets the whole item (a copy of only some fields would be half an item), after its
  -- own items, in the template's order. It starts untracked: the branch counts its own stock.
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
     );
  get diagnostics v_inserted = row_count;

  return v_updated + v_inserted;
end;
$$;

revoke execute on function public.push_template_items(uuid, uuid[], uuid[], text[], jsonb, text)
  from public, anon, authenticated;
grant execute on function public.push_template_items(uuid, uuid[], uuid[], text[], jsonb, text) to service_role;
