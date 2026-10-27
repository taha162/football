-- =============================================================================
-- Foundation: extensions, enums, reference data, profiles, roles, settings,
-- notifications, audit logging, rate limiting and shared helper functions.
--
-- Security model (applies to every migration in this project):
--   * Every table in `public` has RLS enabled. Policies only grant SELECT.
--   * anon/authenticated have no INSERT/UPDATE/DELETE privileges on tables.
--     All writes go through SECURITY DEFINER RPCs in `public` that
--     authenticate (auth.uid()), authorize and validate before writing.
--   * Internal helpers live in schema `private`, which is not exposed by the
--     Data API. Helpers used inside RLS policies are executable by API roles;
--     helpers that write (notify, audit) are not.
--   * SECURITY DEFINER functions use `set search_path = ''` and fully
--     qualified names to prevent search_path hijacking.
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- Nobody but the migration owner creates objects in public.
revoke create on schema public from public;
do $$ begin
  execute 'revoke create on schema public from anon, authenticated';
exception when others then null; end $$;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.account_status as enum ('active', 'suspended');
create type public.app_role as enum ('admin', 'moderator');
create type public.player_position as enum ('goalkeeper', 'defender', 'midfielder', 'forward');
create type public.skill_level as enum ('beginner', 'intermediate', 'advanced');
create type public.match_format as enum ('5v5', '6v6', '7v7', '8v8', '9v9', '11v11');

-- ---------------------------------------------------------------------------
-- Reference data: currencies, cities, areas
-- ---------------------------------------------------------------------------
create table public.currencies (
  code char(3) primary key check (code ~ '^[A-Z]{3}$'),
  -- Number of decimal places used when storing amounts. All amounts in the
  -- database are integers in this unit (IQD uses 0: whole dinars, since fils
  -- are not in circulation).
  minor_unit_exponent smallint not null check (minor_unit_exponent between 0 and 3),
  name_en text not null,
  name_ar text not null
);

create table public.cities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  name_en text not null,
  name_ar text not null,
  country_code char(2) not null check (country_code ~ '^[A-Z]{2}$'),
  timezone text not null,
  currency char(3) not null references public.currencies(code),
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.areas (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9-]{2,60}$'),
  name_en text not null,
  name_ar text not null,
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  is_active boolean not null default true,
  unique (city_id, slug)
);
create index areas_city_idx on public.areas(city_id);

-- Validates that an IANA timezone name is known to the server.
create or replace function private.is_valid_timezone(tz text)
returns boolean language plpgsql stable set search_path = '' as $$
begin
  perform now() at time zone tz;
  return true;
exception when others then
  return false;
end $$;

alter table public.cities add constraint cities_timezone_valid check (private.is_valid_timezone(timezone));

-- ---------------------------------------------------------------------------
-- Platform settings (admin-configurable policies)
-- ---------------------------------------------------------------------------
create table public.platform_settings (
  key text primary key check (key ~ '^[a-z0-9_.]{3,80}$'),
  value jsonb not null,
  description text,
  is_public boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (key, value, description) values
  ('match.default_leave_deadline_hours', '6', 'Default hours before kickoff after which leaving counts as a late withdrawal'),
  ('match.max_open_created_per_user', '20', 'Maximum upcoming matches one user may organize at once'),
  ('match.auto_complete_after_hours', '3', 'Hours after the scheduled end when an active match is marked completed'),
  ('messaging.max_per_minute', '20', 'Messages one user may send per minute'),
  ('reports.max_per_day', '20', 'Reports one user may file per day'),
  ('booking.request_expiry_hours', '24', 'Hours a booking request waits for a venue decision before expiring'),
  ('booking.max_pending_per_user', '5', 'Maximum pending booking requests per user'),
  ('reviews.window_days', '14', 'Days after a match during which reviews may be submitted'),
  ('reviews.min_count_to_display', '3', 'Minimum reviews before aggregate ratings are shown publicly'),
  ('invitations.max_per_hour', '30', 'Invitations one user may send per hour'),
  ('teams.max_created_per_day', '5', 'Teams one user may create per day');

create or replace function private.setting_int(p_key text, p_default int)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::int from public.platform_settings where key = p_key), p_default);
$$;

