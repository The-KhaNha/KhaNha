-- P2.5 (PR 08): pausing a store. A pause stops new orders until `paused_until`, or until someone resumes when it is
-- null; it is derived, so nothing has to lift it (a sweep that emits store.resumed comes with its first consumer).
alter table public.stores
  add column accepting_orders boolean not null default true,
  add column paused_until timestamptz,
  add column pause_reason text check (char_length(pause_reason) <= 120),
  add column paused_by uuid references public.profiles (id) on delete set null;
create index stores_paused_by_idx on public.stores (paused_by);

-- stores_audit also watches the pause.
drop trigger stores_audit on public.stores;
create trigger stores_audit
  after update of name, slug, status, is_open, area, address_line, contact_phone, timezone, accepting_orders,
    paused_until, pause_reason on public.stores
  for each row execute function public.audit_row_change(
    'store.changed', 'name', 'slug', 'status', 'is_open', 'area', 'address_line', 'contact_phone', 'timezone',
    'accepting_orders', 'paused_until', 'pause_reason'
  );

-- Pauses `p_store_id` until `p_until` (null: until resumed). A repeat of the same pause changes nothing and emits
-- nothing; a new end or reason is a change. Returns whether it changed.
create function public.pause_store(
  p_store_id uuid,
  p_until timestamptz default null,
  p_reason text default null,
  p_actor jsonb default null,
  p_request_id text default null,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_store record;
begin
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);
  if p_until is not null and p_until <= p_now then
    raise exception using message = 'VALIDATION_ERROR';
  end if;

  select accepting_orders, paused_until, pause_reason into v_store
    from public.stores where id = p_store_id for update;
  if not found then
    raise exception using message = 'NOT_FOUND';
  end if;
  if not v_store.accepting_orders
     and v_store.paused_until is not distinct from p_until
     and v_store.pause_reason is not distinct from p_reason then
    return false;
  end if;

  update public.stores
     set accepting_orders = false, paused_until = p_until, pause_reason = p_reason,
         paused_by = (p_actor ->> 'id')::uuid
   where id = p_store_id;
  -- Ids and times only: the reason is free text and stays out of the event.
  perform public.emit_event(
    'store.paused', 'store', p_store_id, p_store_id,
    jsonb_build_object('pausedUntil', p_until), p_actor, p_request_id
  );
  return true;
end;
$$;

-- Lifts a pause. A store that is not paused at `p_now` (never paused, resumed, or its pause ran out) changes nothing
-- and emits nothing, apart from clearing a pause that ran out.
create function public.resume_store(
  p_store_id uuid,
  p_actor jsonb default null,
  p_request_id text default null,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_store record;
begin
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);

  select accepting_orders, paused_until into v_store
    from public.stores where id = p_store_id for update;
  if not found then
    raise exception using message = 'NOT_FOUND';
  end if;
  if v_store.accepting_orders then
    return false;
  end if;

  update public.stores
     set accepting_orders = true, paused_until = null, pause_reason = null, paused_by = null
   where id = p_store_id;
  if v_store.paused_until is not null and v_store.paused_until <= p_now then
    return false;
  end if;
  perform public.emit_event('store.resumed', 'store', p_store_id, p_store_id, '{}'::jsonb, p_actor, p_request_id);
  return true;
end;
$$;

revoke execute on function
  public.pause_store(uuid, timestamptz, text, jsonb, text, timestamptz),
  public.resume_store(uuid, jsonb, text, timestamptz)
from public, anon, authenticated;
grant execute on function
  public.pause_store(uuid, timestamptz, text, jsonb, text, timestamptz),
  public.resume_store(uuid, jsonb, text, timestamptz)
to service_role;

