-- Feature flags (P1.7): one row per flag, evaluated by the API (services/flags.service.ts). No rows here: each flag
-- ships in the migration of the phase that uses it. Flipped through PATCH /api/admin/flags/:key, so the audit row
-- names the admin who flipped it.

create table public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{2,63}$'),
  description text not null,
  enabled boolean not null default false,
  client_visible boolean not null default false,
  rules jsonb not null default '{}', -- { "storeIds": [...], "roles": [...], "percent": 0-100 }, all optional
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

-- No index on updated_by: nothing filters on it, and the table holds a handful of rows read whole into the API's cache.

alter table public.feature_flags enable row level security;
revoke all on table public.feature_flags from anon, authenticated;

create trigger feature_flags_set_updated_at
  before update on public.feature_flags
  for each row execute function public.set_updated_at();

-- audit_row_change() took entity_id from the row's `id`; feature_flags is keyed by `key`, and audit_log.entity_id is
-- not null, so every flip would have failed. Same body, with `key` as the fallback. `create or replace` with the same
-- signature keeps the revokes from the audit_log migration.
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
    (v_new ->> 'store_id')::uuid,
    tg_argv[0],
    split_part(tg_argv[0], '.', 1),
    coalesce(v_new ->> 'id', v_new ->> 'key'),
    v_changes,
    coalesce(nullif(current_setting('app.request_id', true), ''), v_headers ->> 'x-request-id')
  );
  return null;
end;
$$;

create trigger feature_flags_audit
  after update on public.feature_flags
  for each row execute function public.audit_row_change('feature_flag.changed', '*');