-- ---------------------------------------------------------------------------
-- Profiles (public data) and user preferences (private data)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 40),
  avatar_path text,
  bio text check (char_length(bio) <= 500),
  city_id uuid references public.cities(id),
  -- Optional *public* neighborhood. Never a precise location.
  area_id uuid references public.areas(id),
  positions public.player_position[] not null default '{}',
  skill_level public.skill_level,
  preferred_formats public.match_format[] not null default '{}',
  show_match_history boolean not null default true,
  status public.account_status not null default 'active',
  suspended_at timestamptz,
  suspension_reason text,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_city_idx on public.profiles(city_id);
create index profiles_display_name_idx on public.profiles using gin (to_tsvector('simple', display_name));

create table public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  locale text not null default 'ar' check (locale in ('ar', 'en')),
  preferred_times text[] not null default '{}'
    check (preferred_times <@ array['weekday_morning','weekday_afternoon','weekday_evening','weekday_night','weekend_morning','weekend_afternoon','weekend_evening','weekend_night']),
  -- Map of notification type -> boolean (in-app). Missing keys mean enabled.
  notification_prefs jsonb not null default '{}'::jsonb check (jsonb_typeof(notification_prefs) = 'object'),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index user_blocks_blocked_idx on public.user_blocks(blocked_id);

-- Create profile + preferences for every new auth user.
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
  insert into public.profiles (id, display_name) values (new.id, v_name);
  insert into public.user_preferences (user_id, locale) values (new.id, v_locale);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger user_preferences_touch before update on public.user_preferences
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Authorization helpers
-- ---------------------------------------------------------------------------
create or replace function private.has_role(p_role public.app_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles where user_id = (select auth.uid()) and role = p_role
  );
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_role('admin');
$$;

create or replace function private.is_moderator()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role in ('admin', 'moderator')
  );
$$;

create or replace function private.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

-- Returns the caller's id, raising if unauthenticated, suspended or (when
-- required) not yet onboarded. Used at the top of every mutating RPC.
create or replace function private.require_user(p_require_onboarded boolean default true)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_profile from public.profiles where id = v_uid;
  if not found then
    raise exception 'profile_missing' using errcode = 'P0001';
  end if;
  if v_profile.status = 'suspended' then
    raise exception 'account_suspended' using errcode = '42501';
  end if;
  if p_require_onboarded and v_profile.onboarded_at is null then
    raise exception 'profile_incomplete' using errcode = 'P0001';
  end if;
  return v_uid;
end $$;

create or replace function private.require_admin()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := private.require_user(false);
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_uid;
end $$;

create or replace function private.require_moderator()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := private.require_user(false);
  if not private.is_moderator() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_uid;
end $$;

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------
create table private.rate_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  bucket text not null,
  created_at timestamptz not null default now()
);
create index rate_events_lookup_idx on private.rate_events(user_id, bucket, created_at desc);

-- Records an event and raises `rate_limited` if the user already reached
-- p_max events in the bucket during the window.
create or replace function private.rate_limit(p_user uuid, p_bucket text, p_max int, p_window interval)
returns void language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  select count(*) into v_count from private.rate_events
   where user_id = p_user and bucket = p_bucket and created_at > now() - p_window;
  if v_count >= p_max then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into private.rate_events (user_id, bucket) values (p_user, p_bucket);
end $$;

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs(created_at desc);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id);

create or replace function private.audit(p_action text, p_entity_type text, p_entity_id text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Notifications (created only by trusted server-side functions)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type ~ '^[a-z_]{3,60}$'),
  payload jsonb not null default '{}'::jsonb,
  -- Optional idempotency key; retried operations do not duplicate notices.
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index notifications_dedupe_idx on public.notifications(user_id, dedupe_key) where dedupe_key is not null;
create index notifications_user_idx on public.notifications(user_id, created_at desc);
create index notifications_unread_idx on public.notifications(user_id) where read_at is null;

-- Types users may not switch off (they concern commitments already made).
create or replace function private.is_mandatory_notification(p_type text)
returns boolean language sql immutable set search_path = '' as $$
  select p_type in ('match_cancelled', 'match_updated', 'waitlist_promoted', 'booking_confirmed',
                    'booking_rejected', 'booking_cancelled', 'participant_removed', 'account_notice');
$$;

