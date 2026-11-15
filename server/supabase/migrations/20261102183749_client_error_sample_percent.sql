-- The share of page loads whose errors the client reports to POST /api/client-errors (docs/CONFIGURATION.md), so an
-- admin can turn reporting down during an incident without a deploy. Bounds match updateSettingsSchema in
-- server/src/schemas/admin.schema.ts. The site_settings audit trigger records changes to it with no change of its own.
alter table public.site_settings
  add column client_error_sample_percent integer not null default 100
    check (client_error_sample_percent between 0 and 100);
