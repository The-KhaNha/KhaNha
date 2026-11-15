-- Money in paise: expand (P1 PR 09, ADR-004 as amended). Every amount gets a bigint paise column beside today's
-- whole-rupee integer column. The API keeps its rupee fields; server/src/utils/money.ts converts at the serializer.
-- The rupee columns are still written (place_order, the seed) so the API deployed during the migration reads right
-- values, and are dropped by the contract migration (PR 16) once the new API runs everywhere.
--
-- While a rupee API field exists for a column, its paise column refuses anything that is not a whole rupee, so the
-- rupee field can never round. A fractional price first needs a paise API field the client reads.

alter table public.menu_items add column price_paise bigint;
alter table public.orders add column total_paise bigint;
alter table public.order_items
  add column unit_price_paise bigint,
  add column line_total_paise bigint;

-- The audit trigger watches `price` by name, so this update of price_paise alone does not fire it. The orders update
-- would stamp every past order as updated now (OrderDto.updatedAt), so orders_set_updated_at is off for it.
update public.menu_items set price_paise = price * 100;
update public.order_items set unit_price_paise = unit_price * 100, line_total_paise = line_total * 100;
alter table public.orders disable trigger orders_set_updated_at;
update public.orders set total_paise = total * 100;
alter table public.orders enable trigger orders_set_updated_at;

alter table public.menu_items
  alter column price_paise set not null,
  add constraint menu_items_price_paise_check check (price_paise >= 0),
  add constraint menu_items_price_paise_whole_rupees check (price_paise % 100 = 0);
alter table public.orders
  alter column total_paise set not null,
  add constraint orders_total_paise_check check (total_paise >= 0),
  add constraint orders_total_paise_whole_rupees check (total_paise % 100 = 0);
alter table public.order_items
  alter column unit_price_paise set not null,
  alter column line_total_paise set not null,
  add constraint order_items_unit_price_paise_check check (unit_price_paise >= 0),
  add constraint order_items_unit_price_paise_whole_rupees check (unit_price_paise % 100 = 0),
  add constraint order_items_line_total_paise_check check (line_total_paise >= 0),
  add constraint order_items_line_total_paise_whole_rupees check (line_total_paise % 100 = 0);

-- Until PR 16 drops menu_items.price, either price column can be written (the API deployed during the migration, the
-- seed, an operator in Studio). This keeps them in step: when one is written, the other is derived from it; when both
-- change and disagree, the write is refused. A row trigger cannot tell a column set to its old value from one left
-- out, so an update counts a column as written when its value changes. The whole-rupee checks still refuse a
-- price_paise that is not a whole rupee (the derived price is truncated, then the check fires). PR 16 drops this
-- trigger with the rupee column.
create function public.menu_items_sync_price()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.price_paise is null
     or tg_op = 'UPDATE' and new.price_paise is not distinct from old.price_paise then
    new.price_paise := new.price::bigint * 100;
  elsif tg_op = 'INSERT' and new.price is null
     or tg_op = 'UPDATE' and new.price is not distinct from old.price then
    new.price := new.price_paise / 100;
  elsif new.price_paise <> new.price::bigint * 100 then
    raise exception 'menu_items.price (%) and price_paise (%) disagree', new.price, new.price_paise;
  end if;
  return new;
end;
$$;

-- After the backfill, which this trigger would otherwise have to agree with row by row.
create trigger menu_items_sync_price
  before insert or update of price, price_paise on public.menu_items
  for each row execute function public.menu_items_sync_price();

-- Fired by its trigger only: nobody calls it, so nobody is granted it.
revoke execute on function public.menu_items_sync_price() from public, anon, authenticated, service_role;

-- PR 08's body and signature (so the grants stay). Each line is priced here, from menu_items.price_paise, and stored
-- at that price. The API sends the price it charged for each line as unit_price_paise; a line whose price has changed
-- since refuses the whole order (PRICE_CHANGED), so nothing is stored at a price other than the one charged. The API
-- deployed during the migration sends rupees in unit_price and no unit_price_paise: its lines are not checked, as
-- before. The rupee columns are derived from the paise ones (exact: the whole-rupee checks).
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
           'category', m.category
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
    image_url, category
  )
  select v_order_id, l.line_number, l.menu_item_id, l.name, l.unit_price_paise, l.unit_price_paise / 100, l.quantity,
         l.unit_price_paise * l.quantity, l.unit_price_paise * l.quantity / 100, l.image_url, l.category
  from jsonb_to_recordset(v_priced) as l(
    line_number integer, menu_item_id uuid, name text, quantity integer, unit_price_paise bigint, image_url text,
    category text
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

-- The audit trigger watches price_paise as well as price: until PR 16 either can be written, and a price change made
-- through either is audited. Its watched columns are trigger arguments, so it is dropped and created again.
drop trigger menu_items_audit on public.menu_items;
create trigger menu_items_audit
  after update of name, price, price_paise, is_available, image_url, category on public.menu_items
  for each row execute function public.audit_row_change(
    'menu_item.changed', 'name', 'price', 'price_paise', 'is_available', 'image_url', 'category'
  );