create or replace function private.notify(p_user uuid, p_type text, p_payload jsonb default '{}'::jsonb, p_dedupe_key text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_prefs jsonb;
begin
  if p_user is null then return; end if;
  if not private.is_mandatory_notification(p_type) then
    select notification_prefs into v_prefs from public.user_preferences where user_id = p_user;
    if v_prefs is not null and (v_prefs ->> p_type) = 'false' then
      return;
    end if;
  end if;
  insert into public.notifications (user_id, type, payload, dedupe_key)
  values (p_user, p_type, coalesce(p_payload, '{}'::jsonb), p_dedupe_key)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.currencies enable row level security;
alter table public.cities enable row level security;
alter table public.areas enable row level security;
alter table public.platform_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_blocks enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;
alter table private.rate_events enable row level security;

create policy currencies_read on public.currencies for select using (true);
create policy cities_read on public.cities for select using (is_active or private.is_admin());
create policy areas_read on public.areas for select using (is_active or private.is_admin());
create policy settings_read on public.platform_settings for select using (is_public or private.is_admin());
-- Profiles only contain public-safe columns by design.
create policy profiles_read on public.profiles for select using (true);
create policy preferences_read_own on public.user_preferences for select using (user_id = (select auth.uid()));
create policy roles_read on public.user_roles for select using (user_id = (select auth.uid()) or private.is_admin());
create policy blocks_read_own on public.user_blocks for select using (blocker_id = (select auth.uid()));
create policy audit_read_admin on public.audit_logs for select using (private.is_admin());
create policy notifications_read_own on public.notifications for select using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- RPCs: profile & preferences
-- ---------------------------------------------------------------------------
create or replace function public.update_my_profile(
  p_display_name text,
  p_city_id uuid,
  p_area_id uuid default null,
  p_bio text default null,
  p_positions public.player_position[] default '{}',
  p_skill_level public.skill_level default null,
  p_preferred_formats public.match_format[] default '{}',
  p_show_match_history boolean default true,
  p_complete_onboarding boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(false);
begin
  if p_display_name is null or char_length(btrim(p_display_name)) not between 2 and 40 then
    raise exception 'invalid_display_name' using errcode = '22023';
  end if;
  if p_city_id is null or not exists (select 1 from public.cities where id = p_city_id and is_active) then
    raise exception 'invalid_city' using errcode = '22023';
  end if;
  if p_area_id is not null and not exists (select 1 from public.areas where id = p_area_id and city_id = p_city_id) then
    raise exception 'invalid_area' using errcode = '22023';
  end if;
  if p_bio is not null and char_length(p_bio) > 500 then
    raise exception 'bio_too_long' using errcode = '22023';
  end if;
  update public.profiles set
    display_name = btrim(p_display_name),
    city_id = p_city_id,
    area_id = p_area_id,
    bio = nullif(btrim(coalesce(p_bio, '')), ''),
    positions = coalesce(p_positions, '{}'),
    skill_level = p_skill_level,
    preferred_formats = coalesce(p_preferred_formats, '{}'),
    show_match_history = coalesce(p_show_match_history, true),
    onboarded_at = case when p_complete_onboarding then coalesce(onboarded_at, now()) else onboarded_at end
  where id = v_uid;
end $$;

create or replace function public.update_my_preferences(
  p_locale text default null,
  p_preferred_times text[] default null,
  p_notification_prefs jsonb default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(false);
begin
  if p_locale is not null and p_locale not in ('ar', 'en') then
    raise exception 'invalid_locale' using errcode = '22023';
  end if;
  if p_notification_prefs is not null and jsonb_typeof(p_notification_prefs) <> 'object' then
    raise exception 'invalid_preferences' using errcode = '22023';
  end if;
  update public.user_preferences set
    locale = coalesce(p_locale, locale),
    preferred_times = coalesce(p_preferred_times, preferred_times),
    notification_prefs = coalesce(p_notification_prefs, notification_prefs)
  where user_id = v_uid;
end $$;

create or replace function public.set_my_avatar(p_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(false);
begin
  if p_path is not null and p_path !~ ('^' || v_uid::text || '/[A-Za-z0-9._-]{1,100}$') then
    raise exception 'invalid_path' using errcode = '22023';
  end if;
  update public.profiles set avatar_path = p_path where id = v_uid;
end $$;

create or replace function public.block_user(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(false);
begin
  if p_user_id = v_uid then
    raise exception 'cannot_block_self' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  insert into public.user_blocks (blocker_id, blocked_id) values (v_uid, p_user_id)
  on conflict do nothing;
end $$;

create or replace function public.unblock_user(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(false);
begin
  delete from public.user_blocks where blocker_id = v_uid and blocked_id = p_user_id;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs: notifications
-- ---------------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(false);
  v_count int;
begin
  update public.notifications set read_at = now()
   where user_id = v_uid and read_at is null
     and (p_ids is null or id = any(p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;
