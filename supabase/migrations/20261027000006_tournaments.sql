-- =============================================================================
-- Tournaments: registration, fixtures (round robin / knockout), results,
-- knockout advancement and announcements. Fixture structures are generated
-- by deterministic, unit-tested application code (src/lib/domain/tournament)
-- and validated here before insertion; advancement happens here atomically.
-- =============================================================================

create type public.tournament_format as enum ('round_robin', 'single_elimination', 'groups_knockout');
create type public.tournament_status as enum ('draft', 'registration_open', 'registration_closed', 'in_progress', 'completed', 'cancelled');
create type public.tournament_team_status as enum ('pending', 'approved', 'rejected', 'waitlisted', 'withdrawn');
create type public.fixture_stage as enum ('group', 'knockout');
create type public.fixture_status as enum ('scheduled', 'completed', 'cancelled');
create type public.result_status as enum ('none', 'submitted', 'confirmed', 'disputed');

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 3 and 100),
  description text check (char_length(description) <= 3000),
  city_id uuid not null references public.cities(id),
  venue_id uuid references public.venues(id) on delete set null,
  format public.match_format not null,
  tournament_format public.tournament_format not null,
  team_capacity int not null check (team_capacity between 2 and 64),
  group_count int not null default 1 check (group_count between 1 and 16),
  advance_per_group int not null default 2 check (advance_per_group between 1 and 8),
  min_team_size int not null default 5 check (min_team_size between 1 and 30),
  registration_deadline timestamptz not null,
  starts_on date not null,
  ends_on date not null,
  entry_fee bigint check (entry_fee >= 0),
  currency char(3) not null references public.currencies(code),
  eligibility text check (char_length(eligibility) <= 1000),
  rules text check (char_length(rules) <= 3000),
  prizes text check (char_length(prizes) <= 1000),
  points_win int not null default 3 check (points_win between 0 and 10),
  points_draw int not null default 1 check (points_draw between 0 and 10),
  points_loss int not null default 0 check (points_loss between 0 and 10),
  status public.tournament_status not null default 'draft',
  is_hidden boolean not null default false,
  hidden_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (tournament_format <> 'groups_knockout' or group_count >= 2)
);
create index tournaments_city_idx on public.tournaments(city_id, starts_on) where not is_hidden;
create index tournaments_organizer_idx on public.tournaments(organizer_id);
create trigger tournaments_touch before update on public.tournaments for each row execute function private.touch_updated_at();

create table public.tournament_teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  status public.tournament_team_status not null default 'pending',
  seed int check (seed >= 1),
  group_label text check (group_label ~ '^[A-P]$'),
  registered_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (tournament_id, team_id)
);
create index tournament_teams_team_idx on public.tournament_teams(team_id);

create table public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  stage public.fixture_stage not null,
  round int not null check (round >= 1),
  match_number int not null check (match_number >= 1),
  group_label text check (group_label ~ '^[A-P]$'),
  home_team_id uuid references public.teams(id) on delete set null,
  away_team_id uuid references public.teams(id) on delete set null,
  scheduled_at timestamptz,
  location_note text check (char_length(location_note) <= 200),
  status public.fixture_status not null default 'scheduled',
  home_score int check (home_score between 0 and 99),
  away_score int check (away_score between 0 and 99),
  home_penalties int check (home_penalties between 0 and 99),
  away_penalties int check (away_penalties between 0 and 99),
  is_bye boolean not null default false,
  winner_team_id uuid references public.teams(id) on delete set null,
  result_status public.result_status not null default 'none',
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  dispute_reason text check (char_length(dispute_reason) <= 500),
  next_match_id uuid references public.tournament_matches(id) on delete set null,
  next_slot public.team_side,
  unique (tournament_id, stage, round, match_number),
  check (home_team_id is null or away_team_id is null or home_team_id <> away_team_id),
  check ((next_match_id is null) = (next_slot is null))
);
create index tournament_matches_tournament_idx on public.tournament_matches(tournament_id, stage, round, match_number);

