-- =============================================================================
-- Match results, match events (goals/assists/clean sheets), player statistics,
-- reviews and reports.
-- =============================================================================

create type public.match_result_status as enum ('reported', 'confirmed', 'disputed');
create type public.match_event_type as enum ('goal', 'assist', 'own_goal', 'clean_sheet');
create type public.review_status as enum ('published', 'hidden');
create type public.report_target as enum ('user', 'match', 'team', 'venue', 'message', 'review', 'tournament', 'booking');
create type public.report_category as enum ('spam', 'harassment', 'fake_listing', 'fraudulent_booking', 'inappropriate_content', 'unsafe_behavior', 'other');
create type public.report_status as enum ('open', 'in_review', 'resolved', 'dismissed');

-- ---------------------------------------------------------------------------
-- Results
-- ---------------------------------------------------------------------------
create table public.match_results (
  match_id uuid primary key references public.matches(id) on delete cascade,
  home_score int not null check (home_score between 0 and 99),
  away_score int not null check (away_score between 0 and 99),
  -- reported: one side/organizer reported. confirmed: the opposing team
  -- confirmed (team matches only). disputed: the opposing team disagreed.
  status public.match_result_status not null default 'reported',
  reported_by uuid references public.profiles(id) on delete set null,
  reported_side public.team_side,
  reported_at timestamptz not null default now(),
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  dispute_reason text check (char_length(dispute_reason) <= 500),
  updated_at timestamptz not null default now()
);
create trigger match_results_touch before update on public.match_results for each row execute function private.touch_updated_at();

create table public.match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type public.match_event_type not null,
  team_side public.team_side,
  minute int check (minute between 0 and 200),
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index match_events_match_idx on public.match_events(match_id);
create index match_events_user_idx on public.match_events(user_id);

alter table public.match_results enable row level security;
alter table public.match_events enable row level security;
create policy match_results_read on public.match_results for select using (private.can_view_match(match_id));
create policy match_events_read on public.match_events for select using (private.can_view_match(match_id));

create or replace function private.result_side_of(m public.matches, p_user uuid)
returns public.team_side language sql stable security definer set search_path = '' as $$
  select case
    when m.match_type <> 'team_vs_team' then null
    when private.is_team_manager(m.home_team_id, p_user) then 'home'::public.team_side
    when private.is_team_manager(m.away_team_id, p_user) then 'away'::public.team_side
  end;
$$;

create or replace function public.report_match_result(p_match_id uuid, p_home_score int, p_away_score int)
returns public.match_result_status language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  m public.matches%rowtype;
  v_side public.team_side;
  v_old public.match_results%rowtype;
  r record;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  v_side := private.result_side_of(m, v_uid);
  if not (m.organizer_id = v_uid or v_side is not null) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if m.status = 'cancelled' or m.starts_at > now() then
    raise exception 'match_not_started' using errcode = 'P0001';
  end if;
  if p_home_score is null or p_away_score is null or p_home_score not between 0 and 99 or p_away_score not between 0 and 99 then
    raise exception 'invalid_score' using errcode = '22023';
  end if;
  select * into v_old from public.match_results where match_id = m.id;
  insert into public.match_results (match_id, home_score, away_score, status, reported_by, reported_side, reported_at)
  values (m.id, p_home_score, p_away_score, 'reported', v_uid, v_side, now())
  on conflict (match_id) do update set home_score = excluded.home_score, away_score = excluded.away_score,
    status = 'reported', reported_by = excluded.reported_by, reported_side = excluded.reported_side,
    reported_at = now(), confirmed_by = null, confirmed_at = null, dispute_reason = null;
  if v_old.match_id is not null then
    perform private.audit('match.result_corrected', 'match', m.id::text,
      jsonb_build_object('from', jsonb_build_array(v_old.home_score, v_old.away_score), 'to', jsonb_build_array(p_home_score, p_away_score)));
  end if;
  if m.status in ('open', 'full', 'confirmed', 'in_progress') then
    update public.matches set status = 'completed', completed_at = now() where id = m.id;
    update public.match_participants set status = 'rejected' where match_id = m.id and status = 'pending';
    update public.match_waitlist set status = 'expired', resolved_at = now() where match_id = m.id and status = 'waiting';
    perform private.recount_match(m.id);
  end if;
  -- The opposing team is asked to confirm.
  if m.match_type = 'team_vs_team' then
    perform private.notify_team_managers(case when v_side = 'away' then m.home_team_id else m.away_team_id end,
      'match_result_reported', jsonb_build_object('match_id', m.id, 'match_title', m.title,
        'home_score', p_home_score, 'away_score', p_away_score), 'match_result:' || m.id || ':' || extract(epoch from now())::bigint);
  else
    for r in select p.user_id from public.match_participants p where p.match_id = m.id and p.status = 'confirmed' and p.user_id <> v_uid loop
      perform private.notify(r.user_id, 'match_result_reported',
        jsonb_build_object('match_id', m.id, 'match_title', m.title, 'home_score', p_home_score, 'away_score', p_away_score),
        'match_result:' || m.id);
    end loop;
  end if;
  return 'reported';
