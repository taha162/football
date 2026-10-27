-- =============================================================================
-- Venues, fields, opening hours, pricing, staff and bookings.
--
-- Double-booking prevention: confirmed bookings (and owner blocks / manual
-- bookings, which are stored as confirmed bookings) carry an exclusion
-- constraint over (field_id, [starts_at, occupied_until)). occupied_until is
-- ends_at plus the venue's buffer at the time of booking. Two overlapping
-- confirmations on the same field therefore cannot both commit, regardless of
-- concurrency.
-- =============================================================================

create type public.venue_role as enum ('owner', 'manager', 'staff');
create type public.verification_status as enum ('unverified', 'pending', 'verified', 'rejected');
create type public.booking_mode as enum ('platform', 'contact_only');
create type public.field_surface as enum ('artificial_turf', 'natural_grass', 'indoor', 'futsal_court', 'other');
create type public.booking_status as enum ('requested', 'confirmed', 'rejected', 'cancelled', 'completed', 'no_show', 'expired');
create type public.booking_kind as enum ('customer', 'manual', 'block');

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  description text check (char_length(description) <= 2000),
  city_id uuid not null references public.cities(id),
  area_id uuid references public.areas(id),
  address text check (char_length(address) <= 300),
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  phone text check (phone ~ '^\+?[0-9 ]{6,20}$'),
  whatsapp text check (whatsapp ~ '^\+?[0-9 ]{6,20}$'),
  facilities text[] not null default '{}' check (facilities <@ array[
    'parking','changing_rooms','showers','lighting','cafeteria','drinking_water','seating',
    'wifi','prayer_room','first_aid','equipment_rental','covered']),
  cover_image_path text,
  booking_mode public.booking_mode not null default 'contact_only',
  auto_confirm_bookings boolean not null default false,
  buffer_minutes int not null default 0 check (buffer_minutes between 0 and 60),
  min_notice_minutes int not null default 60 check (min_notice_minutes between 0 and 10080),
  max_advance_days int not null default 30 check (max_advance_days between 1 and 180),
  cancellation_deadline_hours int not null default 12 check (cancellation_deadline_hours between 0 and 168),
  cancellation_policy text check (char_length(cancellation_policy) <= 1000),
  verification_status public.verification_status not null default 'unverified',
  verification_note text,
  is_hidden boolean not null default false,
  hidden_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null))
);
create index venues_city_idx on public.venues(city_id) where not is_hidden;
create index venues_name_idx on public.venues using gin (to_tsvector('simple', name));
create trigger venues_touch before update on public.venues for each row execute function private.touch_updated_at();

alter table public.teams add constraint teams_home_venue_fk foreign key (home_venue_id) references public.venues(id) on delete set null;

create table public.venue_staff (
  venue_id uuid not null references public.venues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.venue_role not null,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (venue_id, user_id)
);
create unique index venue_staff_one_owner on public.venue_staff(venue_id) where role = 'owner';
create index venue_staff_user_idx on public.venue_staff(user_id);

