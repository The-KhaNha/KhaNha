-- ADMIN role, COMPLETED -> COLLECTED, and site-wide settings edited from the admin dashboard.

-- ADMIN is the site-wide developer/operator role, not a restaurant role: it grants no staff powers
-- (requireStaff still checks role = 'STAFF'). Nothing below uses the new value, which Postgres only forbids
-- inside the transaction that adds it.
alter type public.user_role add value 'ADMIN';

-- "Collected" is what happens after READY: the customer picked the order up. RENAME VALUE relabels the enum entry
-- in place, so existing orders read COLLECTED with no backfill, and no SQL object names the old literal.
-- Breaking for the API: server and client ship together with the new value.
alter type public.order_status rename value 'COMPLETED' to 'COLLECTED';

-- Site-wide operational limits (they bound order.service.listOrders, which is not scoped to one store).
-- Singleton: id is always true, so the primary key caps the table at one row.
create table public.site_settings (
  id boolean primary key default true check (id),
  customer_order_history_limit integer not null default 20
    check (customer_order_history_limit between 1 and 200),
  staff_order_list_limit integer not null default 100
    check (staff_order_list_limit between 1 and 500),
  updated_at timestamptz not null default now(),
  -- set null, not cascade: profiles cascade from auth.users, and deleting the admin who last saved must never
  -- delete the settings row.
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.site_settings (id) values (true);

-- No indexes on purpose (one row), including updated_by.
-- Closed like every table: only the API's secret key reaches it (the default privileges already revoke new tables).
alter table public.site_settings enable row level security;
revoke all on table public.site_settings from anon, authenticated;

create trigger site_settings_set_updated_at
  before update on public.site_settings
  for each row execute function public.set_updated_at();
