-- =============================================================================
-- The header's numbers in one request, and unread counts that stop at 100.
--
-- Every page a member opens (and every check for news) asked the database four
-- separate questions for the header: unread messages, unread notifications,
-- whether they staff a venue, whether they organize a tournament. Now one:
-- header_state(). Unread messages were counted one by one: a member in busy
-- group chats they never open made every page count tens of thousands of rows
-- (measured: 16 ms warm, 304 ms cold for 32,800 unread). The dot only needs to
-- know there is something, and lists show «99+» past 99, so counts stop at 100
-- (2.8 ms for the same member).
--
-- - header_state(): {messages, notifications, manages_venues,
--   manages_tournaments}. The bell leaves out new-message notifications (a red
--   dot on «الرسائل» says there are new messages). Both counts stop at 100.
-- - unread_counts() and my_conversations(): same results, but their unread
--   counts stop at 100 too.
-- - Before this file runs, the site asks the four questions as before.
--
-- Changes no data. Safe to run twice.
-- =============================================================================

-- Unread messages for a member, counted up to p_cap.
create or replace function private.unread_message_count(p_uid uuid, p_cap int default 100)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from (
    select 1
      from private.my_conversation_ids(p_uid) ids(id)
      join public.messages m on m.conversation_id = ids.id
      left join public.conversation_reads r on r.conversation_id = ids.id and r.user_id = p_uid
     where m.sender_id is distinct from p_uid
       and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
     limit greatest(coalesce(p_cap, 100), 1)) unread;
$$;
revoke all on function private.unread_message_count(uuid, int) from public;

create or replace function public.header_state()
returns jsonb language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid where private.mfa_satisfied()) -- second step
  select jsonb_build_object(
    'messages', coalesce((select private.unread_message_count(me.uid, 100) from me), 0),
    'notifications', coalesce((select count(*)::int from (
                       select 1 from public.notifications n, me
                        where n.user_id = me.uid and n.read_at is null and n.type <> 'new_message'
                        limit 100) bell), 0),
    'manages_venues', exists (select 1 from public.venue_staff s, me where s.user_id = me.uid),
    'manages_tournaments', exists (select 1 from public.tournaments t, me where t.organizer_id = me.uid)
  );
$$;
revoke all on function public.header_state() from public, anon;
grant execute on function public.header_state() to authenticated;

create or replace function public.unread_counts()
returns jsonb language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid where private.mfa_satisfied()) -- second step
  select jsonb_build_object(
    'notifications', coalesce((select count(*)::int from (
                       select 1 from public.notifications n, me where n.user_id = me.uid and n.read_at is null limit 100) bell), 0),
    'messages', coalesce((select private.unread_message_count(me.uid, 100) from me), 0)
  );
$$;

create or replace function public.my_conversations(p_limit int default 50)
returns table (
  conversation_id uuid, kind public.conversation_kind, ref_id uuid, title text, is_locked boolean,
  last_message_at timestamptz, last_message text, unread_count bigint, last_kind text
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
      when 'direct' then (select p.display_name from public.conversation_members cm join public.profiles p on p.id = cm.user_id, me
                          where cm.conversation_id = c.id and cm.user_id <> me.uid limit 1)
    end,
    c.is_locked,
    c.last_message_at,
    lm.body,
    -- Stops at 100: the list shows «99+» past that, and a long-unread group chat costs no more than a short one.
    (select count(*) from (
       select 1 from public.messages m
        where m.conversation_id = c.id and m.sender_id is distinct from me.uid
          and m.created_at > coalesce((select r.last_read_at from public.conversation_reads r
                                       where r.conversation_id = c.id and r.user_id = me.uid), '-infinity'::timestamptz)
        limit 100) unread),
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
