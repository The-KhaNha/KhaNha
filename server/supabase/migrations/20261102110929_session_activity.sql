-- The server-side idle sign-out (ADR-011 follow-up, P1 PR 15). Hosted Supabase Free has no session inactivity
-- timeout, so the API records when each sign-in (auth session) was last used and refuses one idle longer than
-- SESSION_IDLE_DAYS. Keyed per session, not per user: a phone in use must not keep a stolen laptop session alive.

create table public.session_activity (
  session_id uuid primary key, -- the access token's session_id claim (auth.sessions.id)
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_seen_at timestamptz not null
);

-- For the cascade from profiles. No index on last_seen_at: the API moves it every few minutes per session, and an
-- index on it would turn each of those HOT updates into an index write, for one small nightly scan.
create index session_activity_user_id_idx on public.session_activity (user_id);

alter table public.session_activity enable row level security;
revoke all on table public.session_activity from anon, authenticated;

-- True, and last_seen_at moved to p_now, for a live session seen within p_idle or never seen (a sign-in made before
-- this table existed starts its clock at its first request). False, and nothing changes, for a session idle longer: the
-- caller revokes it. False too for a session gone from auth.sessions (signed out, revoked or removed by Supabase Auth):
-- its access token stays valid for up to an hour after the refresh token dies, and without this a replay would count
-- as "never seen" once the purge drops its row. Security definer because auth.sessions is readable by the owner
-- (postgres), not by service_role. Time is a parameter, so tests choose it.
create function public.touch_session(
  p_session_id uuid,
  p_user_id uuid,
  p_idle interval,
  p_now timestamptz default now()
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with touched as (
    insert into public.session_activity as s (session_id, user_id, last_seen_at)
    select p_session_id, p_user_id, p_now
    where exists (select 1 from auth.sessions a where a.id = p_session_id)
    on conflict (session_id) do update
      set last_seen_at = greatest(s.last_seen_at, excluded.last_seen_at)
      where s.last_seen_at >= p_now - p_idle
    returning 1
  )
  select exists (select 1 from touched);
$$;

-- Deletes only the rows whose session Supabase Auth has removed (signed out, revoked or cleaned up): such a session
-- can never be refreshed again, and touch_session refuses it with or without a row. Never by age: a live session
-- without a row counts as never seen and is allowed, so purging a live but long-unused session's row would let its
-- stolen refresh token back in. Security definer because auth.sessions is readable by the owner (postgres, as pg_cron
-- runs it), not by service_role.
create function public.purge_session_activity()
returns integer
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from public.session_activity a
    where not exists (select 1 from auth.sessions s where s.id = a.session_id)
    returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke execute on function
  public.touch_session(uuid, uuid, interval, timestamptz),
  public.purge_session_activity()
from public, anon, authenticated;

grant execute on function
  public.touch_session(uuid, uuid, interval, timestamptz),
  public.purge_session_activity()
to service_role;

-- 21:27 UTC is 02:57 IST, ten minutes after purge-domain-events. pg_cron runs it as the migration's role.
select cron.schedule('purge-session-activity', '27 21 * * *', $$select public.purge_session_activity()$$);
