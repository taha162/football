-- =============================================================================
-- Group conversations, step 2 of 2 (0044; run 0043 first, on its own).
--
-- A member makes a group with a name and some of their friends (0042), and is
-- its first admin. Admins add friends of theirs, remove members, make other
-- members admins (or not), and rename the group. Anyone may leave.
-- - conversations.title, created_by: the group's name and who made it.
--   The one who made it cannot be removed or lose admin by others.
-- - conversation_members.role: 'member' or 'admin' (only groups use admin).
-- - Access: the group's current members, as in a one-to-one conversation.
--   Leaving or being removed ends access at once. A group with nobody left
--   stays, unseen.
-- - Never without an admin: when the last admin goes (leaves, is removed, or
--   their account is deleted), the member there longest becomes one.
-- - Up to groups.max_members (100) members; groups.max_per_day (10) new
--   groups a day per member.
-- - Notification group_added (once a day per group at most; can be switched
--   off in settings). Group messages light the messages tab like any other
--   conversation and add no notifications.
--
-- New columns have defaults (no table rewrite); changes no existing data.
-- Safe to run twice.
-- =============================================================================

alter table public.conversations
  add column if not exists title text,
  add column if not exists created_by uuid references public.profiles(id) on delete set null;
create index if not exists conversations_created_by_fk_idx on public.conversations (created_by) where created_by is not null;

alter table public.conversation_members
  add column if not exists role text not null default 'member';
alter table public.conversation_members drop constraint if exists conversation_members_role_check;
alter table public.conversation_members add constraint conversation_members_role_check
  check (role in ('member', 'admin')) not valid;
alter table public.conversation_members validate constraint conversation_members_role_check;

-- A group has a name of 1 to 60 characters; the other kinds as before.
alter table public.conversations drop constraint if exists conversations_check;
alter table public.conversations add constraint conversations_check check (
  (kind = 'match' and match_id is not null) or (kind = 'team' and team_id is not null) or
  (kind = 'booking' and booking_id is not null) or (kind = 'challenge' and challenge_id is not null) or
  (kind = 'tournament' and tournament_id is not null) or (kind = 'direct' and direct_key is not null) or
  (kind = 'group' and char_length(title) between 1 and 60)
) not valid;
alter table public.conversations validate constraint conversations_check;

