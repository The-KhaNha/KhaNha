-- P2 PR 01 (ADR-001 as amended): a brand is the business and records its owner; a store belongs to one brand and gains
-- a slug, a status and a place. Expand only: nothing is dropped, and the single-store API keeps working.

create type public.store_status as enum ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$'),
  description text not null default '',
  logo_url text,
  owner_id uuid references public.profiles (id) on delete set null,
  status public.store_status not null default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index brands_owner_id_idx on public.brands (owner_id);

-- Closed to the browser's key like every table (docs/PERMISSIONS.md "Database"): RLS on, no policies.
alter table public.brands enable row level security;
revoke all on public.brands from anon, authenticated;

-- Added nullable, backfilled, then made required.
alter table public.stores
  add column brand_id uuid references public.brands (id),
  add column slug text unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$'),
  add column status public.store_status not null default 'ACTIVE',
  add column timezone text not null default 'Asia/Kolkata',
  add column area text,
  add column address_line text,
  add column contact_phone text,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();

-- One brand per existing store, named and slugged after it. The slug is the name lower-cased with every run of
-- other characters as one '-', cut to 50, trimmed (so a cut never leaves a trailing '-'), and given '--N' (its rank among
-- the stores sharing it) when two stores would share it.
with base as (
  select id, name,
         coalesce(
           nullif(trim(both '-' from left(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'), 50)), ''),
           'store'
         ) as stem,
         created_at, id as tie
    from public.stores
),
numbered as (
  select id, name,
         case when row_number() over (partition by stem order by created_at, tie) = 1
              then stem
              -- A stem never holds '--' (runs of other characters collapse to one '-'), so 'stem--N' cannot meet
              -- any store's own stem or another group's suffixed slug; N is unique within its stem.
              else stem || '--' || row_number() over (partition by stem order by created_at, tie)
         end as slug
    from base
),
new_brands as (
  insert into public.brands (name, slug, status)
  -- stores.name has no length check; brands.name needs 2..80, so a one-letter name gains a suffix.
  select case when char_length(name) < 2 then name || ' brand' else left(name, 80) end, slug, 'ACTIVE'
    from numbered
  returning id, slug
)
update public.stores s
   set slug = nb.slug, brand_id = nb.id
  from new_brands nb
 where nb.slug = (select n.slug from numbered n where n.id = s.id);

alter table public.stores
  alter column brand_id set not null,
  alter column slug set not null;
create index stores_brand_id_idx on public.stores (brand_id);

create trigger brands_set_updated_at
  before update on public.brands
  for each row execute function public.set_updated_at();
create trigger stores_set_updated_at
  before update on public.stores
  for each row execute function public.set_updated_at();

-- audit_row_change() takes the row's store from its `store_id`; a `stores` row is its own store, so its audit rows
-- would carry no store and never reach the store's audit trail (P2 PR 10). Same body, with the row's `id` as the
-- store for `stores`. `create or replace` with the same signature keeps the revokes from the audit_log migration.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_headers jsonb;
  v_actor jsonb;
  v_changes jsonb;
begin
  select jsonb_object_agg(col, jsonb_build_array(v_old -> col, v_new -> col))
    into v_changes
    from jsonb_object_keys(v_new) as col
   where case when tg_argv[1] = '*' then col not in ('updated_at', 'updated_by') else col = any (tg_argv[1:]) end
     and v_old -> col is distinct from v_new -> col;

  -- A save that changed none of the watched columns is not a change.
  if v_changes is null then
    return null;
  end if;

  -- Parsed only for a real change. An actor that does not parse, or names an unknown type, fails the write on
  -- purpose: an audited change never lands without its row.
  v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  v_actor := coalesce(nullif(current_setting('app.actor', true), '')::jsonb, (v_headers ->> 'x-actor')::jsonb);

  insert into public.audit_log (
    actor_type, actor_id, actor_role, store_id, action, entity_type, entity_id, changes, request_id
  )
  values (
    coalesce(v_actor ->> 'type', 'SYSTEM')::public.actor_type,
    (v_actor ->> 'id')::uuid,
    v_actor ->> 'role',
    coalesce(v_new ->> 'store_id', case when tg_table_name = 'stores' then v_new ->> 'id' end)::uuid,
    tg_argv[0],
    split_part(tg_argv[0], '.', 1),
    coalesce(v_new ->> 'id', v_new ->> 'key'),
    v_changes,
    coalesce(nullif(current_setting('app.request_id', true), ''), v_headers ->> 'x-request-id')
  );
  return null;
end;
$$;

create trigger brands_audit
  after update on public.brands
  for each row execute function public.audit_row_change('brand.changed', '*');
create trigger stores_audit
  after update of name, slug, status, is_open, area, address_line, contact_phone, timezone on public.stores
  for each row execute function public.audit_row_change(
    'store.changed', 'name', 'slug', 'status', 'is_open', 'area', 'address_line', 'contact_phone', 'timezone'
  );
