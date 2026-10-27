-- =============================================================================
-- Opponent matchmaking: teams publish requests, other teams send challenges.
-- Accepting a challenge atomically creates one team-vs-team match. A partial
-- unique index guarantees at most one accepted challenge per request.
-- =============================================================================

create type public.challenge_status as enum ('pending', 'accepted', 'declined', 'withdrawn', 'expired');
create type public.opponent_request_status as enum ('open', 'matched', 'closed');

create table public.opponent_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  city_id uuid not null references public.cities(id),
  area_ids uuid[] not null default '{}',
  earliest_start timestamptz not null,
  latest_start timestamptz not null,
  format public.match_format not null,
  skill_level public.skill_level,
  venue_id uuid references public.venues(id) on delete set null,
  venue_note text check (char_length(venue_note) <= 300),
  cost_per_team bigint check (cost_per_team >= 0),
  currency char(3) not null references public.currencies(code),
  rules text check (char_length(rules) <= 1000),
  notes text check (char_length(notes) <= 1000),
  status public.opponent_request_status not null default 'open',
  match_id uuid references public.matches(id) on delete set null,
  created_at timestamptz not null default now(),
  check (latest_start >= earliest_start),
  check (latest_start - earliest_start <= interval '30 days')
);
create index opponent_requests_open_idx on public.opponent_requests(city_id, earliest_start) where status = 'open';
create index opponent_requests_team_idx on public.opponent_requests(team_id);