create table public.venue_images (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  path text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index venue_images_venue_idx on public.venue_images(venue_id, sort_order);

create table public.venue_fields (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  surface public.field_surface not null default 'artificial_turf',
  formats public.match_format[] not null default '{}',
  is_covered boolean not null default false,
  has_lights boolean not null default true,
  price_per_hour bigint not null check (price_per_hour >= 0 and price_per_hour <= 100000000),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index venue_fields_venue_idx on public.venue_fields(venue_id);

-- One opening window per weekday (0 = Sunday). closes <= opens means the
-- window ends on the following day (e.g. 16:00 -> 02:00); equal means 24h.
create table public.venue_opening_hours (
  venue_id uuid not null references public.venues(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  opens time not null,
  closes time not null,
  primary key (venue_id, weekday)
);

-- Price overrides by weekday and local start time window.
create table public.venue_pricing_rules (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.venue_fields(id) on delete cascade,
  weekdays smallint[] not null check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[] and cardinality(weekdays) > 0),
  start_time time not null,
  end_time time not null,
  price_per_hour bigint not null check (price_per_hour >= 0 and price_per_hour <= 100000000),
  check (start_time <> end_time)
);
create index venue_pricing_rules_field_idx on public.venue_pricing_rules(field_id);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  field_id uuid not null references public.venue_fields(id) on delete cascade,
  kind public.booking_kind not null default 'customer',
  requested_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  match_id uuid, -- FK added in matches migration
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  occupied_until timestamptz not null,
  status public.booking_status not null default 'requested',
  price_total bigint not null default 0 check (price_total >= 0),
  currency char(3) not null references public.currencies(code),
  customer_note text check (char_length(customer_note) <= 500),
  customer_name text check (char_length(customer_name) <= 100),
  internal_note text check (char_length(internal_note) <= 500),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 500),
  cancelled_by uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 500),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (occupied_until >= ends_at),
  check (ends_at - starts_at <= interval '12 hours'),
  check (kind <> 'customer' or requested_by is not null),
  constraint bookings_no_overlap exclude using gist (
    field_id with =,
    tstzrange(starts_at, occupied_until, '[)') with &&
  ) where (status in ('confirmed', 'completed', 'no_show'))
);
create index bookings_field_time_idx on public.bookings(field_id, starts_at);
create index bookings_venue_idx on public.bookings(venue_id, starts_at desc);
create index bookings_requester_idx on public.bookings(requested_by, starts_at desc);
create index bookings_pending_idx on public.bookings(expires_at) where status = 'requested';
create trigger bookings_touch before update on public.bookings for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.venue_role_of(p_venue uuid, p_user uuid)
returns public.venue_role language sql stable security definer set search_path = '' as $$
  select role from public.venue_staff where venue_id = p_venue and user_id = p_user;
$$;

create or replace function private.is_venue_staff(p_venue uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.venue_staff where venue_id = p_venue and user_id = (select auth.uid()));
$$;

-- Owners and managers may edit the venue; all staff may handle bookings.
create or replace function private.require_venue_role(p_venue uuid, p_user uuid, p_manage boolean)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_role public.venue_role;
begin
  if not exists (select 1 from public.venues where id = p_venue) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  v_role := private.venue_role_of(p_venue, p_user);
  if v_role is null or (p_manage and v_role = 'staff') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create or replace function private.can_view_venue(p_venue uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.venues v
    where v.id = p_venue and (not v.is_hidden or private.is_venue_staff(v.id) or private.is_moderator())
  );
$$;

