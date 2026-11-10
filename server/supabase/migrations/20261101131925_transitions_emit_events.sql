-- Today's transitions emit their domain events and carry who asked (P1 PR 05). Both functions take the actor and the
-- request id, set them for the transaction (the audit trigger in PR 06 reads them) and call emit_event in the same
-- transaction as the change, so a transition that raises leaves no event behind (docs/JOBS.md "The outbox").
--
-- The new parameters default to null: the API already deployed calls these functions by name without them, and keeps
-- working between this migration and the new API (its events carry no actor). Postgres identifies a function by its
-- argument types, so a new parameter needs drop + create, and the grants again.
drop function public.place_order(uuid, uuid, text, public.payment_status, jsonb, text, text, uuid);
drop function public.update_order_status(uuid, public.order_status, public.order_status[]);

create function public.place_order(
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
  returning id, order_number into v_order_id, v_order_number;

  insert into public.order_items (order_id, line_number, menu_item_id, name, unit_price, quantity, line_total)
  select v_order_id, l.line_number, l.menu_item_id, l.name, l.unit_price, l.quantity, l.unit_price * l.quantity
  from rows from (
    jsonb_to_recordset(p_lines) as (menu_item_id uuid, name text, unit_price integer, quantity integer)
  ) with ordinality as l(menu_item_id, name, unit_price, quantity, line_number);

  -- Ids and statuses only: an event never carries an amount or personal data.
  perform public.emit_event(
    'order.placed', 'order', v_order_id, p_store_id,
    jsonb_build_object('orderNumber', v_order_number),
    p_actor, p_request_id
  );

  return v_order_id;
end;
$$;

create function public.update_order_status(
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
    -- Untracked items (stock null) are left alone.
    update public.menu_items m
       set stock_quantity = m.stock_quantity + returned.quantity
      from (
        select menu_item_id, sum(quantity)::integer as quantity
        from public.order_items
        where order_id = p_order_id
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

-- The drop took the old signatures' grants with it; the new ones are closed to everyone but the API, like before.
revoke execute on function
  public.place_order(uuid, uuid, text, public.payment_status, jsonb, text, text, uuid, jsonb, text),
  public.update_order_status(uuid, public.order_status, public.order_status[], jsonb, text)
from public, anon, authenticated;

grant execute on function
  public.place_order(uuid, uuid, text, public.payment_status, jsonb, text, text, uuid, jsonb, text),
  public.update_order_status(uuid, public.order_status, public.order_status[], jsonb, text)
to service_role;
