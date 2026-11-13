-- P3.2 PR 13a: modifiers ("Size", "Milk", "Extra cheese +₹20"). The roadmap's tables, scoped to a store like its menu
-- (a template's groups are copied with its items), with money in paise like every money column since ADR-004. Pricing
-- an order with them is PR 13b (place_order); editing them is PR 14. Behind the `modifiers` flag, off.

create table public.modifier_groups (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id),
  name text not null check (char_length(name) between 1 and 40),
  min_select integer not null default 0 check (min_select between 0 and 20),
  max_select integer not null default 1 check (max_select between 1 and 20),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check (min_select <= max_select)
);
create index modifier_groups_store_idx on public.modifier_groups (store_id);

create table public.modifier_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.modifier_groups (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  -- "Small −₹20" is allowed; the line's price is still never below zero (pricing.ts, place_order).
  price_delta_paise bigint not null default 0
    check (price_delta_paise between -1000000 and 1000000 and price_delta_paise % 100 = 0),
  is_default boolean not null default false,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  archived_at timestamptz
);
create index modifier_options_group_idx on public.modifier_options (group_id);

-- Which groups an item offers, in order. Both sides belong to one store: the editing functions (PR 14) and the copies
-- (13c) only ever link a store's own rows.
create table public.menu_item_modifier_groups (
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  group_id uuid not null references public.modifier_groups (id) on delete cascade,
  sort_order integer not null default 0,
  primary key (menu_item_id, group_id)
);
create index menu_item_modifier_groups_group_idx on public.menu_item_modifier_groups (group_id);

-- What an order line was made with, as it was then (like order_items): a later rename or delete of the option
-- changes nothing here.
create table public.order_item_modifiers (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  modifier_option_id uuid references public.modifier_options (id) on delete set null,
  group_name text not null,
  option_name text not null,
  price_delta_paise bigint not null
);
create index order_item_modifiers_order_item_idx on public.order_item_modifiers (order_item_id);
create index order_item_modifiers_option_idx on public.order_item_modifiers (modifier_option_id);

-- The item's own price on a line with modifiers (unit_price_paise includes them), for receipts. Null on older lines.
alter table public.order_items add column base_unit_price_paise bigint check (base_unit_price_paise >= 0);

alter table public.modifier_groups enable row level security;
alter table public.modifier_options enable row level security;
alter table public.menu_item_modifier_groups enable row level security;
alter table public.order_item_modifiers enable row level security;
revoke all on public.modifier_groups, public.modifier_options, public.menu_item_modifier_groups,
  public.order_item_modifiers from anon, authenticated;

-- A menu's configuration is audited like its items: who changed a price delta or a required choice. An option's
-- audit row has no store of its own (its group's).
create trigger modifier_groups_audit
  after insert or update or delete on public.modifier_groups
  for each row execute function public.audit_row_change(
    'modifier_group.changed', 'name', 'min_select', 'max_select', 'archived_at'
  );
create trigger modifier_options_audit
  after insert or update or delete on public.modifier_options
  for each row execute function public.audit_row_change(
    'modifier_option.changed', 'name', 'price_delta_paise', 'is_default', 'is_available', 'archived_at'
  );
-- The links have no id for an audit row (audit_log.entity_id); the function that sets an item's groups (PR 14) records
-- the change in its menu.changed event instead.

-- The demo reset (the seed) empties orders with their lines; their modifier snapshots must go with them, or the
-- truncate is refused for the foreign key.
create or replace function public.reset_demo_orders()
returns void
language sql
security definer
set search_path = ''
as $$
  truncate public.order_item_modifiers, public.order_items, public.orders restart identity;
$$;

insert into public.feature_flags (key, description, enabled, client_visible)
values ('modifiers', 'Item options (size, milk, add-ons) on the menu and in orders (P3.2).', false, true);