create table public.tournament_announcements (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  body text not null check (char_length(body) between 1 and 3000),
  created_at timestamptz not null default now()
);
create index tournament_announcements_idx on public.tournament_announcements(tournament_id, created_at desc);

-- ---------------------------------------------------------------------------
-- State machine & helpers
-- ---------------------------------------------------------------------------
create or replace function public.tournament_transition_allowed(p_from public.tournament_status, p_to public.tournament_status)
returns boolean language sql immutable set search_path = '' as $$
  select p_from = p_to or (p_from, p_to) in (
    ('draft'::public.tournament_status, 'registration_open'::public.tournament_status),
    ('draft', 'cancelled'),
    ('registration_open', 'registration_closed'), ('registration_open', 'cancelled'),
    ('registration_closed', 'registration_open'), ('registration_closed', 'in_progress'), ('registration_closed', 'cancelled'),
    ('in_progress', 'completed'), ('in_progress', 'cancelled')
  );
$$;

create or replace function private.enforce_tournament_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.tournament_transition_allowed(old.status, new.status) then
    raise exception 'invalid_status_transition' using errcode = 'P0001', detail = format('%s -> %s', old.status, new.status);
  end if;
  return new;
end $$;
create trigger tournaments_status_guard before update of status on public.tournaments
  for each row execute function private.enforce_tournament_transition();

create or replace function private.can_view_tournament(p_tournament uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tournaments t where t.id = p_tournament and (
      (t.status <> 'draft' and not t.is_hidden) or t.organizer_id = (select auth.uid()) or private.is_moderator()
    )
  );
$$;

create or replace function private.require_tournament_organizer(p_tournament uuid, p_user uuid)
returns public.tournaments language plpgsql security definer set search_path = '' as $$
declare t public.tournaments%rowtype;
begin
  select * into t from public.tournaments where id = p_tournament for update;
  if not found then
    raise exception 'tournament_not_found' using errcode = 'P0002';
  end if;
  if t.organizer_id <> p_user then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return t;
end $$;

create or replace function private.can_access_tournament_chat(p_tournament uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tournaments where id = p_tournament and organizer_id = p_user)
      or exists (select 1 from public.tournament_teams tt
                 where tt.tournament_id = p_tournament and tt.status in ('pending', 'approved', 'waitlisted')
                   and private.is_team_manager(tt.team_id, p_user));
$$;

create or replace function private.notify_tournament_teams(p_tournament uuid, p_type text, p_payload jsonb, p_dedupe text)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select distinct tm.user_id from public.tournament_teams tt
             join public.team_members tm on tm.team_id = tt.team_id
            where tt.tournament_id = p_tournament and tt.status = 'approved' loop
    perform private.notify(r.user_id, p_type, p_payload, p_dedupe);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.tournaments enable row level security;
alter table public.tournament_teams enable row level security;
alter table public.tournament_matches enable row level security;
alter table public.tournament_announcements enable row level security;

create policy tournaments_read on public.tournaments for select using (private.can_view_tournament(id));
create policy tournament_teams_read on public.tournament_teams for select using (private.can_view_tournament(tournament_id));
create policy tournament_matches_read on public.tournament_matches for select using (private.can_view_tournament(tournament_id));
create policy tournament_announcements_read on public.tournament_announcements for select using (private.can_view_tournament(tournament_id));

