-- =============================================================================
-- Editing a message.
--
-- The sender can correct the text of a message they sent: not a call's
-- record, nor a deleted message. The message keeps its place, is marked as
-- edited for everyone in the conversation, and members see the change live
-- (messages are already in the realtime publication). A report keeps the
-- reported text as it was when reported, so editing doesn't hide anything from
-- moderators. Deleting (delete_message) is unchanged.
--
-- Safe to run twice (SQL Editor or `supabase db push`).
-- =============================================================================

alter table public.messages add column if not exists edited_at timestamptz;

create or replace function public.edit_message(p_message_id bigint, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_body text := btrim(coalesce(p_body, ''));
  m public.messages%rowtype;
  c public.conversations%rowtype;
  v_other uuid;
begin
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'invalid_message' using errcode = '22023';
  end if;
  select * into m from public.messages where id = p_message_id for update;
  if not found or m.sender_id is distinct from v_uid or m.deleted_at is not null or m.call_outcome is not null
     or not private.can_access_conversation(m.conversation_id, v_uid) then
    raise exception 'message_not_found' using errcode = 'P0002';
  end if;
  select * into c from public.conversations where id = m.conversation_id;
  -- As for sending: not in a read-only conversation, nor once either person has blocked the other.
  if c.is_locked then
    raise exception 'conversation_locked' using errcode = 'P0001';
  end if;
  if c.kind = 'direct' then
    select user_id into v_other from public.conversation_members where conversation_id = c.id and user_id <> v_uid;
    if private.is_blocked_between(v_uid, v_other) then
      raise exception 'user_blocked' using errcode = '42501';
    end if;
  end if;
  if v_body = m.body then
    return;
  end if;
  perform private.rate_limit(v_uid, 'message_edit', private.setting_int('messaging.max_per_minute', 20), interval '1 minute');
  update public.messages set body = v_body, edited_at = now() where id = m.id;
end $$;

revoke execute on function public.edit_message(bigint, text) from public, anon;
grant execute on function public.edit_message(bigint, text) to authenticated;
