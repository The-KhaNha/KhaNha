-- P3.3 PR 12a: the photos bundled in client/public/images move to the media store (server/scripts/migrate-media.ts).
-- The script makes each photo's variants per store; these functions find what still points at `/images/` and repoint
-- it. Store covers stay bundled until a store can upload its own (PR 12b).

-- Every (store, bundled path) a menu item or an order line still shows, with how many rows point at it. An order line
-- has no store of its own: its order's.
create function public.bundled_photo_refs()
returns table (store_id uuid, image_url text, menu_rows bigint, order_rows bigint)
language sql
stable
set search_path = ''
as $$
  with refs as (
    select m.store_id, m.image_url, 1 as menu_row, 0 as order_row
      from public.menu_items m
     where m.image_url like '/images/%'
    union all
    select o.store_id, i.image_url, 0, 1
      from public.order_items i
      join public.orders o on o.id = i.order_id
     where i.image_url like '/images/%'
  )
  select r.store_id, r.image_url, sum(r.menu_row)::bigint, sum(r.order_row)::bigint
    from refs r
   group by r.store_id, r.image_url
   order by r.store_id, r.image_url;
$$;

-- How many rows still point at a bundled photo: `migrate:media --check`, counted here rather than summed over
-- bundled_photo_refs(), whose result the Data API caps at 1000 rows.
create function public.bundled_photo_row_count()
returns bigint
language sql
stable
set search_path = ''
as $$
  select (select count(*) from public.menu_items where image_url like '/images/%')
       + (select count(*) from public.order_items where image_url like '/images/%');
$$;

-- Repoints one store's rows from a bundled path to its media copy, in one transaction: the menu items (the URL and
-- the variants, audited with the caller as actor) and the order lines' snapshots (the same photo at a new address,
-- so order history keeps it). Returns the rows changed; a repeat changes none.
create function public.move_bundled_photo(
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

revoke execute on function public.bundled_photo_row_count() from public, anon, authenticated;
grant execute on function public.bundled_photo_row_count() to service_role;
revoke execute on function public.bundled_photo_refs() from public, anon, authenticated;
grant execute on function public.bundled_photo_refs() to service_role;
revoke execute on function public.move_bundled_photo(uuid, text, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.move_bundled_photo(uuid, text, text, jsonb, jsonb, text) to service_role;
