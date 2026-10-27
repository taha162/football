-- =============================================================================
-- Matches: listing, participation, waiting list, invitations, lifecycle.
--
-- Concurrency: every operation that changes who occupies a slot locks the
-- match row (SELECT ... FOR UPDATE) and recounts confirmed participants while
-- holding the lock, so concurrent joins are serialized per match and capacity
-- can never be exceeded. A partial unique index prevents duplicate active
-- registrations even if a code path forgot to check.
-- =============================================================================

create type public.match_type as enum ('open', 'team_needs_players', 'team_vs_team', 'private');
create type public.match_status as enum ('draft', 'open', 'full', 'confirmed', 'in_progress', 'completed', 'cancelled');
create type public.match_join_policy as enum ('open', 'approval', 'invite_only');
create type public.match_booking_status as enum ('none', 'external', 'requested', 'confirmed');
create type public.payment_collector as enum ('organizer', 'venue', 'each_player', 'none');
create type public.participant_status as enum ('pending', 'confirmed', 'left', 'removed', 'rejected');
create type public.waitlist_status as enum ('waiting', 'promoted', 'left', 'removed', 'expired');
create type public.attendance_status as enum ('attended', 'no_show', 'excused');
create type public.manual_payment_status as enum ('unpaid', 'paid', 'waived');
create type public.team_side as enum ('home', 'away');

create table public.match_series (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.profiles(id) on delete cascade,
  occurrences int not null check (occurrences between 2 and 12),
  created_at timestamptz not null default now()
);
alter table public.match_series enable row level security;
create policy match_series_read on public.match_series for select using (true);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  home_team_id uuid references public.teams(id) on delete set null,
  away_team_id uuid references public.teams(id) on delete set null,
  series_id uuid references public.match_series(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 3 and 100),
  description text check (char_length(description) <= 2000),
  city_id uuid not null references public.cities(id),
  area_id uuid references public.areas(id),
  venue_id uuid references public.venues(id) on delete set null,
  field_id uuid references public.venue_fields(id) on delete set null,
  location_note text check (char_length(location_note) <= 300),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  format public.match_format not null,
  match_type public.match_type not null default 'open',
  -- Full roster size including reserved spots (e.g. 10 for 5v5).
  total_players int not null check (total_players between 2 and 30),
  -- Players already confirmed outside the platform (counted in the roster).
  reserved_spots int not null default 0 check (reserved_spots >= 0),
  confirmed_count int not null default 0 check (confirmed_count >= 0),
  pending_count int not null default 0 check (pending_count >= 0),
  waitlist_count int not null default 0 check (waitlist_count >= 0),
  -- {"goalkeeper": 1, "defender": 2}; empty object = any position.
  positions_needed jsonb not null default '{}'::jsonb check (jsonb_typeof(positions_needed) = 'object'),
  skill_level public.skill_level,
  currency char(3) not null references public.currencies(code),
  total_cost bigint check (total_cost >= 0),
  paying_players int check (paying_players between 1 and 60),
  price_per_player bigint not null default 0 check (price_per_player >= 0),
  cost_is_estimate boolean not null default true,
  payment_collector public.payment_collector not null default 'organizer',
  payment_notes text check (char_length(payment_notes) <= 500),
  rules text check (char_length(rules) <= 1000),
  visibility public.visibility_level not null default 'public',
  join_policy public.match_join_policy not null default 'open',
  leave_deadline_hours int not null default 6 check (leave_deadline_hours between 0 and 72),
  booking_status public.match_booking_status not null default 'none',
  booking_id uuid references public.bookings(id) on delete set null,
  status public.match_status not null default 'draft',
  cancelled_reason text check (char_length(cancelled_reason) <= 500),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  is_hidden boolean not null default false,
  hidden_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '6 hours'),
  check (reserved_spots < total_players),
  check (confirmed_count + reserved_spots <= total_players),
  check (match_type <> 'team_vs_team' or (home_team_id is not null and away_team_id is not null and home_team_id <> away_team_id)),
  check (match_type <> 'private' or (visibility = 'private' and join_policy = 'invite_only'))
);
create index matches_discovery_idx on public.matches(city_id, starts_at)
  where status in ('open', 'full', 'confirmed') and not is_hidden;
create index matches_organizer_idx on public.matches(organizer_id, starts_at desc);
create index matches_venue_idx on public.matches(venue_id, starts_at);
create index matches_team_idx on public.matches(team_id) where team_id is not null;
create index matches_home_team_idx on public.matches(home_team_id) where home_team_id is not null;
create index matches_away_team_idx on public.matches(away_team_id) where away_team_id is not null;
create trigger matches_touch before update on public.matches for each row execute function private.touch_updated_at();

alter table public.bookings add constraint bookings_match_fk foreign key (match_id) references public.matches(id) on delete set null;

create table public.match_participants (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status public.participant_status not null,
  position public.player_position,
  team_side public.team_side,
  joined_at timestamptz not null default now(),
  confirmed_at timestamptz,
  left_at timestamptz,
  late_withdrawal boolean not null default false,
  via_invitation boolean not null default false,
  promoted_from_waitlist boolean not null default false,
  removed_reason text check (char_length(removed_reason) <= 300),
  attendance public.attendance_status,
  payment_status public.manual_payment_status not null default 'unpaid',
  payment_marked_by uuid references public.profiles(id) on delete set null,
  payment_marked_at timestamptz
);
create unique index match_participants_active_uq on public.match_participants(match_id, user_id)
  where status in ('pending', 'confirmed');
create index match_participants_match_idx on public.match_participants(match_id, status);
create index match_participants_user_idx on public.match_participants(user_id, joined_at desc);

