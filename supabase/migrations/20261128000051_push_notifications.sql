-- =============================================================================
-- Notifications on the phone, from the app (0051; after 0040 and 0050).
--
-- - push_devices: the phones signed in to the app (an FCM token on Android,
--   an APNs token on iPhone). The app registers its phone after sign-in;
--   signing out forgets it. A phone that signs in to another account moves
--   to it. Up to 10 phones per member (the oldest goes).
-- - private.push_outbox: what to send. Filled by triggers, only for members
--   with a phone in the app:
--     * every notification (the bell's, so the member's settings apply: types
--       they switched off make no notification at all);
--     * every new message, for the conversation's other members, unless they
--       muted it (0040), blocked the sender, or it is a call's record.
-- - The site sends them (src/server/push.ts): claim_push_batch() hands out a
--   batch once (rows go as they are handed out; a phone that is gone is
--   forgotten with forget_push_tokens()). Sending is best effort, like any
--   push: what isn't sent within an hour is dropped.
-- - When it sends: right after a member sends a message (the site), every 15
--   minutes (the scheduled job), and at once for everything when the database
--   can call the site (pg_net) and knows where: two Vault secrets, set once
--   (DEPLOYMENT.md section 22):
--     select vault.create_secret('https://<site>/api/push', 'push_endpoint');
--     select vault.create_secret('<CRON_SECRET>', 'push_secret');
--
-- Adds tables, triggers and functions; changes no existing data. Safe to run
-- twice.
-- =============================================================================

create extension if not exists pg_net with schema extensions;

create table if not exists public.push_devices (
  token text primary key check (char_length(token) between 20 and 4096),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_devices_user_idx on public.push_devices (user_id);
alter table public.push_devices enable row level security;
-- Through the functions below only.
revoke all on public.push_devices from anon, authenticated;
drop policy if exists second_factor on public.push_devices;
create policy second_factor on public.push_devices as restrictive for all to authenticated
  using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()));

create table if not exists private.push_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('notification', 'message')),
  ref text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_outbox_user_idx on private.push_outbox (user_id);
revoke all on private.push_outbox from public, anon, authenticated;

-- The app, after sign-in: this phone receives this member's notifications.
create or replace function public.register_push_device(p_token text, p_platform text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(false);
  v_token text := btrim(coalesce(p_token, ''));
begin
  if char_length(v_token) not between 20 and 4096 or p_platform not in ('android', 'ios') then
    raise exception 'invalid_device' using errcode = '22023';
  end if;
  insert into public.push_devices (token, user_id, platform) values (v_token, v_uid, p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now();
  delete from public.push_devices
   where user_id = v_uid
     and token not in (select token from public.push_devices where user_id = v_uid order by last_seen_at desc limit 10);
end $$;

-- Signing out: this phone stops receiving them.
create or replace function public.unregister_push_device(p_token text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_devices where token = btrim(coalesce(p_token, '')) and user_id = (select auth.uid());
$$;

-- Queued for members with a phone in the app.
create or replace function private.queue_notification_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- new_message: the message itself is sent (below), as the bell doesn't show these either.
  if new.type <> 'new_message' and exists (select 1 from public.push_devices where user_id = new.user_id) then
    insert into private.push_outbox (user_id, kind, ref) values (new.user_id, 'notification', new.id::text);
  end if;
  return null;
end $$;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  for each row execute function private.queue_notification_push();

create or replace function private.queue_message_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.sender_id is null or new.call_outcome is not null then
    return null;
  end if;
  insert into private.push_outbox (user_id, kind, ref)
  select m.user_id, 'message', new.id::text
    from public.conversation_members m
   where m.conversation_id = new.conversation_id
     and m.user_id <> new.sender_id
     and exists (select 1 from public.push_devices d where d.user_id = m.user_id)
     and not private.is_muted(new.conversation_id, m.user_id)
     and not private.is_blocked_between(m.user_id, new.sender_id);
  return null;
end $$;
drop trigger if exists messages_push on public.messages;
create trigger messages_push after insert on public.messages
  for each row execute function private.queue_message_push();

-- Something to send: tell the site at once, when the database knows where (Vault secrets above).
create or replace function private.kick_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_endpoint text;
  v_secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    return null;
  end if;
  execute $q$select (select decrypted_secret from vault.decrypted_secrets where name = 'push_endpoint' limit 1),
                    (select decrypted_secret from vault.decrypted_secrets where name = 'push_secret' limit 1)$q$
     into v_endpoint, v_secret;
  if v_endpoint is null or v_secret is null then
    return null;
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 5000)'
    using v_endpoint, jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'), '{}'::jsonb;
  return null;
exception when others then
  -- A failed wake-up never stops a message or a notification: the scheduled job sends it later.
  return null;
end $$;
drop trigger if exists push_outbox_kick on private.push_outbox;
create trigger push_outbox_kick after insert on private.push_outbox
  for each statement execute function private.kick_push();

-- The site (server key): a batch to send, each handed out once, with the phones to send it to.
create or replace function public.claim_push_batch(p_limit integer default 200)
returns table (kind text, ref text, user_id uuid, devices jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.push_outbox where created_at < now() - interval '1 hour';
  return query
  with batch as (
    delete from private.push_outbox o
     where o.id in (select id from private.push_outbox order by id
                     limit least(greatest(coalesce(p_limit, 200), 1), 500) for update skip locked)
    returning o.kind, o.ref, o.user_id
  )
  select b.kind, b.ref, b.user_id,
         (select jsonb_agg(jsonb_build_object('token', d.token, 'platform', d.platform))
            from public.push_devices d where d.user_id = b.user_id)
    from batch b
   where exists (select 1 from public.push_devices d where d.user_id = b.user_id);
end $$;

-- The site (server key): phones the push services say are gone.
create or replace function public.forget_push_tokens(p_tokens text[])
returns void language sql security definer set search_path = '' as $$
  delete from public.push_devices where token = any(coalesce(p_tokens, '{}'));
$$;

revoke all on function private.queue_notification_push() from public, anon, authenticated;
revoke all on function private.queue_message_push() from public, anon, authenticated;
revoke all on function private.kick_push() from public, anon, authenticated;
revoke all on function public.register_push_device(text, text) from public, anon;
revoke all on function public.unregister_push_device(text) from public, anon;
revoke all on function public.claim_push_batch(integer) from public, anon, authenticated;
revoke all on function public.forget_push_tokens(text[]) from public, anon, authenticated;
grant execute on function public.register_push_device(text, text) to authenticated;
grant execute on function public.unregister_push_device(text) to authenticated;
grant execute on function public.claim_push_batch(integer) to service_role;
grant execute on function public.forget_push_tokens(text[]) to service_role;
