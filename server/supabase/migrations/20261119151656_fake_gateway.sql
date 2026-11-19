-- P5 PR 01: the fake payment provider's own records. The API, the worker and the reconciler are separate processes,
-- so the fake keeps its orders here instead of in memory. It plays a provider: it knows our order id (its
-- idempotency key) and nothing else of our schema, so there is no foreign key. Never used in production
-- (utils/env.ts refuses PAYMENT_PROVIDER=fake there); the table exists there empty.

create table public.fake_gateway_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique,
  amount_paise bigint not null check (amount_paise > 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'FAILED')),
  return_url text not null,
  notify_url text not null,
  expires_at timestamptz not null,
  -- { "<our refund id>": { "amountPaise": n, "status": "PROCESSED" } }: keyed by our id, so a repeat is a lookup.
  refunds jsonb not null default '{}'::jsonb check (jsonb_typeof(refunds) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fake_gateway_orders_created_at_idx on public.fake_gateway_orders (created_at);

create trigger fake_gateway_orders_set_updated_at
  before update on public.fake_gateway_orders
  for each row execute function public.set_updated_at();

alter table public.fake_gateway_orders enable row level security;
revoke all on table public.fake_gateway_orders from public, anon, authenticated;
grant select, insert, update, delete on table public.fake_gateway_orders to service_role;

-- A refund, idempotent on our refund id, never more than was paid: the row lock serialises two refunds of one order.
-- Refused (FAKE_REFUND_REFUSED) for an order that was not paid or an amount over what is left.
create function public.fake_gateway_refund(p_id uuid, p_refund_id text, p_amount_paise bigint)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_order public.fake_gateway_orders;
  v_refunded bigint;
  v_refund jsonb;
begin
  select * into v_order from public.fake_gateway_orders where id = p_id for update;
  if not found then
    raise exception using message = 'NOT_FOUND', detail = jsonb_build_object('id', p_id)::text;
  end if;

  if v_order.refunds ? p_refund_id then
    return v_order.refunds -> p_refund_id;
  end if;

  select coalesce(sum((r.value ->> 'amountPaise')::bigint), 0) into v_refunded
  from jsonb_each(v_order.refunds) as r;

  if v_order.status <> 'PAID' or p_amount_paise <= 0 or v_refunded + p_amount_paise > v_order.amount_paise then
    raise exception using
      message = 'FAKE_REFUND_REFUSED',
      detail = jsonb_build_object('status', v_order.status, 'refundablePaise', v_order.amount_paise - v_refunded)::text;
  end if;

  v_refund := jsonb_build_object('amountPaise', p_amount_paise, 'status', 'PROCESSED');
  update public.fake_gateway_orders
  set refunds = refunds || jsonb_build_object(p_refund_id, v_refund)
  where id = p_id;
  return v_refund;
end;
$$;

-- A week is longer than any hold, refund retry or reconciliation window that reads these rows.
create function public.purge_fake_gateway_orders(p_now timestamptz default now(), p_keep interval default '7 days')
returns integer
language sql
set search_path = ''
as $$
  with deleted as (
    delete from public.fake_gateway_orders where created_at < p_now - p_keep returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke execute on function
  public.fake_gateway_refund(uuid, text, bigint),
  public.purge_fake_gateway_orders(timestamptz, interval)
from public, anon, authenticated;

grant execute on function
  public.fake_gateway_refund(uuid, text, bigint),
  public.purge_fake_gateway_orders(timestamptz, interval)
to service_role;

-- Its own job, so neither purge can fail or be rescheduled away with the other. 21:47 UTC is 03:17 IST, ten minutes
-- after media-sweep.
select cron.schedule('purge-fake-gateway-orders', '47 21 * * *', $$select public.purge_fake_gateway_orders()$$);