create table public.match_waitlist (
  id uuid primary key default gen_random_uuid(),
  -- Assigned while the match row is locked, so it reflects true arrival order.
  seq bigint generated always as identity unique,
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  position public.player_position,
  team_side public.team_side,
  status public.waitlist_status not null default 'waiting',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index match_waitlist_waiting_uq on public.match_waitlist(match_id, user_id) where status = 'waiting';
create index match_waitlist_order_idx on public.match_waitlist(match_id, seq) where status = 'waiting';
create index match_waitlist_user_idx on public.match_waitlist(user_id);

create table public.match_invitations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  invitee_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid references public.profiles(id) on delete set null,
  status public.invitation_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index match_invitations_pending_uq on public.match_invitations(match_id, invitee_id) where status = 'pending';
create index match_invitations_invitee_idx on public.match_invitations(invitee_id, status);

-- ---------------------------------------------------------------------------
-- State machine
-- ---------------------------------------------------------------------------
create or replace function public.match_transition_allowed(p_from public.match_status, p_to public.match_status)
returns boolean language sql immutable set search_path = '' as $$
  select p_from = p_to or (p_from, p_to) in (
    ('draft'::public.match_status, 'open'::public.match_status),
    ('draft', 'cancelled'),
    ('open', 'full'), ('open', 'confirmed'), ('open', 'in_progress'), ('open', 'completed'), ('open', 'cancelled'),
    ('full', 'open'), ('full', 'confirmed'), ('full', 'in_progress'), ('full', 'completed'), ('full', 'cancelled'),
    ('confirmed', 'in_progress'), ('confirmed', 'completed'), ('confirmed', 'cancelled'),
    ('in_progress', 'completed'), ('in_progress', 'cancelled')
  );
$$;

create or replace function private.enforce_match_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.match_transition_allowed(old.status, new.status) then
    raise exception 'invalid_status_transition' using errcode = 'P0001',
      detail = format('%s -> %s', old.status, new.status);
  end if;
  return new;
end $$;
create trigger matches_status_guard before update of status on public.matches
  for each row execute function private.enforce_match_transition();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.split_cost(p_total bigint, p_players int)
returns bigint language sql immutable set search_path = '' as $$
  -- Ceiling division: the organizer never ends up short.
  select case when p_total is null or p_players is null or p_players <= 0 then null
              else (p_total + p_players - 1) / p_players end;
$$;

create or replace function private.distance_km(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns double precision language sql immutable set search_path = '' as $$
  select case when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null else
    6371.0 * 2 * asin(sqrt(
      power(sin(radians((lat2 - lat1)::double precision) / 2), 2) +
      cos(radians(lat1::double precision)) * cos(radians(lat2::double precision)) *
      power(sin(radians((lng2 - lng1)::double precision) / 2), 2)))
  end;
$$;

create or replace function private.can_view_match(p_match uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.matches m
    where m.id = p_match and (
      (m.visibility = 'public' and m.status <> 'draft' and not m.is_hidden)
      or m.organizer_id = (select auth.uid())
      or private.is_moderator()
      or exists (select 1 from public.match_participants p where p.match_id = m.id and p.user_id = (select auth.uid()))
      or exists (select 1 from public.match_waitlist w where w.match_id = m.id and w.user_id = (select auth.uid()))
      or exists (select 1 from public.match_invitations i where i.match_id = m.id and i.invitee_id = (select auth.uid()) and i.status = 'pending')
      or (m.status <> 'draft' and exists (
            select 1 from public.team_members tm
            where tm.user_id = (select auth.uid()) and tm.team_id in (m.team_id, m.home_team_id, m.away_team_id)))
    )
  );
$$;

create or replace function private.is_match_organizer(p_match uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.matches m where m.id = p_match and (
      m.organizer_id = p_user
      or (m.match_type = 'team_vs_team' and private.is_team_manager(m.home_team_id, p_user))
    )
  );
$$;

create or replace function private.is_confirmed_participant(p_match uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.match_participants
                 where match_id = p_match and user_id = p_user and status = 'confirmed');
$$;

-- Users who should hear about a match: organizer + active participants.
create or replace function private.match_audience(p_match uuid)
returns table (user_id uuid) language sql stable security definer set search_path = '' as $$
  select organizer_id from public.matches where id = p_match
  union
  select p.user_id from public.match_participants p where p.match_id = p_match and p.status in ('pending', 'confirmed');
$$;

-- Recalculate counters and open/full status. Caller must hold the match lock.
create or replace function private.recount_match(p_match uuid)
returns public.matches language plpgsql security definer set search_path = '' as $$
declare v public.matches%rowtype;
begin
  update public.matches m set
    confirmed_count = (select count(*) from public.match_participants p where p.match_id = m.id and p.status = 'confirmed'),
    pending_count = (select count(*) from public.match_participants p where p.match_id = m.id and p.status = 'pending'),
    waitlist_count = (select count(*) from public.match_waitlist w where w.match_id = m.id and w.status = 'waiting')
  where m.id = p_match
  returning * into v;
  if v.status = 'open' and v.confirmed_count + v.reserved_spots >= v.total_players then
    update public.matches set status = 'full' where id = p_match returning * into v;
  elsif v.status = 'full' and v.confirmed_count + v.reserved_spots < v.total_players then
    update public.matches set status = 'open' where id = p_match returning * into v;
  end if;
  return v;
end $$;

create or replace function private.open_slots(m public.matches, p_side public.team_side default null)
returns int language plpgsql stable security definer set search_path = '' as $$
declare v_side_count int;
begin
  if m.match_type = 'team_vs_team' and p_side is not null then
    select count(*) into v_side_count from public.match_participants
     where match_id = m.id and status = 'confirmed' and team_side = p_side;
    return least(m.total_players / 2 - v_side_count, m.total_players - m.reserved_spots - m.confirmed_count);
  end if;
  return m.total_players - m.reserved_spots - m.confirmed_count;
end $$;

-- Promote waiting users while slots remain. Caller must hold the match lock.
create or replace function private.promote_waitlist(p_match uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  m public.matches%rowtype;
  w public.match_waitlist%rowtype;
  v_promoted int := 0;
begin
  loop
    select * into m from public.matches where id = p_match;
    exit when m.status not in ('open', 'full', 'confirmed') or m.starts_at <= now();
    exit when private.open_slots(m) <= 0;
    select wl.* into w from public.match_waitlist wl
      join public.profiles pr on pr.id = wl.user_id
     where wl.match_id = p_match and wl.status = 'waiting' and pr.status = 'active'
       and not private.is_blocked_between(m.organizer_id, wl.user_id)
       and not exists (select 1 from public.match_participants p
                        where p.match_id = p_match and p.user_id = wl.user_id and p.status in ('pending', 'confirmed'))
       and (m.match_type <> 'team_vs_team' or private.open_slots(m, wl.team_side) > 0)
     order by wl.seq
     limit 1;
    exit when not found;
    update public.match_waitlist set status = 'promoted', resolved_at = now() where id = w.id;
    insert into public.match_participants (match_id, user_id, status, position, team_side, confirmed_at, promoted_from_waitlist)
    values (p_match, w.user_id, 'confirmed', w.position, w.team_side, now(), true);
    perform private.recount_match(p_match);
    perform private.notify(w.user_id, 'waitlist_promoted',
      jsonb_build_object('match_id', p_match, 'match_title', m.title, 'starts_at', m.starts_at),
      'waitlist_promoted:' || w.id);
    perform private.notify(m.organizer_id, 'match_participant_joined',
      jsonb_build_object('match_id', p_match, 'match_title', m.title, 'user_id', w.user_id,
                         'user_name', (select display_name from public.profiles where id = w.user_id), 'from_waitlist', true),
      'participant_joined:' || w.id);
    v_promoted := v_promoted + 1;
  end loop;
  perform private.recount_match(p_match);
  return v_promoted;
end $$;

-- Core join logic shared by join_match and invitation acceptance.
create or replace function private.do_join(
  p_uid uuid, p_match uuid, p_position public.player_position, p_waitlist_if_full boolean, p_invitation uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.matches%rowtype;
  v_side public.team_side;
  v_slots int;
  v_pid uuid;
  v_wid uuid;
  v_pos int;
begin
  -- Serialize all slot changes for this match.
  select * into m from public.matches where id = p_match for update;
  if not found or (m.is_hidden and m.organizer_id <> p_uid) then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if m.status not in ('open', 'full', 'confirmed') then
    raise exception 'match_not_joinable' using errcode = 'P0001', detail = m.status::text;
  end if;
  if m.starts_at <= now() then
    raise exception 'match_already_started' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.match_participants where match_id = p_match and user_id = p_uid and status in ('pending', 'confirmed')) then
    raise exception 'already_joined' using errcode = '23505';
  end if;
  if exists (select 1 from public.match_waitlist where match_id = p_match and user_id = p_uid and status = 'waiting') then
    raise exception 'already_waitlisted' using errcode = '23505';
  end if;
  if private.is_blocked_between(m.organizer_id, p_uid) then
    raise exception 'user_blocked' using errcode = '42501';
  end if;

  if m.match_type = 'team_vs_team' then
    if exists (select 1 from public.team_members where team_id = m.home_team_id and user_id = p_uid) then
      v_side := 'home';
    elsif exists (select 1 from public.team_members where team_id = m.away_team_id and user_id = p_uid) then
      v_side := 'away';
    elsif p_invitation is null then
      raise exception 'not_team_member' using errcode = '42501';
    end if;
  elsif p_invitation is null and m.join_policy = 'invite_only' then
    raise exception 'invitation_required' using errcode = '42501';
  elsif p_invitation is null and m.visibility = 'private' then
    raise exception 'invitation_required' using errcode = '42501';
  end if;

  -- Approval-based matches: a pending request does not consume a slot.
  if m.join_policy = 'approval' and p_invitation is null and m.match_type <> 'team_vs_team' then
    insert into public.match_participants (match_id, user_id, status, position)
    values (p_match, p_uid, 'pending', p_position) returning id into v_pid;
    perform private.recount_match(p_match);
    perform private.notify(m.organizer_id, 'match_join_request',
      jsonb_build_object('match_id', p_match, 'match_title', m.title, 'participant_id', v_pid, 'user_id', p_uid,
                         'user_name', (select display_name from public.profiles where id = p_uid)),
      'match_join_request:' || v_pid);
    return jsonb_build_object('result', 'pending', 'participant_id', v_pid);
  end if;

  v_slots := private.open_slots(m, v_side);
  if v_slots > 0 then
    insert into public.match_participants (match_id, user_id, status, position, team_side, confirmed_at, via_invitation)
    values (p_match, p_uid, 'confirmed', p_position, v_side, now(), p_invitation is not null) returning id into v_pid;
    perform private.recount_match(p_match);
    perform private.notify(p_uid, 'match_joined',
      jsonb_build_object('match_id', p_match, 'match_title', m.title, 'starts_at', m.starts_at),
      'match_joined:' || v_pid);
    if m.organizer_id <> p_uid then
      perform private.notify(m.organizer_id, 'match_participant_joined',
        jsonb_build_object('match_id', p_match, 'match_title', m.title, 'user_id', p_uid,
                           'user_name', (select display_name from public.profiles where id = p_uid)),
        'participant_joined:' || v_pid);
    end if;
    return jsonb_build_object('result', 'joined', 'participant_id', v_pid);
  end if;

  if not coalesce(p_waitlist_if_full, false) then
    return jsonb_build_object('result', 'full');
  end if;
  insert into public.match_waitlist (match_id, user_id, position, team_side)
  values (p_match, p_uid, p_position, v_side) returning id into v_wid;
  perform private.recount_match(p_match);
  select count(*) into v_pos from public.match_waitlist
   where match_id = p_match and status = 'waiting'
     and seq <= (select seq from public.match_waitlist where id = v_wid);
  return jsonb_build_object('result', 'waitlisted', 'waitlist_id', v_wid, 'waitlist_position', v_pos);
end $$;

-- Validates and links a booking to a match the caller organizes.
create or replace function private.link_booking_to_match(p_booking uuid, p_match uuid, p_uid uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings%rowtype;
  m public.matches%rowtype;
begin
  select * into b from public.bookings where id = p_booking;
  select * into m from public.matches where id = p_match for update;
  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if not private.is_match_organizer(p_match, p_uid) or b.requested_by is distinct from p_uid then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if m.status in ('completed', 'cancelled') then
    raise exception 'match_not_editable' using errcode = 'P0001';
  end if;
  if b.starts_at > m.starts_at or b.ends_at < m.ends_at then
    raise exception 'booking_time_mismatch' using errcode = 'P0001';
  end if;
  update public.bookings set match_id = p_match where id = p_booking;
  update public.matches set booking_id = p_booking, venue_id = b.venue_id, field_id = b.field_id,
         booking_status = case when b.status in ('confirmed', 'completed') then 'confirmed'
                               when b.status = 'requested' then 'requested' else 'none' end::public.match_booking_status
   where id = p_match;
end $$;

-- Keep match.booking_status in sync with its linked booking.
create or replace function private.sync_match_booking_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.status is distinct from old.status and new.match_id is not null then
    for r in update public.matches m set booking_status = case
               when new.status in ('confirmed', 'completed') then 'confirmed'
               when new.status = 'requested' then 'requested'
               else 'none' end::public.match_booking_status
             where m.booking_id = new.id
             returning m.id, m.title, m.organizer_id loop
      if new.status in ('rejected', 'cancelled', 'expired') then
        perform private.notify(r.organizer_id, 'match_booking_lost',
          jsonb_build_object('match_id', r.id, 'match_title', r.title, 'booking_status', new.status),
          'match_booking_lost:' || new.id);
      end if;
    end loop;
  end if;
  return new;
end $$;
create trigger bookings_sync_match after update of status on public.bookings
  for each row execute function private.sync_match_booking_status();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.matches enable row level security;
alter table public.match_participants enable row level security;
alter table public.match_waitlist enable row level security;
alter table public.match_invitations enable row level security;

create policy matches_read on public.matches for select using (private.can_view_match(id));

-- Rosters are visible to signed-in users who can see the match. Completed
-- participation of users who hide their history is only visible to people
-- involved in the same match.
create policy match_participants_read on public.match_participants for select using (
  user_id = (select auth.uid())
  or private.is_moderator()
  or ((select auth.uid()) is not null and private.can_view_match(match_id) and (
        exists (select 1 from public.matches m where m.id = match_id and m.status not in ('completed', 'cancelled'))
        or exists (select 1 from public.profiles pr where pr.id = user_id and pr.show_match_history)
        or private.is_match_organizer(match_id, (select auth.uid()))
        or private.is_confirmed_participant(match_id, (select auth.uid()))))
);
create policy match_waitlist_read on public.match_waitlist for select using (
  user_id = (select auth.uid()) or private.is_match_organizer(match_id, (select auth.uid())) or private.is_moderator()
);
create policy match_invitations_read on public.match_invitations for select using (
  invitee_id = (select auth.uid()) or private.is_match_organizer(match_id, (select auth.uid())) or private.is_moderator()
);

-- ---------------------------------------------------------------------------
-- RPCs: create / update / lifecycle
-- ---------------------------------------------------------------------------
create or replace function private.validate_positions_needed(p jsonb, p_total int)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v jsonb;
  v_sum int := 0;
begin
  if p is null then return '{}'::jsonb; end if;
  if jsonb_typeof(p) <> 'object' then
    raise exception 'invalid_positions' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p) loop
    if k not in ('goalkeeper', 'defender', 'midfielder', 'forward') or jsonb_typeof(v) <> 'number'
       or (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric) or (v #>> '{}')::int < 1 then
      raise exception 'invalid_positions' using errcode = '22023';
    end if;
    v_sum := v_sum + (v #>> '{}')::int;
  end loop;
  if v_sum > p_total then
    raise exception 'invalid_positions' using errcode = '22023';
  end if;
  return p;
end $$;

create or replace function public.create_match(
  p_title text,
  p_city_id uuid,
  p_start_local timestamp,
  p_duration_minutes int,
  p_format public.match_format,
  p_total_players int,
  p_match_type public.match_type default 'open',
  p_description text default null,
  p_area_id uuid default null,
  p_venue_id uuid default null,
  p_field_id uuid default null,
  p_location_note text default null,
  p_reserved_spots int default 0,
  p_positions_needed jsonb default '{}'::jsonb,
  p_skill_level public.skill_level default null,
  p_total_cost bigint default null,
  p_paying_players int default null,
  p_price_per_player bigint default null,
  p_cost_is_estimate boolean default true,
  p_payment_collector public.payment_collector default 'organizer',
  p_payment_notes text default null,
  p_rules text default null,
  p_visibility public.visibility_level default 'public',
  p_join_policy public.match_join_policy default 'open',
  p_leave_deadline_hours int default null,
  p_external_booking boolean default false,
  p_team_id uuid default null,
  p_organizer_plays boolean default true,
  p_organizer_position public.player_position default null,
  p_publish boolean default true,
  p_repeat_weeks int default 0
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_city public.cities%rowtype;
  v_starts timestamptz;
  v_series uuid;
  v_first uuid;
  v_id uuid;
  v_price bigint;
  v_visibility public.visibility_level := coalesce(p_visibility, 'public');
  v_policy public.match_join_policy := coalesce(p_join_policy, 'open');
  v_positions jsonb;
  i int;
begin
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 100 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;
  select * into v_city from public.cities where id = p_city_id and is_active;
  if not found then
    raise exception 'invalid_city' using errcode = '22023';
  end if;
  if p_area_id is not null and not exists (select 1 from public.areas where id = p_area_id and city_id = p_city_id) then
    raise exception 'invalid_area' using errcode = '22023';
  end if;
  if p_venue_id is not null and not exists (select 1 from public.venues where id = p_venue_id and city_id = p_city_id and not is_hidden) then
    raise exception 'invalid_venue' using errcode = '22023';
  end if;
  if p_field_id is not null and not exists (select 1 from public.venue_fields where id = p_field_id and venue_id = p_venue_id) then
    raise exception 'invalid_field' using errcode = '22023';
  end if;
  if p_duration_minutes is null or p_duration_minutes not between 30 and 360 then
    raise exception 'invalid_duration' using errcode = '22023';
  end if;
  if p_total_players is null or p_total_players not between 2 and 30 then
    raise exception 'invalid_capacity' using errcode = '22023';
  end if;
  if coalesce(p_reserved_spots, 0) < 0 or coalesce(p_reserved_spots, 0) >= p_total_players then
    raise exception 'invalid_reserved_spots' using errcode = '22023';
  end if;
  if coalesce(p_repeat_weeks, 0) not between 0 and 11 then
    raise exception 'invalid_recurrence' using errcode = '22023';
  end if;
  if p_match_type = 'team_vs_team' then
    raise exception 'use_opponent_challenges' using errcode = '22023';
  end if;
  if p_match_type = 'team_needs_players' then
    if p_team_id is null or not private.is_team_manager(p_team_id, v_uid) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  elsif p_team_id is not null then
    raise exception 'team_not_allowed' using errcode = '22023';
  end if;
  if p_match_type = 'private' then
    v_visibility := 'private';
    v_policy := 'invite_only';
  end if;
  if p_total_cost is not null and p_total_cost < 0 or p_price_per_player is not null and p_price_per_player < 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  v_positions := private.validate_positions_needed(p_positions_needed, p_total_players);
  v_starts := p_start_local at time zone v_city.timezone;
  if v_starts < now() + interval '15 minutes' then
    raise exception 'start_too_soon' using errcode = '22023';
  end if;
  if v_starts > now() + interval '180 days' then
    raise exception 'start_too_far' using errcode = '22023';
  end if;
  if (select count(*) from public.matches where organizer_id = v_uid and status in ('draft', 'open', 'full', 'confirmed')
        and starts_at > now()) + coalesce(p_repeat_weeks, 0) >= private.setting_int('match.max_open_created_per_user', 20) then
    raise exception 'too_many_active_matches' using errcode = 'P0001';
  end if;
  perform private.rate_limit(v_uid, 'create_match', 30, interval '1 day');

  v_price := coalesce(p_price_per_player,
                      private.split_cost(p_total_cost, coalesce(p_paying_players, p_total_players)), 0);

  if coalesce(p_repeat_weeks, 0) > 0 then
    insert into public.match_series (organizer_id, occurrences) values (v_uid, p_repeat_weeks + 1) returning id into v_series;
  end if;

  for i in 0 .. coalesce(p_repeat_weeks, 0) loop
    insert into public.matches (
      organizer_id, team_id, series_id, title, description, city_id, area_id, venue_id, field_id, location_note,
      starts_at, ends_at, format, match_type, total_players, reserved_spots, positions_needed, skill_level, currency,
      total_cost, paying_players, price_per_player, cost_is_estimate, payment_collector, payment_notes, rules,
      visibility, join_policy, leave_deadline_hours, booking_status, status)
    values (
      v_uid, p_team_id, v_series, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_city_id, p_area_id,
      p_venue_id, p_field_id, nullif(btrim(coalesce(p_location_note, '')), ''),
      v_starts + make_interval(days => 7 * i), v_starts + make_interval(days => 7 * i, mins => p_duration_minutes),
      p_format, coalesce(p_match_type, 'open'), p_total_players, coalesce(p_reserved_spots, 0), v_positions, p_skill_level,
      v_city.currency, p_total_cost, p_paying_players, v_price, coalesce(p_cost_is_estimate, true),
      coalesce(p_payment_collector, 'organizer'), nullif(btrim(coalesce(p_payment_notes, '')), ''),
      nullif(btrim(coalesce(p_rules, '')), ''), v_visibility, v_policy,
      coalesce(p_leave_deadline_hours, private.setting_int('match.default_leave_deadline_hours', 6)),
      case when p_external_booking then 'external' else 'none' end::public.match_booking_status,
      'draft')
    returning id into v_id;
    if coalesce(p_organizer_plays, true) then
      insert into public.match_participants (match_id, user_id, status, position, confirmed_at)
      values (v_id, v_uid, 'confirmed', p_organizer_position, now());
    end if;
    if coalesce(p_publish, true) then
      update public.matches set status = 'open' where id = v_id;
    end if;
    perform private.recount_match(v_id);
    v_first := coalesce(v_first, v_id);
  end loop;
  return v_first;
end $$;

create or replace function public.update_match(
  p_match_id uuid,
  p_title text,
  p_start_local timestamp,
  p_duration_minutes int,
  p_total_players int,
  p_description text default null,
  p_area_id uuid default null,
  p_venue_id uuid default null,
  p_field_id uuid default null,
  p_location_note text default null,
  p_reserved_spots int default 0,
  p_positions_needed jsonb default '{}'::jsonb,
  p_skill_level public.skill_level default null,
  p_total_cost bigint default null,
  p_paying_players int default null,
  p_price_per_player bigint default null,
  p_cost_is_estimate boolean default true,
  p_payment_collector public.payment_collector default 'organizer',
  p_payment_notes text default null,
  p_rules text default null,
  p_visibility public.visibility_level default 'public',
  p_join_policy public.match_join_policy default 'open',
  p_leave_deadline_hours int default 6,
  p_external_booking boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  m public.matches%rowtype;
  v_tz text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_price bigint;
  v_material boolean;
  r record;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if not private.is_match_organizer(p_match_id, v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if m.status not in ('draft', 'open', 'full', 'confirmed') or m.starts_at <= now() then
    raise exception 'match_not_editable' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 100 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;
  if p_duration_minutes is null or p_duration_minutes not between 30 and 360 then
    raise exception 'invalid_duration' using errcode = '22023';
  end if;
  if p_total_players is null or p_total_players not between 2 and 30 or coalesce(p_reserved_spots, 0) < 0
     or coalesce(p_reserved_spots, 0) >= p_total_players then
    raise exception 'invalid_capacity' using errcode = '22023';
  end if;
  if m.confirmed_count + coalesce(p_reserved_spots, 0) > p_total_players then
    raise exception 'capacity_below_participants' using errcode = 'P0001';
  end if;
  if m.match_type = 'team_vs_team' and p_total_players % 2 <> 0 then
    raise exception 'invalid_capacity' using errcode = '22023';
  end if;
  if p_area_id is not null and not exists (select 1 from public.areas where id = p_area_id and city_id = m.city_id) then
    raise exception 'invalid_area' using errcode = '22023';
  end if;
  if p_venue_id is not null and not exists (select 1 from public.venues where id = p_venue_id and city_id = m.city_id and not is_hidden) then
    raise exception 'invalid_venue' using errcode = '22023';
  end if;
  if p_field_id is not null and not exists (select 1 from public.venue_fields where id = p_field_id and venue_id = p_venue_id) then
    raise exception 'invalid_field' using errcode = '22023';
  end if;
  select timezone into v_tz from public.cities where id = m.city_id;
  v_starts := p_start_local at time zone v_tz;
  v_ends := v_starts + make_interval(mins => p_duration_minutes);
  if v_starts <> m.starts_at and v_starts < now() + interval '15 minutes' then
    raise exception 'start_too_soon' using errcode = '22023';
  end if;
  -- A linked platform booking pins the time and venue.
  if m.booking_id is not null and m.booking_status in ('requested', 'confirmed') and
     (v_starts <> m.starts_at or v_ends <> m.ends_at or p_venue_id is distinct from m.venue_id or p_field_id is distinct from m.field_id) then
    raise exception 'booking_locks_time' using errcode = 'P0001';
  end if;
  v_price := coalesce(p_price_per_player,
                      private.split_cost(p_total_cost, coalesce(p_paying_players, p_total_players)), 0);
  v_material := v_starts <> m.starts_at or v_ends <> m.ends_at or p_venue_id is distinct from m.venue_id
                or p_area_id is distinct from m.area_id or v_price <> m.price_per_player
                or coalesce(p_location_note, '') <> coalesce(m.location_note, '');
  update public.matches set
    title = btrim(p_title),
    description = nullif(btrim(coalesce(p_description, '')), ''),
    area_id = p_area_id,
    venue_id = p_venue_id,
    field_id = p_field_id,
    location_note = nullif(btrim(coalesce(p_location_note, '')), ''),
    starts_at = v_starts,
    ends_at = v_ends,
    total_players = p_total_players,
    reserved_spots = coalesce(p_reserved_spots, 0),
    positions_needed = private.validate_positions_needed(p_positions_needed, p_total_players),
    skill_level = p_skill_level,
    total_cost = p_total_cost,
    paying_players = p_paying_players,
    price_per_player = v_price,
    cost_is_estimate = coalesce(p_cost_is_estimate, true),
    payment_collector = coalesce(p_payment_collector, 'organizer'),
    payment_notes = nullif(btrim(coalesce(p_payment_notes, '')), ''),
    rules = nullif(btrim(coalesce(p_rules, '')), ''),
    visibility = case when m.match_type = 'private' then 'private' else coalesce(p_visibility, 'public') end::public.visibility_level,
    join_policy = case when m.match_type = 'private' then 'invite_only' else coalesce(p_join_policy, 'open') end::public.match_join_policy,
    leave_deadline_hours = coalesce(p_leave_deadline_hours, 6),
    booking_status = case
      when m.booking_status in ('requested', 'confirmed') then m.booking_status
      when p_external_booking then 'external' else 'none' end::public.match_booking_status
  where id = p_match_id;
  perform private.recount_match(p_match_id);
  perform private.promote_waitlist(p_match_id);
  if v_material and m.status <> 'draft' then
    for r in select user_id from private.match_audience(p_match_id) where user_id <> v_uid loop
      perform private.notify(r.user_id, 'match_updated',
        jsonb_build_object('match_id', p_match_id, 'match_title', btrim(p_title), 'starts_at', v_starts),
        'match_updated:' || p_match_id || ':' || extract(epoch from now())::bigint);
    end loop;
  end if;
end $$;

create or replace function public.publish_match(p_match_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  m public.matches%rowtype;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found or not private.is_match_organizer(p_match_id, v_uid) then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if m.status <> 'draft' then
    raise exception 'invalid_status_transition' using errcode = 'P0001';
  end if;
  if m.starts_at <= now() then
    raise exception 'start_in_past' using errcode = 'P0001';
  end if;
  update public.matches set status = 'open' where id = p_match_id;
  perform private.recount_match(p_match_id);
end $$;

create or replace function public.confirm_match(p_match_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  m public.matches%rowtype;
  r record;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found or not private.is_match_organizer(p_match_id, v_uid) then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if m.status not in ('open', 'full') then
    raise exception 'invalid_status_transition' using errcode = 'P0001';
  end if;
  update public.matches set status = 'confirmed' where id = p_match_id;
  for r in select user_id from private.match_audience(p_match_id) where user_id <> v_uid loop
    perform private.notify(r.user_id, 'match_confirmed',
      jsonb_build_object('match_id', p_match_id, 'match_title', m.title, 'starts_at', m.starts_at),
      'match_confirmed:' || p_match_id);
  end loop;
end $$;

create or replace function private.cancel_match_internal(p_match_id uuid, p_actor uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.matches%rowtype;
  r record;
begin
  select * into m from public.matches where id = p_match_id for update;
  if m.status in ('completed', 'cancelled') then
    raise exception 'invalid_status_transition' using errcode = 'P0001';
  end if;
  update public.matches set status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor,
         cancelled_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_match_id;
  for r in
    select user_id from private.match_audience(p_match_id)
    union select w.user_id from public.match_waitlist w where w.match_id = p_match_id and w.status = 'waiting'
  loop
    if r.user_id <> p_actor then
      perform private.notify(r.user_id, 'match_cancelled',
        jsonb_build_object('match_id', p_match_id, 'match_title', m.title, 'starts_at', m.starts_at,
                           'reason', nullif(btrim(coalesce(p_reason, '')), '')),
        'match_cancelled:' || p_match_id);
    end if;
  end loop;
  update public.match_waitlist set status = 'expired', resolved_at = now() where match_id = p_match_id and status = 'waiting';
  update public.match_invitations set status = 'expired', responded_at = now() where match_id = p_match_id and status = 'pending';
  -- Pending venue requests carry no obligation and are withdrawn automatically.
  -- Confirmed bookings stay: the organizer must cancel them per venue policy.
  update public.bookings set status = 'cancelled', cancelled_by = p_actor, cancelled_at = now(), cancel_reason = 'match_cancelled'
   where id = m.booking_id and status = 'requested';
  perform private.recount_match(p_match_id);
end $$;

create or replace function public.cancel_match(p_match_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(false);
begin
  if not exists (select 1 from public.matches where id = p_match_id) then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if private.is_match_organizer(p_match_id, v_uid) then
    perform private.cancel_match_internal(p_match_id, v_uid, p_reason);
  elsif private.is_moderator() then
    perform private.cancel_match_internal(p_match_id, v_uid, p_reason);
    perform private.audit('moderation.match_cancelled', 'match', p_match_id::text, jsonb_build_object('reason', p_reason));
  else
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create or replace function public.start_match(p_match_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  m public.matches%rowtype;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found or not private.is_match_organizer(p_match_id, v_uid) then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if m.starts_at > now() + interval '30 minutes' then
    raise exception 'match_not_started' using errcode = 'P0001';
  end if;
  update public.matches set status = 'in_progress' where id = p_match_id;
end $$;

create or replace function public.complete_match(p_match_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  m public.matches%rowtype;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found or not private.is_match_organizer(p_match_id, v_uid) then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if m.starts_at > now() then
    raise exception 'match_not_started' using errcode = 'P0001';
  end if;
  update public.matches set status = 'completed', completed_at = now() where id = p_match_id;
  update public.match_participants set status = 'rejected' where match_id = p_match_id and status = 'pending';
  update public.match_waitlist set status = 'expired', resolved_at = now() where match_id = p_match_id and status = 'waiting';
  perform private.recount_match(p_match_id);
end $$;

-- ---------------------------------------------------------------------------
-- RPCs: participation
-- ---------------------------------------------------------------------------
create or replace function public.join_match(
  p_match_id uuid, p_position public.player_position default null, p_waitlist_if_full boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if not private.can_view_match(p_match_id) then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  return private.do_join(v_uid, p_match_id, p_position, p_waitlist_if_full, null);
end $$;

create or replace function public.leave_match(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(false);
  m public.matches%rowtype;
  p public.match_participants%rowtype;
  v_late boolean;
  v_promoted int := 0;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  select * into p from public.match_participants
   where match_id = p_match_id and user_id = v_uid and status in ('pending', 'confirmed');
  if not found then
    -- Leaving the waiting list instead.
    update public.match_waitlist set status = 'left', resolved_at = now()
     where match_id = p_match_id and user_id = v_uid and status = 'waiting';
    if not found then
      raise exception 'not_participant' using errcode = 'P0002';
    end if;
    perform private.recount_match(p_match_id);
    return jsonb_build_object('result', 'left_waitlist');
  end if;
  if m.status in ('in_progress', 'completed', 'cancelled') or m.starts_at <= now() then
    raise exception 'match_already_started' using errcode = 'P0001';
  end if;
  v_late := p.status = 'confirmed' and now() > m.starts_at - make_interval(hours => m.leave_deadline_hours);
  update public.match_participants set status = 'left', left_at = now(), late_withdrawal = v_late where id = p.id;
  perform private.recount_match(p_match_id);
  if p.status = 'confirmed' then
    v_promoted := private.promote_waitlist(p_match_id);
  end if;
  if m.organizer_id <> v_uid then
    perform private.notify(m.organizer_id, 'match_participant_left',
      jsonb_build_object('match_id', p_match_id, 'match_title', m.title, 'user_id', v_uid,
                         'user_name', (select display_name from public.profiles where id = v_uid),
                         'late', v_late, 'promoted', v_promoted),
      'participant_left:' || p.id);
  end if;
  return jsonb_build_object('result', 'left', 'late_withdrawal', v_late, 'promoted', v_promoted);
end $$;

create or replace function public.decide_match_participant(p_participant_id uuid, p_approve boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  p public.match_participants%rowtype;
  m public.matches%rowtype;
begin
  select * into p from public.match_participants where id = p_participant_id;
  if not found then
    raise exception 'participant_not_found' using errcode = 'P0002';
  end if;
  select * into m from public.matches where id = p.match_id for update;
  if not private.is_match_organizer(m.id, v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into p from public.match_participants where id = p_participant_id;
  if p.status <> 'pending' then
    raise exception 'participant_not_pending' using errcode = 'P0001';
  end if;
  if p_approve then
    if m.status not in ('open', 'full', 'confirmed') or m.starts_at <= now() then
      raise exception 'match_not_joinable' using errcode = 'P0001';
    end if;
    if private.open_slots(m) <= 0 then
      raise exception 'match_full' using errcode = 'P0001';
    end if;
    update public.match_participants set status = 'confirmed', confirmed_at = now() where id = p.id;
  else
    update public.match_participants set status = 'rejected' where id = p.id;
  end if;
  perform private.recount_match(m.id);
  perform private.notify(p.user_id, case when p_approve then 'match_joined' else 'match_registration_rejected' end,
    jsonb_build_object('match_id', m.id, 'match_title', m.title, 'starts_at', m.starts_at),
    'match_request_decision:' || p.id);
  return jsonb_build_object('result', case when p_approve then 'confirmed' else 'rejected' end);
end $$;

create or replace function public.remove_match_participant(p_participant_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  p public.match_participants%rowtype;
  m public.matches%rowtype;
begin
  select * into p from public.match_participants where id = p_participant_id;
  if not found then
    raise exception 'participant_not_found' using errcode = 'P0002';
  end if;
  select * into m from public.matches where id = p.match_id for update;
  if not private.is_match_organizer(m.id, v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into p from public.match_participants where id = p_participant_id;
  if p.status not in ('pending', 'confirmed') then
    raise exception 'participant_not_active' using errcode = 'P0001';
  end if;
  if m.starts_at <= now() or m.status in ('completed', 'cancelled') then
    raise exception 'match_already_started' using errcode = 'P0001';
  end if;
  if p.user_id = v_uid then
    raise exception 'use_leave_match' using errcode = 'P0001';
  end if;
  update public.match_participants set status = 'removed', left_at = now(),
         removed_reason = nullif(btrim(coalesce(p_reason, '')), '') where id = p.id;
  perform private.recount_match(m.id);
  perform private.promote_waitlist(m.id);
  perform private.notify(p.user_id, 'participant_removed',
    jsonb_build_object('match_id', m.id, 'match_title', m.title, 'reason', nullif(btrim(coalesce(p_reason, '')), '')),
    'participant_removed:' || p.id);
  perform private.audit('match.participant_removed', 'match', m.id::text, jsonb_build_object('user_id', p.user_id));
end $$;

create or replace function public.set_participant_details(
  p_participant_id uuid,
  p_team_side public.team_side default null,
  p_payment_status public.manual_payment_status default null,
  p_attendance public.attendance_status default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  p public.match_participants%rowtype;
  m public.matches%rowtype;
begin
  select * into p from public.match_participants where id = p_participant_id;
  if not found then
    raise exception 'participant_not_found' using errcode = 'P0002';
  end if;
  select * into m from public.matches where id = p.match_id;
  if not private.is_match_organizer(m.id, v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p.status <> 'confirmed' then
    raise exception 'participant_not_active' using errcode = 'P0001';
  end if;
  if p_attendance is not null and m.starts_at > now() then
    raise exception 'match_not_started' using errcode = 'P0001';
  end if;
  if p_team_side is not null and m.match_type = 'team_vs_team' then
    raise exception 'side_fixed_by_team' using errcode = 'P0001';
  end if;
  update public.match_participants set
    team_side = coalesce(p_team_side, team_side),
    attendance = coalesce(p_attendance, attendance),
    payment_status = coalesce(p_payment_status, payment_status),
    payment_marked_by = case when p_payment_status is not null then v_uid else payment_marked_by end,
    payment_marked_at = case when p_payment_status is not null then now() else payment_marked_at end
  where id = p.id;
end $$;

create or replace function public.update_my_match_position(p_match_id uuid, p_position public.player_position)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  update public.match_participants set position = p_position
   where match_id = p_match_id and user_id = v_uid and status in ('pending', 'confirmed');
  if not found then
    raise exception 'not_participant' using errcode = 'P0002';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs: invitations
-- ---------------------------------------------------------------------------
create or replace function public.invite_to_match(p_match_id uuid, p_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  m public.matches%rowtype;
  v_id uuid;
begin
  select * into m from public.matches where id = p_match_id;
  if not found or not private.is_match_organizer(p_match_id, v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if m.status not in ('draft', 'open', 'full', 'confirmed') or m.starts_at <= now() then
    raise exception 'match_not_joinable' using errcode = 'P0001';
  end if;
  if p_user_id = v_uid or not exists (select 1 from public.profiles where id = p_user_id and status = 'active') then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if private.is_blocked_between(v_uid, p_user_id) then
    raise exception 'user_blocked' using errcode = '42501';
  end if;
  if exists (select 1 from public.match_participants where match_id = p_match_id and user_id = p_user_id and status in ('pending', 'confirmed')) then
    raise exception 'already_joined' using errcode = '23505';
  end if;
  perform private.rate_limit(v_uid, 'invite', private.setting_int('invitations.max_per_hour', 30), interval '1 hour');
  insert into public.match_invitations (match_id, invitee_id, invited_by) values (p_match_id, p_user_id, v_uid)
  on conflict (match_id, invitee_id) where status = 'pending' do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'already_invited' using errcode = '23505';
  end if;
  perform private.notify(p_user_id, 'match_invitation',
    jsonb_build_object('match_id', p_match_id, 'match_title', m.title, 'starts_at', m.starts_at, 'invitation_id', v_id,
                       'inviter_name', (select display_name from public.profiles where id = v_uid)),
    'match_invitation:' || v_id);
  return v_id;
end $$;

create or replace function public.respond_match_invitation(p_invitation_id uuid, p_accept boolean, p_position public.player_position default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  i public.match_invitations%rowtype;
  v_result jsonb;
begin
  select * into i from public.match_invitations where id = p_invitation_id for update;
  if not found or i.invitee_id <> v_uid then
    raise exception 'invitation_not_found' using errcode = 'P0002';
  end if;
  if i.status <> 'pending' then
    raise exception 'invitation_not_pending' using errcode = 'P0001';
  end if;
  if not p_accept then
    update public.match_invitations set status = 'declined', responded_at = now() where id = i.id;
    return jsonb_build_object('result', 'declined');
  end if;
  v_result := private.do_join(v_uid, i.match_id, p_position, true, i.id);
  update public.match_invitations set status = 'accepted', responded_at = now() where id = i.id;
  return v_result;
end $$;

create or replace function public.revoke_match_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_match uuid;
begin
  select match_id into v_match from public.match_invitations where id = p_invitation_id and status = 'pending';
  if v_match is null or not private.is_match_organizer(v_match, v_uid) then
    raise exception 'invitation_not_found' using errcode = 'P0002';
  end if;
  update public.match_invitations set status = 'revoked', responded_at = now() where id = p_invitation_id;
end $$;

create or replace function public.link_match_booking(p_match_id uuid, p_booking_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if not exists (select 1 from public.bookings where id = p_booking_id and status in ('requested', 'confirmed')) then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  perform private.link_booking_to_match(p_booking_id, p_match_id, v_uid);
end $$;

-- ---------------------------------------------------------------------------
-- Discovery (SECURITY INVOKER: RLS applies)
-- ---------------------------------------------------------------------------
create or replace function public.search_matches(
  p_city_id uuid default null,
  p_area_id uuid default null,
  p_date_from date default null,
  p_date_to date default null,
  p_time_from time default null,
  p_time_to time default null,
  p_format public.match_format default null,
  p_skill_level public.skill_level default null,
  p_max_price bigint default null,
  p_position public.player_position default null,
  p_min_open_slots int default null,
  p_booking_confirmed boolean default null,
  p_join_policy public.match_join_policy default null,
  p_include_full boolean default true,
  p_lat numeric default null,
  p_lng numeric default null,
  p_radius_km numeric default null,
  p_sort text default 'time',
  p_limit int default 20,
  p_offset int default 0
) returns setof public.matches
language sql stable security invoker set search_path = '' as $$
  select m.* from public.matches m
  join public.cities c on c.id = m.city_id
  left join public.venues v on v.id = m.venue_id
  left join public.areas a on a.id = m.area_id
  where m.status in ('open', 'full', 'confirmed')
    and not m.is_hidden
    and m.visibility = 'public'
    and m.starts_at > now()
    and (p_city_id is null or m.city_id = p_city_id)
    and (p_area_id is null or m.area_id = p_area_id)
    and (p_date_from is null or (m.starts_at at time zone c.timezone)::date >= p_date_from)
    and (p_date_to is null or (m.starts_at at time zone c.timezone)::date <= p_date_to)
    and (p_time_from is null or (m.starts_at at time zone c.timezone)::time >= p_time_from)
    and (p_time_to is null or (m.starts_at at time zone c.timezone)::time <= p_time_to)
    and (p_format is null or m.format = p_format)
    and (p_skill_level is null or m.skill_level is null or m.skill_level = p_skill_level)
    and (p_max_price is null or m.price_per_player <= p_max_price)
    and (p_position is null or m.positions_needed = '{}'::jsonb or m.positions_needed ? p_position::text)
    and (p_min_open_slots is null or m.total_players - m.reserved_spots - m.confirmed_count >= p_min_open_slots)
    and (p_include_full or m.total_players - m.reserved_spots - m.confirmed_count > 0)
    and (p_booking_confirmed is null or (m.booking_status = 'confirmed') = p_booking_confirmed)
    and (p_join_policy is null or m.join_policy = p_join_policy)
    and (p_radius_km is null or p_lat is null or p_lng is null or
         private.distance_km(p_lat, p_lng, coalesce(v.latitude, a.latitude), coalesce(v.longitude, a.longitude)) <= p_radius_km)
  order by
    case when p_sort = 'relevance' then (m.total_players - m.reserved_spots - m.confirmed_count > 0) end desc nulls last,
    case when p_sort = 'distance' then
      private.distance_km(p_lat, p_lng, coalesce(v.latitude, a.latitude), coalesce(v.longitude, a.longitude)) end asc nulls last,
    m.starts_at asc, m.id
  limit least(greatest(coalesce(p_limit, 20), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
$$;