-- place_order, from its last body (20261109122051_order_integrity.sql) with the same signature, so its grants stay:
-- a store that stopped trading is NOT_FOUND and a paused one STORE_PAUSED, under the same store lock as the closed
-- check; and every menu_items read and write is limited to the order's store, so the database itself refuses another
-- store's item (it reads as not found: INSUFFICIENT_STOCK with nothing available).
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
  v_available boolean;
  v_priced jsonb;
  v_total_paise bigint;
  v_changed record;
  v_store record;
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

  -- The API refused a closed, paused or suspended store before charging, but any of them can change in between. Read
  -- under a share lock, so a pause, a close or a suspension waits for this order (placed while the store took orders)
  -- or this order sees it. A store that stopped trading answers as an unknown one; a pause names when it ends.
  select status, is_open, accepting_orders, paused_until
    into v_store
    from public.stores where id = p_store_id for share;
  if not found or v_store.status <> 'ACTIVE' then
    raise exception using message = 'NOT_FOUND';
  end if;
  if not v_store.accepting_orders and (v_store.paused_until is null or v_store.paused_until > now()) then
    raise exception using
      message = 'STORE_PAUSED',
      detail = jsonb_build_object('storeId', p_store_id, 'pausedUntil', v_store.paused_until)::text;
  end if;
  if not v_store.is_open then
    raise exception using message = 'STORE_CLOSED', detail = jsonb_build_object('storeId', p_store_id)::text;
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
       and store_id = p_store_id
       and stock_quantity >= v_line.quantity;

    if found then
      v_reserved := v_reserved || v_line.line_number;
    else
      select stock_quantity, is_available into v_left, v_available
        from public.menu_items
       where id = v_line.menu_item_id and store_id = p_store_id;
      -- Switched off is reported before too little stock, the same order as the API's checks.
      if found and not v_available then
        raise exception using
          message = 'ITEM_UNAVAILABLE',
          detail = jsonb_build_object('menuItemId', v_line.menu_item_id, 'name', v_line.name, 'available', 0)::text;
      end if;
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
           'is_available', m.is_available,
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
    join public.menu_items m on m.id = l.menu_item_id and m.store_id = p_store_id;

  -- An item switched off after the API's check (the same read as the price): nothing is placed and the stock above
  -- rolls back.
  select l.menu_item_id, l.name
    into v_changed
    from jsonb_to_recordset(v_priced) as l(line_number bigint, menu_item_id uuid, name text, is_available boolean)
   where not l.is_available
   order by l.line_number
   limit 1;
  if found then
    raise exception using
      message = 'ITEM_UNAVAILABLE',
      detail = jsonb_build_object('menuItemId', v_changed.menu_item_id, 'name', v_changed.name, 'available', 0)::text;
  end if;

  -- Checked against that same read, so the price compared is the price stored. Raising rolls back the stock above.
  -- A line without unit_price_paise is refused too: PR 09 skipped the check for the pre-paise API, which no longer runs.
  select l.menu_item_id, l.name, l.unit_price_paise
    into v_changed
    from jsonb_to_recordset(v_priced) as l(
      line_number bigint, menu_item_id uuid, name text, unit_price_paise bigint, expected_paise bigint
    )
   where l.expected_paise is distinct from l.unit_price_paise
   order by l.line_number
   limit 1;
  if found then
    raise exception using
      message = 'PRICE_CHANGED',
      detail = jsonb_build_object('menuItemId', v_changed.menu_item_id, 'name', v_changed.name, 'price', v_changed.unit_price_paise / 100)::text;
  end if;

  insert into public.orders (
    user_id, store_id, store_name, customer_name, customer_phone, note, total_paise, payment_status, status,
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
    p_payment_status,
    'PLACED',
    now() + make_interval(mins => (select prep_time_max_minutes from public.stores where id = p_store_id)),
    p_idempotency_key
  )
  returning id, order_number into v_order_id, v_order_number;

  insert into public.order_items (
    order_id, line_number, menu_item_id, name, unit_price_paise, quantity, line_total_paise, image_url, category,
    reserved_quantity
  )
  select v_order_id, l.line_number, l.menu_item_id, l.name, l.unit_price_paise, l.quantity,
         l.unit_price_paise * l.quantity, l.image_url, l.category, l.reserved_quantity
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
