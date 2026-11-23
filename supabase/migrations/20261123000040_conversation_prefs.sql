-- =============================================================================
-- A member's own settings for a conversation, from a long press on it in the
-- list: pinned, muted, favourite, a nickname, and «delete» (for them only).
--
-- conversation_prefs: one row per member and conversation, made the first time
-- they change something. Each member sees and changes their own rows only,
-- through the functions below.
-- - Pinned: up to 3, at the top of their list (the latest pinned first).
-- - Muted for 8 hours, a week, or always: unread messages there no longer
--   light the messages tab's dot, and no message notifications come from it.
-- - Favourite: the list's «المفضلة» filter.
-- - Nickname: shown to them only, in place of the conversation's name.
-- - Delete: for them only. The conversation leaves their list, its earlier
--   messages are hidden from them (cleared_at), and it comes back with the
--   next message. No message is deleted, and nobody else's view changes.
--
-- my_conversations() returns these too, pinned first, and leaves out a
-- conversation deleted since its last message.
--
-- Changes no data. Safe to run twice.
-- =============================================================================

create table if not exists public.conversation_prefs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  pinned_at timestamptz,
  muted_until timestamptz,
  favorite boolean not null default false,
  nickname text check (nickname is null or char_length(nickname) between 1 and 40),
  cleared_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);
create index if not exists conversation_prefs_conversation_id_fk_idx on public.conversation_prefs (conversation_id);

alter table public.conversation_prefs enable row level security;
drop policy if exists conversation_prefs_own on public.conversation_prefs;
create policy conversation_prefs_own on public.conversation_prefs for select using (user_id = (select auth.uid()));
revoke all on public.conversation_prefs from anon, authenticated;
grant select on public.conversation_prefs to authenticated;
-- Two-step verification, as on every table (0027).
drop policy if exists second_factor on public.conversation_prefs;
create policy second_factor on public.conversation_prefs as restrictive for all to authenticated
  using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()));

-- Whether a member has muted a conversation right now.
create or replace function private.is_muted(p_conversation uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversation_prefs p
                  where p.conversation_id = p_conversation and p.user_id = p_user and p.muted_until > now());
$$;
revoke all on function private.is_muted(uuid, uuid) from public;

