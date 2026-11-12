-- Per-store settings (P2 PR 05): four limits a store's manager may change, as columns on `stores` (no table of their
-- own: one row per store already exists, and stores_set_updated_at and audit_log cover who and when). The defaults
-- are the values the API used to hard-code, so a store that never changes them behaves as before.
alter table public.stores
  add column max_quantity_per_item integer not null default 10
    constraint stores_max_quantity_per_item_check check (max_quantity_per_item between 1 and 50),
  add column low_stock_threshold integer not null default 5
    constraint stores_low_stock_threshold_check check (low_stock_threshold between 0 and 50),
  add column staff_order_list_limit integer not null default 100
    constraint stores_staff_order_list_limit_check check (staff_order_list_limit between 1 and 500),
  -- Stored and editable here; PR 06 enforces it (how long before closing the store stops taking orders).
  add column last_order_minutes_before_close integer not null default 0
    constraint stores_last_order_minutes_before_close_check check (last_order_minutes_before_close between 0 and 240);

-- Existing stores start from the site-wide value they were using. A backfill is not a change anyone made, so it
-- writes no audit rows (and leaves updated_at alone). New stores get the constant default: no insert trigger.
alter table public.stores disable trigger stores_audit;
alter table public.stores disable trigger stores_set_updated_at;
update public.stores set staff_order_list_limit = (select staff_order_list_limit from public.site_settings);
alter table public.stores enable trigger stores_set_updated_at;
alter table public.stores enable trigger stores_audit;

-- Settings changes are their own audit action, apart from store.changed (stores_audit is left as it was).
create trigger stores_settings_audit
  after update of max_quantity_per_item, low_stock_threshold, staff_order_list_limit, last_order_minutes_before_close
  on public.stores
  for each row execute function public.audit_row_change(
    'store_settings.changed', 'max_quantity_per_item', 'low_stock_threshold', 'staff_order_list_limit',
    'last_order_minutes_before_close'
  );
