-- =============================================================================
-- Conversations & messages.
--
-- Access to a conversation is derived from current domain membership rather
-- than a synced member list (except direct conversations):
--   match      -> organizer + confirmed participants
--   team       -> team members
--   booking    -> requester + venue staff
--   challenge  -> managers of both teams
--   tournament -> organizer + managers of registered teams
--   direct     -> the two members
-- Leaving a match/team therefore immediately revokes access. Platform staff do
-- not read conversations; reported messages are snapshotted into the report.
-- =============================================================================

create type public.conversation_kind as enum ('match', 'team', 'booking', 'challenge', 'tournament', 'direct');

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind public.conversation_kind not null,
  match_id uuid unique references public.matches(id) on delete cascade,
  team_id uuid unique references public.teams(id) on delete cascade,
  booking_id uuid unique references public.bookings(id) on delete cascade,
  challenge_id uuid unique references public.opponent_challenges(id) on delete cascade,
  tournament_id uuid unique references public.tournaments(id) on delete cascade,
  direct_key text unique,
  is_locked boolean not null default false,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (kind = 'match' and match_id is not null) or (kind = 'team' and team_id is not null) or
    (kind = 'booking' and booking_id is not null) or (kind = 'challenge' and challenge_id is not null) or
    (kind = 'tournament' and tournament_id is not null) or (kind = 'direct' and direct_key is not null)
  )
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members(user_id);

create table public.conversation_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index messages_conversation_idx on public.messages(conversation_id, id desc);

-- ---------------------------------------------------------------------------
-- Access
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
    when 'direct' then
      return exists (select 1 from public.conversation_members where conversation_id = c.id and user_id = v_uid);
  end case;
  return false;
end $$;

-- ---------------------------------------------------------------------------
-- Conversations are created automatically with their parent entity.
-- ---------------------------------------------------------------------------
create or replace function private.create_entity_conversation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  case tg_table_name
    when 'matches' then insert into public.conversations (kind, match_id) values ('match', new.id);
    when 'teams' then insert into public.conversations (kind, team_id) values ('team', new.id);
    when 'bookings' then
      if new.kind = 'customer' then
        insert into public.conversations (kind, booking_id) values ('booking', new.id);
      end if;
    when 'opponent_challenges' then insert into public.conversations (kind, challenge_id) values ('challenge', new.id);
    when 'tournaments' then insert into public.conversations (kind, tournament_id) values ('tournament', new.id);
  end case;
  return new;
end $$;

create trigger matches_conversation after insert on public.matches for each row execute function private.create_entity_conversation();
create trigger teams_conversation after insert on public.teams for each row execute function private.create_entity_conversation();
create trigger bookings_conversation after insert on public.bookings for each row execute function private.create_entity_conversation();
create trigger challenges_conversation after insert on public.opponent_challenges for each row execute function private.create_entity_conversation();
create trigger tournaments_conversation after insert on public.tournaments for each row execute function private.create_entity_conversation();

-- Cancelled matches keep their history but become read-only.
create or replace function private.lock_cancelled_match_conversation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.conversations set is_locked = true where match_id = new.id;
  end if;
  return new;
end $$;
create trigger matches_lock_conversation after update of status on public.matches
  for each row execute function private.lock_cancelled_match_conversation();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.conversation_reads enable row level security;
alter table public.messages enable row level security;

