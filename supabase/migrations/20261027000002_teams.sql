-- =============================================================================
-- Teams: teams, members, invitations, join requests, recruitment listings.
-- =============================================================================

create type public.visibility_level as enum ('public', 'private');
create type public.team_join_policy as enum ('request', 'invite_only');
create type public.team_role as enum ('captain', 'manager', 'player');
create type public.invitation_status as enum ('pending', 'accepted', 'declined', 'revoked', 'expired');
create type public.request_status as enum ('pending', 'approved', 'rejected', 'withdrawn');
create type public.listing_status as enum ('open', 'closed');

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  description text check (char_length(description) <= 1000),
  logo_path text,
  city_id uuid not null references public.cities(id),
  area_id uuid references public.areas(id),
  home_venue_id uuid, -- FK added in venues migration
  visibility public.visibility_level not null default 'public',
  join_policy public.team_join_policy not null default 'request',
  skill_level public.skill_level,
  preferred_format public.match_format,
  preferred_formation text check (preferred_formation ~ '^[0-9]{1,2}(-[0-9]{1,2}){1,4}$'),
  is_archived boolean not null default false,
  is_hidden boolean not null default false,
  hidden_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index teams_city_idx on public.teams(city_id) where not is_archived and not is_hidden;
create index teams_name_idx on public.teams using gin (to_tsvector('simple', name));
create trigger teams_touch before update on public.teams for each row execute function private.touch_updated_at();

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.team_role not null default 'player',
  position public.player_position,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create unique index team_members_one_captain on public.team_members(team_id) where role = 'captain';
create index team_members_user_idx on public.team_members(user_id);

create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  invitee_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid references public.profiles(id) on delete set null,
  message text check (char_length(message) <= 300),
  status public.invitation_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index team_invitations_pending_uq on public.team_invitations(team_id, invitee_id) where status = 'pending';
create index team_invitations_invitee_idx on public.team_invitations(invitee_id, status);

create table public.team_recruitment (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 3 and 100),
  description text check (char_length(description) <= 1000),
  -- Empty array means "any position".
  positions public.player_position[] not null default '{}',
  players_needed int not null default 1 check (players_needed between 1 and 30),
  skill_level public.skill_level,
  status public.listing_status not null default 'open',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index team_recruitment_open_idx on public.team_recruitment(expires_at) where status = 'open';
create index team_recruitment_team_idx on public.team_recruitment(team_id);

create table public.team_join_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  recruitment_id uuid references public.team_recruitment(id) on delete set null,
  position public.player_position,
  message text check (char_length(message) <= 300),
  status public.request_status not null default 'pending',
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index team_join_requests_pending_uq on public.team_join_requests(team_id, user_id) where status = 'pending';
create index team_join_requests_team_idx on public.team_join_requests(team_id, status);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.team_role_of(p_team uuid, p_user uuid)
returns public.team_role language sql stable security definer set search_path = '' as $$
  select role from public.team_members where team_id = p_team and user_id = p_user;
$$;

create or replace function private.is_team_member(p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members where team_id = p_team and user_id = (select auth.uid()));
$$;

create or replace function private.is_team_manager(p_team uuid, p_user uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team and user_id = coalesce(p_user, (select auth.uid())) and role in ('captain', 'manager')
  );
$$;

create or replace function private.can_view_team(p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.teams t
    where t.id = p_team and (
      (t.visibility = 'public' and not t.is_hidden)
      or private.is_team_member(t.id)
      or private.is_moderator()
      or exists (select 1 from public.team_invitations i
                 where i.team_id = t.id and i.invitee_id = (select auth.uid()) and i.status = 'pending')
    )
  );
$$;

