-- =============================================================================
-- «نشط الآن» and «نشط قبل 5 دقائق» (0049; after 0042).
--
-- user_presence: when each member was last active on the site. An open,
-- visible tab that was used in the last 3 minutes says so about once a minute
-- (touch_presence, written at most every 45 seconds per member: one small row
-- each, updated in place).
-- - Who sees it (last_seen): their friends (0042) and the people they share a
--   one-to-one or group conversation with; never across a block; nobody if
--   they hid it (settings, set_presence_hidden).
-- - last_seen_in: the same for the other person in the caller's one-to-one
--   conversations, asked by conversation, so the list of conversations and a
--   conversation's bar ask at the same time as their other requests.
-- - «نشط الآن»: active in the last 2½ minutes; the site says it, from the time.
--
-- Adds a table and functions; changes no existing data. Safe to run twice.
-- =============================================================================

create table if not exists public.user_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  hidden boolean not null default false
) with (fillfactor = 70); -- room on each page, so the frequent updates stay in place

alter table public.user_presence enable row level security;
-- Read and written through the functions below only.
revoke all on public.user_presence from anon, authenticated;
-- Two-step verification, as on every table (0027).
drop policy if exists second_factor on public.user_presence;
create policy second_factor on public.user_presence as restrictive for all to authenticated
  using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()));

-- The signed-in member is active now.
create or replace function public.touch_presence()
returns void language sql security definer set search_path = '' as $$
  insert into public.user_presence (user_id, last_seen_at)
  select p.id, now() from public.profiles p
   where p.id = (select auth.uid()) and private.mfa_satisfied()
  on conflict (user_id) do update set last_seen_at = excluded.last_seen_at
   where public.user_presence.last_seen_at < now() - interval '45 seconds';
$$;

-- When these members were last active, for those the caller may know it about (up to 100 at once).
create or replace function public.last_seen(p_user_ids uuid[])
returns table (user_id uuid, last_seen_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid where private.mfa_satisfied())
  select p.user_id, p.last_seen_at
    from me, public.user_presence p
   where p.user_id = any((coalesce(p_user_ids, '{}'::uuid[]))[1:100])
     and p.user_id <> me.uid
     and not p.hidden
     and not private.is_blocked_between(me.uid, p.user_id)
     and (private.are_friends(me.uid, p.user_id)
          or exists (select 1 from public.conversation_members a
                       join public.conversation_members b on b.conversation_id = a.conversation_id
                      where a.user_id = me.uid and b.user_id = p.user_id));
$$;

-- The same for the other person in each of these one-to-one conversations of the caller's (up to 100).
create or replace function public.last_seen_in(p_conversation_ids uuid[])
returns table (conversation_id uuid, user_id uuid, last_seen_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid where private.mfa_satisfied())
  select mine.conversation_id, p.user_id, p.last_seen_at
    from me
    join public.conversation_members mine on mine.user_id = me.uid
    join public.conversations c on c.id = mine.conversation_id and c.kind = 'direct'
    join public.conversation_members other on other.conversation_id = mine.conversation_id and other.user_id <> me.uid
    join public.user_presence p on p.user_id = other.user_id
   where mine.conversation_id = any((coalesce(p_conversation_ids, '{}'::uuid[]))[1:100])
     and not p.hidden
     and not private.is_blocked_between(me.uid, p.user_id);
$$;

-- Settings: show when I was active, or not.
create or replace function public.set_presence_hidden(p_hidden boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(false);
begin
  insert into public.user_presence (user_id, hidden) values (v_uid, coalesce(p_hidden, false))
  on conflict (user_id) do update set hidden = excluded.hidden;
end $$;

create or replace function public.my_presence_hidden()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select hidden from public.user_presence where user_id = (select auth.uid())), false);
$$;

revoke all on function public.touch_presence() from public, anon;
revoke all on function public.last_seen(uuid[]) from public, anon;
revoke all on function public.last_seen_in(uuid[]) from public, anon;
revoke all on function public.set_presence_hidden(boolean) from public, anon;
revoke all on function public.my_presence_hidden() from public, anon;
grant execute on function public.touch_presence() to authenticated;
grant execute on function public.last_seen(uuid[]) to authenticated;
grant execute on function public.last_seen_in(uuid[]) to authenticated;
grant execute on function public.set_presence_hidden(boolean) to authenticated;
grant execute on function public.my_presence_hidden() to authenticated;
