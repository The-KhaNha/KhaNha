-- P2.7 (PR 16): the multi-store contract. A store role is a membership (store_memberships) or a brand's ownership,
-- never the profile: every STAFF profile becomes CUSTOMER, and keeps the store access its membership has held since
-- P2 PR 03. profiles_audit records each change; with no actor set, as SYSTEM. The enum value stays, unused.
update public.profiles set role = 'CUSTOMER' where role = 'STAFF';

-- The staff board's length is a per-store setting since P2 PR 05 (stores.staff_order_list_limit).
alter table public.site_settings drop column staff_order_list_limit;