create or replace function private.require_team_manager(p_team uuid, p_user uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.teams where id = p_team and not is_archived) then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;
  if not private.is_team_manager(p_team, p_user) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create or replace function private.notify_team_managers(p_team uuid, p_type text, p_payload jsonb, p_dedupe text default null, p_except uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select user_id from public.team_members
           where team_id = p_team and role in ('captain', 'manager') and user_id is distinct from p_except loop
    perform private.notify(r.user_id, p_type, p_payload, case when p_dedupe is null then null else p_dedupe end);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invitations enable row level security;
alter table public.team_recruitment enable row level security;
alter table public.team_join_requests enable row level security;

create policy teams_read on public.teams for select using (private.can_view_team(id));
create policy team_members_read on public.team_members for select using (private.can_view_team(team_id));
create policy team_invitations_read on public.team_invitations for select
  using (invitee_id = (select auth.uid()) or private.is_team_manager(team_id) or private.is_moderator());
create policy team_recruitment_read on public.team_recruitment for select
  using (private.can_view_team(team_id));
create policy team_join_requests_read on public.team_join_requests for select
  using (user_id = (select auth.uid()) or private.is_team_manager(team_id) or private.is_moderator());

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.create_team(
  p_name text,
  p_city_id uuid,
  p_area_id uuid default null,
  p_description text default null,
  p_visibility public.visibility_level default 'public',
  p_join_policy public.team_join_policy default 'request',
  p_skill_level public.skill_level default null,
  p_preferred_format public.match_format default null,
  p_preferred_formation text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_id uuid;
begin
  perform private.rate_limit(v_uid, 'create_team', private.setting_int('teams.max_created_per_day', 5), interval '1 day');
  if not exists (select 1 from public.cities where id = p_city_id and is_active) then
    raise exception 'invalid_city' using errcode = '22023';
  end if;
  if p_area_id is not null and not exists (select 1 from public.areas where id = p_area_id and city_id = p_city_id) then
    raise exception 'invalid_area' using errcode = '22023';
  end if;
  insert into public.teams (name, description, city_id, area_id, visibility, join_policy, skill_level,
                            preferred_format, preferred_formation, created_by)
  values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_city_id, p_area_id,
          coalesce(p_visibility, 'public'), coalesce(p_join_policy, 'request'), p_skill_level,
          p_preferred_format, nullif(btrim(coalesce(p_preferred_formation, '')), ''), v_uid)
  returning id into v_id;
  insert into public.team_members (team_id, user_id, role) values (v_id, v_uid, 'captain');
  return v_id;
end $$;

create or replace function public.update_team(
  p_team_id uuid,
  p_name text,
  p_city_id uuid,
  p_area_id uuid default null,
  p_description text default null,
  p_visibility public.visibility_level default 'public',
  p_join_policy public.team_join_policy default 'request',
  p_skill_level public.skill_level default null,
  p_preferred_format public.match_format default null,
  p_preferred_formation text default null,
  p_home_venue_id uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform private.require_team_manager(p_team_id, v_uid);
  if not exists (select 1 from public.cities where id = p_city_id and is_active) then
    raise exception 'invalid_city' using errcode = '22023';
  end if;
  if p_area_id is not null and not exists (select 1 from public.areas where id = p_area_id and city_id = p_city_id) then
    raise exception 'invalid_area' using errcode = '22023';
  end if;
  update public.teams set
    name = btrim(p_name),
    description = nullif(btrim(coalesce(p_description, '')), ''),
    city_id = p_city_id,
    area_id = p_area_id,
    visibility = coalesce(p_visibility, visibility),
    join_policy = coalesce(p_join_policy, join_policy),
    skill_level = p_skill_level,
    preferred_format = p_preferred_format,
    preferred_formation = nullif(btrim(coalesce(p_preferred_formation, '')), ''),
    home_venue_id = p_home_venue_id
  where id = p_team_id;
end $$;

create or replace function public.set_team_logo(p_team_id uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform private.require_team_manager(p_team_id, v_uid);
  if p_path is not null and p_path !~ ('^' || p_team_id::text || '/[A-Za-z0-9._-]{1,100}$') then
    raise exception 'invalid_path' using errcode = '22023';
  end if;
  update public.teams set logo_path = p_path where id = p_team_id;
end $$;

create or replace function public.invite_to_team(p_team_id uuid, p_user_id uuid, p_message text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_id uuid;
  v_team_name text;
begin
  perform private.require_team_manager(p_team_id, v_uid);
  perform private.rate_limit(v_uid, 'invite', private.setting_int('invitations.max_per_hour', 30), interval '1 hour');
  if not exists (select 1 from public.profiles where id = p_user_id and status = 'active') then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if private.is_blocked_between(v_uid, p_user_id) then
    raise exception 'user_blocked' using errcode = '42501';
  end if;
  if exists (select 1 from public.team_members where team_id = p_team_id and user_id = p_user_id) then
    raise exception 'already_member' using errcode = '23505';
  end if;
  insert into public.team_invitations (team_id, invitee_id, invited_by, message)
  values (p_team_id, p_user_id, v_uid, nullif(btrim(coalesce(p_message, '')), ''))
  on conflict (team_id, invitee_id) where status = 'pending' do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'already_invited' using errcode = '23505';
  end if;
  select name into v_team_name from public.teams where id = p_team_id;
  perform private.notify(p_user_id, 'team_invitation',
    jsonb_build_object('team_id', p_team_id, 'team_name', v_team_name, 'invitation_id', v_id), 'team_invitation:' || v_id);
  return v_id;
end $$;

create or replace function public.respond_team_invitation(p_invitation_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_inv public.team_invitations%rowtype;
  v_team_name text;
begin
  select * into v_inv from public.team_invitations where id = p_invitation_id for update;
  if not found or v_inv.invitee_id <> v_uid then
    raise exception 'invitation_not_found' using errcode = 'P0002';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'invitation_not_pending' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.teams where id = v_inv.team_id and is_archived) then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;
  update public.team_invitations set status = case when p_accept then 'accepted' else 'declined' end::public.invitation_status,
         responded_at = now() where id = p_invitation_id;
  select name into v_team_name from public.teams where id = v_inv.team_id;
  if p_accept then
    insert into public.team_members (team_id, user_id, role) values (v_inv.team_id, v_uid, 'player')
    on conflict do nothing;
    -- Any pending join request becomes moot.
    update public.team_join_requests set status = 'approved', decided_at = now()
     where team_id = v_inv.team_id and user_id = v_uid and status = 'pending';
  end if;
  perform private.notify_team_managers(v_inv.team_id,
    case when p_accept then 'team_invitation_accepted' else 'team_invitation_declined' end,
    jsonb_build_object('team_id', v_inv.team_id, 'team_name', v_team_name, 'user_id', v_uid,
                       'user_name', (select display_name from public.profiles where id = v_uid)),
    'team_invitation_response:' || p_invitation_id);
end $$;

create or replace function public.revoke_team_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_team uuid;
begin
  select team_id into v_team from public.team_invitations where id = p_invitation_id and status = 'pending';
  if v_team is null then
    raise exception 'invitation_not_found' using errcode = 'P0002';
  end if;
  perform private.require_team_manager(v_team, v_uid);
  update public.team_invitations set status = 'revoked', responded_at = now() where id = p_invitation_id;
end $$;

create or replace function public.request_to_join_team(
  p_team_id uuid, p_message text default null, p_position public.player_position default null, p_recruitment_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_team public.teams%rowtype;
  v_id uuid;
  v_recruit_ok boolean := false;
begin
  select * into v_team from public.teams where id = p_team_id;
  if not found or v_team.is_archived or v_team.is_hidden then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;
  if p_recruitment_id is not null then
    select true into v_recruit_ok from public.team_recruitment
     where id = p_recruitment_id and team_id = p_team_id and status = 'open' and expires_at > now();
    if not coalesce(v_recruit_ok, false) then
      raise exception 'recruitment_closed' using errcode = 'P0001';
    end if;
  end if;
  -- Private / invite-only teams accept requests only through an open recruitment listing.
  if not coalesce(v_recruit_ok, false) and (v_team.visibility <> 'public' or v_team.join_policy <> 'request') then
    raise exception 'team_not_accepting_requests' using errcode = '42501';
  end if;
  if exists (select 1 from public.team_members where team_id = p_team_id and user_id = v_uid) then
    raise exception 'already_member' using errcode = '23505';
  end if;
  if exists (select 1 from public.team_members m where m.team_id = p_team_id and m.role in ('captain','manager')
             and private.is_blocked_between(m.user_id, v_uid)) then
    raise exception 'user_blocked' using errcode = '42501';
  end if;
  perform private.rate_limit(v_uid, 'join_request', 20, interval '1 day');
  insert into public.team_join_requests (team_id, user_id, recruitment_id, position, message)
  values (p_team_id, v_uid, p_recruitment_id, p_position, nullif(btrim(coalesce(p_message, '')), ''))
  on conflict (team_id, user_id) where status = 'pending' do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'already_requested' using errcode = '23505';
  end if;
  perform private.notify_team_managers(p_team_id,
    case when p_recruitment_id is null then 'team_join_request' else 'recruitment_response' end,
    jsonb_build_object('team_id', p_team_id, 'team_name', v_team.name, 'request_id', v_id, 'user_id', v_uid,
                       'user_name', (select display_name from public.profiles where id = v_uid)),
    'team_join_request:' || v_id);
  return v_id;
end $$;

create or replace function public.withdraw_join_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(false);
begin
  update public.team_join_requests set status = 'withdrawn', decided_at = now()
   where id = p_request_id and user_id = v_uid and status = 'pending';
  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.decide_join_request(p_request_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_req public.team_join_requests%rowtype;
  v_team_name text;
begin
  select * into v_req from public.team_join_requests where id = p_request_id for update;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  perform private.require_team_manager(v_req.team_id, v_uid);
  if v_req.status <> 'pending' then
    raise exception 'request_not_pending' using errcode = 'P0001';
  end if;
  update public.team_join_requests set status = case when p_approve then 'approved' else 'rejected' end::public.request_status,
         decided_by = v_uid, decided_at = now() where id = p_request_id;
  if p_approve then
    insert into public.team_members (team_id, user_id, role, position)
    values (v_req.team_id, v_req.user_id, 'player', v_req.position) on conflict do nothing;
  end if;
  select name into v_team_name from public.teams where id = v_req.team_id;
  perform private.notify(v_req.user_id, 'team_membership_decision',
    jsonb_build_object('team_id', v_req.team_id, 'team_name', v_team_name, 'approved', p_approve),
    'team_join_decision:' || p_request_id);
end $$;

create or replace function public.set_team_member_role(p_team_id uuid, p_user_id uuid, p_role public.team_role)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_current public.team_role;
begin
  if private.team_role_of(p_team_id, v_uid) is distinct from 'captain' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_current := private.team_role_of(p_team_id, p_user_id);
  if v_current is null then
    raise exception 'not_a_member' using errcode = 'P0002';
  end if;
  if p_user_id = v_uid and p_role <> 'captain' then
    raise exception 'transfer_captaincy_first' using errcode = 'P0001';
  end if;
  if p_role = 'captain' and p_user_id <> v_uid then
    -- Transfer captaincy: current captain becomes manager.
    update public.team_members set role = 'manager' where team_id = p_team_id and user_id = v_uid;
  end if;
  update public.team_members set role = p_role where team_id = p_team_id and user_id = p_user_id;
  perform private.audit('team.role_changed', 'team', p_team_id::text,
    jsonb_build_object('user_id', p_user_id, 'from', v_current, 'to', p_role));
  perform private.notify(p_user_id, 'team_role_changed',
    jsonb_build_object('team_id', p_team_id, 'team_name', (select name from public.teams where id = p_team_id), 'role', p_role));
end $$;

create or replace function public.remove_team_member(p_team_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_actor_role public.team_role := private.team_role_of(p_team_id, v_uid);
  v_target_role public.team_role := private.team_role_of(p_team_id, p_user_id);
begin
  if v_target_role is null then
    raise exception 'not_a_member' using errcode = 'P0002';
  end if;
  if p_user_id = v_uid then
    raise exception 'use_leave_team' using errcode = 'P0001';
  end if;
  -- Captains may remove anyone else; managers may only remove players.
  if not (v_actor_role = 'captain' or (v_actor_role = 'manager' and v_target_role = 'player')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.team_members where team_id = p_team_id and user_id = p_user_id;
  perform private.audit('team.member_removed', 'team', p_team_id::text, jsonb_build_object('user_id', p_user_id));
  perform private.notify(p_user_id, 'team_member_removed',
    jsonb_build_object('team_id', p_team_id, 'team_name', (select name from public.teams where id = p_team_id)));
end $$;

create or replace function public.leave_team(p_team_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(false);
  v_role public.team_role := private.team_role_of(p_team_id, v_uid);
  v_others int;
begin
  if v_role is null then
    raise exception 'not_a_member' using errcode = 'P0002';
  end if;
  select count(*) into v_others from public.team_members where team_id = p_team_id and user_id <> v_uid;
  if v_role = 'captain' and v_others > 0 then
    raise exception 'transfer_captaincy_first' using errcode = 'P0001';
  end if;
  delete from public.team_members where team_id = p_team_id and user_id = v_uid;
  if v_others = 0 then
    update public.teams set is_archived = true where id = p_team_id;
  end if;
end $$;

create or replace function public.set_my_team_position(p_team_id uuid, p_position public.player_position)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  update public.team_members set position = p_position where team_id = p_team_id and user_id = v_uid;
  if not found then
    raise exception 'not_a_member' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.archive_team(p_team_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if private.team_role_of(p_team_id, v_uid) is distinct from 'captain' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.teams set is_archived = true where id = p_team_id;
  update public.team_recruitment set status = 'closed', closed_at = now() where team_id = p_team_id and status = 'open';
  update public.team_invitations set status = 'revoked', responded_at = now() where team_id = p_team_id and status = 'pending';
  perform private.audit('team.archived', 'team', p_team_id::text);
end $$;

create or replace function public.create_recruitment(
  p_team_id uuid,
  p_title text,
  p_description text default null,
  p_positions public.player_position[] default '{}',
  p_players_needed int default 1,
  p_skill_level public.skill_level default null,
  p_expires_in_days int default 14
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_id uuid;
begin
  perform private.require_team_manager(p_team_id, v_uid);
  if p_expires_in_days is null or p_expires_in_days not between 1 and 60 then
    raise exception 'invalid_expiry' using errcode = '22023';
  end if;
  if (select count(*) from public.team_recruitment where team_id = p_team_id and status = 'open' and expires_at > now()) >= 5 then
    raise exception 'too_many_open_listings' using errcode = 'P0001';
  end if;
  insert into public.team_recruitment (team_id, created_by, title, description, positions, players_needed, skill_level, expires_at)
  values (p_team_id, v_uid, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_positions, '{}'),
          coalesce(p_players_needed, 1), p_skill_level, now() + make_interval(days => p_expires_in_days))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.close_recruitment(p_recruitment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_team uuid;
begin
  select team_id into v_team from public.team_recruitment where id = p_recruitment_id;
  if v_team is null then
    raise exception 'recruitment_not_found' using errcode = 'P0002';
  end if;
  perform private.require_team_manager(v_team, v_uid);
  update public.team_recruitment set status = 'closed', closed_at = now() where id = p_recruitment_id and status = 'open';
end $$;