create table public.opponent_challenges (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.opponent_requests(id) on delete cascade,
  challenger_team_id uuid not null references public.teams(id) on delete cascade,
  target_team_id uuid not null references public.teams(id) on delete cascade,
  proposed_starts_at timestamptz not null,
  duration_minutes int not null check (duration_minutes between 30 and 240),
  format public.match_format not null,
  venue_id uuid references public.venues(id) on delete set null,
  location_note text check (char_length(location_note) <= 300),
  cost_per_team bigint check (cost_per_team >= 0),
  message text check (char_length(message) <= 1000),
  status public.challenge_status not null default 'pending',
  match_id uuid references public.matches(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  responded_by uuid references public.profiles(id) on delete set null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  check (challenger_team_id <> target_team_id)
);
create unique index opponent_challenges_one_accepted on public.opponent_challenges(request_id)
  where status = 'accepted' and request_id is not null;
create unique index opponent_challenges_pending_uq on public.opponent_challenges(coalesce(request_id, '00000000-0000-0000-0000-000000000000'::uuid), challenger_team_id, target_team_id)
  where status = 'pending';
create index opponent_challenges_target_idx on public.opponent_challenges(target_team_id, status);
create index opponent_challenges_challenger_idx on public.opponent_challenges(challenger_team_id, status);

create or replace function private.can_view_challenge(p_challenge uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.opponent_challenges c where c.id = p_challenge and (
      private.is_team_member(c.challenger_team_id) or private.is_team_member(c.target_team_id) or private.is_moderator()
    )
  );
$$;

create or replace function private.is_challenge_manager(p_challenge uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.opponent_challenges c where c.id = p_challenge and (
      private.is_team_manager(c.challenger_team_id, p_user) or private.is_team_manager(c.target_team_id, p_user)
    )
  );
$$;

alter table public.opponent_requests enable row level security;
alter table public.opponent_challenges enable row level security;

create policy opponent_requests_read on public.opponent_requests for select
  using (private.can_view_team(team_id));
create policy opponent_challenges_read on public.opponent_challenges for select
  using (private.can_view_challenge(id));

create or replace function public.create_opponent_request(
  p_team_id uuid,
  p_earliest_local timestamp,
  p_latest_local timestamp,
  p_format public.match_format,
  p_area_ids uuid[] default '{}',
  p_skill_level public.skill_level default null,
  p_venue_id uuid default null,
  p_venue_note text default null,
  p_cost_per_team bigint default null,
  p_rules text default null,
  p_notes text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_team public.teams%rowtype;
  v_city public.cities%rowtype;
  v_id uuid;
  v_earliest timestamptz;
  v_latest timestamptz;
begin
  perform private.require_team_manager(p_team_id, v_uid);
  select * into v_team from public.teams where id = p_team_id;
  if v_team.is_hidden then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;
  select * into v_city from public.cities where id = v_team.city_id;
  v_earliest := p_earliest_local at time zone v_city.timezone;
  v_latest := p_latest_local at time zone v_city.timezone;
  if v_earliest < now() or v_latest < v_earliest or v_latest - v_earliest > interval '30 days' then
    raise exception 'invalid_time_window' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_area_ids, '{}')) a(id)
             where not exists (select 1 from public.areas where id = a.id and city_id = v_team.city_id)) then
    raise exception 'invalid_area' using errcode = '22023';
  end if;
  if (select count(*) from public.opponent_requests where team_id = p_team_id and status = 'open') >= 5 then
    raise exception 'too_many_open_listings' using errcode = 'P0001';
  end if;
  insert into public.opponent_requests (team_id, created_by, city_id, area_ids, earliest_start, latest_start, format,
                                        skill_level, venue_id, venue_note, cost_per_team, currency, rules, notes)
  values (p_team_id, v_uid, v_team.city_id, coalesce(p_area_ids, '{}'), v_earliest, v_latest, p_format, p_skill_level,
          p_venue_id, nullif(btrim(coalesce(p_venue_note, '')), ''), p_cost_per_team, v_city.currency,
          nullif(btrim(coalesce(p_rules, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.close_opponent_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_team uuid;
  r record;
begin
  select team_id into v_team from public.opponent_requests where id = p_request_id and status = 'open';
  if v_team is null then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  perform private.require_team_manager(v_team, v_uid);
  update public.opponent_requests set status = 'closed' where id = p_request_id;
  for r in update public.opponent_challenges set status = 'expired', responded_at = now()
           where request_id = p_request_id and status = 'pending' returning id, challenger_team_id loop
    perform private.notify_team_managers(r.challenger_team_id, 'challenge_declined',
      jsonb_build_object('challenge_id', r.id, 'reason', 'request_closed'), 'challenge_response:' || r.id);
  end loop;
end $$;

-- Send a challenge either in response to a request or directly to a team.
create or replace function public.send_challenge(
  p_challenger_team_id uuid,
  p_start_local timestamp,
  p_duration_minutes int,
  p_request_id uuid default null,
  p_target_team_id uuid default null,
  p_format public.match_format default null,
  p_venue_id uuid default null,
  p_location_note text default null,
  p_cost_per_team bigint default null,
  p_message text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_req public.opponent_requests%rowtype;
  v_target uuid;
  v_format public.match_format;
  v_city uuid;
  v_tz text;
  v_starts timestamptz;
  v_id uuid;
  v_challenger_name text;
begin
  perform private.require_team_manager(p_challenger_team_id, v_uid);
  if p_request_id is not null then
    select * into v_req from public.opponent_requests where id = p_request_id;
    if not found or v_req.status <> 'open' or not private.can_view_team(v_req.team_id) then
      raise exception 'request_not_found' using errcode = 'P0002';
    end if;
    v_target := v_req.team_id;
    v_format := v_req.format;
    v_city := v_req.city_id;
  else
    if p_target_team_id is null or not private.can_view_team(p_target_team_id) then
      raise exception 'team_not_found' using errcode = 'P0002';
    end if;
    v_target := p_target_team_id;
    v_format := coalesce(p_format, (select preferred_format from public.teams where id = p_target_team_id), '5v5');
    select city_id into v_city from public.teams where id = p_target_team_id;
  end if;
  if v_target = p_challenger_team_id then
    raise exception 'cannot_challenge_self' using errcode = '22023';
  end if;
  if exists (select 1 from public.teams where id = v_target and (is_archived or is_hidden)) then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;
  select timezone into v_tz from public.cities where id = v_city;
  v_starts := p_start_local at time zone v_tz;
  if v_starts < now() + interval '1 hour' then
    raise exception 'start_too_soon' using errcode = '22023';
  end if;
  if p_request_id is not null and (v_starts < v_req.earliest_start or v_starts > v_req.latest_start) then
    raise exception 'outside_requested_window' using errcode = '22023';
  end if;
  if p_duration_minutes is null or p_duration_minutes not between 30 and 240 then
    raise exception 'invalid_duration' using errcode = '22023';
  end if;
  perform private.rate_limit(v_uid, 'challenge', 20, interval '1 day');
  insert into public.opponent_challenges (request_id, challenger_team_id, target_team_id, proposed_starts_at, duration_minutes,
                                          format, venue_id, location_note, cost_per_team, message, created_by)
  values (p_request_id, p_challenger_team_id, v_target, v_starts, p_duration_minutes, v_format, p_venue_id,
          nullif(btrim(coalesce(p_location_note, '')), ''), p_cost_per_team, nullif(btrim(coalesce(p_message, '')), ''), v_uid)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'already_challenged' using errcode = '23505';
  end if;
  select name into v_challenger_name from public.teams where id = p_challenger_team_id;
  perform private.notify_team_managers(v_target, 'challenge_received',
    jsonb_build_object('challenge_id', v_id, 'team_id', p_challenger_team_id, 'team_name', v_challenger_name,
                       'starts_at', v_starts), 'challenge_received:' || v_id);
  return v_id;
end $$;

create or replace function public.withdraw_challenge(p_challenge_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  c public.opponent_challenges%rowtype;
begin
  select * into c from public.opponent_challenges where id = p_challenge_id for update;
  if not found or not private.is_team_manager(c.challenger_team_id, v_uid) then
    raise exception 'challenge_not_found' using errcode = 'P0002';
  end if;
  if c.status <> 'pending' then
    raise exception 'challenge_not_pending' using errcode = 'P0001';
  end if;
  update public.opponent_challenges set status = 'withdrawn', responded_at = now() where id = c.id;
end $$;

create or replace function public.respond_challenge(p_challenge_id uuid, p_accept boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  c public.opponent_challenges%rowtype;
  v_req public.opponent_requests%rowtype;
  v_home public.teams%rowtype;
  v_away public.teams%rowtype;
  v_city public.cities%rowtype;
  v_match uuid;
  v_size int;
  r record;
begin
  select * into c from public.opponent_challenges where id = p_challenge_id for update;
  if not found or not private.is_team_manager(c.target_team_id, v_uid) then
    raise exception 'challenge_not_found' using errcode = 'P0002';
  end if;
  if c.status <> 'pending' then
    raise exception 'challenge_not_pending' using errcode = 'P0001';
  end if;
  if not p_accept then
    update public.opponent_challenges set status = 'declined', responded_by = v_uid, responded_at = now() where id = c.id;
    perform private.notify_team_managers(c.challenger_team_id, 'challenge_declined',
      jsonb_build_object('challenge_id', c.id, 'team_id', c.target_team_id,
                         'team_name', (select name from public.teams where id = c.target_team_id)),
      'challenge_response:' || c.id);
    return null;
  end if;
  if c.proposed_starts_at <= now() then
    raise exception 'start_in_past' using errcode = 'P0001';
  end if;
  if c.request_id is not null then
    -- Lock the request so only one challenge can be accepted.
    select * into v_req from public.opponent_requests where id = c.request_id for update;
    if v_req.status <> 'open' then
      raise exception 'request_not_open' using errcode = 'P0001';
    end if;
  end if;
  select * into v_home from public.teams where id = c.target_team_id;
  select * into v_away from public.teams where id = c.challenger_team_id;
  select * into v_city from public.cities where id = v_home.city_id;
  v_size := case c.format when '5v5' then 5 when '6v6' then 6 when '7v7' then 7 when '8v8' then 8
                          when '9v9' then 9 else 11 end;
  insert into public.matches (organizer_id, home_team_id, away_team_id, title, city_id, venue_id, location_note,
                              starts_at, ends_at, format, match_type, total_players, currency, total_cost,
                              price_per_player, cost_is_estimate, payment_collector, payment_notes, rules,
                              visibility, join_policy, status)
  values (v_uid, v_home.id, v_away.id, left(v_home.name || ' vs ' || v_away.name, 100), v_home.city_id, c.venue_id,
          c.location_note, c.proposed_starts_at, c.proposed_starts_at + make_interval(mins => c.duration_minutes),
          c.format, 'team_vs_team', v_size * 2, v_city.currency,
          case when c.cost_per_team is not null then c.cost_per_team * 2 end,
          coalesce(private.split_cost(c.cost_per_team, v_size), 0), true, 'each_player',
          case when c.cost_per_team is not null then 'cost_per_team' end, v_req.rules,
          'private', 'invite_only', 'open')
  returning id into v_match;
  update public.opponent_challenges set status = 'accepted', responded_by = v_uid, responded_at = now(), match_id = v_match
   where id = c.id;
  if c.request_id is not null then
    update public.opponent_requests set status = 'matched', match_id = v_match where id = c.request_id;
    for r in update public.opponent_challenges set status = 'expired', responded_at = now()
             where request_id = c.request_id and status = 'pending' returning id, challenger_team_id loop
      perform private.notify_team_managers(r.challenger_team_id, 'challenge_declined',
        jsonb_build_object('challenge_id', r.id, 'reason', 'request_matched'), 'challenge_response:' || r.id);
    end loop;
  end if;
  perform private.notify_team_managers(c.challenger_team_id, 'challenge_accepted',
    jsonb_build_object('challenge_id', c.id, 'match_id', v_match, 'team_name', v_home.name, 'starts_at', c.proposed_starts_at),
    'challenge_response:' || c.id);
  -- Let both rosters know a fixture exists.
  for r in select user_id from public.team_members where team_id in (v_home.id, v_away.id) and user_id <> v_uid loop
    perform private.notify(r.user_id, 'team_match_scheduled',
      jsonb_build_object('match_id', v_match, 'home_team', v_home.name, 'away_team', v_away.name, 'starts_at', c.proposed_starts_at),
      'team_match_scheduled:' || v_match);
  end loop;
  return v_match;
end $$;