create policy conversations_read on public.conversations for select using (private.can_access_conversation(id));
create policy conversation_members_read on public.conversation_members for select using (private.can_access_conversation(conversation_id));
create policy conversation_reads_read on public.conversation_reads for select using (user_id = (select auth.uid()));
create policy messages_read on public.messages for select using (private.can_access_conversation(conversation_id));

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.start_direct_conversation(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_key text;
  v_id uuid;
begin
  if p_user_id = v_uid or not exists (select 1 from public.profiles where id = p_user_id and status = 'active') then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if private.is_blocked_between(v_uid, p_user_id) then
    raise exception 'user_blocked' using errcode = '42501';
  end if;
  v_key := least(v_uid::text, p_user_id::text) || ':' || greatest(v_uid::text, p_user_id::text);
  select id into v_id from public.conversations where direct_key = v_key;
  if v_id is null then
    perform private.rate_limit(v_uid, 'direct_conversation', 20, interval '1 day');
    insert into public.conversations (kind, direct_key) values ('direct', v_key)
    on conflict (direct_key) do nothing returning id into v_id;
    if v_id is null then
      select id into v_id from public.conversations where direct_key = v_key;
    end if;
    insert into public.conversation_members (conversation_id, user_id) values (v_id, v_uid), (v_id, p_user_id)
    on conflict do nothing;
  end if;
  return v_id;
end $$;

create or replace function public.entity_conversation_id(p_kind public.conversation_kind, p_entity_id uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.conversations c
   where c.kind = p_kind and p_entity_id = case p_kind
     when 'match' then c.match_id when 'team' then c.team_id when 'booking' then c.booking_id
     when 'challenge' then c.challenge_id when 'tournament' then c.tournament_id end;
  if v_id is null or not private.can_access_conversation(v_id) then
    return null;
  end if;
  return v_id;
end $$;

create or replace function public.send_message(p_conversation_id uuid, p_body text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  c public.conversations%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_id bigint;
  v_other uuid;
  v_bucket text := floor(extract(epoch from now()) / 900)::bigint::text;
  r record;
begin
  if char_length(v_body) = 0 or char_length(v_body) > 2000 then
    raise exception 'invalid_message' using errcode = '22023';
  end if;
  select * into c from public.conversations where id = p_conversation_id;
  if not found or not private.can_access_conversation(p_conversation_id, v_uid) then
    raise exception 'conversation_not_found' using errcode = 'P0002';
  end if;
  if c.is_locked then
    raise exception 'conversation_locked' using errcode = 'P0001';
  end if;
  if c.kind = 'direct' then
    select user_id into v_other from public.conversation_members where conversation_id = c.id and user_id <> v_uid;
    if private.is_blocked_between(v_uid, v_other) then
      raise exception 'user_blocked' using errcode = '42501';
    end if;
  end if;
  perform private.rate_limit(v_uid, 'message', private.setting_int('messaging.max_per_minute', 20), interval '1 minute');
  insert into public.messages (conversation_id, sender_id, body) values (c.id, v_uid, v_body) returning id into v_id;
  update public.conversations set last_message_at = now() where id = c.id;
  insert into public.conversation_reads (conversation_id, user_id, last_read_at) values (c.id, v_uid, now())
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
  -- One-to-one style conversations notify the other party (at most every 15 minutes).
  if c.kind = 'direct' then
    perform private.notify(v_other, 'new_message',
      jsonb_build_object('conversation_id', c.id, 'sender_name', (select display_name from public.profiles where id = v_uid)),
      'msg:' || c.id || ':' || v_bucket);
  elsif c.kind = 'booking' then
    for r in select b.requested_by as uid from public.bookings b where b.id = c.booking_id
             union select s.user_id from public.venue_staff s join public.bookings b on b.venue_id = s.venue_id where b.id = c.booking_id
    loop
      if r.uid is not null and r.uid <> v_uid then
        perform private.notify(r.uid, 'new_message',
          jsonb_build_object('conversation_id', c.id, 'sender_name', (select display_name from public.profiles where id = v_uid)),
          'msg:' || c.id || ':' || v_bucket);
      end if;
    end loop;
  end if;
  return v_id;
end $$;

create or replace function public.delete_message(p_message_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(false);
begin
  update public.messages set deleted_at = now(), body = '[deleted]'
   where id = p_message_id and sender_id = v_uid and deleted_at is null;
  if not found then
    raise exception 'message_not_found' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(false);
begin
  if not private.can_access_conversation(p_conversation_id, v_uid) then
    raise exception 'conversation_not_found' using errcode = 'P0002';
  end if;
  insert into public.conversation_reads (conversation_id, user_id, last_read_at) values (p_conversation_id, v_uid, now())
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
end $$;

-- Conversations the caller can currently access, with titles and unread counts.
create or replace function public.my_conversations(p_limit int default 50)
returns table (
  conversation_id uuid, kind public.conversation_kind, ref_id uuid, title text, is_locked boolean,
  last_message_at timestamptz, last_message text, unread_count bigint
) language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid),
  candidates as (
    select c.id from public.conversations c join public.matches m on m.id = c.match_id, me
     where c.kind = 'match' and (m.organizer_id = me.uid or private.is_confirmed_participant(m.id, me.uid))
    union
    select c.id from public.conversations c join public.team_members tm on tm.team_id = c.team_id, me
     where c.kind = 'team' and tm.user_id = me.uid
    union
    select c.id from public.conversations c join public.bookings b on b.id = c.booking_id, me
     where c.kind = 'booking' and (b.requested_by = me.uid or exists (select 1 from public.venue_staff s where s.venue_id = b.venue_id and s.user_id = me.uid))
    union
    select c.id from public.conversations c join public.opponent_challenges ch on ch.id = c.challenge_id, me
     where c.kind = 'challenge' and (private.is_team_manager(ch.challenger_team_id, me.uid) or private.is_team_manager(ch.target_team_id, me.uid))
    union
    select c.id from public.conversations c, me
     where c.kind = 'tournament' and private.can_access_tournament_chat(c.tournament_id, me.uid)
    union
    select cm.conversation_id from public.conversation_members cm, me where cm.user_id = me.uid
  )
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
      when 'direct' then (select p.display_name from public.conversation_members cm join public.profiles p on p.id = cm.user_id, me
                          where cm.conversation_id = c.id and cm.user_id <> me.uid limit 1)
    end,
    c.is_locked,
    c.last_message_at,
    (select left(m.body, 120) from public.messages m where m.conversation_id = c.id order by m.id desc limit 1),
    (select count(*) from public.messages m, me
      where m.conversation_id = c.id and m.sender_id is distinct from me.uid
        and m.created_at > coalesce((select r.last_read_at from public.conversation_reads r
                                     where r.conversation_id = c.id and r.user_id = me.uid), '-infinity'::timestamptz))
  from public.conversations c
  where c.id in (select id from candidates) and (c.last_message_at is not null or c.kind = 'direct')
  order by c.last_message_at desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

create or replace function public.unread_counts()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'notifications', (select count(*) from public.notifications where user_id = auth.uid() and read_at is null),
    'messages', coalesce((select sum(unread_count) from public.my_conversations(200)), 0)
  );
$$;

-- Realtime: deliver new messages and notifications (RLS still applies).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.notifications;
  end if;
end $$;
