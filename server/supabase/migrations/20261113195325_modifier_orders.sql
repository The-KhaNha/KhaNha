-- P3.2 PR 13b: an order's lines priced with their modifiers, in the order's transaction. place_order gains
-- p_modifiers_enabled (the store's evaluated `modifiers` flag, false by default, so the deployed API keeps its exact
-- behaviour); a line may carry modifier_option_ids. The signature changes, so the old function is dropped first: a
-- second overload would make every named call ambiguous.

-- The snapshots' order on their line: the item's group order, then the option's, as price_order_line applied them.
alter table public.order_item_modifiers add column position integer not null default 0;

-- One order line's price with its modifiers: domain/pricing.ts priceLine, in the order's transaction (the truth). The
-- same rules, checked in the same order, with the same refusals (test/setup/modifierCases.ts holds both to them):
--   flag off: the item's price; any option is MODIFIER_INVALID;
--   an option twice, or one that is not in a live group of the item (live itself), is MODIFIER_INVALID;
--   an unavailable option is MODIFIER_INVALID naming its group;
--   per group, in the item's order: nothing chosen in a required group takes its available defaults (at most
--   max_select); more than max_select is MODIFIER_INVALID, fewer than min_select MODIFIER_REQUIRED, naming the group;
--   a unit price below zero is MODIFIER_INVALID.
-- Returns { unit, applied: [{ option_id, group_name, option_name, price_delta_paise }] }.
create function public.price_order_line(
  p_store_id uuid,
  p_menu_item_id uuid,
  p_item_name text,
  p_base_paise bigint,
  p_option_ids uuid[],
  p_enabled boolean
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_ids uuid[] := coalesce(p_option_ids, '{}');
  v_group record;
  v_picked jsonb;
  v_count integer;
  v_applied jsonb := '[]';
  v_unit bigint := p_base_paise;
  v_bad text;
begin
  if not p_enabled then
    if cardinality(v_ids) > 0 then
      raise exception using message = 'MODIFIER_INVALID',
        detail = jsonb_build_object('menuItemId', p_menu_item_id, 'name', p_item_name)::text;
    end if;
    return jsonb_build_object('unit', p_base_paise, 'applied', '[]'::jsonb);
  end if;

  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) as x)
     or exists (
       select 1 from unnest(v_ids) as c(id)
        where not exists (
          select 1
            from public.menu_item_modifier_groups l
            join public.modifier_groups g on g.id = l.group_id
            join public.modifier_options o on o.group_id = g.id
           where l.menu_item_id = p_menu_item_id and g.store_id = p_store_id
             and g.archived_at is null and o.archived_at is null and o.id = c.id
        )
     ) then
    raise exception using message = 'MODIFIER_INVALID',
      detail = jsonb_build_object('menuItemId', p_menu_item_id, 'name', p_item_name)::text;
  end if;

  select g.name into v_bad
    from public.modifier_options o
    join public.modifier_groups g on g.id = o.group_id
   where o.id = any (v_ids) and not o.is_available
   order by array_position(v_ids, o.id)
   limit 1;
  if found then
    raise exception using message = 'MODIFIER_INVALID',
      detail = jsonb_build_object('menuItemId', p_menu_item_id, 'name', p_item_name, 'group', v_bad)::text;
  end if;

  for v_group in
    select g.id, g.name, g.min_select, g.max_select
      from public.menu_item_modifier_groups l
      join public.modifier_groups g on g.id = l.group_id
     where l.menu_item_id = p_menu_item_id and g.store_id = p_store_id and g.archived_at is null
     order by l.sort_order, g.sort_order, g.id
  loop
    select coalesce(jsonb_agg(jsonb_build_object(
             'option_id', o.id, 'group_name', v_group.name, 'option_name', o.name,
             'price_delta_paise', o.price_delta_paise) order by o.sort_order, o.id), '[]'),
           count(*)
      into v_picked, v_count
      from public.modifier_options o
     where o.group_id = v_group.id and o.archived_at is null and o.id = any (v_ids);
    if v_count = 0 and v_group.min_select > 0 then
      select coalesce(jsonb_agg(jsonb_build_object(
               'option_id', d.id, 'group_name', v_group.name, 'option_name', d.name,
               'price_delta_paise', d.price_delta_paise) order by d.sort_order, d.id), '[]'),
             count(*)
        into v_picked, v_count
        from (
          select o.id, o.name, o.price_delta_paise, o.sort_order
            from public.modifier_options o
           where o.group_id = v_group.id and o.archived_at is null and o.is_default and o.is_available
           order by o.sort_order, o.id
           limit v_group.max_select
        ) d;
    end if;
    if v_count > v_group.max_select then
      raise exception using message = 'MODIFIER_INVALID',
        detail = jsonb_build_object('menuItemId', p_menu_item_id, 'name', p_item_name, 'group', v_group.name)::text;
    end if;
    if v_count < v_group.min_select then
      raise exception using message = 'MODIFIER_REQUIRED',
        detail = jsonb_build_object('menuItemId', p_menu_item_id, 'name', p_item_name, 'group', v_group.name)::text;
    end if;
    v_applied := v_applied || v_picked;
    v_unit := v_unit + coalesce((select sum((m ->> 'price_delta_paise')::bigint) from jsonb_array_elements(v_picked) m), 0);
  end loop;

  if v_unit < 0 then
    raise exception using message = 'MODIFIER_INVALID',
      detail = jsonb_build_object('menuItemId', p_menu_item_id, 'name', p_item_name)::text;
  end if;
  return jsonb_build_object('unit', v_unit, 'applied', v_applied);
