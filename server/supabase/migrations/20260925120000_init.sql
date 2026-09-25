-- Food Pickup V0 — intentionally small schema (5 tables).
-- Prices are whole rupees stored as integers. What the customer sees is what they pay.
--
-- Access model: the web app talks to Supabase only to sign in. Every row is read and written by the Express API
-- with the secret key (service_role, which bypasses RLS). RLS is enabled on every table with NO policies, and the
-- anon/authenticated roles hold no privileges, so the publishable key shipped in the browser cannot touch any row.

create type public.user_role as enum ('CUSTOMER', 'STAFF');
create type public.order_status as enum ('PLACED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED');
create type public.payment_status as enum ('PENDING', 'PAID');

-- ---------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------

-- One row per Supabase Auth user, created by the on_auth_user_created trigger below.
-- The role lives here and nowhere else: user_metadata is editable by the user, so it must never grant STAFF.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  email text not null unique,
  phone text,
  role public.user_role not null default 'CUSTOMER',
  created_at timestamptz not null default now()
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tagline text not null, -- e.g. "Coffee • Snacks • Quick Bites"
  description text not null, -- e.g. "Quick bites, coffee and snacks."
  image_url text,
  is_open boolean not null default true,
  prep_time_min_minutes integer not null default 10,
  prep_time_max_minutes integer not null default 15 -- used for estimated_ready_at
);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id),
  category text not null, -- "Coffee", "Snacks", "Juices", "Desserts"
  name text not null,
  description text not null,
  price integer not null check (price >= 0), -- whole rupees
  image_url text not null,
  is_available boolean not null default true,
  is_popular boolean not null default false,
  sort_order integer not null default 0,
  -- Units left; null = not tracked (unlimited). Decremented per order, restored on CANCELLED.
  stock_quantity integer check (stock_quantity >= 0)
);

create index menu_items_store_id_category_idx on public.menu_items (store_id, category);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number integer generated always as identity (start with 1001) unique, -- human-readable, e.g. #1042
  user_id uuid not null references public.profiles (id),
  store_id uuid not null references public.stores (id),
  customer_name text not null,
  customer_phone text,
  note text,
  total integer not null, -- whole rupees, computed on the server only
  payment_status public.payment_status not null default 'PENDING',
  status public.order_status not null default 'PLACED',
  estimated_ready_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now() -- maintained by orders_set_updated_at
);

create index orders_user_id_created_at_idx on public.orders (user_id, created_at);
create index orders_status_created_at_idx on public.orders (status, created_at);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  line_number integer not null, -- position in the cart, so an order lists its lines in the order they were added
  menu_item_id uuid not null references public.menu_items (id),
  name text not null, -- snapshot at order time
  unit_price integer not null, -- snapshot at order time, whole rupees
  quantity integer not null check (quantity > 0),
  line_total integer not null, -- unit_price * quantity
  unique (order_id, line_number)
);

create index order_items_menu_item_id_idx on public.order_items (menu_item_id);

-- ---------------------------------------------------------------------------------------------------------------
-- Lock the tables away from the browser
-- ---------------------------------------------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.menu_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

revoke all on table public.profiles, public.stores, public.menu_items, public.orders, public.order_items
  from anon, authenticated;

-- Tables and functions added by later migrations start out closed as well; grant explicitly if one must be public.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- Every new Auth user gets a CUSTOMER profile. Name and phone come from the metadata the API passes to
-- auth.admin.createUser; a user created elsewhere (e.g. the dashboard) falls back to the email's local part.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name, phone)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------------------------------------------------
-- Functions the API calls. Each call is one transaction, so a function that raises leaves nothing behind.
-- Errors are raised with message = the API error code and detail = a JSON object; order.service maps them.
-- ---------------------------------------------------------------------------------------------------------------

-- Writes one order and reserves its stock. The API has already checked every line and priced it from the database
-- (never from the request); p_lines is [{ menu_item_id, name, unit_price, quantity }] in cart order.
--
-- Stock is taken with a conditional decrement (stock_quantity >= quantity), so two customers can never both get
-- the last unit. Lines are reserved in menu_item_id order so concurrent orders lock rows in the same order.
create function public.place_order(
  p_user_id uuid,
  p_store_id uuid,
  p_customer_name text,
  p_payment_status public.payment_status,
  p_lines jsonb,
  p_customer_phone text default null,
  p_note text default null
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
    user_id, store_id, customer_name, customer_phone, note, total, payment_status, status, estimated_ready_at
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
    now() + make_interval(mins => (select prep_time_max_minutes from public.stores where id = p_store_id))
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

-- One conditional update, so two staff devices cannot overwrite each other: the row only changes if its status is
-- still one of p_from_statuses (the API's ALLOWED_TRANSITIONS decides which). Cancelling also puts the order's items
-- back in stock; the conditional update succeeds exactly once per order, so stock is restored exactly once.
create function public.update_order_status(
  p_order_id uuid,
  p_next_status public.order_status,
  p_from_statuses public.order_status[]
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_current record;
begin
  update public.orders
     set status = p_next_status
   where id = p_order_id
     and status = any (p_from_statuses);

  if not found then
    select status, order_number into v_current from public.orders where id = p_order_id;
    if not found then
      raise exception using message = 'NOT_FOUND';
    end if;
    raise exception using
      message = 'INVALID_STATUS_TRANSITION',
      detail = jsonb_build_object('orderNumber', v_current.order_number, 'status', v_current.status)::text;
  end if;

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
end;
$$;

-- Demo data reset used by `npm run seed` (which refuses to run against production):
-- deletes every order and restarts numbering at #1001. Security definer because restarting the identity sequence
-- needs its owner; only service_role may execute it (grants below).
create function public.reset_demo_orders()
returns void
language sql
security definer
set search_path = ''
as $$
  truncate public.order_items, public.orders restart identity;
$$;

revoke execute on function
  public.set_updated_at(),
  public.handle_new_user(),
  public.handle_user_email_change(),
  public.place_order(uuid, uuid, text, public.payment_status, jsonb, text, text),
  public.update_order_status(uuid, public.order_status, public.order_status[]),
  public.reset_demo_orders()
from public, anon, authenticated;

grant execute on function
  public.place_order(uuid, uuid, text, public.payment_status, jsonb, text, text),
  public.update_order_status(uuid, public.order_status, public.order_status[]),
  public.reset_demo_orders()
to service_role;