insert into public.platform_settings (key, value, description, is_public) values
  ('groups.max_members', '100', 'Members a group conversation may have.', false),
  ('groups.max_per_day', '10', 'Groups one member may create in a day.', false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Access: as in 0007, with groups beside direct conversations.
-- ---------------------------------------------------------------------------
create or replace function private.can_access_conversation(p_conversation uuid, p_user uuid default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  c public.conversations%rowtype;
  v_uid uuid := coalesce(p_user, auth.uid());
begin
  if v_uid is null then return false; end if;
  select * into c from public.conversations where id = p_conversation;
  if not found then return false; end if;
  case c.kind
    when 'match' then
      return exists (select 1 from public.matches m where m.id = c.match_id and m.organizer_id = v_uid)
          or private.is_confirmed_participant(c.match_id, v_uid)
          or exists (select 1 from public.matches m where m.id = c.match_id and m.match_type = 'team_vs_team'
                     and (private.is_team_manager(m.home_team_id, v_uid) or private.is_team_manager(m.away_team_id, v_uid)));
    when 'team' then
      return exists (select 1 from public.team_members where team_id = c.team_id and user_id = v_uid);
    when 'booking' then
      return exists (select 1 from public.bookings b where b.id = c.booking_id and
                     (b.requested_by = v_uid or exists (select 1 from public.venue_staff s where s.venue_id = b.venue_id and s.user_id = v_uid)));
    when 'challenge' then
      return private.is_challenge_manager(c.challenge_id, v_uid);
    when 'tournament' then
      return private.can_access_tournament_chat(c.tournament_id, v_uid);
    when 'direct', 'group' then
      return exists (select 1 from public.conversation_members where conversation_id = c.id and user_id = v_uid);
    else
      return false;
  end case;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- p_user's role in the group: 'admin', 'member', or null (not in it, or not a group).
create or replace function private.group_role(p_conversation uuid, p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select cm.role from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id and c.kind = 'group'
   where cm.conversation_id = p_conversation and cm.user_id = p_user;
$$;

-- The caller, if they are an admin of the group. Locks the group, so changes
-- to its members happen one after another.
create or replace function private.require_group_admin(p_conversation uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_role text;
begin
  perform 1 from public.conversations where id = p_conversation and kind = 'group' for update;
  v_role := private.group_role(p_conversation, v_uid);
  if v_role is null then
    raise exception 'conversation_not_found' using errcode = 'P0002';
  elsif v_role <> 'admin' then
    raise exception 'not_group_admin' using errcode = '42501';
  end if;
  return v_uid;
end $$;

-- A group's name: spaces and line breaks become single spaces; 1 to 60 characters.
create or replace function private.group_name(p_title text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
begin
  if char_length(v) not between 1 and 60 then
    raise exception 'invalid_group_name' using errcode = '22023';
  end if;
  return v;
end $$;

-- Adds p_by's friends to the group (the caller has locked it); returns how many joined.
create or replace function private.insert_group_members(p_conversation uuid, p_by uuid, p_users uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_max int := private.setting_int('groups.max_members', 100);
  v_ids uuid[];
  v_new int;
  v_added int := 0;
  v_title text;
  v_by_name text;
  r record;
begin
  if cardinality(p_users) > v_max then
    raise exception 'group_full' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct u), '{}') into v_ids
    from unnest(coalesce(p_users, '{}'::uuid[])) u
   where u is not null and u <> p_by
     and not exists (select 1 from public.conversation_members cm where cm.conversation_id = p_conversation and cm.user_id = u);
  if cardinality(v_ids) = 0 then return 0; end if;
  -- Friends only, and only active members.
  if exists (select 1 from unnest(v_ids) u
              where not private.are_friends(p_by, u)
                 or not exists (select 1 from public.profiles p where p.id = u and p.status = 'active')) then
    raise exception 'not_friends' using errcode = '42501';
  end if;
  select count(*) into v_new from public.conversation_members where conversation_id = p_conversation;
  if v_new + cardinality(v_ids) > v_max then
    raise exception 'group_full' using errcode = 'P0001';
  end if;
  select title into v_title from public.conversations where id = p_conversation;
  select display_name into v_by_name from public.profiles where id = p_by;
  for r in
    insert into public.conversation_members (conversation_id, user_id, role)
    select p_conversation, u, 'member' from unnest(v_ids) u
    on conflict (conversation_id, user_id) do nothing
    returning user_id
  loop
    v_added := v_added + 1;
    perform private.notify(r.user_id, 'group_added',
      jsonb_build_object('conversation_id', p_conversation, 'group_name', v_title, 'by_name', v_by_name),
      'group_added:' || p_conversation || ':' || r.user_id || ':' || current_date);
  end loop;
  return v_added;
end $$;

-- ---------------------------------------------------------------------------
-- What members do
-- ---------------------------------------------------------------------------

-- A new group with its name and some of the caller's friends; the caller is its admin.
create or replace function public.create_group(p_title text, p_member_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_title text := private.group_name(p_title);
  v_id uuid;
begin
  if not exists (select 1 from unnest(coalesce(p_member_ids, '{}'::uuid[])) u where u is not null and u <> v_uid) then
    raise exception 'group_needs_members' using errcode = '22023';
  end if;
  perform private.rate_limit(v_uid, 'group_create', private.setting_int('groups.max_per_day', 10), interval '1 day');
  insert into public.conversations (kind, title, created_by) values ('group', v_title, v_uid) returning id into v_id;
  insert into public.conversation_members (conversation_id, user_id, role) values (v_id, v_uid, 'admin');
  perform private.insert_group_members(v_id, v_uid, p_member_ids);
  return v_id;
end $$;

-- Admins: add friends of theirs. Returns how many joined.
create or replace function public.add_group_members(p_conversation_id uuid, p_member_ids uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_group_admin(p_conversation_id);
begin
  return private.insert_group_members(p_conversation_id, v_uid, p_member_ids);
end $$;

-- Admins: remove a member (not themselves: they leave instead; not the one who made the group).
create or replace function public.remove_group_member(p_conversation_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_group_admin(p_conversation_id);
begin
  if p_user_id = v_uid then
    raise exception 'invalid' using errcode = '22023';
  end if;
  if exists (select 1 from public.conversations where id = p_conversation_id and created_by = p_user_id) then
    raise exception 'group_creator' using errcode = '42501';
  end if;
  delete from public.conversation_members where conversation_id = p_conversation_id and user_id = p_user_id;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
end $$;

-- Admins: make a member an admin, or not (not themselves; the one who made the group stays one).
create or replace function public.set_group_admin(p_conversation_id uuid, p_user_id uuid, p_admin boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_group_admin(p_conversation_id);
begin
  if p_user_id = v_uid or p_admin is null then
    raise exception 'invalid' using errcode = '22023';
  end if;
  if not p_admin and exists (select 1 from public.conversations where id = p_conversation_id and created_by = p_user_id) then
    raise exception 'group_creator' using errcode = '42501';
  end if;
  update public.conversation_members set role = case when p_admin then 'admin' else 'member' end
   where conversation_id = p_conversation_id and user_id = p_user_id;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
end $$;

-- Admins: a new name.
create or replace function public.rename_group(p_conversation_id uuid, p_title text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_group_admin(p_conversation_id);
begin
  update public.conversations set title = private.group_name(p_title) where id = p_conversation_id;
end $$;

-- Anyone: leave. Their own settings for it (pinned, muted…) go too.
create or replace function public.leave_group(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
begin
  perform 1 from public.conversations where id = p_conversation_id and kind = 'group' for update;
  delete from public.conversation_members where conversation_id = p_conversation_id and user_id = v_uid
     and exists (select 1 from public.conversations c where c.id = p_conversation_id and c.kind = 'group');
  if not found then
    raise exception 'conversation_not_found' using errcode = 'P0002';
  end if;
  delete from public.conversation_prefs where conversation_id = p_conversation_id and user_id = v_uid;
end $$;

-- Never without an admin: when the last one goes, the member there longest becomes one.
create or replace function private.keep_group_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin'
     and exists (select 1 from public.conversations c where c.id = old.conversation_id and c.kind = 'group')
     and not exists (select 1 from public.conversation_members where conversation_id = old.conversation_id and role = 'admin') then
    update public.conversation_members set role = 'admin'
     where conversation_id = old.conversation_id
       and user_id = (select user_id from public.conversation_members
                       where conversation_id = old.conversation_id
                       order by created_at, user_id limit 1);
  end if;
  return null;
end $$;
drop trigger if exists conversation_members_keep_admin on public.conversation_members;
create trigger conversation_members_keep_admin after delete on public.conversation_members
  for each row execute function private.keep_group_admin();

-- ---------------------------------------------------------------------------
-- The list (as in 0040): a group shows its name, and shows before its first message.
-- ---------------------------------------------------------------------------
create or replace function public.my_conversations(p_limit int default 50)
returns table (
  conversation_id uuid, kind public.conversation_kind, ref_id uuid, title text, is_locked boolean,
  last_message_at timestamptz, last_message text, unread_count bigint, last_kind text,
  pinned boolean, muted boolean, favorite boolean, nickname text
) language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid where private.mfa_satisfied()) -- second step
  select c.id, c.kind,
    coalesce(c.match_id, c.team_id, c.booking_id, c.challenge_id, c.tournament_id),
    case c.kind
      when 'match' then (select title from public.matches where id = c.match_id)
      when 'team' then (select name from public.teams where id = c.team_id)
      when 'booking' then (select v.name from public.bookings b join public.venues v on v.id = b.venue_id where b.id = c.booking_id)
      when 'challenge' then (select t1.name || ' – ' || t2.name from public.opponent_challenges ch
                              join public.teams t1 on t1.id = ch.challenger_team_id join public.teams t2 on t2.id = ch.target_team_id
                              where ch.id = c.challenge_id)
      when 'tournament' then (select name from public.tournaments where id = c.tournament_id)
      when 'direct' then (select p.display_name from public.conversation_members cm join public.profiles p on p.id = cm.user_id
                          where cm.conversation_id = c.id and cm.user_id <> me.uid limit 1)
      when 'group' then c.title
    end,
    c.is_locked,
    c.last_message_at,
    lm.body,
    -- Stops at 100: the list shows «99+» past that.
    (select count(*) from (
       select 1 from public.messages m
        where m.conversation_id = c.id and m.sender_id is distinct from me.uid
          and m.created_at > coalesce((select r.last_read_at from public.conversation_reads r
                                       where r.conversation_id = c.id and r.user_id = me.uid), '-infinity'::timestamptz)
        limit 100) unread),
    lm.kind,
    pr.pinned_at is not null,
    coalesce(pr.muted_until > now(), false),
    coalesce(pr.favorite, false),
    pr.nickname
  from me, public.conversations c
  left join public.conversation_prefs pr on pr.conversation_id = c.id and pr.user_id = (select auth.uid())
  left join lateral (
    select left(m.body, 120) as body,
           case when m.deleted_at is not null then 'text'
                when m.call_outcome is not null then 'call'
                when m.voice_path is not null then 'voice'
                when m.location_lat is not null then 'location'
                when m.image_path is not null then 'image'
                else 'text' end as kind
      from public.messages m where m.conversation_id = c.id order by m.id desc limit 1
  ) lm on true
  where c.id in (select private.my_conversation_ids(me.uid))
    and (c.last_message_at is not null or c.kind in ('direct', 'group'))
    and (pr.cleared_at is null or c.last_message_at > pr.cleared_at)
  order by (pr.pinned_at is not null) desc, pr.pinned_at desc nulls last, c.last_message_at desc nulls last, c.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- ---------------------------------------------------------------------------
-- Grants: through the API for signed-in members only; each function checks the rest.
-- ---------------------------------------------------------------------------
revoke all on function private.group_role(uuid, uuid) from public, anon, authenticated;
revoke all on function private.require_group_admin(uuid) from public, anon, authenticated;
revoke all on function private.group_name(text) from public, anon, authenticated;
revoke all on function private.insert_group_members(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function private.keep_group_admin() from public, anon, authenticated;
revoke all on function public.create_group(text, uuid[]) from public, anon;
revoke all on function public.add_group_members(uuid, uuid[]) from public, anon;
revoke all on function public.remove_group_member(uuid, uuid) from public, anon;
revoke all on function public.set_group_admin(uuid, uuid, boolean) from public, anon;
revoke all on function public.rename_group(uuid, text) from public, anon;
revoke all on function public.leave_group(uuid) from public, anon;
grant execute on function public.create_group(text, uuid[]) to authenticated;
grant execute on function public.add_group_members(uuid, uuid[]) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.set_group_admin(uuid, uuid, boolean) to authenticated;
grant execute on function public.rename_group(uuid, text) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
revoke execute on function public.my_conversations(int) from public, anon;
grant execute on function public.my_conversations(int) to authenticated;
