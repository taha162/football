-- =============================================================================
-- Videos in conversations (0045; after 0044).
--
-- A message may carry a video (MP4, MOV or WebM, up to 50 MB), in the private
-- bucket `message-videos` under <conversation id>/<random name>, like pictures
-- and voice notes: members (and moderators) watch it through short-lived
-- signed links.
-- - Videos are too big to pass through the site's server (its hosting refuses
--   requests over 4.5 MB). So the server first asks begin_video_upload()
--   whether this member may send one here now (a member, not locked, at most
--   messaging.max_videos_per_hour = 30 an hour), then hands the browser a
--   one-time upload link for a name it chose; the browser sends the file
--   straight to storage, the server checks its first bytes, and only then
--   send_message() records the message.
-- - Beside the video, a small still from it (<name>.poster.jpg), made in the
--   browser, for the conversation to show before it plays. Optional.
-- - messages.video_path, video_seconds (when the browser could tell).
-- - Deleting a message (or a moderator removing it) erases its video.
-- - orphan_message_videos(): uploads that never became a message (closed
--   tab, failed send) or whose message is gone, after a day; the scheduled
--   job removes them from storage.
--
-- Adds a bucket, two columns and functions; changes no existing data.
-- Safe to run twice.
-- =============================================================================

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('message-videos', 'message-videos', false, 52428800, array['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
    execute 'drop policy if exists message_videos_read on storage.objects';
    execute $p$
      create policy message_videos_read on storage.objects for select to authenticated
        using (bucket_id = 'message-videos'
               and ((select private.is_moderator())
                    or private.can_access_conversation(private.try_uuid((storage.foldername(name))[1]))))
    $p$;
  end if;
end $$;

alter table public.messages add column if not exists video_path text;
alter table public.messages add column if not exists video_seconds smallint;
-- As a voice note's (0017): a name in a conversation's folder, and a length when known.
alter table public.messages drop constraint if exists messages_video_check;
alter table public.messages add constraint messages_video_check check (
  (video_path is null and video_seconds is null)
  or (video_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|mov|webm)$' and (video_seconds is null or video_seconds between 1 and 3600))
) not valid;
alter table public.messages validate constraint messages_video_check;
-- A message carries text or something else; a video is one more such thing (as 0017, plus video).
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check check (
  char_length(body) <= 2000
  and (char_length(body) >= 1 or image_path is not null or location_lat is not null or voice_path is not null
       or call_outcome is not null or video_path is not null)
) not valid;
alter table public.messages validate constraint messages_content_check;
-- A video and its still share a key (<conversation>/<random name>): finds the message of a stored file.
create index if not exists messages_video_key_idx on public.messages (split_part(video_path, '.', 1)) where video_path is not null;

insert into public.platform_settings (key, value, description, is_public) values
  ('messaging.max_videos_per_hour', '30', 'Videos one member may start sending in an hour.', false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Before an upload: a member of the conversation, which isn't locked, within the hourly limit.
-- ---------------------------------------------------------------------------
create or replace function public.begin_video_upload(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_locked boolean;
begin
  select is_locked into v_locked from public.conversations where id = p_conversation_id;
  if not found or not private.can_access_conversation(p_conversation_id, v_uid) then
    raise exception 'conversation_not_found' using errcode = 'P0002';
  end if;
  if v_locked then
    raise exception 'conversation_locked' using errcode = 'P0001';
  end if;
  perform private.rate_limit(v_uid, 'video_upload', private.setting_int('messaging.max_videos_per_hour', 30), interval '1 hour');
end $$;

-- ---------------------------------------------------------------------------
-- Sending (as 0040), with a video as one more kind of attachment.
-- ---------------------------------------------------------------------------
drop function if exists public.send_message(uuid, text, text, double precision, double precision, real, text, integer);
create or replace function public.send_message(
  p_conversation_id uuid,
  p_body text,
  p_image_path text default null,
  p_location_lat double precision default null,
  p_location_lng double precision default null,
  p_location_accuracy real default null,
  p_voice_path text default null,
  p_voice_seconds integer default null,
  p_video_path text default null,
  p_video_seconds integer default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  c public.conversations%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_image text := nullif(btrim(coalesce(p_image_path, '')), '');
  v_voice text := nullif(btrim(coalesce(p_voice_path, '')), '');
  v_video text := nullif(btrim(coalesce(p_video_path, '')), '');
  v_location boolean := p_location_lat is not null or p_location_lng is not null;
  v_attachments int;
  v_id bigint;
  v_other uuid;
  v_bucket text := floor(extract(epoch from now()) / 900)::bigint::text;
  r record;
begin
  -- Text, and at most one of: a picture, a location, a voice note, a video.
  v_attachments := (v_image is not null)::int + v_location::int + (v_voice is not null)::int + (v_video is not null)::int;
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
  -- And the video: uploaded to the name the server gave, as a video; its length when known.
  if v_video is not null and (
       v_video !~ ('^' || c.id::text || '/[0-9a-f-]{36}\.(mp4|mov|webm)$')
       or (p_video_seconds is not null and p_video_seconds not between 1 and 3600)
       or not exists (select 1 from storage.objects o where o.bucket_id = 'message-videos' and o.name = v_video
                        and o.metadata ->> 'mimetype' in ('video/mp4', 'video/quicktime', 'video/webm'))) then
    raise exception 'invalid_video' using errcode = '22023';
  end if;
  if c.kind = 'direct' then
    select user_id into v_other from public.conversation_members where conversation_id = c.id and user_id <> v_uid;
    if private.is_blocked_between(v_uid, v_other) then
      raise exception 'user_blocked' using errcode = '42501';
    end if;
  end if;
  perform private.rate_limit(v_uid, 'message', private.setting_int('messaging.max_per_minute', 20), interval '1 minute');
  insert into public.messages (conversation_id, sender_id, body, image_path,
                               location_lat, location_lng, location_accuracy, voice_path, voice_seconds,
                               video_path, video_seconds)
  values (c.id, v_uid, v_body, v_image,
          case when v_location then round(p_location_lat::numeric, 6)::double precision end,
          case when v_location then round(p_location_lng::numeric, 6)::double precision end,
          case when v_location and p_location_accuracy is not null then round(p_location_accuracy::numeric)::real end,
          v_voice,
          case when v_voice is not null then p_voice_seconds end,
          v_video,
          case when v_video is not null then p_video_seconds end)
  returning id into v_id;
  update public.conversations set last_message_at = now() where id = c.id;
  insert into public.conversation_reads (conversation_id, user_id, last_read_at) values (c.id, v_uid, now())
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
  -- One-to-one style conversations notify the other party (at most every 15 minutes), unless they muted it.
  if c.kind = 'direct' then
    if not private.is_muted(c.id, v_other) then
      perform private.notify(v_other, 'new_message',
        jsonb_build_object('conversation_id', c.id, 'sender_name', (select display_name from public.profiles where id = v_uid)),
        'msg:' || c.id || ':' || v_bucket);
    end if;
  elsif c.kind = 'booking' then
    for r in select b.requested_by as uid from public.bookings b where b.id = c.booking_id
             union select s.user_id from public.venue_staff s join public.bookings b on b.venue_id = s.venue_id where b.id = c.booking_id
    loop
      if r.uid is not null and r.uid <> v_uid and not private.is_muted(c.id, r.uid) then
        perform private.notify(r.uid, 'new_message',
          jsonb_build_object('conversation_id', c.id, 'sender_name', (select display_name from public.profiles where id = v_uid)),
          'msg:' || c.id || ':' || v_bucket);
      end if;
    end loop;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Deleting (as 0017): nothing of what it carried stays, the video included.
-- ---------------------------------------------------------------------------
create or replace function public.delete_message(p_message_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(false);
begin
  update public.messages set deleted_at = now(), body = '[deleted]', image_path = null,
         location_lat = null, location_lng = null, location_accuracy = null,
         voice_path = null, voice_seconds = null, call_outcome = null, call_seconds = null,
         video_path = null, video_seconds = null
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
         voice_path = null, voice_seconds = null, call_outcome = null, call_seconds = null,
         video_path = null, video_seconds = null
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

-- ---------------------------------------------------------------------------
-- The list (as 0044): a video as the last message says so.
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
                when m.video_path is not null then 'video'
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
-- Stored videos (and stills) no message points at any more, a day on.
-- ---------------------------------------------------------------------------
create or replace function public.orphan_message_videos(p_limit int default 200)
returns setof text language sql stable security definer set search_path = '' as $$
  select o.name from storage.objects o
   where o.bucket_id = 'message-videos'
     and o.created_at < now() - interval '1 day'
     and not exists (select 1 from public.messages m
                      where m.video_path is not null and split_part(m.video_path, '.', 1) = split_part(o.name, '.', 1))
   order by o.created_at
   limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;

revoke all on function public.begin_video_upload(uuid) from public, anon;
grant execute on function public.begin_video_upload(uuid) to authenticated;
revoke execute on function public.send_message(uuid, text, text, double precision, double precision, real, text, integer, text, integer) from public, anon;
grant execute on function public.send_message(uuid, text, text, double precision, double precision, real, text, integer, text, integer) to authenticated;
revoke execute on function public.my_conversations(int) from public, anon;
grant execute on function public.my_conversations(int) to authenticated;
revoke all on function public.orphan_message_videos(int) from public, anon, authenticated;
grant execute on function public.orphan_message_videos(int) to service_role;
