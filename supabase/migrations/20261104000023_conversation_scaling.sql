-- =============================================================================
-- Conversation lists and unread counts that stay fast as the platform grows.
--
-- unread_counts() runs on every page a signed-in person opens (the header's
-- bell and messages counts). It summed my_conversations(), which found the
-- person's conversations by testing every match, tournament and challenge
-- conversation on the platform with a function call each: the cost of any
-- page grew with the whole country's matches, not with the person's own.
-- With national data (10,000 matches, 100,000 messages) one call took ~75 ms.
--
-- 1. private.my_conversation_ids(): starts from the person (their matches,
--    teams, bookings, venues, managed teams' challenges and tournaments,
--    direct conversations) through existing indexes. Same membership rules.
-- 2. my_conversations() and unread_counts() use it; unread_counts() no longer
--    builds titles and last messages just to add numbers up.
-- 3. An index to count a conversation's messages since the person read it.
--
-- Same results as before. Safe to run twice.
-- =============================================================================

create index if not exists messages_conversation_time_idx on public.messages (conversation_id, created_at);

create or replace function private.my_conversation_ids(p_user uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  with managed as (
    select team_id from public.team_members where user_id = p_user and role in ('captain', 'manager')
  )
  -- Matches they organize or play in (confirmed).
  select c.id from public.conversations c join public.matches m on m.id = c.match_id
   where c.kind = 'match' and m.organizer_id = p_user
  union
  select c.id from public.conversations c join public.match_participants mp on mp.match_id = c.match_id
   where c.kind = 'match' and mp.user_id = p_user and mp.status = 'confirmed'
  -- Their teams.
  union
  select c.id from public.conversations c join public.team_members tm on tm.team_id = c.team_id
   where c.kind = 'team' and tm.user_id = p_user
  -- Bookings they made, or at venues they staff.
  union
  select c.id from public.conversations c join public.bookings b on b.id = c.booking_id
   where c.kind = 'booking' and b.requested_by = p_user
  union
  select c.id from public.conversations c join public.bookings b on b.id = c.booking_id
    join public.venue_staff s on s.venue_id = b.venue_id
   where c.kind = 'booking' and s.user_id = p_user
  -- Challenges between teams they manage.
  union
  select c.id from public.conversations c join public.opponent_challenges ch on ch.id = c.challenge_id
   where c.kind = 'challenge' and (ch.challenger_team_id in (select team_id from managed) or ch.target_team_id in (select team_id from managed))
  -- Tournaments they organize, or have a managed team registered in.
  union
  select c.id from public.conversations c join public.tournaments t on t.id = c.tournament_id
   where c.kind = 'tournament' and t.organizer_id = p_user
  union
  select c.id from public.conversations c join public.tournament_teams tt on tt.tournament_id = c.tournament_id
   where c.kind = 'tournament' and tt.status in ('pending', 'approved', 'waitlisted') and tt.team_id in (select team_id from managed)
  -- Direct conversations.
  union
  select cm.conversation_id from public.conversation_members cm where cm.user_id = p_user;
$$;
revoke execute on function private.my_conversation_ids(uuid) from public, anon, authenticated;

create or replace function public.my_conversations(p_limit int default 50)
returns table (
  conversation_id uuid, kind public.conversation_kind, ref_id uuid, title text, is_locked boolean,
  last_message_at timestamptz, last_message text, unread_count bigint, last_kind text
) language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid)
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
    lm.body,
    (select count(*) from public.messages m, me
      where m.conversation_id = c.id and m.sender_id is distinct from me.uid
        and m.created_at > coalesce((select r.last_read_at from public.conversation_reads r
                                     where r.conversation_id = c.id and r.user_id = me.uid), '-infinity'::timestamptz)),
    lm.kind
  from me, public.conversations c
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
  where c.id in (select private.my_conversation_ids(me.uid)) and (c.last_message_at is not null or c.kind = 'direct')
  order by c.last_message_at desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;
revoke execute on function public.my_conversations(int) from public, anon;
grant execute on function public.my_conversations(int) to authenticated;

create or replace function public.unread_counts()
returns jsonb language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid)
  select jsonb_build_object(
    'notifications', (select count(*) from public.notifications, me where user_id = me.uid and read_at is null),
    'messages', (select count(*) from me
                   cross join lateral private.my_conversation_ids(me.uid) ids(id)
                   join public.messages m on m.conversation_id = ids.id
                   left join public.conversation_reads r on r.conversation_id = ids.id and r.user_id = me.uid
                  where m.sender_id is distinct from me.uid
                    and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz))
  );
$$;
