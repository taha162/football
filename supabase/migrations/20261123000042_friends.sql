-- =============================================================================
-- Friends, added by username (0042).
--
-- friendships: one row per pair of members (user_a < user_b), who asked, and
-- whether the other accepted. Each member sees only the pairs they are in.
-- - send_friend_request(username): to someone active, not blocked either way.
--   If they had already asked you, you are friends at once. Up to 30 requests
--   a day (setting friends.max_requests_per_day).
-- - respond_friend_request(user, accept): the one asked accepts or declines
--   (declined: the request is removed; they may ask again).
-- - cancel_friend_request(user), remove_friend(user).
-- - Blocking someone ends the friendship or request between you.
-- - find_member(username): who has that username, and where you stand.
-- - my_friends(): friends and requests, for «الأصدقاء».
-- Notifications: friend_request (to the one asked) and friend_accepted (to the
-- one who asked); both can be switched off in settings.
--
-- Adds a table, its functions and one setting; changes no existing data.
-- Safe to run twice.
-- =============================================================================

create table if not exists public.friendships (
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_a, user_b),
  check (user_a < user_b),
  check (requested_by in (user_a, user_b))
);
create index if not exists friendships_user_b_fk_idx on public.friendships (user_b);
create index if not exists friendships_requested_by_fk_idx on public.friendships (requested_by);

alter table public.friendships enable row level security;
drop policy if exists friendships_own on public.friendships;
create policy friendships_own on public.friendships for select
  using ((select auth.uid()) in (user_a, user_b));
revoke all on public.friendships from anon, authenticated;
grant select on public.friendships to authenticated;
-- Two-step verification, as on every table (0027).
drop policy if exists second_factor on public.friendships;
create policy second_factor on public.friendships as restrictive for all to authenticated
  using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()));

insert into public.platform_settings (key, value, description, is_public) values
  ('friends.max_requests_per_day', '30', 'Friend requests one member may send in a day.', false)
on conflict (key) do nothing;

create or replace function private.are_friends(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships
                  where user_a = least(p_a, p_b) and user_b = greatest(p_a, p_b) and status = 'accepted');
$$;
revoke all on function private.are_friends(uuid, uuid) from public;