-- ---------------------------------------------------------------------------
-- RPCs: tournament setup
-- ---------------------------------------------------------------------------
create or replace function public.upsert_tournament(
  p_tournament_id uuid,
  p_name text,
  p_city_id uuid,
  p_format public.match_format,
  p_tournament_format public.tournament_format,
  p_team_capacity int,
  p_registration_deadline_local timestamp,
  p_starts_on date,
  p_ends_on date,
  p_description text default null,
  p_venue_id uuid default null,
  p_group_count int default 1,
  p_advance_per_group int default 2,
  p_min_team_size int default 5,
  p_entry_fee bigint default null,
  p_eligibility text default null,
  p_rules text default null,
  p_prizes text default null,
  p_points_win int default 3,
  p_points_draw int default 1,
  p_points_loss int default 0
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_city public.cities%rowtype;
  t public.tournaments%rowtype;
  v_deadline timestamptz;
  v_id uuid;
begin
  select * into v_city from public.cities where id = p_city_id and is_active;
  if not found then
    raise exception 'invalid_city' using errcode = '22023';
  end if;
  if p_venue_id is not null and not exists (select 1 from public.venues where id = p_venue_id and city_id = p_city_id) then
    raise exception 'invalid_venue' using errcode = '22023';
  end if;
  v_deadline := p_registration_deadline_local at time zone v_city.timezone;
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on
     or v_deadline > (p_starts_on::timestamp + interval '1 day') at time zone v_city.timezone then
    raise exception 'invalid_dates' using errcode = '22023';
  end if;
  if p_tournament_format = 'groups_knockout' and (coalesce(p_group_count, 1) < 2 or p_group_count * 2 > p_team_capacity) then
    raise exception 'invalid_groups' using errcode = '22023';
  end if;
  if p_tournament_id is null then
    perform private.rate_limit(v_uid, 'create_tournament', 5, interval '1 day');
    if v_deadline <= now() then
      raise exception 'invalid_dates' using errcode = '22023';
    end if;
    insert into public.tournaments (organizer_id, name, description, city_id, venue_id, format, tournament_format, team_capacity,
      group_count, advance_per_group, min_team_size, registration_deadline, starts_on, ends_on, entry_fee, currency,
      eligibility, rules, prizes, points_win, points_draw, points_loss)
    values (v_uid, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_city_id, p_venue_id, p_format,
      p_tournament_format, p_team_capacity, coalesce(p_group_count, 1), coalesce(p_advance_per_group, 2),
      coalesce(p_min_team_size, 5), v_deadline, p_starts_on, p_ends_on, p_entry_fee, v_city.currency,
      nullif(btrim(coalesce(p_eligibility, '')), ''), nullif(btrim(coalesce(p_rules, '')), ''),
      nullif(btrim(coalesce(p_prizes, '')), ''), coalesce(p_points_win, 3), coalesce(p_points_draw, 1), coalesce(p_points_loss, 0))
    returning id into v_id;
    return v_id;
  end if;
  t := private.require_tournament_organizer(p_tournament_id, v_uid);
  if t.status not in ('draft', 'registration_open', 'registration_closed') then
    raise exception 'tournament_locked' using errcode = 'P0001';
  end if;
  if p_team_capacity < (select count(*) from public.tournament_teams where tournament_id = t.id and status = 'approved') then
    raise exception 'capacity_below_registrations' using errcode = 'P0001';
  end if;
  -- Scoring and structure are fixed once registration has opened.
  if t.status <> 'draft' and (p_tournament_format <> t.tournament_format or p_points_win <> t.points_win
      or p_points_draw <> t.points_draw or p_points_loss <> t.points_loss) then
    raise exception 'tournament_locked' using errcode = 'P0001';
  end if;
  update public.tournaments set name = btrim(p_name), description = nullif(btrim(coalesce(p_description, '')), ''),
    city_id = p_city_id, venue_id = p_venue_id, format = p_format, tournament_format = p_tournament_format,
    team_capacity = p_team_capacity, group_count = coalesce(p_group_count, 1), advance_per_group = coalesce(p_advance_per_group, 2),
    min_team_size = coalesce(p_min_team_size, 5), registration_deadline = v_deadline, starts_on = p_starts_on,
    ends_on = p_ends_on, entry_fee = p_entry_fee, eligibility = nullif(btrim(coalesce(p_eligibility, '')), ''),
    rules = nullif(btrim(coalesce(p_rules, '')), ''), prizes = nullif(btrim(coalesce(p_prizes, '')), ''),
    points_win = coalesce(p_points_win, 3), points_draw = coalesce(p_points_draw, 1), points_loss = coalesce(p_points_loss, 0)
  where id = t.id;
  return t.id;
end $$;

create or replace function public.set_tournament_status(p_tournament_id uuid, p_status public.tournament_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(false);
  t public.tournaments%rowtype;
begin
  if p_status = 'in_progress' then
    raise exception 'use_save_fixtures' using errcode = '22023';
  end if;
  select * into t from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'tournament_not_found' using errcode = 'P0002';
  end if;
  if t.organizer_id <> v_uid and not (p_status = 'cancelled' and private.is_moderator()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status = 'registration_open' and t.registration_deadline <= now() then
    raise exception 'registration_deadline_passed' using errcode = 'P0001';
  end if;
  if p_status = 'completed' and exists (select 1 from public.tournament_matches where tournament_id = t.id and status = 'scheduled') then
    raise exception 'fixtures_pending' using errcode = 'P0001';
  end if;
  update public.tournaments set status = p_status where id = t.id;
  if p_status in ('cancelled', 'completed', 'registration_closed') then
    perform private.notify_tournament_teams(t.id, 'tournament_update',
      jsonb_build_object('tournament_id', t.id, 'tournament_name', t.name, 'status', p_status),
      'tournament_status:' || t.id || ':' || p_status);
  end if;
  if t.organizer_id <> v_uid then
    perform private.audit('moderation.tournament_cancelled', 'tournament', t.id::text);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs: registration
-- ---------------------------------------------------------------------------
create or replace function public.register_tournament_team(p_tournament_id uuid, p_team_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  t public.tournaments%rowtype;
  v_existing public.tournament_teams%rowtype;
  v_id uuid;
begin
  perform private.require_team_manager(p_team_id, v_uid);
  select * into t from public.tournaments where id = p_tournament_id for update;
  if not found or not private.can_view_tournament(p_tournament_id) then
    raise exception 'tournament_not_found' using errcode = 'P0002';
  end if;
  if t.status <> 'registration_open' or t.registration_deadline <= now() then
    raise exception 'registration_closed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.teams where id = p_team_id and is_hidden) then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.team_members where team_id = p_team_id) < t.min_team_size then
    raise exception 'team_too_small' using errcode = 'P0001';
  end if;
  select * into v_existing from public.tournament_teams where tournament_id = t.id and team_id = p_team_id;
  if found then
    if v_existing.status in ('pending', 'approved', 'waitlisted') then
      raise exception 'already_registered' using errcode = '23505';
    end if;
    update public.tournament_teams set status = 'pending', registered_by = v_uid, created_at = now(), decided_at = null
     where id = v_existing.id returning id into v_id;
  else
    insert into public.tournament_teams (tournament_id, team_id, registered_by) values (t.id, p_team_id, v_uid) returning id into v_id;
  end if;
  perform private.notify(t.organizer_id, 'tournament_registration',
    jsonb_build_object('tournament_id', t.id, 'tournament_name', t.name, 'team_id', p_team_id,
                       'team_name', (select name from public.teams where id = p_team_id)),
    'tournament_registration:' || v_id || ':' || extract(epoch from now())::bigint);
  return v_id;
end $$;

create or replace function private.promote_tournament_waitlist(p_tournament uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  t public.tournaments%rowtype;
  w public.tournament_teams%rowtype;
begin
  select * into t from public.tournaments where id = p_tournament;
  if t.status not in ('registration_open', 'registration_closed') then return; end if;
  while (select count(*) from public.tournament_teams where tournament_id = t.id and status = 'approved') < t.team_capacity loop
    select * into w from public.tournament_teams where tournament_id = t.id and status = 'waitlisted'
     order by created_at, id limit 1;
    exit when not found;
    update public.tournament_teams set status = 'approved', decided_at = now() where id = w.id;
    perform private.notify_team_managers(w.team_id, 'tournament_registration_decision',
      jsonb_build_object('tournament_id', t.id, 'tournament_name', t.name, 'status', 'approved'),
      'tournament_decision:' || w.id || ':approved');
  end loop;
end $$;

create or replace function public.withdraw_tournament_team(p_tournament_id uuid, p_team_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(false);
  t public.tournaments%rowtype;
begin
  perform private.require_team_manager(p_team_id, v_uid);
  select * into t from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'tournament_not_found' using errcode = 'P0002';
  end if;
  if t.status not in ('draft', 'registration_open', 'registration_closed') then
    raise exception 'tournament_locked' using errcode = 'P0001';
  end if;
  update public.tournament_teams set status = 'withdrawn', decided_at = now()
   where tournament_id = t.id and team_id = p_team_id and status in ('pending', 'approved', 'waitlisted');
  if not found then
    raise exception 'not_registered' using errcode = 'P0002';
  end if;
  perform private.promote_tournament_waitlist(t.id);
  perform private.notify(t.organizer_id, 'tournament_team_withdrew',
    jsonb_build_object('tournament_id', t.id, 'tournament_name', t.name,
                       'team_name', (select name from public.teams where id = p_team_id)),
    'tournament_withdraw:' || t.id || ':' || p_team_id || ':' || extract(epoch from now())::bigint);
end $$;

create or replace function public.decide_tournament_registration(p_registration_id uuid, p_approve boolean)
returns public.tournament_team_status language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  r public.tournament_teams%rowtype;
  t public.tournaments%rowtype;
  v_status public.tournament_team_status;
begin
  select * into r from public.tournament_teams where id = p_registration_id;
  if not found then
    raise exception 'registration_not_found' using errcode = 'P0002';
  end if;
  t := private.require_tournament_organizer(r.tournament_id, v_uid);
  if t.status not in ('registration_open', 'registration_closed') then
    raise exception 'tournament_locked' using errcode = 'P0001';
  end if;
  if r.status not in ('pending', 'waitlisted') then
    raise exception 'registration_not_pending' using errcode = 'P0001';
  end if;
  if not p_approve then
    v_status := 'rejected';
  elsif (select count(*) from public.tournament_teams where tournament_id = t.id and status = 'approved') >= t.team_capacity then
    v_status := 'waitlisted';
  else
    v_status := 'approved';
  end if;
  update public.tournament_teams set status = v_status, decided_at = now() where id = r.id;
  perform private.notify_team_managers(r.team_id, 'tournament_registration_decision',
    jsonb_build_object('tournament_id', t.id, 'tournament_name', t.name, 'status', v_status),
    'tournament_decision:' || r.id || ':' || v_status);
  return v_status;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs: fixtures & results
-- ---------------------------------------------------------------------------
create or replace function private.advance_knockout(p_match uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.tournament_matches%rowtype;
  n public.tournament_matches%rowtype;
begin
  select * into m from public.tournament_matches where id = p_match;
  if m.next_match_id is null or m.winner_team_id is null then return; end if;
  select * into n from public.tournament_matches where id = m.next_match_id for update;
  if n.status = 'completed' and not n.is_bye then
    raise exception 'next_match_already_played' using errcode = 'P0001';
  end if;
  if m.next_slot = 'home' then
    update public.tournament_matches set home_team_id = m.winner_team_id where id = n.id;
  else
    update public.tournament_matches set away_team_id = m.winner_team_id where id = n.id;
  end if;
end $$;

-- p_fixtures: [{"key":"r1m1","stage":"knockout","round":1,"match_number":1,"group_label":null,
--   "home_team_id":"..","away_team_id":"..","next_key":"r2m1","next_slot":"home","scheduled_at":null}]
-- Appends fixtures for a stage that has none yet. Moves the tournament to in_progress.
create or replace function public.save_tournament_fixtures(p_tournament_id uuid, p_fixtures jsonb, p_groups jsonb default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  t public.tournaments%rowtype;
  f jsonb;
  v_keys jsonb := '{}'::jsonb;
  v_id uuid;
  v_stage public.fixture_stage;
  v_count int := 0;
  v_team uuid;
  v_round1 int;
  g record;
begin
  t := private.require_tournament_organizer(p_tournament_id, v_uid);
  if t.status not in ('registration_closed', 'in_progress') then
    raise exception 'registration_must_be_closed' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_fixtures) <> 'array' or jsonb_array_length(p_fixtures) = 0 or jsonb_array_length(p_fixtures) > 600 then
    raise exception 'invalid_fixtures' using errcode = '22023';
  end if;
  v_stage := (p_fixtures -> 0 ->> 'stage')::public.fixture_stage;
  if exists (select 1 from jsonb_array_elements(p_fixtures) e where (e ->> 'stage') <> v_stage::text) then
    raise exception 'invalid_fixtures' using errcode = '22023';
  end if;
  if (t.tournament_format = 'round_robin' and v_stage <> 'group')
     or (t.tournament_format = 'single_elimination' and v_stage <> 'knockout') then
    raise exception 'invalid_fixtures' using errcode = '22023';
  end if;
  if exists (select 1 from public.tournament_matches where tournament_id = t.id and stage = v_stage) then
    raise exception 'fixtures_already_generated' using errcode = 'P0001';
  end if;
  if t.tournament_format = 'groups_knockout' and v_stage = 'knockout' and
     (not exists (select 1 from public.tournament_matches where tournament_id = t.id and stage = 'group')
      or exists (select 1 from public.tournament_matches where tournament_id = t.id and stage = 'group' and status = 'scheduled')) then
    raise exception 'group_stage_incomplete' using errcode = 'P0001';
  end if;
  if t.tournament_format = 'groups_knockout' and v_stage = 'group' and t.status <> 'registration_closed' then
    raise exception 'invalid_fixtures' using errcode = '22023';
  end if;
  -- Every referenced team must be approved.
  for v_team in select distinct x::uuid from jsonb_array_elements(p_fixtures) e,
                  lateral (values (e ->> 'home_team_id'), (e ->> 'away_team_id')) v(x) where x is not null loop
    if not exists (select 1 from public.tournament_teams where tournament_id = t.id and team_id = v_team and status = 'approved') then
      raise exception 'team_not_approved' using errcode = '22023';
    end if;
  end loop;
  -- Group fixtures must have both teams and no repeated pairing within a group.
  if v_stage = 'group' then
    if exists (select 1 from jsonb_array_elements(p_fixtures) e where e ->> 'home_team_id' is null or e ->> 'away_team_id' is null) then
      raise exception 'invalid_fixtures' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(p_fixtures) e
               group by least(e ->> 'home_team_id', e ->> 'away_team_id'), greatest(e ->> 'home_team_id', e ->> 'away_team_id')
               having count(*) > 1) then
      raise exception 'duplicate_pairing' using errcode = '22023';
    end if;
  end if;
  -- Insert, then resolve next_key references.
  for f in select * from jsonb_array_elements(p_fixtures) loop
    insert into public.tournament_matches (tournament_id, stage, round, match_number, group_label, home_team_id, away_team_id, scheduled_at)
    values (t.id, v_stage, (f ->> 'round')::int, (f ->> 'match_number')::int, nullif(f ->> 'group_label', ''),
            (f ->> 'home_team_id')::uuid, (f ->> 'away_team_id')::uuid, (f ->> 'scheduled_at')::timestamptz)
    returning id into v_id;
    v_keys := v_keys || jsonb_build_object(f ->> 'key', v_id);
    v_count := v_count + 1;
  end loop;
  for f in select * from jsonb_array_elements(p_fixtures) where value ->> 'next_key' is not null loop
    if not (v_keys ? (f ->> 'next_key')) or (f ->> 'next_slot') not in ('home', 'away') then
      raise exception 'invalid_fixtures' using errcode = '22023';
    end if;
    update public.tournament_matches set next_match_id = (v_keys ->> (f ->> 'next_key'))::uuid,
           next_slot = (f ->> 'next_slot')::public.team_side
     where id = (v_keys ->> (f ->> 'key'))::uuid;
  end loop;
  -- Group assignments, when provided: {"team_id": "A", ...}
  if p_groups is not null and jsonb_typeof(p_groups) = 'object' then
    for g in select key, value from jsonb_each_text(p_groups) loop
      update public.tournament_teams set group_label = g.value where tournament_id = t.id and team_id = g.key::uuid;
    end loop;
  end if;
  -- First-round knockout byes advance automatically.
  if v_stage = 'knockout' then
    select min(round) into v_round1 from public.tournament_matches where tournament_id = t.id and stage = 'knockout';
    for v_id in select id from public.tournament_matches
                 where tournament_id = t.id and stage = 'knockout' and round = v_round1
                   and ((home_team_id is null) <> (away_team_id is null)) loop
      update public.tournament_matches set status = 'completed', is_bye = true, result_status = 'confirmed',
             winner_team_id = coalesce(home_team_id, away_team_id), confirmed_at = now(), confirmed_by = v_uid
       where id = v_id;
      perform private.advance_knockout(v_id);
    end loop;
  end if;
  if t.status = 'registration_closed' then
    update public.tournaments set status = 'in_progress' where id = t.id;
  end if;
  perform private.notify_tournament_teams(t.id, 'tournament_update',
    jsonb_build_object('tournament_id', t.id, 'tournament_name', t.name, 'status', 'fixtures_published'),
    'tournament_fixtures:' || t.id || ':' || v_stage);
  return v_count;
end $$;

create or replace function public.set_tournament_fixture_schedule(p_match_id uuid, p_scheduled_local timestamp, p_location_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  m public.tournament_matches%rowtype;
  t public.tournaments%rowtype;
begin
  select * into m from public.tournament_matches where id = p_match_id;
  if not found then
    raise exception 'fixture_not_found' using errcode = 'P0002';
  end if;
  t := private.require_tournament_organizer(m.tournament_id, v_uid);
  update public.tournament_matches set
    scheduled_at = case when p_scheduled_local is null then null
                        else p_scheduled_local at time zone (select timezone from public.cities where id = t.city_id) end,
    location_note = nullif(btrim(coalesce(p_location_note, '')), '')
  where id = p_match_id;
end $$;

-- Organizer: records an authoritative (confirmed) result, including corrections.
-- Team managers of the two teams: submit a result for organizer approval.
create or replace function public.record_tournament_result(
  p_match_id uuid, p_home_score int, p_away_score int, p_home_penalties int default null, p_away_penalties int default null
) returns public.result_status language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  m public.tournament_matches%rowtype;
  t public.tournaments%rowtype;
  v_winner uuid;
  v_old_winner uuid;
begin
  select * into m from public.tournament_matches where id = p_match_id for update;
  if not found then
    raise exception 'fixture_not_found' using errcode = 'P0002';
  end if;
  select * into t from public.tournaments where id = m.tournament_id for update;
  if t.status <> 'in_progress' then
    raise exception 'tournament_not_in_progress' using errcode = 'P0001';
  end if;
  if m.is_bye or m.home_team_id is null or m.away_team_id is null then
    raise exception 'fixture_not_ready' using errcode = 'P0001';
  end if;
  if p_home_score is null or p_away_score is null or p_home_score not between 0 and 99 or p_away_score not between 0 and 99 then
    raise exception 'invalid_score' using errcode = '22023';
  end if;
  if m.stage = 'knockout' and p_home_score = p_away_score then
    if p_home_penalties is null or p_away_penalties is null or p_home_penalties = p_away_penalties then
      raise exception 'knockout_needs_winner' using errcode = '22023';
    end if;
  elsif p_home_penalties is not null or p_away_penalties is not null then
    raise exception 'penalties_not_applicable' using errcode = '22023';
  end if;
  v_winner := case
    when p_home_score > p_away_score then m.home_team_id
    when p_away_score > p_home_score then m.away_team_id
    when m.stage = 'knockout' and p_home_penalties > p_away_penalties then m.home_team_id
    when m.stage = 'knockout' then m.away_team_id
    else null end;

  if t.organizer_id = v_uid then
    v_old_winner := m.winner_team_id;
    update public.tournament_matches set home_score = p_home_score, away_score = p_away_score,
      home_penalties = p_home_penalties, away_penalties = p_away_penalties, winner_team_id = v_winner,
      status = 'completed', result_status = 'confirmed', confirmed_by = v_uid, confirmed_at = now(), dispute_reason = null
    where id = m.id;
    if m.stage = 'knockout' and v_old_winner is distinct from v_winner then
      perform private.advance_knockout(m.id);
    end if;
    if m.status = 'completed' then
      perform private.audit('tournament.result_corrected', 'tournament_match', m.id::text,
        jsonb_build_object('from', jsonb_build_array(m.home_score, m.away_score), 'to', jsonb_build_array(p_home_score, p_away_score)));
    end if;
    return 'confirmed';
  end if;

  if not (private.is_team_manager(m.home_team_id, v_uid) or private.is_team_manager(m.away_team_id, v_uid)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if m.result_status = 'confirmed' then
    raise exception 'result_already_confirmed' using errcode = 'P0001';
  end if;
  update public.tournament_matches set home_score = p_home_score, away_score = p_away_score,
    home_penalties = p_home_penalties, away_penalties = p_away_penalties,
    result_status = 'submitted', submitted_by = v_uid, submitted_at = now(), dispute_reason = null
  where id = m.id;
  perform private.notify(t.organizer_id, 'tournament_result_submitted',
    jsonb_build_object('tournament_id', t.id, 'tournament_name', t.name, 'fixture_id', m.id),
    'tournament_result:' || m.id || ':' || extract(epoch from now())::bigint);
  return 'submitted';
end $$;

create or replace function public.confirm_tournament_result(p_match_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  m public.tournament_matches%rowtype;
begin
  select * into m from public.tournament_matches where id = p_match_id;
  if not found then
    raise exception 'fixture_not_found' using errcode = 'P0002';
  end if;
  perform private.require_tournament_organizer(m.tournament_id, v_uid);
  if m.result_status not in ('submitted', 'disputed') then
    raise exception 'no_submitted_result' using errcode = 'P0001';
  end if;
  perform public.record_tournament_result(p_match_id, m.home_score, m.away_score, m.home_penalties, m.away_penalties);
end $$;

create or replace function public.dispute_tournament_result(p_match_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  m public.tournament_matches%rowtype;
  t public.tournaments%rowtype;
begin
  select * into m from public.tournament_matches where id = p_match_id for update;
  if not found then
    raise exception 'fixture_not_found' using errcode = 'P0002';
  end if;
  if not (private.is_team_manager(m.home_team_id, v_uid) or private.is_team_manager(m.away_team_id, v_uid)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if m.result_status <> 'submitted' or m.submitted_by = v_uid then
    raise exception 'cannot_dispute' using errcode = 'P0001';
  end if;
  update public.tournament_matches set result_status = 'disputed', dispute_reason = left(btrim(coalesce(p_reason, '')), 500)
   where id = m.id;
  select * into t from public.tournaments where id = m.tournament_id;
  perform private.notify(t.organizer_id, 'tournament_result_disputed',
    jsonb_build_object('tournament_id', t.id, 'tournament_name', t.name, 'fixture_id', m.id),
    'tournament_dispute:' || m.id);
end $$;

create or replace function public.post_tournament_announcement(p_tournament_id uuid, p_title text, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  t public.tournaments%rowtype;
  v_id uuid;
begin
  t := private.require_tournament_organizer(p_tournament_id, v_uid);
  perform private.rate_limit(v_uid, 'announcement', 20, interval '1 day');
  insert into public.tournament_announcements (tournament_id, author_id, title, body)
  values (t.id, v_uid, btrim(p_title), btrim(p_body)) returning id into v_id;
  perform private.notify_tournament_teams(t.id, 'tournament_update',
    jsonb_build_object('tournament_id', t.id, 'tournament_name', t.name, 'announcement', btrim(p_title)),
    'tournament_announcement:' || v_id);
  return v_id;
end $$;
