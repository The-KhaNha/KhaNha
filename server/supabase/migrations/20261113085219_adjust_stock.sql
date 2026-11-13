-- P3.4, P3.5 (PR 04): stock is changed by hand through one function, which keeps a trail of who changed it, when, by
-- how much and why. Sales and cancels stay out of the trail (D3): order_items.reserved_quantity already records them.
create type public.stock_reason as enum ('MANUAL_SET', 'MANUAL_ADJUST', 'WASTE');

create table public.stock_movements (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores (id),
  menu_item_id uuid not null references public.menu_items (id),
  -- The change in units; null when tracking starts or stops (one side has no number).
  delta integer,
  -- The stock after the change; null: no longer tracked.
  resulting_quantity integer,
  reason public.stock_reason not null,
  actor_id uuid references public.profiles (id) on delete set null,
  -- When the row is written, not when the transaction began: a change that waited on the item lock sorts after the
  -- one it waited for.
  created_at timestamptz not null default clock_timestamp()
);
create index stock_movements_item_time_idx on public.stock_movements (menu_item_id, created_at desc);
create index stock_movements_store_time_idx on public.stock_movements (store_id, created_at desc);

alter table public.stock_movements enable row level security;
revoke all on public.stock_movements from anon, authenticated;

-- Whether STAFF may change stock at this store (roadmap decision 16). A new branch starts on the default; the
-- template's value is not copied.
alter table public.stores add column staff_can_edit_stock boolean not null default true;

drop trigger stores_settings_audit on public.stores;
create trigger stores_settings_audit
  after update of max_quantity_per_item, low_stock_threshold, staff_order_list_limit, last_order_minutes_before_close,
    staff_can_edit_stock
  on public.stores
  for each row execute function public.audit_row_change(
    'store_settings.changed', 'max_quantity_per_item', 'low_stock_threshold', 'staff_order_list_limit',
    'last_order_minutes_before_close', 'staff_can_edit_stock'
  );

-- Exactly one of: p_set (N available now), p_delta (±n), p_untracked (stop counting). The item's row is locked first,
-- so this and place_order's conditional update queue on it and stock never goes below zero (INSUFFICIENT_STOCK). A
-- change that leaves the stock as it was writes no movement and emits nothing, and an adjustment never takes stock
-- above the most a set may (STOCK_TOO_HIGH). Returns the stock after the call (null: untracked). The reason defaults
-- from the kind of change; WASTE is a negative adjustment.
create function public.adjust_stock(
  p_store_id uuid,
  p_menu_item_id uuid,
  p_set integer default null,
  p_delta integer default null,
  p_untracked boolean default false,
  p_reason public.stock_reason default null,
  p_actor jsonb default null,
  p_request_id text default null
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_item record;
  v_new integer;
  v_reason public.stock_reason :=
    coalesce(p_reason, case when p_delta is null then 'MANUAL_SET' else 'MANUAL_ADJUST' end::public.stock_reason);
begin
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);

  if num_nonnulls(p_set, p_delta, nullif(coalesce(p_untracked, false), false)) <> 1
     or p_set < 0 or p_delta = 0
     or not ((p_delta is null and v_reason = 'MANUAL_SET')
             or (p_delta is not null and (v_reason = 'MANUAL_ADJUST' or (v_reason = 'WASTE' and p_delta < 0)))) then
    raise exception using message = 'VALIDATION_ERROR';
  end if;

  select id, name, stock_quantity into v_item
    from public.menu_items
   where id = p_menu_item_id and store_id = p_store_id and archived_at is null
     for update;
  if not found then
    raise exception using message = 'NOT_FOUND';
  end if;

  if p_delta is not null then
    if v_item.stock_quantity is null then
      raise exception using message = 'STOCK_UNTRACKED';
    end if;
    if v_item.stock_quantity + p_delta < 0 then
      raise exception using
        message = 'INSUFFICIENT_STOCK',
        detail = jsonb_build_object('menuItemId', v_item.id, 'name', v_item.name, 'available', v_item.stock_quantity)::text;
    end if;
    -- LIMITS.menuItem.stockMax, the most a set or a new item may start with (test/api/stock.test.ts).
    if v_item.stock_quantity + p_delta > 100000 then
      raise exception using message = 'STOCK_TOO_HIGH';
    end if;
    v_new := v_item.stock_quantity + p_delta;
  else
    v_new := p_set; -- null when p_untracked
  end if;

  if v_new is not distinct from v_item.stock_quantity then
    return v_new;
  end if;

  update public.menu_items set stock_quantity = v_new where id = v_item.id;
  insert into public.stock_movements (store_id, menu_item_id, delta, resulting_quantity, reason, actor_id)
  values (p_store_id, v_item.id, v_new - v_item.stock_quantity, v_new, v_reason, (p_actor ->> 'id')::uuid);
  perform public.emit_event(
    'menu.changed', 'store', p_store_id, p_store_id, jsonb_build_object('itemIds', jsonb_build_array(v_item.id)),
    p_actor, p_request_id
  );
  return v_new;
end;
$$;

revoke execute on function public.adjust_stock(uuid, uuid, integer, integer, boolean, public.stock_reason, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.adjust_stock(uuid, uuid, integer, integer, boolean, public.stock_reason, jsonb, text)
  to service_role;