end;
$$;

revoke execute on function public.price_order_line(uuid, uuid, text, bigint, uuid[], boolean)
  from public, anon, authenticated;
grant execute on function public.price_order_line(uuid, uuid, text, bigint, uuid[], boolean) to service_role;

drop function public.place_order(uuid, uuid, text, public.payment_status, jsonb, text, text, uuid, jsonb, text);

-- place_order, from its last body (20261112130000_store_pause.sql): each line's unit price is now
-- price_order_line's (the item and its chosen or default modifiers), compared with the price the request charged
-- (PRICE_CHANGED), and stored with base_unit_price_paise and the order_item_modifiers snapshots. Stock is still taken
-- per menu item, across all its lines.
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
  p_request_id text default null,
  p_modifiers_enabled boolean default false
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
  -- keying by item when two lines name the same one (the same item with different options, P3.2).
  v_reserved bigint[] := '{}';
  -- Units this order has taken so far, by item: a refused later line of the same item reports the item's real stock,
  -- not what the earlier lines left (all of it rolls back).
  v_taken jsonb := '{}';
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
      v_taken := v_taken || jsonb_build_object(
        v_line.menu_item_id::text,
        coalesce((v_taken ->> v_line.menu_item_id::text)::integer, 0) + v_line.quantity
      );
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
          detail = jsonb_build_object(
            'menuItemId', v_line.menu_item_id, 'name', v_line.name,
            'available', coalesce(v_left, 0) + coalesce((v_taken ->> v_line.menu_item_id::text)::integer, 0)
          )::text;
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
           'unit_price_paise', (p.priced ->> 'unit')::bigint,
           'base_unit_price_paise', m.price_paise,
           'applied', p.priced -> 'applied',
           'is_available', m.is_available,
           'expected_paise', l.unit_price_paise,
           'image_url', m.image_url,
           'category', m.category,
           'reserved_quantity', case when l.line_number = any (v_reserved) then l.quantity else 0 end
         )),
         sum((p.priced ->> 'unit')::bigint * l.quantity)
    into v_priced, v_total_paise
    from rows from (
      jsonb_to_recordset(p_lines) as (
        menu_item_id uuid, quantity integer, unit_price_paise bigint, modifier_option_ids uuid[]
      )
    ) with ordinality as l(menu_item_id, quantity, unit_price_paise, modifier_option_ids, line_number)
    join public.menu_items m on m.id = l.menu_item_id and m.store_id = p_store_id
    -- The line's price with its modifiers (P3.2), from the same read of the item; raises MODIFIER_REQUIRED or
    -- MODIFIER_INVALID for a line its rules refuse, which rolls the stock above back.
    cross join lateral (
      select public.price_order_line(
        p_store_id, m.id, m.name, m.price_paise, l.modifier_option_ids, p_modifiers_enabled
      ) as priced
    ) p;

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
    order_id, line_number, menu_item_id, name, unit_price_paise, base_unit_price_paise, quantity, line_total_paise,
    image_url, category, reserved_quantity
  )
  select v_order_id, l.line_number, l.menu_item_id, l.name, l.unit_price_paise, l.base_unit_price_paise, l.quantity,
         l.unit_price_paise * l.quantity, l.image_url, l.category, l.reserved_quantity
  from jsonb_to_recordset(v_priced) as l(
    line_number integer, menu_item_id uuid, name text, quantity integer, unit_price_paise bigint,
    base_unit_price_paise bigint, image_url text, category text, reserved_quantity integer
  );

  -- What each line was made with, as it is now: a later rename or delete of an option leaves these as they were.
  insert into public.order_item_modifiers (
    order_item_id, modifier_option_id, group_name, option_name, price_delta_paise, position
  )
  select oi.id, (a.value ->> 'option_id')::uuid, a.value ->> 'group_name', a.value ->> 'option_name',
         (a.value ->> 'price_delta_paise')::bigint, a.n
    from jsonb_to_recordset(v_priced) as l(line_number integer, applied jsonb)
    join public.order_items oi on oi.order_id = v_order_id and oi.line_number = l.line_number
    cross join lateral jsonb_array_elements(l.applied) with ordinality as a(value, n);

  -- Ids and statuses only: an event never carries an amount or personal data.
  perform public.emit_event(
    'order.placed', 'order', v_order_id, p_store_id,
    jsonb_build_object('orderNumber', v_order_number),
    p_actor, p_request_id
  );

  return v_order_id;
end;
$$;

revoke execute on function
  public.place_order(uuid, uuid, text, public.payment_status, jsonb, text, text, uuid, jsonb, text, boolean)
  from public, anon, authenticated;
grant execute on function
  public.place_order(uuid, uuid, text, public.payment_status, jsonb, text, text, uuid, jsonb, text, boolean)
  to service_role;
