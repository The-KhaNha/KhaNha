-- Order snapshots v2 (P1 PR 08, roadmap P1.5). An order keeps what it looked like when it was placed: each line's
-- photo and category, and the store's name. Before this, order reads joined menu_items.image_url and stores.name live,
-- so a new photo or a renamed store rewrote every past order. order_items.name and unit_price were already snapshots.
-- category is stored for analytics (P7.1) and not sent by the API.
--
-- Expand only: the API deployed during the migration still joins menu_items and stores, whose columns are untouched,
-- and calls place_order with the same arguments, which now fills the new columns itself.

alter table public.order_items
  add column image_url text,
  add column category text;

alter table public.orders
  add column store_name text;

-- Backfill from today's menu and store, the best copy left. orders_set_updated_at would stamp every past order as
-- updated now (OrderDto.updatedAt), so it is off for the backfill; the audit trigger watches status only.
update public.order_items oi
   set image_url = m.image_url,
       category = m.category
  from public.menu_items m
 where m.id = oi.menu_item_id;

alter table public.orders disable trigger orders_set_updated_at;
update public.orders o
   set store_name = s.name
  from public.stores s
 where s.id = o.store_id;
alter table public.orders enable trigger orders_set_updated_at;

alter table public.order_items
  alter column image_url set not null,
  alter column category set not null;

alter table public.orders
  alter column store_name set not null;

-- PR 05's body and signature (so the grants stay), plus the three snapshots, read here: the API's arguments do not
-- change.
create or replace function public.place_order(
  p_user_id uuid,
  p_store_id uuid,
  p_customer_name text,
  p_payment_status public.payment_status,
  p_lines jsonb,
  p_customer_phone text default null,
  p_note text default null,
  p_idempotency_key uuid default null,
  p_actor jsonb default null,
  p_request_id text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_order_number integer;
  v_line record;
  v_left integer;
begin
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);

  if p_idempotency_key is not null then
    -- Two requests with the same key at the same time queue here; the second then finds the first's committed row.
    -- The unique index is the backstop if this lock is ever bypassed. A replay emits nothing: the order was placed once.
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_idempotency_key::text, 0));
    select id into v_order_id
      from public.orders
     where user_id = p_user_id and idempotency_key = p_idempotency_key;
    if found then
      return v_order_id;
    end if;
  end if;

  for v_line in
    select * from jsonb_to_recordset(p_lines) as l(menu_item_id uuid, name text, quantity integer)
    order by menu_item_id
  loop
    update public.menu_items
       set stock_quantity = stock_quantity - v_line.quantity
     where id = v_line.menu_item_id
       and stock_quantity >= v_line.quantity;

    if not found then
      select stock_quantity into v_left from public.menu_items where id = v_line.menu_item_id;
      -- Found with a null stock: the item is not stock-tracked, so there is nothing to reserve.
      if not found or v_left is not null then
        raise exception using
          message = 'INSUFFICIENT_STOCK',
          detail = jsonb_build_object('menuItemId', v_line.menu_item_id, 'name', v_line.name, 'available', coalesce(v_left, 0))::text;
      end if;
    end if;
  end loop;

  insert into public.orders (
    user_id, store_id, store_name, customer_name, customer_phone, note, total, payment_status, status,
    estimated_ready_at, idempotency_key
  )
  values (
    p_user_id,
    p_store_id,
    (select name from public.stores where id = p_store_id),
    p_customer_name,
    p_customer_phone,
    p_note,
    (select sum(unit_price * quantity) from jsonb_to_recordset(p_lines) as l(unit_price integer, quantity integer)),
    p_payment_status,
    'PLACED',
    now() + make_interval(mins => (select prep_time_max_minutes from public.stores where id = p_store_id)),
    p_idempotency_key
  )
  returning id, order_number into v_order_id, v_order_number;

  -- The loop above raised for any line whose item does not exist, so the join keeps every line. The name, photo and
  -- category all come from this one read of menu_items, so a line never mixes two versions of its item; p_lines' name
  -- is only for the stock error above. The price still comes from p_lines until PR 09 prices lines here too.
  insert into public.order_items (
    order_id, line_number, menu_item_id, name, unit_price, quantity, line_total, image_url, category
  )
  select v_order_id, l.line_number, l.menu_item_id, m.name, l.unit_price, l.quantity, l.unit_price * l.quantity,
         m.image_url, m.category
  from rows from (
    jsonb_to_recordset(p_lines) as (menu_item_id uuid, name text, unit_price integer, quantity integer)
  ) with ordinality as l(menu_item_id, name, unit_price, quantity, line_number)
  join public.menu_items m on m.id = l.menu_item_id;

  -- Ids and statuses only: an event never carries an amount or personal data.
  perform public.emit_event(
    'order.placed', 'order', v_order_id, p_store_id,
    jsonb_build_object('orderNumber', v_order_number),
    p_actor, p_request_id
  );

  return v_order_id;
end;
$$;
