-- P2.2 (ADR-001): staff and managers are memberships of one store. The brand's owner (brands.owner_id) is OWNER of
-- every store of the brand with no row here, so "the last owner" cannot be removed by construction.
create type public.store_role as enum ('MANAGER', 'STAFF');

create table public.store_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  role public.store_role not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  unique (user_id, store_id)
);
-- (user_id, store_id) is covered by the unique index; the team list reads by store.
create index store_memberships_store_id_idx on public.store_memberships (store_id);
create index store_memberships_created_by_idx on public.store_memberships (created_by);

-- Only the API (secret key) reads or writes memberships: closed to the browser's keys (docs/PERMISSIONS.md "Database").
alter table public.store_memberships enable row level security;
revoke all on public.store_memberships from anon, authenticated;

-- audit_row_change() recorded updates only. It now records an insert as [null, value] pairs and a delete as
-- [value, null], with the store and entity id from whichever row exists, and `actor_role` is the actor's `storeRole`
-- (types/auth.ts) when set. `create or replace` with the same signature keeps the audit_log migration's revokes.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_row jsonb := coalesce(to_jsonb(new), to_jsonb(old));
  v_headers jsonb;
  v_actor jsonb;
  v_changes jsonb;
begin
  -- The missing side reads as JSON null, so an inserted or deleted null column is not a change.
  select jsonb_object_agg(col, jsonb_build_array(v_old -> col, v_new -> col))
    into v_changes
    from jsonb_object_keys(v_row) as col
   where case when tg_argv[1] = '*' then col not in ('updated_at', 'updated_by') else col = any (tg_argv[1:]) end
     and coalesce(v_old -> col, 'null'::jsonb) is distinct from coalesce(v_new -> col, 'null'::jsonb);

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
    coalesce(v_actor ->> 'storeRole', v_actor ->> 'role'),
    coalesce(v_row ->> 'store_id', case when tg_table_name = 'stores' then v_row ->> 'id' end)::uuid,
    tg_argv[0],
    split_part(tg_argv[0], '.', 1),
    coalesce(v_row ->> 'id', v_row ->> 'key'),
    v_changes,
    coalesce(nullif(current_setting('app.request_id', true), ''), v_headers ->> 'x-request-id')
  );
  return null;
end;
$$;

create trigger store_memberships_audit
  after insert or update or delete on public.store_memberships
  for each row execute function public.audit_row_change('membership.changed', 'user_id', 'store_id', 'role');

-- Today's STAFF profiles work the only store there was, the oldest; their profile role stays STAFF until P2 PR 16
-- so the old staff routes still admit them. After the trigger, so each is audited as a SYSTEM change.
insert into public.store_memberships (user_id, store_id, role)
select p.id, s.id, 'STAFF'
  from public.profiles p
  cross join (select id from public.stores order by created_at, id limit 1) s
 where p.role = 'STAFF'
on conflict (user_id, store_id) do nothing;