-- Where the caller stands with another member: 'self', 'friend', 'requested' (the caller asked),
-- 'incoming' (they asked the caller), 'blocked', or 'none'.
create or replace function private.friend_relation(p_me uuid, p_other uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_me = p_other then 'self'
    when private.is_blocked_between(p_me, p_other) then 'blocked'
    else coalesce((select case when f.status = 'accepted' then 'friend'
                               when f.requested_by = p_me then 'requested'
                               else 'incoming' end
                     from public.friendships f
                    where f.user_a = least(p_me, p_other) and f.user_b = greatest(p_me, p_other)), 'none')
  end;
$$;
revoke all on function private.friend_relation(uuid, uuid) from public;

-- Who has this username (an active member), and where the caller stands with them.
create or replace function public.find_member(p_username text)
returns table (id uuid, display_name text, username text, avatar_path text, relation text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, p.username, p.avatar_path, private.friend_relation(auth.uid(), p.id)
    from public.profiles p
   where p.username = lower(btrim(regexp_replace(coalesce(p_username, ''), '^@+', '')))
     and p.status = 'active'
     and auth.uid() is not null;
$$;

-- 'requested', or 'friends' when they had already asked the caller (or were friends already).
create or replace function public.send_friend_request(p_username text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_other uuid;
  v_relation text;
  v_me record;
begin
  select p.id into v_other from public.profiles p
   where p.username = lower(btrim(regexp_replace(coalesce(p_username, ''), '^@+', ''))) and p.status = 'active';
  if v_other is null then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  v_relation := private.friend_relation(v_uid, v_other);
  if v_relation = 'self' then
    raise exception 'cannot_friend_self' using errcode = '22023';
  elsif v_relation = 'blocked' then
    raise exception 'user_blocked' using errcode = '42501';
  elsif v_relation = 'friend' then
    return 'friends';
  elsif v_relation = 'requested' then
    return 'requested';
  end if;
  select display_name, username into v_me from public.profiles where id = v_uid;
  if v_relation = 'incoming' then
    update public.friendships set status = 'accepted', accepted_at = now()
     where user_a = least(v_uid, v_other) and user_b = greatest(v_uid, v_other);
    perform private.notify(v_other, 'friend_accepted',
      jsonb_build_object('user_id', v_uid, 'from_name', v_me.display_name, 'from_username', v_me.username));
    return 'friends';
  end if;
  perform private.rate_limit(v_uid, 'friend_request', private.setting_int('friends.max_requests_per_day', 30), interval '1 day');
  insert into public.friendships (user_a, user_b, requested_by)
  values (least(v_uid, v_other), greatest(v_uid, v_other), v_uid)
  on conflict (user_a, user_b) do nothing;
  -- One notice per asker, however often they cancel and ask again.
  perform private.notify(v_other, 'friend_request',
    jsonb_build_object('user_id', v_uid, 'from_name', v_me.display_name, 'from_username', v_me.username),
    'friend_request:' || v_uid);
  return 'requested';
end $$;

-- The one asked accepts or declines.
create or replace function public.respond_friend_request(p_user_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_me record;
begin
  if not exists (select 1 from public.friendships
                  where user_a = least(v_uid, p_user_id) and user_b = greatest(v_uid, p_user_id)
                    and status = 'pending' and requested_by = p_user_id) then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  if coalesce(p_accept, false) then
    update public.friendships set status = 'accepted', accepted_at = now()
     where user_a = least(v_uid, p_user_id) and user_b = greatest(v_uid, p_user_id);
    select display_name, username into v_me from public.profiles where id = v_uid;
    perform private.notify(p_user_id, 'friend_accepted',
      jsonb_build_object('user_id', v_uid, 'from_name', v_me.display_name, 'from_username', v_me.username));
  else
    delete from public.friendships where user_a = least(v_uid, p_user_id) and user_b = greatest(v_uid, p_user_id);
  end if;
end $$;

create or replace function public.cancel_friend_request(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(false);
begin
  delete from public.friendships
   where user_a = least(v_uid, p_user_id) and user_b = greatest(v_uid, p_user_id)
     and status = 'pending' and requested_by = v_uid;
end $$;

create or replace function public.remove_friend(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(false);
begin
  delete from public.friendships
   where user_a = least(v_uid, p_user_id) and user_b = greatest(v_uid, p_user_id) and status = 'accepted';
end $$;

-- Friends and requests: 'friend', 'incoming' (they asked), 'requested' (the caller asked). Up to 500.
create or replace function public.my_friends()
returns table (user_id uuid, display_name text, username text, avatar_path text, relation text, since timestamptz)
language sql stable security definer set search_path = '' as $$
  with me as (select private.require_user(false) as uid)
  select p.id, p.display_name, p.username, p.avatar_path,
         case when f.status = 'accepted' then 'friend' when f.requested_by = me.uid then 'requested' else 'incoming' end,
         coalesce(f.accepted_at, f.created_at)
    from me, public.friendships f
    join public.profiles p on p.id = case when f.user_a = (select uid from me) then f.user_b else f.user_a end
   where (f.user_a = me.uid or f.user_b = me.uid) and p.status = 'active'
   order by f.status = 'accepted', p.display_name
   limit 500;
$$;

-- Blocking someone ends what was between you.
create or replace function private.end_friendship_on_block()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.friendships
   where user_a = least(new.blocker_id, new.blocked_id) and user_b = greatest(new.blocker_id, new.blocked_id);
  return new;
end $$;
drop trigger if exists user_blocks_end_friendship on public.user_blocks;
create trigger user_blocks_end_friendship after insert on public.user_blocks
  for each row execute function private.end_friendship_on_block();

revoke all on function public.find_member(text) from public, anon;
revoke all on function public.send_friend_request(text) from public, anon;
revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke all on function public.cancel_friend_request(uuid) from public, anon;
revoke all on function public.remove_friend(uuid) from public, anon;
revoke all on function public.my_friends() from public, anon;
grant execute on function public.find_member(text) to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.my_friends() to authenticated;
