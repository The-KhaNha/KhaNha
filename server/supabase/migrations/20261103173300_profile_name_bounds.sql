-- handle_new_user copied an Auth user's metadata into profiles as it came. POST /api/auth/register checks it first,
-- but an account made another way (a direct Auth sign-up with the bundled publishable key, the dashboard) skipped
-- those checks: a 9,000-character name reached every order's customer name and the staff board, and a long enough one
-- made the account's tokens too large for the API to read. The profile now keeps the API's bounds whichever way the
-- account was made. The rules live once, in the two functions below, used by the trigger and the clean-up alike.

-- The API's name rule (LIMITS.nameMin 2, nameMax 60 in server/src/schemas/limits.ts): control characters dropped and
-- the ends trimmed; shorter than 2 falls back to the email's local part, as an account made without a name does; cut
-- to 60. The floor here is 1, not 2: a one-letter local part is still a name, and padding one would invent data.
create function public.profile_name(p_name text, p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(
    coalesce(
      nullif(
        case
          when char_length(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'))) >= 2
            then btrim(regexp_replace(p_name, '[[:cntrl:]]', '', 'g'))
        end,
        ''
      ),
      nullif(btrim(split_part(coalesce(p_email, ''), '@', 1)), ''),
      'Customer'
    ),
    60
  );
$$;

-- The API's phone rule (phoneField in server/src/schemas/common.ts): spaces, dashes and brackets removed, then an
-- optional + and 10 to 15 digits (LIMITS.phoneDigits), or no phone at all. [0-9], not \d, so it matches the API.
create function public.profile_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when regexp_replace(btrim(p_phone), '[[:space:]()-]', '', 'g') ~ '^\+?[0-9]{10,15}$'
      then regexp_replace(btrim(p_phone), '[[:space:]()-]', '', 'g')
  end;
$$;

revoke execute on function public.profile_name(text, text), public.profile_phone(text)
from public, anon, authenticated;

-- Same signature (so the trigger and its grants stay); the metadata now passes through the rules.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name, phone)
  values (
    new.id,
    new.email,
    public.profile_name(new.raw_user_meta_data ->> 'name', new.email),
    public.profile_phone(new.raw_user_meta_data ->> 'phone')
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Profiles made before this migration are brought inside the bounds first, so the checks below hold for every row and
-- a later write to such a profile (an email change, a role change) cannot fail on a value it did not touch.
update public.profiles
   set name = public.profile_name(name, email)
 where char_length(name) not between 1 and 60;

update public.profiles
   set phone = public.profile_phone(phone)
 where phone is not null and phone !~ '^\+?[0-9]{10,15}$';

alter table public.profiles
  add constraint profiles_name_length check (char_length(name) between 1 and 60),
  add constraint profiles_phone_format check (phone is null or phone ~ '^\+?[0-9]{10,15}$');
