-- The worker's way into the queues (P1.2, ADR-002): security-definer wrappers granted to service_role only, so the
-- pgmq schema itself stays closed to every API role, and a dead-letter table for messages the worker gives up on.

-- Dead letters: messages that failed permanently or ran out of attempts, for an operator to inspect or replay.
create table public.job_failures (
  id bigint generated always as identity primary key,
  queue_name text not null,
  message jsonb not null,
  attempts integer not null,
  last_error text not null,
  failed_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null
);

alter table public.job_failures enable row level security;
revoke all on table public.job_failures from anon, authenticated;

-- Up to p_qty messages, each hidden for p_vt_seconds; read_ct is the attempt. Waits up to p_poll_seconds for the first
-- one; 0 returns at once (read_with_poll checks its deadline before reading, so 0 there would never read anything).
create function public.queue_read(p_queue text, p_vt_seconds integer, p_qty integer, p_poll_seconds integer)
returns table (msg_id bigint, read_ct integer, enqueued_at timestamptz, message jsonb)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_poll_seconds > 0 then
    return query
      select r.msg_id, r.read_ct, r.enqueued_at, r.message
        from pgmq.read_with_poll(p_queue, p_vt_seconds, p_qty, p_poll_seconds) as r;
  else
    return query
      select r.msg_id, r.read_ct, r.enqueued_at, r.message from pgmq.read(p_queue, p_vt_seconds, p_qty) as r;
  end if;
end;
$$;

-- Handled messages are deleted, not archived (ADR-002: the free tier's 500 MB).
create function public.queue_delete(p_queue text, p_msg_id bigint)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select pgmq.delete(p_queue, p_msg_id);
$$;

-- Hides the message for p_delay_seconds more; it is then read again with read_ct + 1.
create function public.queue_retry(p_queue text, p_msg_id bigint, p_delay_seconds integer)
returns void
language sql
security definer
set search_path = ''
as $$
  select pgmq.set_vt(p_queue, p_msg_id, p_delay_seconds);
$$;

-- Deletes the message and records the failure only if the delete took it: a reader whose visibility timeout ran out may
-- give up on a message another reader has already handled, and that must not leave a dead letter to replay. Returns
-- whether it recorded one, so the worker logs a dead letter only when there was one.
create function public.queue_dead_letter(
  p_queue text,
  p_msg_id bigint,
  p_message jsonb,
  p_attempts integer,
  p_error text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with recorded as (
    insert into public.job_failures (queue_name, message, attempts, last_error)
    select p_queue, p_message, p_attempts, p_error
     where pgmq.delete(p_queue, p_msg_id)
    returning 1
  )
  select exists (select from recorded);
$$;

-- For the worker's health report: how many messages wait, and how long the oldest has waited.
create function public.queue_metrics(p_queue text)
returns table (queue_length bigint, oldest_msg_age_sec integer)
language sql
security definer
set search_path = ''
as $$
  select m.queue_length, m.oldest_msg_age_sec from pgmq.metrics(p_queue) as m;
$$;

revoke execute on function
  public.queue_read(text, integer, integer, integer),
  public.queue_delete(text, bigint),
  public.queue_retry(text, bigint, integer),
  public.queue_dead_letter(text, bigint, jsonb, integer, text),
  public.queue_metrics(text)
from public, anon, authenticated;

grant execute on function
  public.queue_read(text, integer, integer, integer),
  public.queue_delete(text, bigint),
  public.queue_retry(text, bigint, integer),
  public.queue_dead_letter(text, bigint, jsonb, integer, text),
  public.queue_metrics(text)
to service_role;
