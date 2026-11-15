-- P2.2 (PR 09): a store's team grows by invite. An invite names an email and a role; the inviter shares a link that
-- carries a token, shown once (nothing sends mail before P6.3). Only the token's sha-256 is stored. Accepting needs a
-- signed-in account with that email (accept_store_invite, in the next migration).
create table public.store_invites (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  role public.store_role not null,
  -- The account that may accept it, lower-cased by the API (auth.users keeps emails lower-cased too).
  email text not null check (email = lower(email) and char_length(email) between 3 and 320),
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (accepted_at is null or revoked_at is null)
);
-- One open invite per email per store: inviting twice is 409 MEMBERSHIP_EXISTS. An expired one still counts as open
-- here, so the API revokes a store's expired invites for that email before it inserts.
create unique index store_invites_open_email_key
  on public.store_invites (store_id, email)
  where accepted_at is null and revoked_at is null;
create index store_invites_store_id_idx on public.store_invites (store_id);
create index store_invites_created_by_idx on public.store_invites (created_by);
create index store_invites_accepted_by_idx on public.store_invites (accepted_by);

-- Only the API (secret key) reads or writes invites (docs/PERMISSIONS.md "Database").
alter table public.store_invites enable row level security;
revoke all on public.store_invites from anon, authenticated;

-- Never token_hash: the audit trail is readable by the store's managers (GET /api/stores/:storeId/audit).
create trigger store_invites_audit
  after insert or update or delete on public.store_invites
  for each row execute function public.audit_row_change(
    'invite.changed', 'role', 'email', 'accepted_at', 'revoked_at'
  );
