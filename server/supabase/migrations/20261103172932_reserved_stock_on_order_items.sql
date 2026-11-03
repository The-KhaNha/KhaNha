-- A cancelled order gave back stock for every line whose item was stock-tracked at cancel time, whether or not the
-- order had taken any: an item ordered untracked and tracked later (marked sold out, say) gained stock it never lost.
-- Each line now records what place_order reserved for it, and a cancel returns exactly that.

-- All or nothing per line: place_order takes a line's whole quantity or none of it.
alter table public.order_items
  add column reserved_quantity integer not null default 0,
  add constraint order_items_reserved_quantity_check check (reserved_quantity in (0, quantity));

-- Orders still open before this migration took their stock under the old rule, so a cancel keeps returning it (as
-- before). Collected orders cannot be cancelled, and cancelled ones were already returned: 0.
update public.order_items oi
   set reserved_quantity = oi.quantity
  from public.orders o
 where o.id = oi.order_id
   and o.status in ('PLACED', 'PREPARING', 'READY');

-- PR 09's body and signature (so the grants stay), recording each line's reservation.
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
  v_priced jsonb;
  v_total_paise bigint;
  v_changed record;
  -- Lines whose stock this order took, by line number: decided in the stock loop, where tracked rows are locked.
  -- Reading stock_quantity again later would count an item tracked between the two reads as reserved, and so would
  -- keying by item when two lines name the same one (only a direct call; the API merges them).
  v_reserved bigint[] := '{}';
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
    select *
      from rows from (
        jsonb_to_recordset(p_lines) as (menu_item_id uuid, name text, quantity integer)
      ) with ordinality as l(menu_item_id, name, quantity, line_number)
     order by menu_item_id
  loop
    update public.menu_items
       set stock_quantity = stock_quantity - v_line.quantity
     where id = v_line.menu_item_id
       and stock_quantity >= v_line.quantity;

    if found then
      v_reserved := v_reserved || v_line.line_number;
    else
      select stock_quantity into v_left from public.menu_items where id = v_line.menu_item_id;
      -- Found with a null stock: the item is not stock-tracked, so there is nothing to reserve.
      if not found or v_left is not null then
        raise exception using
          message = 'INSUFFICIENT_STOCK',
          detail = jsonb_build_object('menuItemId', v_line.menu_item_id, 'name', v_line.name, 'available', coalesce(v_left, 0))::text;
      end if;
    end if;
  end loop;

  -- One read of menu_items for every line: the total and the lines are priced from the same row versions, even if a
  -- price changes while this order is placed (items without a stock count were not locked by the loop above). The loop
  -- raised for any item that does not exist, so the join keeps every line. The name, photo and category come from the
  -- same read; p_lines' name is only for the stock error above.
  select jsonb_agg(jsonb_build_object(
           'line_number', l.line_number,
           'menu_item_id', m.id,
           'name', m.name,
           'quantity', l.quantity,
           'unit_price_paise', m.price_paise,
           'expected_paise', l.unit_price_paise,
           'image_url', m.image_url,
           'category', m.category,
           'reserved_quantity', case when l.line_number = any (v_reserved) then l.quantity else 0 end
         )),
         sum(m.price_paise * l.quantity)
    into v_priced, v_total_paise
    from rows from (
      jsonb_to_recordset(p_lines) as (menu_item_id uuid, quantity integer, unit_price_paise bigint)
    ) with ordinality as l(menu_item_id, quantity, unit_price_paise, line_number)
    join public.menu_items m on m.id = l.menu_item_id;

  -- Checked against that same read, so the price compared is the price stored. Raising rolls back the stock above.
  select l.menu_item_id, l.name, l.unit_price_paise
    into v_changed
    from jsonb_to_recordset(v_priced) as l(
      line_number bigint, menu_item_id uuid, name text, unit_price_paise bigint, expected_paise bigint
    )
   where l.expected_paise <> l.unit_price_paise
   order by l.line_number
   limit 1;
  if found then
    raise exception using
      message = 'PRICE_CHANGED',
      detail = jsonb_build_object('menuItemId', v_changed.menu_item_id, 'name', v_changed.name, 'price', v_changed.unit_price_paise / 100)::text;
  end if;

  insert into public.orders (
    user_id, store_id, store_name, customer_name, customer_phone, note, total_paise, total, payment_status, status,
    estimated_ready_at, idempotency_key
  )
  values (
    p_user_id,
    p_store_id,
    (select name from public.stores where id = p_store_id),
    p_customer_name,
    p_customer_phone,
    p_note,
    v_total_paise,
    v_total_paise / 100,
    p_payment_status,
    'PLACED',
    now() + make_interval(mins => (select prep_time_max_minutes from public.stores where id = p_store_id)),
    p_idempotency_key
  )
  returning id, order_number into v_order_id, v_order_number;

  insert into public.order_items (
    order_id, line_number, menu_item_id, name, unit_price_paise, unit_price, quantity, line_total_paise, line_total,
    image_url, category, reserved_quantity
  )
  select v_order_id, l.line_number, l.menu_item_id, l.name, l.unit_price_paise, l.unit_price_paise / 100, l.quantity,
         l.unit_price_paise * l.quantity, l.unit_price_paise * l.quantity / 100, l.image_url, l.category,
         l.reserved_quantity
  from jsonb_to_recordset(v_priced) as l(
    line_number integer, menu_item_id uuid, name text, quantity integer, unit_price_paise bigint, image_url text,
    category text, reserved_quantity integer
  );

  -- Ids and statuses only: an event never carries an amount or personal data.
  perform public.emit_event(
    'order.placed', 'order', v_order_id, p_store_id,
    jsonb_build_object('orderNumber', v_order_number),
    p_actor, p_request_id
  );

  return v_order_id;
end;
$$;

-- PR 05's body and signature, returning only what each line reserved.
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
  public.place_order(uuid, uuid, text, public.payment_status, jsonb, text, text, uuid, jsonb, text),
  public.update_order_status(uuid, public.order_status, public.order_status[], jsonb, text)
from public, anon, authenticated;

grant execute on function
  public.place_order(uuid, uuid, text, public.payment_status, jsonb, text, text, uuid, jsonb, text),
  public.update_order_status(uuid, public.order_status, public.order_status[], jsonb, text)
to service_role;
