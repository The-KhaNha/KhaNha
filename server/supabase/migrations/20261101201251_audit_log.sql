-- The audit log (P1.3, R27): the business record of who changed what, kept 13 months. The operational logs are not it
-- (they rotate), and neither is domain_events (30 days, events only). Rows come from audit_row_change(), an after-update
-- trigger on each audited table, so no audited change can skip its row.

create type public.actor_type as enum ('USER', 'WORKER', 'RECONCILER', 'WEBHOOK', 'SCHEDULER', 'SYSTEM');

-- No foreign keys: a profile or store deleted later must not touch its audit rows (an on-delete action would be an
-- update, which the append-only guard below refuses).
create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_type public.actor_type not null,
  actor_id uuid, -- profiles.id for USER, null for system actors
  actor_role text, -- the actor's role when the change happened
  store_id uuid, -- for per-store audit views
  action text not null, -- 'order.status_changed', 'menu_item.changed', ...
  entity_type text not null,
  entity_id text not null,
  changes jsonb, -- { column: [old, new] }, watched columns only
  reason text,
  request_id text
);

create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, occurred_at desc);
create index audit_log_store_idx on public.audit_log (store_id, occurred_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, occurred_at desc);

-- Append-only twice over. The API's role may only read it (the trigger writes as the owner, so the secret key cannot
-- insert, edit or remove a row; it does vouch for the actor it sends), and even the owner cannot change or remove a
-- row while these triggers stand. The retention purge (P9.5) gets a sanctioned way past them, never a dropped trigger.
alter table public.audit_log enable row level security;
revoke all on table public.audit_log from public, anon, authenticated, service_role;
grant select on table public.audit_log to service_role;

create function public.audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_no_change
  before update or delete on public.audit_log
  for each row execute function public.audit_log_append_only();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_append_only();

-- trigger arguments: the action ('order.status_changed'; its first part is the entity type), then the watched columns,
-- or '*' for every column but updated_at and updated_by.
--
-- The actor: app.actor when a transition function set it (PR 05), else the x-actor header of a table write through the
-- Data API (PostgREST hands the request's headers to the transaction as request.headers; only the secret key can write
-- these tables), else SYSTEM: the SQL editor, the seed, a migration. The request id comes the same two ways.
--
-- Security definer: it inserts as the owner, the only role that may.
create function public.audit_row_change()
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
    (v_new ->> 'store_id')::uuid,
    tg_argv[0],
    split_part(tg_argv[0], '.', 1),
    v_new ->> 'id',
    v_changes,
    coalesce(nullif(current_setting('app.request_id', true), ''), v_headers ->> 'x-request-id')
  );
  return null;
end;
$$;

-- Fired by their triggers only: nobody calls them, so nobody is granted them.
revoke execute on function public.audit_log_append_only(), public.audit_row_change()
from public, anon, authenticated, service_role;

-- `update of` keeps the trigger from firing at all for writes that never name a watched column, such as place_order
-- moving stock. Stock is not audited by trigger: every order moves it (manual stock edits get their audited RPC, P3.5).
create trigger site_settings_audit
  after update on public.site_settings
  for each row execute function public.audit_row_change('site_settings.changed', '*');

create trigger orders_audit
  after update of status on public.orders
  for each row execute function public.audit_row_change('order.status_changed', 'status');

create trigger profiles_audit
  after update of role on public.profiles
  for each row execute function public.audit_row_change('profile.role_changed', 'role');

create trigger menu_items_audit
  after update of name, price, is_available, image_url, category on public.menu_items
  for each row execute function public.audit_row_change(
    'menu_item.changed', 'name', 'price', 'is_available', 'image_url', 'category'
  );