end $$;

create or replace function public.respond_match_result(p_match_id uuid, p_confirm boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  m public.matches%rowtype;
  res public.match_results%rowtype;
  v_side public.team_side;
begin
  select * into m from public.matches where id = p_match_id;
  select * into res from public.match_results where match_id = p_match_id for update;
  if m.id is null or res.match_id is null then
    raise exception 'result_not_found' using errcode = 'P0002';
  end if;
  if m.match_type <> 'team_vs_team' then
    raise exception 'confirmation_not_applicable' using errcode = 'P0001';
  end if;
  v_side := private.result_side_of(m, v_uid);
  -- Only the side that did not report may confirm or dispute.
  if v_side is null or v_side = res.reported_side or res.status <> 'reported' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.match_results set
    status = case when p_confirm then 'confirmed' else 'disputed' end::public.match_result_status,
    confirmed_by = case when p_confirm then v_uid end,
    confirmed_at = case when p_confirm then now() end,
    dispute_reason = case when p_confirm then null else left(btrim(coalesce(p_reason, '')), 500) end
  where match_id = p_match_id;
  perform private.notify(res.reported_by, case when p_confirm then 'match_result_confirmed' else 'match_result_disputed' end,
    jsonb_build_object('match_id', m.id, 'match_title', m.title), 'match_result_response:' || m.id || ':' || extract(epoch from now())::bigint);
end $$;

-- Replaces the recorded events for a match. p_events: [{"user_id":"..","event_type":"goal","minute":12}]
create or replace function public.set_match_events(p_match_id uuid, p_events jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  m public.matches%rowtype;
  e jsonb;
  v_user uuid;
  v_side public.team_side;
  v_count int := 0;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found or not private.is_match_organizer(p_match_id, v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if m.status <> 'completed' then
    raise exception 'match_not_completed' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 200 then
    raise exception 'invalid_events' using errcode = '22023';
  end if;
  delete from public.match_events where match_id = m.id;
  for e in select * from jsonb_array_elements(p_events) loop
    v_user := (e ->> 'user_id')::uuid;
    select team_side into v_side from public.match_participants
     where match_id = m.id and user_id = v_user and status = 'confirmed' and coalesce(attendance, 'attended') <> 'no_show';
    if not found then
      raise exception 'event_player_not_participant' using errcode = '22023';
    end if;
    insert into public.match_events (match_id, user_id, event_type, team_side, minute, recorded_by)
    values (m.id, v_user, (e ->> 'event_type')::public.match_event_type, v_side, (e ->> 'minute')::int, v_uid);
    v_count := v_count + 1;
  end loop;
  perform private.audit('match.events_recorded', 'match', m.id::text, jsonb_build_object('count', v_count));
  return v_count;
end $$;

-- Aggregated statistics built only from completed matches whose result is not
-- disputed. Respects the player's "show match history" preference.
create or replace function public.player_stats(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not exists (select 1 from public.profiles where id = p_user_id and (show_match_history or id = auth.uid()))
    then null else jsonb_build_object(
    'matches_played', (select count(*) from public.match_participants p join public.matches m on m.id = p.match_id
                        where p.user_id = p_user_id and p.status = 'confirmed' and m.status = 'completed'
                          and coalesce(p.attendance, 'attended') <> 'no_show'),
    'attendance_marked', (select count(*) from public.match_participants p where p.user_id = p_user_id and p.attendance is not null),
    'no_shows', (select count(*) from public.match_participants p where p.user_id = p_user_id and p.attendance = 'no_show'),
    'late_withdrawals', (select count(*) from public.match_participants p where p.user_id = p_user_id and p.late_withdrawal),
    'goals', (select count(*) from public.match_events e left join public.match_results r on r.match_id = e.match_id
               where e.user_id = p_user_id and e.event_type = 'goal' and coalesce(r.status::text, '') <> 'disputed'),
    'assists', (select count(*) from public.match_events e left join public.match_results r on r.match_id = e.match_id
                 where e.user_id = p_user_id and e.event_type = 'assist' and coalesce(r.status::text, '') <> 'disputed'),
    'clean_sheets', (select count(*) from public.match_events e left join public.match_results r on r.match_id = e.match_id
                      where e.user_id = p_user_id and e.event_type = 'clean_sheet' and coalesce(r.status::text, '') <> 'disputed'),
    'verified_results', (select count(*) from public.match_participants p join public.match_results r on r.match_id = p.match_id
                          where p.user_id = p_user_id and p.status = 'confirmed' and r.status = 'confirmed')
  ) end;
$$;

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  match_id uuid references public.matches(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  subject_user_id uuid references public.profiles(id) on delete cascade,
  venue_id uuid references public.venues(id) on delete cascade,
  reliability smallint check (reliability between 1 and 5),
  punctuality smallint check (punctuality between 1 and 5),
  sportsmanship smallint check (sportsmanship between 1 and 5),
  organization smallint check (organization between 1 and 5),
  venue_rating smallint check (venue_rating between 1 and 5),
  comment text check (char_length(comment) <= 500),
  status public.review_status not null default 'published',
  hidden_reason text,
  created_at timestamptz not null default now(),
  check ((subject_user_id is null) <> (venue_id is null)),
  check (subject_user_id is null or (match_id is not null and reliability is not null and punctuality is not null and sportsmanship is not null)),
  check (venue_id is null or (venue_rating is not null and (match_id is not null or booking_id is not null))),
  check (subject_user_id is distinct from reviewer_id)
);
create unique index reviews_player_uq on public.reviews(reviewer_id, match_id, subject_user_id) where subject_user_id is not null;
create unique index reviews_venue_uq on public.reviews(reviewer_id, venue_id, coalesce(match_id, booking_id)) where venue_id is not null;
create index reviews_subject_idx on public.reviews(subject_user_id) where status = 'published';
create index reviews_venue_idx on public.reviews(venue_id) where status = 'published';

alter table public.reviews enable row level security;
-- Venue review comments are public; player review comments are visible only
-- to the reviewer, the subject and moderators (aggregates are public).
create policy reviews_read on public.reviews for select using (
  (status = 'published' and venue_id is not null)
  or reviewer_id = (select auth.uid()) or subject_user_id = (select auth.uid()) or private.is_moderator()
);

create or replace function private.attended(p_match uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.matches where id = p_match and organizer_id = p_user)
      or exists (select 1 from public.match_participants
                 where match_id = p_match and user_id = p_user and status = 'confirmed'
                   and coalesce(attendance, 'attended') <> 'no_show');
$$;

create or replace function public.submit_player_review(
  p_match_id uuid, p_subject_user_id uuid, p_reliability int, p_punctuality int, p_sportsmanship int,
  p_organization int default null, p_comment text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  m public.matches%rowtype;
  v_id uuid;
begin
  select * into m from public.matches where id = p_match_id;
  if not found or m.status <> 'completed' then
    raise exception 'review_not_eligible' using errcode = '42501';
  end if;
  if m.ends_at < now() - make_interval(days => private.setting_int('reviews.window_days', 14)) then
    raise exception 'review_window_closed' using errcode = 'P0001';
  end if;
  if p_subject_user_id = v_uid then
    raise exception 'cannot_review_self' using errcode = '22023';
  end if;
  if not private.attended(p_match_id, v_uid) or not private.attended(p_match_id, p_subject_user_id) then
    raise exception 'review_not_eligible' using errcode = '42501';
  end if;
  if p_organization is not null and m.organizer_id <> p_subject_user_id then
    raise exception 'organization_rating_not_applicable' using errcode = '22023';
  end if;
  perform private.rate_limit(v_uid, 'review', 50, interval '1 day');
  begin
    insert into public.reviews (reviewer_id, match_id, subject_user_id, reliability, punctuality, sportsmanship, organization, comment)
    values (v_uid, p_match_id, p_subject_user_id, p_reliability, p_punctuality, p_sportsmanship, p_organization,
            nullif(btrim(coalesce(p_comment, '')), ''))
    returning id into v_id;
  exception
    when unique_violation then raise exception 'already_reviewed' using errcode = '23505';
    when check_violation then raise exception 'invalid_rating' using errcode = '22023';
  end;
  perform private.notify(p_subject_user_id, 'review_received', jsonb_build_object('match_id', p_match_id, 'match_title', m.title),
    'review_received:' || v_id);
  return v_id;
end $$;

create or replace function public.submit_venue_review(
  p_venue_id uuid, p_rating int, p_match_id uuid default null, p_booking_id uuid default null, p_comment text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_ended timestamptz;
  v_id uuid;
begin
  if (p_match_id is null) = (p_booking_id is null) then
    raise exception 'review_not_eligible' using errcode = '22023';
  end if;
  if p_booking_id is not null then
    select ends_at into v_ended from public.bookings
     where id = p_booking_id and venue_id = p_venue_id and requested_by = v_uid
       and (status = 'completed' or (status = 'confirmed' and ends_at < now()));
  else
    select ends_at into v_ended from public.matches
     where id = p_match_id and venue_id = p_venue_id and status = 'completed' and private.attended(p_match_id, v_uid);
  end if;
  if v_ended is null then
    raise exception 'review_not_eligible' using errcode = '42501';
  end if;
  if v_ended < now() - make_interval(days => private.setting_int('reviews.window_days', 14)) then
    raise exception 'review_window_closed' using errcode = 'P0001';
  end if;
  if private.venue_role_of(p_venue_id, v_uid) is not null then
    raise exception 'cannot_review_own_venue' using errcode = '42501';
  end if;
  begin
    insert into public.reviews (reviewer_id, venue_id, match_id, booking_id, venue_rating, comment)
    values (v_uid, p_venue_id, p_match_id, p_booking_id, p_rating, nullif(btrim(coalesce(p_comment, '')), ''))
    returning id into v_id;
  exception
    when unique_violation then raise exception 'already_reviewed' using errcode = '23505';
    when check_violation then raise exception 'invalid_rating' using errcode = '22023';
  end;
  return v_id;
end $$;

-- Aggregates are only shown once enough reviews exist (reduces targeting).
create or replace function public.player_reputation(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with r as (select * from public.reviews where subject_user_id = p_user_id and status = 'published')
  select case when (select count(*) from r) < private.setting_int('reviews.min_count_to_display', 3)
    then jsonb_build_object('count', (select count(*) from r), 'visible', false)
    else jsonb_build_object('count', (select count(*) from r), 'visible', true,
      'reliability', (select round(avg(reliability), 1) from r),
      'punctuality', (select round(avg(punctuality), 1) from r),
      'sportsmanship', (select round(avg(sportsmanship), 1) from r),
      'organization', (select round(avg(organization), 1) from r where organization is not null)) end;
$$;

create or replace function public.venue_rating(p_venue_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with r as (select * from public.reviews where venue_id = p_venue_id and status = 'published')
  select jsonb_build_object('count', (select count(*) from r),
    'average', case when (select count(*) from r) >= private.setting_int('reviews.min_count_to_display', 3)
                    then (select round(avg(venue_rating), 1) from r) end);
$$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id) on delete set null,
  target_type public.report_target not null,
  target_id text not null,
  category public.report_category not null,
  details text check (char_length(details) <= 1000),
  -- Snapshot of reported content (e.g. a message body) for moderators.
  snapshot jsonb not null default '{}'::jsonb,
  status public.report_status not null default 'open',
  resolution_note text check (char_length(resolution_note) <= 1000),
  handled_by uuid references public.profiles(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index reports_open_uq on public.reports(reporter_id, target_type, target_id) where status in ('open', 'in_review');
create index reports_status_idx on public.reports(status, created_at);

alter table public.reports enable row level security;
create policy reports_read on public.reports for select using (reporter_id = (select auth.uid()) or private.is_moderator());

create or replace function public.create_report(
  p_target_type public.report_target, p_target_id text, p_category public.report_category, p_details text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(false);
  v_snapshot jsonb := '{}'::jsonb;
  v_exists boolean;
  v_id uuid;
  v_msg public.messages%rowtype;
begin
  perform private.rate_limit(v_uid, 'report', private.setting_int('reports.max_per_day', 20), interval '1 day');
  begin
    case p_target_type
      when 'user' then
        select true, jsonb_build_object('display_name', display_name, 'bio', bio) into v_exists, v_snapshot
          from public.profiles where id = p_target_id::uuid;
      when 'match' then
        select true, jsonb_build_object('title', title, 'description', description, 'organizer_id', organizer_id) into v_exists, v_snapshot
          from public.matches where id = p_target_id::uuid and private.can_view_match(id);
      when 'team' then
        select true, jsonb_build_object('name', name, 'description', description) into v_exists, v_snapshot
          from public.teams where id = p_target_id::uuid and private.can_view_team(id);
      when 'venue' then
        select true, jsonb_build_object('name', name, 'description', description) into v_exists, v_snapshot
          from public.venues where id = p_target_id::uuid and private.can_view_venue(id);
      when 'tournament' then
        select true, jsonb_build_object('name', name) into v_exists, v_snapshot
          from public.tournaments where id = p_target_id::uuid and private.can_view_tournament(id);
      when 'booking' then
        select true, jsonb_build_object('venue_id', venue_id, 'starts_at', starts_at) into v_exists, v_snapshot
          from public.bookings where id = p_target_id::uuid and (requested_by = v_uid or private.venue_role_of(venue_id, v_uid) is not null);
      when 'review' then
        select true, jsonb_build_object('comment', comment, 'reviewer_id', reviewer_id) into v_exists, v_snapshot
          from public.reviews where id = p_target_id::uuid and (subject_user_id = v_uid or venue_id is not null);
      when 'message' then
        select * into v_msg from public.messages where id = p_target_id::bigint;
        if found and private.can_access_conversation(v_msg.conversation_id, v_uid) then
          v_exists := true;
          v_snapshot := jsonb_build_object('body', v_msg.body, 'sender_id', v_msg.sender_id,
                                           'conversation_id', v_msg.conversation_id, 'sent_at', v_msg.created_at);
        end if;
    end case;
  exception when invalid_text_representation then
    v_exists := false;
  end;
  if not coalesce(v_exists, false) then
    raise exception 'report_target_not_found' using errcode = 'P0002';
  end if;
  insert into public.reports (reporter_id, target_type, target_id, category, details, snapshot)
  values (v_uid, p_target_type, p_target_id, p_category, nullif(btrim(coalesce(p_details, '')), ''), coalesce(v_snapshot, '{}'))
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'already_reported' using errcode = '23505';
  end if;
  return v_id;
end $$;
