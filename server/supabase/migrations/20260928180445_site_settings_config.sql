-- The configuration registry's site-wide tier (docs/CONFIGURATION.md): limits and poll intervals an admin can change
-- without a deploy. Bounds match updateSettingsSchema in server/src/schemas/admin.schema.ts, so a bad value is a 400
-- from the API and never reaches these checks.
alter table public.site_settings
  add column max_lines_per_order integer not null default 30
    check (max_lines_per_order between 1 and 100),
  add column order_poll_ms integer not null default 4000
    check (order_poll_ms between 2000 and 60000),
  add column orders_poll_ms integer not null default 8000
    check (orders_poll_ms between 2000 and 60000),
  add column staff_board_poll_ms integer not null default 4000
    check (staff_board_poll_ms between 2000 and 60000);
