-- Server-side idempotency for order placement. A client that never heard the answer to its POST /api/orders (a
-- timeout, a dropped connection, a refresh mid-request) sends the same key again and gets the order it already
-- placed instead of a second one. The key is per user: two customers may reuse the same value without colliding.
alter table public.orders add column idempotency_key uuid;

create unique index orders_user_id_idempotency_key_idx
  on public.orders (user_id, idempotency_key)
  where idempotency_key is not null;

-- Postgres identifies a function by its argument types, so a new parameter needs drop + create (create or replace
-- would leave the old seven-argument overload behind, with its grants).
drop function public.place_order(uuid, uuid, text, public.payment_status, jsonb, text, text);

create function public.place_order(
  p_user_id uuid,
  p_store_id uuid,
  p_customer_name text,
  p_payment_status public.payment_status,
  p_lines jsonb,
  p_customer_phone text default null,
  p_note text default null,
  p_idempotency_key uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_line record;
  v_left integer;
begin
  if p_idempotency_key is not null then
    -- Two requests with the same key at the same time queue here; the second then finds the first's committed row.
    -- The unique index above is the backstop if this lock is ever bypassed.
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
    user_id, store_id, customer_name, customer_phone, note, total, payment_status, status, estimated_ready_at,
    idempotency_key
  )
  values (
    p_user_id,
    p_store_id,
    p_customer_name,
    p_customer_phone,
    p_note,
    (select sum(unit_price * quantity) from jsonb_to_recordset(p_lines) as l(unit_price integer, quantity integer)),
    p_payment_status,
    'PLACED',
    now() + make_interval(mins => (select prep_time_max_minutes from public.stores where id = p_store_id)),
    p_idempotency_key
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, line_number, menu_item_id, name, unit_price, quantity, line_total)
  select v_order_id, l.line_number, l.menu_item_id, l.name, l.unit_price, l.quantity, l.unit_price * l.quantity
  from rows from (
    jsonb_to_recordset(p_lines) as (menu_item_id uuid, name text, unit_price integer, quantity integer)
  ) with ordinality as l(menu_item_id, name, unit_price, quantity, line_number);

  return v_order_id;
end;
$$;

-- The drop took the old signature's grants with it; the new one is closed to everyone but the API, like before.
revoke execute on function
  public.place_order(uuid, uuid, text, public.payment_status, jsonb, text, text, uuid)
from public, anon, authenticated;

grant execute on function
  public.place_order(uuid, uuid, text, public.payment_status, jsonb, text, text, uuid)
to service_role;