create or replace function private.notify_venue_staff(p_venue uuid, p_type text, p_payload jsonb, p_dedupe text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select user_id from public.venue_staff where venue_id = p_venue loop
    perform private.notify(r.user_id, p_type, p_payload, p_dedupe);
  end loop;
end $$;

create or replace function private.venue_timezone(p_venue uuid)
returns text language sql stable security definer set search_path = '' as $$
  select c.timezone from public.venues v join public.cities c on c.id = v.city_id where v.id = p_venue;
$$;

-- True when the booking interval fits inside one opening window (windows may
-- cross midnight).
create or replace function private.within_opening_hours(p_venue uuid, p_starts timestamptz, p_ends timestamptz)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := private.venue_timezone(p_venue);
  v_ls timestamp := p_starts at time zone v_tz;
  v_le timestamp := p_ends at time zone v_tz;
  v_day date;
  v_row public.venue_opening_hours%rowtype;
  v_ws timestamp;
  v_we timestamp;
begin
  foreach v_day in array array[v_ls::date - 1, v_ls::date] loop
    select * into v_row from public.venue_opening_hours
     where venue_id = p_venue and weekday = extract(dow from v_day)::smallint;
    if found then
      v_ws := v_day + v_row.opens;
      v_we := case when v_row.closes > v_row.opens then v_day + v_row.closes
                   else v_day + 1 + v_row.closes end;
      if v_ls >= v_ws and v_le <= v_we then
        return true;
      end if;
    end if;
  end loop;
  return false;
end $$;

-- Hourly price for a field at a given start time (rules override the base).
create or replace function private.field_hourly_price(p_field uuid, p_starts timestamptz)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare
  v_field public.venue_fields%rowtype;
  v_local timestamp;
  v_t time;
  v_dow smallint;
  v_price bigint;
begin
  select * into v_field from public.venue_fields where id = p_field;
  v_local := p_starts at time zone private.venue_timezone(v_field.venue_id);
  v_t := v_local::time;
  v_dow := extract(dow from v_local)::smallint;
  select r.price_per_hour into v_price from public.venue_pricing_rules r
   where r.field_id = p_field and v_dow = any(r.weekdays)
     and (case when r.end_time > r.start_time then v_t >= r.start_time and v_t < r.end_time
               else v_t >= r.start_time or v_t < r.end_time end)
   order by r.start_time desc limit 1;
  return coalesce(v_price, v_field.price_per_hour);
end $$;

-- Integer price for a duration; rounds half up to the whole currency unit.
create or replace function private.price_for_duration(p_hourly bigint, p_minutes int)
returns bigint language sql immutable set search_path = '' as $$
  select (p_hourly * p_minutes + 30) / 60;
$$;

-- Validates a requested slot; returns starts/ends/price or raises.
create or replace function private.validate_booking_slot(
  p_field_id uuid, p_start_local timestamp, p_duration_minutes int, p_enforce_notice boolean
) returns table (venue_id uuid, starts_at timestamptz, ends_at timestamptz, occupied_until timestamptz, price bigint, currency char(3))
language plpgsql stable security definer set search_path = '' as $$
declare
  v_field public.venue_fields%rowtype;
  v_venue public.venues%rowtype;
  v_tz text;
  v_currency char(3);
  v_starts timestamptz;
  v_ends timestamptz;
begin
  select * into v_field from public.venue_fields where id = p_field_id;
  if not found or not v_field.is_active then
    raise exception 'field_not_found' using errcode = 'P0002';
  end if;
  select * into v_venue from public.venues where id = v_field.venue_id;
  if v_venue.is_hidden then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 30 or p_duration_minutes > 360 or p_duration_minutes % 30 <> 0 then
    raise exception 'invalid_duration' using errcode = '22023';
  end if;
  select c.timezone, c.currency into v_tz, v_currency from public.cities c where c.id = v_venue.city_id;
  v_starts := p_start_local at time zone v_tz;
  v_ends := v_starts + make_interval(mins => p_duration_minutes);
  if v_starts <= now() then
    raise exception 'start_in_past' using errcode = '22023';
  end if;
  if p_enforce_notice then
    if v_starts < now() + make_interval(mins => v_venue.min_notice_minutes) then
      raise exception 'insufficient_notice' using errcode = 'P0001';
    end if;
    if v_starts > now() + make_interval(days => v_venue.max_advance_days) then
      raise exception 'too_far_in_advance' using errcode = 'P0001';
    end if;
  end if;
  if not private.within_opening_hours(v_venue.id, v_starts, v_ends) then
    raise exception 'outside_opening_hours' using errcode = 'P0001';
  end if;
  return query select v_venue.id, v_starts, v_ends,
    v_ends + make_interval(mins => v_venue.buffer_minutes),
    private.price_for_duration(private.field_hourly_price(p_field_id, v_starts), p_duration_minutes),
    v_currency;
end $$;

-- Serializes confirmations on one field (consistent lock order avoids
-- deadlocks between concurrent confirm/auto-reject operations).
create or replace function private.lock_field(p_field uuid)
returns void language sql security definer set search_path = '' as $$
  select null from public.venue_fields where id = p_field for update;
$$;

create or replace function private.slot_is_free(p_field uuid, p_starts timestamptz, p_occupied_until timestamptz, p_ignore uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.bookings b
    where b.field_id = p_field and b.status in ('confirmed', 'completed', 'no_show')
      and (p_ignore is null or b.id <> p_ignore)
      and tstzrange(b.starts_at, b.occupied_until, '[)') && tstzrange(p_starts, p_occupied_until, '[)')
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.venues enable row level security;
alter table public.venue_staff enable row level security;
alter table public.venue_images enable row level security;
alter table public.venue_fields enable row level security;
alter table public.venue_opening_hours enable row level security;
alter table public.venue_pricing_rules enable row level security;
alter table public.bookings enable row level security;

create policy venues_read on public.venues for select using (private.can_view_venue(id));
create policy venue_staff_read on public.venue_staff for select
  using (user_id = (select auth.uid()) or private.is_venue_staff(venue_id) or private.is_moderator());
create policy venue_images_read on public.venue_images for select using (private.can_view_venue(venue_id));
create policy venue_fields_read on public.venue_fields for select using (private.can_view_venue(venue_id));
create policy venue_hours_read on public.venue_opening_hours for select using (private.can_view_venue(venue_id));
create policy venue_pricing_read on public.venue_pricing_rules for select
  using (exists (select 1 from public.venue_fields f where f.id = field_id and private.can_view_venue(f.venue_id)));
create policy bookings_read on public.bookings for select
  using (requested_by = (select auth.uid()) or private.is_venue_staff(venue_id) or private.is_moderator());

-- ---------------------------------------------------------------------------
-- RPCs: venue management
-- ---------------------------------------------------------------------------
create or replace function public.create_venue(
  p_name text,
  p_city_id uuid,
  p_area_id uuid default null,
  p_description text default null,
  p_address text default null,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_phone text default null,
  p_whatsapp text default null,
  p_facilities text[] default '{}'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_id uuid;
begin
  perform private.rate_limit(v_uid, 'create_venue', 3, interval '1 day');
  if not exists (select 1 from public.cities where id = p_city_id and is_active) then
    raise exception 'invalid_city' using errcode = '22023';
  end if;
  if p_area_id is not null and not exists (select 1 from public.areas where id = p_area_id and city_id = p_city_id) then
    raise exception 'invalid_area' using errcode = '22023';
  end if;
  insert into public.venues (name, description, city_id, area_id, address, latitude, longitude, phone, whatsapp, facilities, created_by)
  values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_city_id, p_area_id,
          nullif(btrim(coalesce(p_address, '')), ''), p_latitude, p_longitude,
          nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_whatsapp, '')), ''),
          coalesce(p_facilities, '{}'), v_uid)
  returning id into v_id;
  insert into public.venue_staff (venue_id, user_id, role, added_by) values (v_id, v_uid, 'owner', v_uid);
  perform private.audit('venue.created', 'venue', v_id::text);
  return v_id;
