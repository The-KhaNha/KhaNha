-- Opening hours (P2.4). day_of_week is ISO (1 = Monday). An interval whose closes_at is before its opens_at runs past
-- midnight into the next day. Written only through the API (service role), so RLS is on and everything is revoked;
-- the audit triggers and the overlap rules arrive with the write path (set_store_hours).
create type public.schedule_exception_kind as enum ('CLOSED', 'SPECIAL_HOURS');
create table public.store_hours (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 1 and 7),
  opens_at time not null check (opens_at < time '24:00'),
  closes_at time not null check (closes_at < time '24:00'),
  created_at timestamptz not null default now(),
  check (opens_at <> closes_at)
);
create index store_hours_store_day_idx on public.store_hours (store_id, day_of_week);
create table public.store_schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  kind public.schedule_exception_kind not null,
  opens_at time,
  closes_at time,
  label text not null check (char_length(label) between 2 and 60),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (
    (kind = 'CLOSED' and opens_at is null and closes_at is null)
    or (kind = 'SPECIAL_HOURS' and opens_at is not null and closes_at is not null and opens_at <> closes_at
        and opens_at < time '24:00' and closes_at < time '24:00')
  )
);
create index store_schedule_exceptions_store_id_ends_on_starts_on_idx
  on public.store_schedule_exceptions (store_id, ends_on, starts_on);
alter table public.store_hours enable row level security;
alter table public.store_schedule_exceptions enable row level security;
revoke all on table public.store_hours, public.store_schedule_exceptions from anon, authenticated;
