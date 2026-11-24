-- =============================================================================
-- Usernames: every member has one, unlike any other (@ahmed_10), to be found
-- and added as a friend.
--
-- profiles.username: 3 to 20 characters, lower-case English letters, digits,
-- «_» and «.», starting with a letter, without «..» and not ending with «.».
-- Unique. A few words are reserved (admin, support, almalab...).
-- - Chosen at sign-up (e-mail or WhatsApp): it comes with the new account's
--   data and is given to its profile if still free; if someone took it in the
--   meantime, the account gets one like those below and can change it.
-- - Members who joined before, and accounts made without one, get «player»
--   and part of their account number (player3f9a1c). They can change it in
--   «الإعدادات».
-- - username_available(): anyone may ask (the sign-up form asks as you type).
-- - set_username(): a member changes theirs, up to 5 times a day.
--
-- Adds the column and fills it for every member (no other data changes).
-- Safe to run twice.
-- =============================================================================

alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_key on public.profiles (username);

-- The rules, and the reserved words.
create or replace function private.valid_username(p text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p ~ '^[a-z][a-z0-9_.]{2,19}$' and p !~ '\.\.' and p !~ '\.$'
    and p not in ('admin', 'administrator', 'admins', 'support', 'help', 'moderator', 'moderators', 'mod', 'system',
                  'root', 'official', 'almalab', 'al_malab', 'al.malab', 'malab', 'staff', 'security', 'info',
                  'contact', 'null', 'undefined', 'player', 'players', 'user', 'users', 'me', 'friends'), false);
$$;

-- A free username for an account: the wished one when valid and free, else «player» and part of its number.
create or replace function private.free_username(p_user uuid, p_wished text default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_wished text := lower(btrim(coalesce(p_wished, '')));
  v_hex text := replace(p_user::text, '-', '');
  v_try text;
  n int;
begin
  if private.valid_username(v_wished) and not exists (select 1 from public.profiles where username = v_wished and id <> p_user) then
    return v_wished;
  end if;
  foreach n in array array[6, 8, 10, 12, 14] loop
    v_try := 'player' || left(v_hex, n);
    if not exists (select 1 from public.profiles where username = v_try and id <> p_user) then
      return v_try;
    end if;
  end loop;
  return 'p' || left(v_hex, 19);
end $$;
revoke all on function private.free_username(uuid, text) from public;

-- Everyone who joined before gets one: the one they typed when signing up, if
-- they signed up after the site asked for it (before this file ran) and it is
-- free, else one made up.
do $$
declare r record;
begin
  for r in select p.id, u.raw_user_meta_data ->> 'username' as wished
             from public.profiles p join auth.users u on u.id = p.id
            where p.username is null
            order by p.created_at loop
    update public.profiles set username = private.free_username(r.id, r.wished) where id = r.id;
  end loop;
end $$;

-- A profile made any other way (by hand in SQL, say) gets one made up too.
create or replace function private.fill_username()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.username is null then
    new.username := private.free_username(new.id);
  end if;
  return new;
end $$;
revoke all on function private.fill_username() from public;
drop trigger if exists profiles_fill_username on public.profiles;
create trigger profiles_fill_username before insert on public.profiles
  for each row execute function private.fill_username();

alter table public.profiles alter column username set not null;
alter table public.profiles drop constraint if exists profiles_username_check;
alter table public.profiles add constraint profiles_username_check check (private.valid_username(username));

-- Anyone may read it, like the name (column grants since 0032).
grant select (username) on public.profiles to anon, authenticated;

-- New accounts: as before (foundation), and the username from the sign-up form, or one made up.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_locale text;
begin
  v_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  if v_name is null or char_length(v_name) < 2 then
    v_name := 'Player ' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;
  v_name := left(v_name, 40);
  v_locale := case when new.raw_user_meta_data ->> 'locale' in ('ar', 'en')
                   then new.raw_user_meta_data ->> 'locale' else 'ar' end;
  begin
    insert into public.profiles (id, display_name, username)
    values (new.id, v_name, private.free_username(new.id, new.raw_user_meta_data ->> 'username'));
  exception when unique_violation then
    -- Taken a moment ago by someone else: one made up instead; it can be changed in settings.
    insert into public.profiles (id, display_name, username) values (new.id, v_name, private.free_username(new.id));
  end;
  insert into public.user_preferences (user_id, locale) values (new.id, v_locale);
  return new;
end $$;

-- 'ok', 'invalid' or 'taken'.
create or replace function public.username_available(p_username text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not private.valid_username(lower(btrim(coalesce(p_username, '')))) then 'invalid'
    when exists (select 1 from public.profiles where username = lower(btrim(p_username))
                 and id is distinct from auth.uid()) then 'taken'
    else 'ok' end;
$$;
revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

create or replace function public.set_username(p_username text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(false);
  v_name text := lower(btrim(coalesce(p_username, '')));
begin
  if not private.valid_username(v_name) then
    raise exception 'invalid_username' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = v_uid and username = v_name) then
    return v_name;
  end if;
  perform private.rate_limit(v_uid, 'username_change', 5, interval '1 day');
  begin
    update public.profiles set username = v_name where id = v_uid;
  exception when unique_violation then
    raise exception 'username_taken' using errcode = '23505';
  end;
  return v_name;
end $$;
revoke all on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;
