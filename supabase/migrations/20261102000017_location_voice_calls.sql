-- =============================================================================
-- Conversations: a shared location, voice notes and voice calls.
--
-- 1. Location: a message may carry a point (latitude, longitude, and how
--    accurate the phone said it was, in metres). Only the conversation's
--    members see it, like any message. Deleting the message erases the point.
-- 2. Voice notes: a message may carry a short recording (WebM/Ogg/MP4 audio,
--    up to 5 MB). Recordings live in the private bucket `message-voice` under
--    <conversation id>/<random name>, exactly like pictures: members and
--    moderators read them through short-lived signed links, and only the
--    server uploads, after checking the sender belongs to the conversation.
-- 3. Voice calls: two members of a direct conversation can call each other.
--    The call itself goes browser to browser (WebRTC); the database only
--    rings, carries the connection set-up between the two browsers
--    (call_signals, deleted when the call ends) and records the outcome as a
--    line in the conversation («مكالمة صوتية · 3:12» / «مكالمة فائتة»).
--    Nothing of what is said passes through or is stored by the server.
--    A missed call also sends a notification.
--
-- Run after 20261102000016_message_images.sql. Safe to run twice (SQL Editor
-- or `supabase db push`).
-- =============================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'messages' and column_name = 'image_path') then
    raise exception 'Run 20261102000016_message_images.sql first, then this file.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Voice notes: private bucket
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('message-voice', 'message-voice', false, 5242880, array['audio/webm', 'audio/ogg', 'audio/mp4'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
    execute 'drop policy if exists "message_voice_read" on storage.objects';
    execute $p$
      create policy "message_voice_read" on storage.objects for select to authenticated
        using (bucket_id = 'message-voice'
               and (private.can_access_conversation(private.try_uuid((storage.foldername(name))[1])) or private.is_moderator()))
    $p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Messages: new kinds of content
-- ---------------------------------------------------------------------------
alter table public.messages add column if not exists location_lat double precision;
alter table public.messages add column if not exists location_lng double precision;
alter table public.messages add column if not exists location_accuracy real;
alter table public.messages add column if not exists voice_path text;
alter table public.messages add column if not exists voice_seconds smallint;
-- A call's record in the conversation: answered (with its length) or missed.
alter table public.messages add column if not exists call_outcome text;
alter table public.messages add column if not exists call_seconds integer;

alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages drop constraint if exists messages_location_check;
alter table public.messages drop constraint if exists messages_voice_check;
alter table public.messages drop constraint if exists messages_call_check;
-- A message has text, a picture, a location, a voice note or a call record.
alter table public.messages add constraint messages_content_check
  check (char_length(body) <= 2000 and (char_length(body) >= 1 or image_path is not null or location_lat is not null
                                        or voice_path is not null or call_outcome is not null));
alter table public.messages add constraint messages_location_check
  check ((location_lat is null) = (location_lng is null)
         and (location_lat is null or (location_lat between -90 and 90 and location_lng between -180 and 180))
         and (location_accuracy is null or (location_lat is not null and location_accuracy between 0 and 100000)));
alter table public.messages add constraint messages_voice_check
  check ((voice_path is null and voice_seconds is null)
         or (voice_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webm|ogg|m4a)$' and voice_seconds between 1 and 300));
alter table public.messages add constraint messages_call_check
  check ((call_outcome is null and call_seconds is null)
         or (call_outcome = 'answered' and call_seconds >= 0)
         or (call_outcome = 'missed' and call_seconds is null));

drop function if exists public.send_message(uuid, text);
drop function if exists public.send_message(uuid, text, text);
create or replace function public.send_message(
  p_conversation_id uuid,
  p_body text,
  p_image_path text default null,
  p_location_lat double precision default null,
  p_location_lng double precision default null,
  p_location_accuracy real default null,
  p_voice_path text default null,
  p_voice_seconds integer default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  c public.conversations%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_image text := nullif(btrim(coalesce(p_image_path, '')), '');
  v_voice text := nullif(btrim(coalesce(p_voice_path, '')), '');
  v_location boolean := p_location_lat is not null or p_location_lng is not null;
  v_attachments int;
  v_id bigint;
  v_other uuid;
  v_bucket text := floor(extract(epoch from now()) / 900)::bigint::text;
  r record;
begin
  -- Text, and at most one of: a picture, a location, a voice note.
  v_attachments := (v_image is not null)::int + v_location::int + (v_voice is not null)::int;
  if char_length(v_body) > 2000 or v_attachments > 1 or (char_length(v_body) = 0 and v_attachments = 0) then
    raise exception 'invalid_message' using errcode = '22023';
  end if;
  -- NaN and infinities fail these comparisons too.
  if v_location and not (coalesce(p_location_lat between -90 and 90, false)
                         and coalesce(p_location_lng between -180 and 180, false)
                         and (p_location_accuracy is null or coalesce(p_location_accuracy between 0 and 100000, false))) then
    raise exception 'invalid_location' using errcode = '22023';
  end if;
  select * into c from public.conversations where id = p_conversation_id;
  if not found or not private.can_access_conversation(p_conversation_id, v_uid) then
    raise exception 'conversation_not_found' using errcode = 'P0002';
  end if;
  if c.is_locked then
    raise exception 'conversation_locked' using errcode = 'P0001';
  end if;
  -- The picture must be one the server stored in this conversation's folder.
  if v_image is not null and (
       v_image !~ ('^' || c.id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$')
       or not exists (select 1 from storage.objects o where o.bucket_id = 'message-images' and o.name = v_image)) then
    raise exception 'invalid_image' using errcode = '22023';
  end if;
  -- Likewise the voice note, with its length in seconds (shown beside it).
  if v_voice is not null and (
       v_voice !~ ('^' || c.id::text || '/[0-9a-f-]{36}\.(webm|ogg|m4a)$')
       or p_voice_seconds is null or p_voice_seconds not between 1 and 300
       or not exists (select 1 from storage.objects o where o.bucket_id = 'message-voice' and o.name = v_voice)) then
    raise exception 'invalid_voice' using errcode = '22023';
  end if;
  if c.kind = 'direct' then
    select user_id into v_other from public.conversation_members where conversation_id = c.id and user_id <> v_uid;
    if private.is_blocked_between(v_uid, v_other) then
      raise exception 'user_blocked' using errcode = '42501';
    end if;
  end if;
  perform private.rate_limit(v_uid, 'message', private.setting_int('messaging.max_per_minute', 20), interval '1 minute');
  insert into public.messages (conversation_id, sender_id, body, image_path,
                               location_lat, location_lng, location_accuracy, voice_path, voice_seconds)
  values (c.id, v_uid, v_body, v_image,
          case when v_location then round(p_location_lat::numeric, 6)::double precision end,
          case when v_location then round(p_location_lng::numeric, 6)::double precision end,
          case when v_location and p_location_accuracy is not null then round(p_location_accuracy::numeric)::real end,
          v_voice,
          case when v_voice is not null then p_voice_seconds end)
  returning id into v_id;
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
revoke execute on function public.send_message(uuid, text, text, double precision, double precision, real, text, integer) from public, anon;
grant execute on function public.send_message(uuid, text, text, double precision, double precision, real, text, integer) to authenticated;

-- Deleting a message erases everything it carried (the server removes the files).
create or replace function public.delete_message(p_message_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(false);
begin
  update public.messages set deleted_at = now(), body = '[deleted]', image_path = null,
         location_lat = null, location_lng = null, location_accuracy = null,
         voice_path = null, voice_seconds = null, call_outcome = null, call_seconds = null
   where id = p_message_id and sender_id = v_uid and deleted_at is null;
  if not found then
    raise exception 'message_not_found' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.admin_remove_message(p_message_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_moderator();
  v_sender uuid;
  v_conversation uuid;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  update public.messages set deleted_at = now(), body = '[removed]', image_path = null,
         location_lat = null, location_lng = null, location_accuracy = null,
         voice_path = null, voice_seconds = null, call_outcome = null, call_seconds = null
   where id = p_message_id and deleted_at is null
   returning sender_id, conversation_id into v_sender, v_conversation;
  if not found then
    raise exception 'message_not_found' using errcode = 'P0002';
  end if;
  perform private.audit('moderation.message_removed', 'message', p_message_id::text,
    jsonb_build_object('reason', p_reason, 'conversation_id', v_conversation, 'sender_id', v_sender));
  if v_sender is not null then
    perform private.notify(v_sender, 'moderation_notice',
      jsonb_build_object('entity_type', 'message', 'entity_id', p_message_id, 'hidden', true));
  end if;
end $$;

-- The conversation list also says what the last message was (picture,
-- location, voice note or call), so the page can label it.
drop function if exists public.my_conversations(int);
create function public.my_conversations(p_limit int default 50)
returns table (
  conversation_id uuid, kind public.conversation_kind, ref_id uuid, title text, is_locked boolean,
  last_message_at timestamptz, last_message text, unread_count bigint, last_kind text
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
    lm.body,
    (select count(*) from public.messages m, me
      where m.conversation_id = c.id and m.sender_id is distinct from me.uid
        and m.created_at > coalesce((select r.last_read_at from public.conversation_reads r
                                     where r.conversation_id = c.id and r.user_id = me.uid), '-infinity'::timestamptz)),
    lm.kind
  from public.conversations c
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
  where c.id in (select id from candidates) and (c.last_message_at is not null or c.kind = 'direct')
  order by c.last_message_at desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;
revoke execute on function public.my_conversations(int) from public, anon;
grant execute on function public.my_conversations(int) to authenticated;

-- ---------------------------------------------------------------------------
-- Voice calls
-- ---------------------------------------------------------------------------
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  callee_id uuid not null references public.profiles(id) on delete cascade,
  -- ringing → active → ended; or ringing → missed / declined; failed = the connection broke.
  status text not null default 'ringing' check (status in ('ringing', 'active', 'ended', 'missed', 'declined', 'failed')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  -- Each side's browser checks in every few seconds; a side that goes quiet has left.
  caller_seen_at timestamptz not null default now(),
  callee_seen_at timestamptz,
  check (caller_id <> callee_id)
);
create index if not exists calls_caller_idx on public.calls(caller_id, created_at desc);
create index if not exists calls_callee_idx on public.calls(callee_id, created_at desc);
create index if not exists calls_open_idx on public.calls(status) where status in ('ringing', 'active');

-- Connection set-up between the two browsers (WebRTC offer, answer and
-- network candidates). Deleted when the call ends.
create table if not exists public.call_signals (
  id bigint generated always as identity primary key,
  call_id uuid not null references public.calls(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('offer', 'answer', 'candidate')),
  payload jsonb not null check (pg_column_size(payload) <= 16384),
  created_at timestamptz not null default now()
);
create index if not exists call_signals_call_idx on public.call_signals(call_id, id);

alter table public.calls enable row level security;
alter table public.call_signals enable row level security;
-- Only the two people on a call see it; nobody else, staff included.
drop policy if exists calls_read on public.calls;
create policy calls_read on public.calls for select
  using (caller_id = (select auth.uid()) or callee_id = (select auth.uid()));
drop policy if exists call_signals_read on public.call_signals;
create policy call_signals_read on public.call_signals for select
  using (exists (select 1 from public.calls k where k.id = call_id
                   and (k.caller_id = (select auth.uid()) or k.callee_id = (select auth.uid()))));
-- Read through RLS; written only through the functions below.
revoke all on public.calls, public.call_signals from anon, authenticated;
grant select on public.calls, public.call_signals to authenticated;

-- Ends an open call with the given status, writes its line in the
-- conversation and, when it was missed, tells the person called.
create or replace function private.finish_call(p_call_id uuid, p_status text)
returns text language plpgsql security definer set search_path = '' as $$
declare k public.calls%rowtype;
begin
  update public.calls set status = p_status, ended_at = now()
   where id = p_call_id and status in ('ringing', 'active')
   returning * into k;
  if not found then
    return (select status from public.calls where id = p_call_id);
  end if;
  delete from public.call_signals where call_id = k.id;
  if k.answered_at is not null then
    insert into public.messages (conversation_id, sender_id, body, call_outcome, call_seconds)
    values (k.conversation_id, k.caller_id, '', 'answered', greatest(0, floor(extract(epoch from k.ended_at - k.answered_at)))::int);
    -- Both were on the call: its line is not news to either.
    insert into public.conversation_reads (conversation_id, user_id, last_read_at)
    values (k.conversation_id, k.caller_id, now()), (k.conversation_id, k.callee_id, now())
    on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
  else
    insert into public.messages (conversation_id, sender_id, body, call_outcome)
    values (k.conversation_id, k.caller_id, '', 'missed');
    insert into public.conversation_reads (conversation_id, user_id, last_read_at)
    select k.conversation_id, u, now() from unnest(case when p_status = 'declined' then array[k.caller_id, k.callee_id] else array[k.caller_id] end) u
    on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
    if p_status = 'missed' then
      perform private.notify(k.callee_id, 'missed_call',
        jsonb_build_object('conversation_id', k.conversation_id,
                           'caller_name', (select display_name from public.profiles where id = k.caller_id)),
        'call:' || k.id);
    end if;
  end if;
  update public.conversations set last_message_at = now() where id = k.conversation_id;
  return k.status;
end $$;

-- A call that rang for a minute without an answer was missed; an active call
-- one side stopped checking in on (closed the page, lost the network) is over.
create or replace function private.call_is_stale(k public.calls)
returns boolean language sql stable set search_path = '' as $$
  select (k.status = 'ringing' and k.created_at < now() - interval '60 seconds')
      or (k.status = 'active' and least(k.caller_seen_at, coalesce(k.callee_seen_at, k.answered_at)) < now() - interval '45 seconds');
$$;

create or replace function private.expire_calls(p_user uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  k public.calls%rowtype;
  n int := 0;
begin
  for k in select * from public.calls
            where status in ('ringing', 'active')
              and (p_user is null or caller_id = p_user or callee_id = p_user)
            for update skip locked
  loop
    if private.call_is_stale(k) then
      perform private.finish_call(k.id, case when k.status = 'ringing' then 'missed' else 'ended' end);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Rings the other member of a direct conversation. Returns the call's id.
create or replace function public.start_call(p_conversation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  c public.conversations%rowtype;
  v_other uuid;
  v_id uuid;
  k public.calls%rowtype;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found or c.kind <> 'direct' or not private.can_access_conversation(c.id, v_uid) then
    raise exception 'conversation_not_found' using errcode = 'P0002';
  end if;
  if c.is_locked then
    raise exception 'conversation_locked' using errcode = 'P0001';
  end if;
  select user_id into v_other from public.conversation_members where conversation_id = c.id and user_id <> v_uid;
  if v_other is null or not exists (select 1 from public.profiles where id = v_other and status = 'active') then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if private.is_blocked_between(v_uid, v_other) then
    raise exception 'user_blocked' using errcode = '42501';
  end if;
  -- One call at a time per person: take both people's locks, in a fixed order.
  perform pg_advisory_xact_lock(hashtextextended('call:' || least(v_uid, v_other)::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('call:' || greatest(v_uid, v_other)::text, 0));
  perform private.expire_calls(v_uid);
  perform private.expire_calls(v_other);
  if exists (select 1 from public.calls where status in ('ringing', 'active') and v_other in (caller_id, callee_id)) then
    raise exception 'user_busy' using errcode = 'P0001';
  end if;
  -- A call the caller left open elsewhere (another tab, a reloaded page) ends now.
  for k in select * from public.calls where status in ('ringing', 'active') and v_uid in (caller_id, callee_id) loop
    perform private.finish_call(k.id, case when k.status = 'ringing' then 'missed' else 'ended' end);
  end loop;
  perform private.rate_limit(v_uid, 'call', private.setting_int('calls.max_per_10_minutes', 10), interval '10 minutes');
  insert into public.calls (conversation_id, caller_id, callee_id) values (c.id, v_uid, v_other) returning id into v_id;
  return v_id;
end $$;

-- The person called picks up. Returns the call's status afterwards
-- ('active', or how it already ended).
create or replace function public.answer_call(p_call_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  k public.calls%rowtype;
begin
  select * into k from public.calls where id = p_call_id for update;
  if not found or k.callee_id <> v_uid then
    raise exception 'call_not_found' using errcode = 'P0002';
  end if;
  if k.status <> 'ringing' then
    return k.status;
  end if;
  if private.call_is_stale(k) then
    return private.finish_call(k.id, 'missed');
  end if;
  update public.calls set status = 'active', answered_at = now(), caller_seen_at = now(), callee_seen_at = now()
   where id = k.id;
  return 'active';
end $$;

-- Either side hangs up (p_reason 'hangup'), the person called declines
-- ('decline'), or a browser reports the connection broke ('failed').
-- Returns the final status. Ending an ended call changes nothing.
create or replace function public.end_call(p_call_id uuid, p_reason text default 'hangup')
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(false);
  k public.calls%rowtype;
begin
  select * into k from public.calls where id = p_call_id for update;
  if not found or v_uid not in (k.caller_id, k.callee_id) then
    raise exception 'call_not_found' using errcode = 'P0002';
  end if;
  if k.status not in ('ringing', 'active') then
    return k.status;
  end if;
  return private.finish_call(k.id,
    case when k.status = 'ringing' then case when v_uid = k.callee_id and p_reason = 'decline' then 'declined' else 'missed' end
         when p_reason = 'failed' then 'failed'
         else 'ended' end);
end $$;

-- Each browser checks in every few seconds while ringing or talking. Returns
-- the call's status, so a browser that missed a live update still learns the
-- call ended.
create or replace function public.call_heartbeat(p_call_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(false);
  k public.calls%rowtype;
begin
  select * into k from public.calls where id = p_call_id for update;
  if not found or v_uid not in (k.caller_id, k.callee_id) then
    raise exception 'call_not_found' using errcode = 'P0002';
  end if;
  if k.status not in ('ringing', 'active') then
    return k.status;
  end if;
  if private.call_is_stale(k) then
    return private.finish_call(k.id, case when k.status = 'ringing' then 'missed' else 'ended' end);
  end if;
  if v_uid = k.caller_id then
    update public.calls set caller_seen_at = now() where id = k.id;
  elsif k.status = 'active' then
    update public.calls set callee_seen_at = now() where id = k.id;
  end if;
  return k.status;
end $$;

-- Passes one piece of connection set-up to the other browser.
create or replace function public.send_call_signal(p_call_id uuid, p_kind text, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(false);
  k public.calls%rowtype;
begin
  select * into k from public.calls where id = p_call_id;
  if not found or v_uid not in (k.caller_id, k.callee_id) then
    raise exception 'call_not_found' using errcode = 'P0002';
  end if;
  if k.status not in ('ringing', 'active') then
    raise exception 'call_ended' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('offer', 'answer', 'candidate')
     or p_payload is null or jsonb_typeof(p_payload) <> 'object' or pg_column_size(p_payload) > 16384 then
    raise exception 'invalid_signal' using errcode = '22023';
  end if;
  if (select count(*) from public.call_signals where call_id = k.id and sender_id = v_uid) >= 200 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.call_signals (call_id, sender_id, kind, payload) values (k.id, v_uid, p_kind, p_payload);
end $$;

revoke execute on function public.start_call(uuid), public.answer_call(uuid), public.end_call(uuid, text),
  public.call_heartbeat(uuid), public.send_call_signal(uuid, text, jsonb) from public, anon;
grant execute on function public.start_call(uuid), public.answer_call(uuid), public.end_call(uuid, text),
  public.call_heartbeat(uuid), public.send_call_signal(uuid, text, jsonb) to authenticated;

-- Scheduled clean-up (the /api/cron route): closes calls both browsers
-- abandoned, so a missed call is still recorded and notified.
create or replace function public.calls_cleanup()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_expired int;
  v_signals int;
begin
  v_expired := private.expire_calls(null);
  delete from public.call_signals s using public.calls k
   where k.id = s.call_id and k.status not in ('ringing', 'active');
  get diagnostics v_signals = row_count;
  return jsonb_build_object('calls_expired', v_expired, 'call_signals_removed', v_signals);
end $$;
revoke execute on function public.calls_cleanup() from public, anon, authenticated;
grant execute on function public.calls_cleanup() to service_role;

insert into public.platform_settings (key, value, description)
values ('calls.max_per_10_minutes', '10', 'Voice calls one person may start in 10 minutes')
on conflict (key) do nothing;

-- Live updates: the ring, the answer, the hang-up and the set-up messages
-- reach the two browsers instantly (RLS still applies).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calls') then
      alter publication supabase_realtime add table public.calls;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'call_signals') then
      alter publication supabase_realtime add table public.call_signals;
    end if;
  end if;
end $$;