-- The caller, after checking they belong to the conversation.
create or replace function private.require_conversation_member(p_conversation uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(false);
begin
  if p_conversation is null or not private.can_access_conversation(p_conversation, v_uid) then
    raise exception 'conversation_not_found' using errcode = 'P0002';
  end if;
  return v_uid;
end $$;
revoke all on function private.require_conversation_member(uuid) from public;

-- Pin or unpin. At most 3 pinned, counting only conversations the member still belongs to.
create or replace function public.pin_conversation(p_conversation_id uuid, p_pinned boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_conversation_member(p_conversation_id);
begin
  if coalesce(p_pinned, false) and (
       select count(*) from public.conversation_prefs p
        where p.user_id = v_uid and p.pinned_at is not null and p.conversation_id <> p_conversation_id
          and private.can_access_conversation(p.conversation_id, v_uid)) >= 3 then
    raise exception 'pin_limit' using errcode = 'P0001';
  end if;
  insert into public.conversation_prefs (user_id, conversation_id, pinned_at)
  values (v_uid, p_conversation_id, case when p_pinned then now() end)
  on conflict (user_id, conversation_id) do update
    set pinned_at = case when p_pinned then coalesce(conversation_prefs.pinned_at, now()) end, updated_at = now();
end $$;

-- Mute for a number of hours (8, a week...), -1 for always, 0 to unmute.
create or replace function public.mute_conversation(p_conversation_id uuid, p_hours integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_conversation_member(p_conversation_id);
  v_until timestamptz;
begin
  if p_hours is null or p_hours < -1 or p_hours > 8760 then
    raise exception 'invalid_duration' using errcode = '22023';
  end if;
  v_until := case when p_hours = -1 then 'infinity'::timestamptz
                  when p_hours = 0 then null
                  else now() + make_interval(hours => p_hours) end;
  insert into public.conversation_prefs (user_id, conversation_id, muted_until)
  values (v_uid, p_conversation_id, v_until)
  on conflict (user_id, conversation_id) do update set muted_until = excluded.muted_until, updated_at = now();
end $$;

create or replace function public.favorite_conversation(p_conversation_id uuid, p_favorite boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_conversation_member(p_conversation_id);
begin
  insert into public.conversation_prefs (user_id, conversation_id, favorite)
  values (v_uid, p_conversation_id, coalesce(p_favorite, false))
  on conflict (user_id, conversation_id) do update set favorite = excluded.favorite, updated_at = now();
end $$;

-- A name for the conversation that only the member sees; empty clears it.
create or replace function public.set_conversation_nickname(p_conversation_id uuid, p_nickname text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_conversation_member(p_conversation_id);
  v_name text := nullif(btrim(coalesce(p_nickname, '')), '');
begin
  if v_name is not null and char_length(v_name) > 40 then
    raise exception 'invalid_nickname' using errcode = '22023';
  end if;
  insert into public.conversation_prefs (user_id, conversation_id, nickname)
  values (v_uid, p_conversation_id, v_name)
  on conflict (user_id, conversation_id) do update set nickname = excluded.nickname, updated_at = now();
end $$;

-- «Delete» for the member only: hidden until the next message, earlier messages hidden from them, unpinned.
create or replace function public.clear_conversation(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_conversation_member(p_conversation_id);
begin
  insert into public.conversation_prefs (user_id, conversation_id, cleared_at)
  values (v_uid, p_conversation_id, now())
  on conflict (user_id, conversation_id) do update
    set cleared_at = now(), pinned_at = null, favorite = false, updated_at = now();
  insert into public.conversation_reads (conversation_id, user_id, last_read_at) values (p_conversation_id, v_uid, now())
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
end $$;

revoke all on function public.pin_conversation(uuid, boolean) from public, anon;
revoke all on function public.mute_conversation(uuid, integer) from public, anon;
revoke all on function public.favorite_conversation(uuid, boolean) from public, anon;
revoke all on function public.set_conversation_nickname(uuid, text) from public, anon;
revoke all on function public.clear_conversation(uuid) from public, anon;
grant execute on function public.pin_conversation(uuid, boolean) to authenticated;
grant execute on function public.mute_conversation(uuid, integer) to authenticated;
grant execute on function public.favorite_conversation(uuid, boolean) to authenticated;
grant execute on function public.set_conversation_nickname(uuid, text) to authenticated;
grant execute on function public.clear_conversation(uuid) to authenticated;

-- The list: the member's settings with each conversation, pinned first, without
-- conversations they deleted since the last message.
drop function if exists public.my_conversations(int);
create function public.my_conversations(p_limit int default 50)
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
    and (c.last_message_at is not null or c.kind = 'direct')
    and (pr.cleared_at is null or c.last_message_at > pr.cleared_at)
  order by (pr.pinned_at is not null) desc, pr.pinned_at desc nulls last, c.last_message_at desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;
revoke execute on function public.my_conversations(int) from public, anon;
grant execute on function public.my_conversations(int) to authenticated;

-- The messages tab's dot: muted conversations don't light it.
create or replace function private.unread_message_count(p_uid uuid, p_cap int default 100)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from (
    select 1
      from private.my_conversation_ids(p_uid) ids(id)
      join public.messages m on m.conversation_id = ids.id
      left join public.conversation_reads r on r.conversation_id = ids.id and r.user_id = p_uid
     where m.sender_id is distinct from p_uid
       and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
       and not private.is_muted(ids.id, p_uid)
     limit greatest(coalesce(p_cap, 100), 1)) unread;
$$;
revoke all on function private.unread_message_count(uuid, int) from public;

-- Sending: as before (0017), and no message notification to a member who muted the conversation.
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
revoke execute on function public.send_message(uuid, text, text, double precision, double precision, real, text, integer) from public, anon;
grant execute on function public.send_message(uuid, text, text, double precision, double precision, real, text, integer) to authenticated;