end $$;

create or replace function public.update_venue(
  p_venue_id uuid,
  p_name text,
  p_city_id uuid,
  p_area_id uuid default null,
  p_description text default null,
  p_address text default null,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_phone text default null,
  p_whatsapp text default null,
  p_facilities text[] default '{}',
  p_booking_mode public.booking_mode default 'contact_only',
  p_auto_confirm boolean default false,
  p_buffer_minutes int default 0,
  p_min_notice_minutes int default 60,
  p_max_advance_days int default 30,
  p_cancellation_deadline_hours int default 12,
  p_cancellation_policy text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_old public.venues%rowtype;
begin
  perform private.require_venue_role(p_venue_id, v_uid, true);
  select * into v_old from public.venues where id = p_venue_id;
  if not exists (select 1 from public.cities where id = p_city_id and is_active) then
    raise exception 'invalid_city' using errcode = '22023';
  end if;
  if p_area_id is not null and not exists (select 1 from public.areas where id = p_area_id and city_id = p_city_id) then
    raise exception 'invalid_area' using errcode = '22023';
  end if;
  update public.venues set
    name = btrim(p_name),
    city_id = p_city_id,
    area_id = p_area_id,
    description = nullif(btrim(coalesce(p_description, '')), ''),
    address = nullif(btrim(coalesce(p_address, '')), ''),
    latitude = p_latitude,
    longitude = p_longitude,
    phone = nullif(btrim(coalesce(p_phone, '')), ''),
    whatsapp = nullif(btrim(coalesce(p_whatsapp, '')), ''),
    facilities = coalesce(p_facilities, '{}'),
    booking_mode = coalesce(p_booking_mode, 'contact_only'),
    auto_confirm_bookings = coalesce(p_auto_confirm, false),
    buffer_minutes = coalesce(p_buffer_minutes, 0),
    min_notice_minutes = coalesce(p_min_notice_minutes, 60),
    max_advance_days = coalesce(p_max_advance_days, 30),
    cancellation_deadline_hours = coalesce(p_cancellation_deadline_hours, 12),
    cancellation_policy = nullif(btrim(coalesce(p_cancellation_policy, '')), ''),
    -- Changing name/location of a verified venue requires re-verification.
    verification_status = case
      when v_old.verification_status = 'verified'
       and (v_old.name <> btrim(p_name) or v_old.city_id <> p_city_id) then 'pending'
      else v_old.verification_status end
  where id = p_venue_id;
end $$;

create or replace function public.request_venue_verification(p_venue_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform private.require_venue_role(p_venue_id, v_uid, true);
  update public.venues set verification_status = 'pending'
   where id = p_venue_id and verification_status in ('unverified', 'rejected');
  if not found then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.set_venue_cover(p_venue_id uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform private.require_venue_role(p_venue_id, v_uid, true);
  if p_path is not null and p_path !~ ('^' || p_venue_id::text || '/[A-Za-z0-9._-]{1,100}$') then
    raise exception 'invalid_path' using errcode = '22023';
  end if;
  update public.venues set cover_image_path = p_path where id = p_venue_id;
end $$;

create or replace function public.add_venue_image(p_venue_id uuid, p_path text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_id uuid;
begin
  perform private.require_venue_role(p_venue_id, v_uid, true);
  if p_path !~ ('^' || p_venue_id::text || '/[A-Za-z0-9._-]{1,100}$') then
    raise exception 'invalid_path' using errcode = '22023';
  end if;
  if (select count(*) from public.venue_images where venue_id = p_venue_id) >= 12 then
    raise exception 'too_many_images' using errcode = 'P0001';
  end if;
  insert into public.venue_images (venue_id, path, sort_order)
  values (p_venue_id, p_path, coalesce((select max(sort_order) + 1 from public.venue_images where venue_id = p_venue_id), 0))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.remove_venue_image(p_image_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_img public.venue_images%rowtype;
begin
  select * into v_img from public.venue_images where id = p_image_id;
  if not found then
    raise exception 'image_not_found' using errcode = 'P0002';
  end if;
  perform private.require_venue_role(v_img.venue_id, v_uid, true);
  delete from public.venue_images where id = p_image_id;
  return v_img.path;
end $$;

create or replace function public.upsert_venue_field(
  p_venue_id uuid,
  p_field_id uuid,
  p_name text,
  p_surface public.field_surface,
  p_formats public.match_format[],
  p_is_covered boolean,
  p_has_lights boolean,
  p_price_per_hour bigint,
  p_is_active boolean default true
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_id uuid;
begin
  perform private.require_venue_role(p_venue_id, v_uid, true);
  if p_field_id is null then
    if (select count(*) from public.venue_fields where venue_id = p_venue_id) >= 20 then
      raise exception 'too_many_fields' using errcode = 'P0001';
    end if;
    insert into public.venue_fields (venue_id, name, surface, formats, is_covered, has_lights, price_per_hour, is_active)
    values (p_venue_id, btrim(p_name), p_surface, coalesce(p_formats, '{}'), coalesce(p_is_covered, false),
            coalesce(p_has_lights, true), p_price_per_hour, coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.venue_fields set name = btrim(p_name), surface = p_surface, formats = coalesce(p_formats, '{}'),
      is_covered = coalesce(p_is_covered, false), has_lights = coalesce(p_has_lights, true),
      price_per_hour = p_price_per_hour, is_active = coalesce(p_is_active, true)
    where id = p_field_id and venue_id = p_venue_id
    returning id into v_id;
    if v_id is null then
      raise exception 'field_not_found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end $$;

-- p_hours: [{"weekday":0,"opens":"16:00","closes":"02:00"}, ...]; replaces all.
create or replace function public.set_venue_opening_hours(p_venue_id uuid, p_hours jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_item jsonb;
begin
  perform private.require_venue_role(p_venue_id, v_uid, true);
  if jsonb_typeof(p_hours) <> 'array' then
    raise exception 'invalid_hours' using errcode = '22023';
  end if;
  delete from public.venue_opening_hours where venue_id = p_venue_id;
  for v_item in select * from jsonb_array_elements(p_hours) loop
    insert into public.venue_opening_hours (venue_id, weekday, opens, closes)
    values (p_venue_id, (v_item ->> 'weekday')::smallint, (v_item ->> 'opens')::time, (v_item ->> 'closes')::time);
  end loop;
exception
  when unique_violation then raise exception 'duplicate_weekday' using errcode = '22023';
  when invalid_text_representation or invalid_datetime_format or check_violation or not_null_violation then
    raise exception 'invalid_hours' using errcode = '22023';
end $$;

-- p_rules: [{"weekdays":[4,5],"start_time":"18:00","end_time":"00:00","price_per_hour":40000}]
create or replace function public.set_field_pricing_rules(p_field_id uuid, p_rules jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_venue uuid;
  v_item jsonb;
begin
  select venue_id into v_venue from public.venue_fields where id = p_field_id;
  if v_venue is null then
    raise exception 'field_not_found' using errcode = 'P0002';
  end if;
  perform private.require_venue_role(v_venue, v_uid, true);
  if jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) > 20 then
    raise exception 'invalid_rules' using errcode = '22023';
  end if;
  delete from public.venue_pricing_rules where field_id = p_field_id;
  for v_item in select * from jsonb_array_elements(p_rules) loop
    insert into public.venue_pricing_rules (field_id, weekdays, start_time, end_time, price_per_hour)
    values (p_field_id,
            array(select jsonb_array_elements_text(v_item -> 'weekdays')::smallint),
            (v_item ->> 'start_time')::time, (v_item ->> 'end_time')::time,
            (v_item ->> 'price_per_hour')::bigint);
  end loop;
exception
  when invalid_text_representation or invalid_datetime_format or check_violation or not_null_violation then
    raise exception 'invalid_rules' using errcode = '22023';
end $$;

create or replace function public.add_venue_staff(p_venue_id uuid, p_user_id uuid, p_role public.venue_role)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if private.venue_role_of(p_venue_id, v_uid) is distinct from 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role = 'owner' then
    raise exception 'cannot_add_owner' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and status = 'active') then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  insert into public.venue_staff (venue_id, user_id, role, added_by) values (p_venue_id, p_user_id, p_role, v_uid)
  on conflict (venue_id, user_id) do update set role = excluded.role
  where public.venue_staff.role <> 'owner';
  perform private.audit('venue.staff_set', 'venue', p_venue_id::text, jsonb_build_object('user_id', p_user_id, 'role', p_role));
  perform private.notify(p_user_id, 'venue_staff_added',
    jsonb_build_object('venue_id', p_venue_id, 'venue_name', (select name from public.venues where id = p_venue_id), 'role', p_role));
end $$;

create or replace function public.remove_venue_staff(p_venue_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if private.venue_role_of(p_venue_id, v_uid) is distinct from 'owner' or p_user_id = v_uid then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.venue_staff where venue_id = p_venue_id and user_id = p_user_id and role <> 'owner';
  perform private.audit('venue.staff_removed', 'venue', p_venue_id::text, jsonb_build_object('user_id', p_user_id));
end $$;

-- ---------------------------------------------------------------------------
-- RPCs: availability & quotes (public)
-- ---------------------------------------------------------------------------
create or replace function public.quote_booking(p_field_id uuid, p_start_local timestamp, p_duration_minutes int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v record;
begin
  select * into v from private.validate_booking_slot(p_field_id, p_start_local, p_duration_minutes, true);
  return jsonb_build_object(
    'starts_at', v.starts_at, 'ends_at', v.ends_at, 'price_total', v.price, 'currency', v.currency,
    'available', private.slot_is_free(p_field_id, v.starts_at, v.occupied_until));
end $$;

-- Busy intervals (confirmed bookings incl. buffer) for a field on a local
-- date. Does not expose who booked.
create or replace function public.field_busy_intervals(p_field_id uuid, p_local_date date)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_venue uuid;
  v_tz text;
  v_from timestamptz;
begin
  select venue_id into v_venue from public.venue_fields where id = p_field_id;
  if v_venue is null or not private.can_view_venue(v_venue) then
    raise exception 'field_not_found' using errcode = 'P0002';
  end if;
  v_tz := private.venue_timezone(v_venue);
  v_from := p_local_date::timestamp at time zone v_tz;
  return query
    select b.starts_at, b.occupied_until from public.bookings b
     where b.field_id = p_field_id and b.status in ('confirmed', 'completed', 'no_show')
       and b.starts_at < v_from + interval '30 hours' and b.occupied_until > v_from
     order by b.starts_at;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs: booking lifecycle
-- ---------------------------------------------------------------------------
create or replace function private.reject_overlapping_requests(p_booking public.bookings)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in update public.bookings b set status = 'rejected', decided_at = now(), decision_note = 'slot_taken'
           where b.field_id = p_booking.field_id and b.status = 'requested' and b.id <> p_booking.id
             and tstzrange(b.starts_at, b.occupied_until, '[)') && tstzrange(p_booking.starts_at, p_booking.occupied_until, '[)')
           returning b.id, b.requested_by, b.venue_id, b.starts_at loop
    perform private.notify(r.requested_by, 'booking_rejected',
      jsonb_build_object('booking_id', r.id, 'venue_id', r.venue_id, 'starts_at', r.starts_at, 'reason', 'slot_taken',
                         'venue_name', (select name from public.venues where id = r.venue_id)),
      'booking_decision:' || r.id);
  end loop;
end $$;

create or replace function public.request_booking(
  p_field_id uuid, p_start_local timestamp, p_duration_minutes int, p_note text default null, p_match_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v record;
  v_venue public.venues%rowtype;
  v_booking public.bookings%rowtype;
  v_status public.booking_status;
begin
  select * into v from private.validate_booking_slot(p_field_id, p_start_local, p_duration_minutes, true);
  select * into v_venue from public.venues where id = v.venue_id;
  if v_venue.auto_confirm_bookings then
    perform private.lock_field(p_field_id);
  end if;
  if v_venue.booking_mode <> 'platform' then
    raise exception 'venue_not_bookable' using errcode = 'P0001';
  end if;
  if v_venue.verification_status <> 'verified' then
    raise exception 'venue_not_verified' using errcode = 'P0001';
  end if;
  if (select count(*) from public.bookings where requested_by = v_uid and status = 'requested')
       >= private.setting_int('booking.max_pending_per_user', 5) then
    raise exception 'too_many_pending_bookings' using errcode = 'P0001';
  end if;
  perform private.rate_limit(v_uid, 'booking_request', 20, interval '1 day');
  if not private.slot_is_free(p_field_id, v.starts_at, v.occupied_until) then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;
  v_status := case when v_venue.auto_confirm_bookings then 'confirmed' else 'requested' end;
  begin
    insert into public.bookings (venue_id, field_id, kind, requested_by, created_by, starts_at, ends_at, occupied_until,
                                 status, price_total, currency, customer_note, expires_at,
                                 decided_at)
    values (v.venue_id, p_field_id, 'customer', v_uid, v_uid, v.starts_at, v.ends_at, v.occupied_until,
            v_status, v.price, v.currency, nullif(btrim(coalesce(p_note, '')), ''),
            case when v_status = 'requested'
                 then least(v.starts_at, now() + make_interval(hours => private.setting_int('booking.request_expiry_hours', 24)))
            end,
            case when v_status = 'confirmed' then now() end)
    returning * into v_booking;
  exception when exclusion_violation then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end;
  if p_match_id is not null then
    perform private.link_booking_to_match(v_booking.id, p_match_id, v_uid);
  end if;
  if v_status = 'confirmed' then
    perform private.reject_overlapping_requests(v_booking);
    perform private.notify(v_uid, 'booking_confirmed',
      jsonb_build_object('booking_id', v_booking.id, 'venue_id', v.venue_id, 'venue_name', v_venue.name, 'starts_at', v.starts_at),
      'booking_decision:' || v_booking.id);
  end if;
  perform private.notify_venue_staff(v.venue_id,
    case when v_status = 'confirmed' then 'booking_new_confirmed' else 'booking_requested' end,
    jsonb_build_object('booking_id', v_booking.id, 'venue_id', v.venue_id, 'venue_name', v_venue.name, 'starts_at', v.starts_at,
                       'user_name', (select display_name from public.profiles where id = v_uid)),
    'booking_new:' || v_booking.id);
  return jsonb_build_object('booking_id', v_booking.id, 'status', v_status, 'price_total', v.price, 'currency', v.currency);
end $$;

create or replace function public.decide_booking(p_booking_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_b public.bookings%rowtype;
  v_venue_name text;
begin
  perform private.lock_field((select field_id from public.bookings where id = p_booking_id));
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  perform private.require_venue_role(v_b.venue_id, v_uid, false);
  if v_b.status <> 'requested' then
    raise exception 'booking_not_pending' using errcode = 'P0001';
  end if;
  if p_approve and v_b.starts_at <= now() then
    raise exception 'start_in_past' using errcode = 'P0001';
  end if;
  begin
    update public.bookings set
      status = case when p_approve then 'confirmed' else 'rejected' end::public.booking_status,
      decided_by = v_uid, decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), ''), expires_at = null
    where id = p_booking_id
    returning * into v_b;
  exception when exclusion_violation then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end;
  select name into v_venue_name from public.venues where id = v_b.venue_id;
  if p_approve then
    perform private.reject_overlapping_requests(v_b);
  end if;
  perform private.notify(v_b.requested_by, case when p_approve then 'booking_confirmed' else 'booking_rejected' end,
    jsonb_build_object('booking_id', v_b.id, 'venue_id', v_b.venue_id, 'venue_name', v_venue_name, 'starts_at', v_b.starts_at,
                       'note', v_b.decision_note),
    'booking_decision:' || v_b.id);
end $$;

create or replace function public.cancel_booking(p_booking_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(false);
  v_b public.bookings%rowtype;
  v_venue public.venues%rowtype;
  v_is_staff boolean;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  select * into v_venue from public.venues where id = v_b.venue_id;
  v_is_staff := private.venue_role_of(v_b.venue_id, v_uid) is not null;
  if not v_is_staff and v_b.requested_by is distinct from v_uid then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_b.status not in ('requested', 'confirmed') then
    raise exception 'booking_not_cancellable' using errcode = 'P0001';
  end if;
  if v_b.ends_at <= now() then
    raise exception 'booking_already_ended' using errcode = 'P0001';
  end if;
  -- Customers may cancel a confirmed booking only before the venue's deadline.
  if not v_is_staff and v_b.status = 'confirmed'
     and now() > v_b.starts_at - make_interval(hours => v_venue.cancellation_deadline_hours) then
    raise exception 'cancellation_deadline_passed' using errcode = 'P0001';
  end if;
  update public.bookings set status = 'cancelled', cancelled_by = v_uid, cancelled_at = now(),
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''), expires_at = null
   where id = p_booking_id;
  if v_is_staff and v_b.requested_by is not null and v_b.requested_by <> v_uid then
    perform private.notify(v_b.requested_by, 'booking_cancelled',
      jsonb_build_object('booking_id', v_b.id, 'venue_id', v_b.venue_id, 'venue_name', v_venue.name,
                         'starts_at', v_b.starts_at, 'by', 'venue'), 'booking_cancelled:' || v_b.id);
  elsif not v_is_staff then
    perform private.notify_venue_staff(v_b.venue_id, 'booking_cancelled',
      jsonb_build_object('booking_id', v_b.id, 'venue_id', v_b.venue_id, 'venue_name', v_venue.name,
                         'starts_at', v_b.starts_at, 'by', 'customer'), 'booking_cancelled:' || v_b.id);
  end if;
  perform private.audit('booking.cancelled', 'booking', v_b.id::text, jsonb_build_object('by_staff', v_is_staff));
end $$;

-- Venue staff record a walk-in/phone booking ('manual') or block time ('block').
create or replace function public.create_manual_booking(
  p_field_id uuid, p_start_local timestamp, p_duration_minutes int, p_kind public.booking_kind,
  p_customer_name text default null, p_note text default null, p_price_total bigint default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v record;
  v_id uuid;
begin
  if p_kind not in ('manual', 'block') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  select * into v from private.validate_booking_slot(p_field_id, p_start_local, p_duration_minutes, false);
  perform private.require_venue_role(v.venue_id, v_uid, false);
  perform private.lock_field(p_field_id);
  if p_price_total is not null and p_price_total < 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  begin
    insert into public.bookings (venue_id, field_id, kind, created_by, starts_at, ends_at, occupied_until, status,
                                 price_total, currency, customer_name, internal_note, decided_by, decided_at)
    values (v.venue_id, p_field_id, p_kind, v_uid, v.starts_at, v.ends_at, v.occupied_until, 'confirmed',
            case when p_kind = 'block' then 0 else coalesce(p_price_total, v.price) end, v.currency,
            nullif(btrim(coalesce(p_customer_name, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), v_uid, now())
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end;
  perform private.reject_overlapping_requests((select b from public.bookings b where b.id = v_id));
  return v_id;
end $$;

create or replace function public.mark_booking_outcome(p_booking_id uuid, p_status public.booking_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_b public.bookings%rowtype;
begin
  if p_status not in ('completed', 'no_show') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  perform private.require_venue_role(v_b.venue_id, v_uid, false);
  if v_b.status not in ('confirmed', 'completed', 'no_show') or v_b.kind = 'block' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  if v_b.starts_at > now() then
    raise exception 'booking_not_started' using errcode = 'P0001';
  end if;
  update public.bookings set status = p_status where id = p_booking_id;
end $$;
