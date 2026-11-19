-- =============================================================================
-- Conversations: «شوهدت» (seen) between two people, and «يكتب…» (typing).
--
-- 1. Seen. In a one-to-one (direct) conversation each of the two members may
--    read when the other last read it (conversation_reads), so the sender's
--    last message can say «شوهدت». Nobody else may, and in group chats
--    (match, team, booking, challenge, tournament) everyone still reads only
--    their own. Two-step verification still applies (the restrictive
--    second_factor policy from 0027 is untouched).
-- 2. Live. conversation_reads joins the realtime publication: «شوهدت»
--    appears as the other person reads. RLS decides who receives each change.
-- 3. Typing. A private realtime broadcast topic per conversation,
--    "typing:<conversation id>": only its current members may send on it or
--    receive from it, with two-step verification satisfied. Nothing is
--    stored. Skipped (with a notice) on a database without realtime
--    authorization; the site then simply shows no typing.
--
-- Changes no data. Safe to run twice.
-- =============================================================================

-- Whether p_user is one of the two members of this direct conversation.
create or replace function private.is_direct_member(p_conversation uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversations c
    join public.conversation_members m on m.conversation_id = c.id
    where c.id = p_conversation and c.kind = 'direct' and m.user_id = p_user
  );
$$;
revoke all on function private.is_direct_member(uuid, uuid) from public;
grant execute on function private.is_direct_member(uuid, uuid) to anon, authenticated;

drop policy if exists conversation_reads_read on public.conversation_reads;
create policy conversation_reads_read on public.conversation_reads for select
  using (user_id = (select auth.uid())
         or ((select auth.uid()) is not null and private.is_direct_member(conversation_id, (select auth.uid()))));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_reads') then
    alter publication supabase_realtime add table public.conversation_reads;
  end if;
end $$;

-- "typing:<conversation id>", for a current member of that conversation.
create or replace function private.typing_topic_allowed(p_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_topic is null or p_topic !~ '^typing:[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  v_id := private.try_uuid(substr(p_topic, 8));
  return v_id is not null
     and (select auth.uid()) is not null
     and private.mfa_satisfied()
     and private.can_access_conversation(v_id);
end $$;
revoke all on function private.typing_topic_allowed(text) from public;
grant execute on function private.typing_topic_allowed(text) to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is null
     or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'realtime' and p.proname = 'topic') then
    raise notice 'realtime authorization is not available here: typing indicators stay off';
    return;
  end if;
  execute 'drop policy if exists chat_typing_receive on realtime.messages';
  execute $p$
    create policy chat_typing_receive on realtime.messages for select to authenticated
      using (realtime.messages.extension = 'broadcast'
             and (select private.typing_topic_allowed((select realtime.topic()))))
  $p$;
  execute 'drop policy if exists chat_typing_send on realtime.messages';
  execute $p$
    create policy chat_typing_send on realtime.messages for insert to authenticated
      with check (realtime.messages.extension = 'broadcast'
                  and (select private.typing_topic_allowed((select realtime.topic()))))
  $p$;
end $$;
