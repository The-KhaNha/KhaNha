-- handle_new_user copied an Auth user's metadata into profiles as it came. POST /api/auth/register checks it first,
-- but an account made another way (a direct Auth sign-up with the bundled publishable key, the dashboard) skipped
-- those checks: a 9,000-character name reached every order's customer name and the staff board, and a long enough one
-- made the account's tokens too large for the API to read. The profile now keeps the API's bounds whichever way the
-- account was made. The rules live once, in the two functions below, used by the trigger and the clean-up alike.

-- The API's name rule (LIMITS.nameMin 2, nameMax 60 in server/src/schemas/limits.ts): control characters dropped and
-- the ends trimmed; shorter than 2 falls back to the email's local part, as an account made without a name does; cut
-- to 60 and trimmed again. Lengths are UTF-16 units, as the API and the forms count them (an emoji is 2), so a name the
-- profile holds is always one the checkout form accepts back; the cut never leaves half of a surrogate pair. The floor
-- here is 1, not 2: a one-letter local part is still a name, and padding one would invent data.
create function public.profile_name(p_name text, p_email text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'));
begin
  if char_length(v_name) + char_length(regexp_replace(v_name, '[^\U00010000-\U0010FFFF]', '', 'g')) < 2 then
    v_name := btrim(split_part(coalesce(p_email, ''), '@', 1));
  end if;
  if v_name = '' then
    v_name := 'Customer';
  end if;
  v_name := left(v_name, 60);
  while char_length(v_name) + char_length(regexp_replace(v_name, '[^\U00010000-\U0010FFFF]', '', 'g')) > 60 loop
    v_name := left(v_name, -1);
  end loop;
  return btrim(v_name);
end;
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
 where char_length(name) + char_length(regexp_replace(name, '[^\U00010000-\U0010FFFF]', '', 'g')) not between 1 and 60;

update public.profiles
   set phone = public.profile_phone(phone)
 where phone is not null and phone !~ '^\+?[0-9]{10,15}$';

alter table public.profiles
  -- UTF-16 units, inline: a check that called a function would need EXECUTE for every role that writes profiles.
  add constraint profiles_name_length check (
    char_length(name) + char_length(regexp_replace(name, '[^\U00010000-\U0010FFFF]', '', 'g')) between 1 and 60
  ),
  add constraint profiles_phone_format check (phone is null or phone ~ '^\+?[0-9]{10,15}$');
