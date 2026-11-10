-- Money in paise: contract (P1 PR 16, ADR-004 as amended). PR 09 added the paise columns beside the whole-rupee ones
-- and kept writing both; every reader now uses the paise columns, so the rupee columns go. The API's rupee fields are
-- computed from paise (server/src/utils/money.ts), and the paise columns keep their whole-rupee checks until a paise
-- API field replaces each rupee field.

-- PR 09's audit trigger watched both price columns; only price_paise is left. Its watched columns are trigger
-- arguments, so it is dropped and created again.
drop trigger menu_items_audit on public.menu_items;
create trigger menu_items_audit
  after update of name, price_paise, is_available, image_url, category on public.menu_items
  for each row execute function public.audit_row_change(
    'menu_item.changed', 'name', 'price_paise', 'is_available', 'image_url', 'category'
  );

-- PR 09's trigger kept price and price_paise in step; it names the column, so it goes first.
drop trigger menu_items_sync_price on public.menu_items;
drop function public.menu_items_sync_price();

-- The last migration's body and signature (so the grants stay), without the rupee writes.
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

alter table public.menu_items drop column price;
alter table public.orders drop column total;
alter table public.order_items
  drop column unit_price,
  drop column line_total;
