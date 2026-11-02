-- =============================================================================
-- Pictures in conversations.
--
-- A message may carry one picture (JPEG, PNG or WebP, up to 5 MB; the server
-- checks the file's first bytes, not its name). Pictures live in the private
-- bucket `message-images` under <conversation id>/<random name>:
-- - members of the conversation, and moderators, can read them, through
--   short-lived signed links;
-- - nobody uploads directly: the server uploads after checking the sender
--   belongs to the conversation, and send_message checks again that the
--   picture exists and sits in that conversation's folder.
-- Deleting a message, or a moderator removing it, also drops its picture
-- (the server removes the file).
--
-- Safe to run twice (SQL Editor or `supabase db push`).
-- =============================================================================

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('message-images', 'message-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
    execute 'drop policy if exists "message_images_read" on storage.objects';
    execute $p$
      create policy "message_images_read" on storage.objects for select to authenticated
        using (bucket_id = 'message-images'
               and (private.can_access_conversation(private.try_uuid((storage.foldername(name))[1])) or private.is_moderator()))
    $p$;
  end if;
end $$;

alter table public.messages add column if not exists image_path text;
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages drop constraint if exists messages_image_path_check;
-- A message has text, a picture, or both.
alter table public.messages add constraint messages_content_check
  check (char_length(body) <= 2000 and (char_length(body) >= 1 or image_path is not null));
alter table public.messages add constraint messages_image_path_check
  check (image_path is null or image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$');

drop function if exists public.send_message(uuid, text);
create or replace function public.send_message(p_conversation_id uuid, p_body text, p_image_path text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  c public.conversations%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_image text := nullif(btrim(coalesce(p_image_path, '')), '');
  v_id bigint;
  v_other uuid;
  v_bucket text := floor(extract(epoch from now()) / 900)::bigint::text;
  r record;
begin
  if char_length(v_body) > 2000 or (char_length(v_body) = 0 and v_image is null) then
    raise exception 'invalid_message' using errcode = '22023';
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
  if c.kind = 'direct' then
    select user_id into v_other from public.conversation_members where conversation_id = c.id and user_id <> v_uid;
    if private.is_blocked_between(v_uid, v_other) then
      raise exception 'user_blocked' using errcode = '42501';
    end if;
  end if;
  perform private.rate_limit(v_uid, 'message', private.setting_int('messaging.max_per_minute', 20), interval '1 minute');
  insert into public.messages (conversation_id, sender_id, body, image_path) values (c.id, v_uid, v_body, v_image) returning id into v_id;
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
revoke execute on function public.send_message(uuid, text, text) from public, anon;
grant execute on function public.send_message(uuid, text, text) to authenticated;

create or replace function public.delete_message(p_message_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(false);
begin
  update public.messages set deleted_at = now(), body = '[deleted]', image_path = null
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
  update public.messages set deleted_at = now(), body = '[removed]', image_path = null
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
