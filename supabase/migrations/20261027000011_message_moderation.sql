-- =============================================================================
-- Moderators can remove a reported message. The body is erased (the report's
-- snapshot keeps the original text for moderators); the action is audited and
-- the sender is notified. Removal is intentionally not reversible.
-- =============================================================================
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
  update public.messages set deleted_at = now(), body = '[removed]'
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

revoke execute on function public.admin_remove_message(bigint, text) from public, anon;
grant execute on function public.admin_remove_message(bigint, text) to authenticated;
