-- Background work (P1.2, ADR-002): a transactional outbox into pgmq queues, and pg_cron for time-based work.
-- A transition function calls emit_event() before it returns, so a state change and its events commit together or
-- not at all. The pgmq schema is not exposed through the API (config.toml api.schemas), and pgmq_public is not
-- enabled: the worker will reach the queues through security-definer wrappers granted to service_role only.
create extension if not exists pgmq;
create extension if not exists pg_cron;

-- The durable event log: replay source and analytics input. Payloads carry ids and statuses, never a whole row or an
-- amount (500 MB free tier, ADR-011); purge_domain_events() keeps 30 days.
create table public.domain_events (
  id uuid primary key default gen_random_uuid(),
  type text not null,                     -- 'order.ready'
  aggregate_type text not null,           -- 'order'
  aggregate_id uuid not null,
  store_id uuid references public.stores (id),
  payload jsonb not null,
  actor jsonb,                            -- { "type": "USER" | "WORKER" | ..., "id": uuid }
  request_id text,
  occurred_at timestamptz not null default now()
);

create index domain_events_aggregate_idx on public.domain_events (aggregate_type, aggregate_id, occurred_at);

-- Fan-out: pgmq is point-to-point, so an event goes to every queue subscribed to its type or its family ('order.*').
-- A row naming a queue that does not exist makes every matching emit_event() raise, and the transition with it: add a
-- subscription in the migration that creates its queue.
create table public.event_subscriptions (
  event_type text not null,
  queue_name text not null,
  primary key (event_type, queue_name)
);

-- Closed like every table: only the API's and the worker's secret key reaches them.
alter table public.domain_events enable row level security;
alter table public.event_subscriptions enable row level security;
revoke all on table public.domain_events, public.event_subscriptions from anon, authenticated;

-- Security definer: the queue tables belong to the migration's role, and the API's role (which runs the transition
-- functions that call this) has no privileges on them.
create function public.emit_event(
  p_type text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_store_id uuid,
  p_payload jsonb,
  p_actor jsonb,
  p_request_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.domain_events;
  v_queue text;
begin
  insert into public.domain_events (type, aggregate_type, aggregate_id, store_id, payload, actor, request_id)
  values (p_type, p_aggregate_type, p_aggregate_id, p_store_id, p_payload, p_actor, p_request_id)
  returning * into v_event;

  -- distinct: a queue subscribed to both the type and its family still gets the event once.
  for v_queue in
    select distinct queue_name
      from public.event_subscriptions
     where event_type in (p_type, split_part(p_type, '.', 1) || '.*')
  loop
    perform pgmq.send(v_queue, jsonb_build_object(
      'eventId', v_event.id,
      'type', v_event.type,
      'aggregateId', v_event.aggregate_id,
      'storeId', v_event.store_id,
      'payload', v_event.payload,
      'actor', v_event.actor,
      'requestId', v_event.request_id,
      'occurredAt', v_event.occurred_at
    ));
  end loop;

  return v_event.id;
end;
$$;

-- Time is a parameter, so tests choose it instead of back-dating rows. Returns the number of events deleted.
create function public.purge_domain_events(p_now timestamptz default now(), p_keep interval default '30 days')
returns integer
language sql
set search_path = ''
as $$
  with deleted as (
    delete from public.domain_events where occurred_at < p_now - p_keep returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke execute on function
  public.emit_event(text, text, uuid, uuid, jsonb, jsonb, text),
  public.purge_domain_events(timestamptz, interval)
from public, anon, authenticated;

grant execute on function
  public.emit_event(text, text, uuid, uuid, jsonb, jsonb, text),
  public.purge_domain_events(timestamptz, interval)
to service_role;

-- The first queue and its subscription: order events, for the worker's notification handler.
select pgmq.create('q_notifications');
insert into public.event_subscriptions (event_type, queue_name) values ('order.*', 'q_notifications');

-- 21:17 UTC is 02:47 IST, the quietest hour. pg_cron runs it as the migration's role.
select cron.schedule('purge-domain-events', '17 21 * * *', $$select public.purge_domain_events()$$);
