-- The oldest client build the API still serves. Requests from an older X-Client-Version get 426 CLIENT_OUTDATED
-- (server/src/middleware/clientVersion.ts), so a change the deployed client cannot survive can retire it. The
-- default 0.0.0 gates nothing. Compared on the numeric triple only, so staging's prerelease labels never gate.
alter table public.site_settings
  add column min_client_version text not null default '0.0.0'
    check (min_client_version ~ '^\d+\.\d+\.\d+$');
