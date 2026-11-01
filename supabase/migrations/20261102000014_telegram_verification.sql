-- =============================================================================
-- Phone verification moves from WhatsApp (Meta's Cloud API) to a Telegram bot,
-- so the platform needs no Meta account.
--
-- The site shows a link t.me/<bot>?start=<code>. In the bot the user taps
-- "Share my number", and Telegram delivers their own contact card to our
-- webhook (checked with the secret token set when the webhook was
-- registered). Telegram verified that number when the account was made, and
-- the webhook accepts only a contact whose user_id is the sender's own. The
-- bot answers inside the webhook response: no SMS, no per-message cost.
--
--   1. phone_verify_start  — the site starts a sign-up or password reset.
--   2. tg_link_code        — the bot receives the code; the Telegram account
--                            that sends it first claims the verification.
--   3. tg_receive_contact  — the same account shares its contact: the number
--                            is verified (or found taken / unknown).
--   4. phone_verify_lookup / phone_verify_consume — the waiting page polls,
--                            then opens a session once.
--
-- The verification table keeps its rows under a channel-neutral name; the
-- WhatsApp-only column and functions go. Every function here is for the
-- server (service_role) only.
--
-- The file also works on a database where the WhatsApp file (…0012) was never
-- applied: it then creates the tables itself. It is safe to run twice, so it
-- can be pasted into Supabase's SQL Editor as well as applied with
-- `supabase db push`.
-- =============================================================================

drop function if exists public.wa_create_verification(public.wa_purpose, text, text, uuid, text);
drop function if exists public.wa_receive(text, text, text);
drop function if exists public.wa_get_verification(text);
drop function if exists public.wa_consume_verification(text);
drop function if exists public.wa_auth_email_for_phone(text);
drop function if exists public.wa_cleanup();

-- Types and table: renamed from the WhatsApp file when it was applied, created otherwise.
do $$
begin
  if to_regtype('public.wa_purpose') is not null then
    alter type public.wa_purpose rename to phone_verify_purpose;
  elsif to_regtype('public.phone_verify_purpose') is null then
    create type public.phone_verify_purpose as enum ('signup', 'reset');
  end if;
  if to_regtype('public.wa_status') is not null then
    alter type public.wa_status rename to phone_verify_status;
  elsif to_regtype('public.phone_verify_status') is null then
    create type public.phone_verify_status as enum ('pending', 'verified', 'phone_taken', 'no_account', 'consumed');
  end if;
  if to_regclass('public.whatsapp_verifications') is not null and to_regclass('public.phone_verifications') is null then
    alter table public.whatsapp_verifications rename to phone_verifications;
    alter index public.whatsapp_verifications_pending_code rename to phone_verifications_pending_code;
  end if;
end $$;

create table if not exists public.phone_verifications (
  id uuid primary key default gen_random_uuid(),
  purpose public.phone_verify_purpose not null,
  code text not null check (code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  -- SHA-256 of the random ticket kept in the browser's httpOnly cookie.
  ticket_hash text not null unique check (ticket_hash ~ '^[0-9a-f]{64}$'),
  -- signup: the pending (unconfirmed) auth user; reset: filled in on match.
  user_id uuid references auth.users(id) on delete cascade,
  status public.phone_verify_status not null default 'pending',
  phone text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  verified_at timestamptz,
  consumed_at timestamptz,
  check (purpose = 'reset' or user_id is not null)
);
create unique index if not exists phone_verifications_pending_code on public.phone_verifications(code) where status = 'pending';
alter table public.phone_verifications enable row level security;
revoke all on public.phone_verifications from anon, authenticated;
alter table public.phone_verifications drop column if exists wa_message_id;
alter table public.phone_verifications
  -- The Telegram account that claimed the code (set by tg_link_code).
  add column if not exists tg_user_id bigint check (tg_user_id > 0),
  -- Hash of the client (IP) that started it, for the per-client limit.
  add column if not exists client_ref uuid;
create index if not exists phone_verifications_tg_user on public.phone_verifications (tg_user_id, created_at desc) where tg_user_id is not null;
create index if not exists phone_verifications_client on public.phone_verifications (client_ref, created_at desc) where client_ref is not null;

-- Verified phone numbers (E.164 digits, no "+"). Private: never exposed to clients.
create table if not exists private.user_phones (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  phone text not null unique check (phone ~ '^[1-9][0-9]{7,14}$'),
  verified_at timestamptz not null default now()
);

-- The signed-in user's verified phone, if any.
create or replace function public.my_phone()
returns text language sql stable security definer set search_path = '' as $$
  select phone from private.user_phones where user_id = (select auth.uid());
$$;
revoke execute on function public.my_phone() from public, anon;
grant execute on function public.my_phone() to authenticated;

delete from public.platform_settings where key = 'whatsapp.max_starts_per_hour';
insert into public.platform_settings (key, value, description) values
  ('verify.max_open_per_hour', '20', 'Unfinished phone verifications one client (IP) may start per hour; finished ones do not count'),
  ('telegram.max_codes_per_hour', '20', 'Codes one Telegram account may send to the bot per hour')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Start a verification. p_client_key identifies the client (its IP); it is
-- stored only as a hash. A client may hold a limited number of *unfinished*
-- verifications per hour: finished ones don't count, so people who share a
-- connection (mobile networks, cafés) never block each other, while a script
-- that starts sign-ups and never completes them is stopped.
-- ---------------------------------------------------------------------------
create or replace function public.phone_verify_start(
  p_purpose public.phone_verify_purpose, p_code text, p_ticket_hash text, p_user_id uuid, p_client_key text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_ref uuid := md5('verify:' || coalesce(p_client_key, 'unknown'))::uuid;
  v_expires timestamptz;
begin
  -- Serialize per client so concurrent requests cannot all pass the check.
  perform pg_advisory_xact_lock(hashtextextended(v_ref::text, 0));
  if (select count(*) from public.phone_verifications
       where client_ref = v_ref and created_at > now() - interval '1 hour'
         and status not in ('verified', 'consumed')) >= private.setting_int('verify.max_open_per_hour', 20) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if p_purpose = 'signup' then
    if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id and email_confirmed_at is null) then
      raise exception 'invalid_user' using errcode = '22023';
    end if;
  elsif p_user_id is not null then
    raise exception 'invalid_user' using errcode = '22023';
  end if;
  insert into public.phone_verifications (purpose, code, ticket_hash, user_id, client_ref)
  values (p_purpose, upper(p_code), p_ticket_hash, p_user_id, v_ref)
  returning expires_at into v_expires;
  return v_expires;
end $$;

-- ---------------------------------------------------------------------------
-- The bot received a code (from the start link, or typed by the user). The
-- Telegram account that sends it first claims the verification; another
-- account cannot take it over. Each account may try a limited number of codes
-- per hour, which bounds guessing.
-- ---------------------------------------------------------------------------
create or replace function public.tg_link_code(p_code text, p_tg_user_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key uuid := md5('tg_code:' || coalesce(p_tg_user_id, 0))::uuid;
  v_row public.phone_verifications%rowtype;
begin
  if p_tg_user_id is null or p_tg_user_id <= 0 then
    return jsonb_build_object('linked', false, 'reason', 'invalid_sender');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_key::text, 0));
  if (select count(*) from private.rate_events
       where user_id = v_key and bucket = 'tg_code' and created_at > now() - interval '1 hour')
     >= private.setting_int('telegram.max_codes_per_hour', 20) then
    return jsonb_build_object('linked', false, 'reason', 'rate_limited');
  end if;
  insert into private.rate_events (user_id, bucket) values (v_key, 'tg_code');

  select * into v_row from public.phone_verifications
   where code = upper(coalesce(p_code, '')) and status = 'pending' and expires_at > now()
   for update;
  if not found then
    return jsonb_build_object('linked', false, 'reason', 'no_pending_code');
  end if;
  if v_row.tg_user_id is not null and v_row.tg_user_id <> p_tg_user_id then
    return jsonb_build_object('linked', false, 'reason', 'claimed');
  end if;
  update public.phone_verifications set tg_user_id = p_tg_user_id where id = v_row.id;
  return jsonb_build_object('linked', true, 'purpose', v_row.purpose);
end $$;

-- ---------------------------------------------------------------------------
-- The bot received the sender's own contact card (the webhook checks that
-- contact.user_id is the sender). Completes the verification this Telegram
-- account claimed. A repeated delivery of the same contact answers the same.
-- ---------------------------------------------------------------------------
create or replace function public.tg_receive_contact(p_tg_user_id bigint, p_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_row public.phone_verifications%rowtype;
  v_owner uuid;
  v_status public.phone_verify_status;
begin
  if p_tg_user_id is null or p_tg_user_id <= 0 then
    return jsonb_build_object('matched', false, 'reason', 'invalid_sender');
  end if;
  if v_phone !~ '^[1-9][0-9]{7,14}$' then
    return jsonb_build_object('matched', false, 'reason', 'invalid_phone');
  end if;
  select * into v_row from public.phone_verifications
   where tg_user_id = p_tg_user_id and status = 'pending' and expires_at > now()
   order by created_at desc
   limit 1
   for update;
  if not found then
    select * into v_row from public.phone_verifications
     where tg_user_id = p_tg_user_id and phone = v_phone and verified_at > now() - interval '30 minutes'
     order by verified_at desc
     limit 1;
    if found then
      return jsonb_build_object('matched', true, 'repeat', true, 'purpose', v_row.purpose,
                                'status', case when v_row.status = 'consumed' then 'verified' else v_row.status::text end);
    end if;
    return jsonb_build_object('matched', false, 'reason', 'no_pending_code');
  end if;

  if v_row.purpose = 'signup' then
    select user_id into v_owner from private.user_phones where phone = v_phone;
    if v_owner is not null and v_owner <> v_row.user_id then
      update public.phone_verifications set status = 'phone_taken', phone = v_phone, verified_at = now() where id = v_row.id;
      return jsonb_build_object('matched', true, 'purpose', 'signup', 'status', 'phone_taken');
    end if;
    insert into private.user_phones (user_id, phone) values (v_row.user_id, v_phone)
      on conflict (user_id) do update set phone = excluded.phone, verified_at = now();
    -- The phone, not an e-mail, is this account's verified identifier.
    update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = v_row.user_id;
    update public.phone_verifications set status = 'verified', phone = v_phone, verified_at = now() where id = v_row.id;
    return jsonb_build_object('matched', true, 'purpose', 'signup', 'status', 'verified');
  end if;

  -- Password reset: the shared number identifies the account.
  select user_id into v_owner from private.user_phones where phone = v_phone;
  v_status := case when v_owner is null then 'no_account' else 'verified' end;
  update public.phone_verifications
     set status = v_status, user_id = v_owner, phone = v_phone, verified_at = now()
   where id = v_row.id;
  return jsonb_build_object('matched', true, 'purpose', 'reset', 'status', v_status);
end $$;

-- Current state of a verification, looked up by the browser's ticket.
-- `linked` turns true once the user has opened the bot with the code.
create or replace function public.phone_verify_lookup(p_ticket_hash text)
returns table (purpose public.phone_verify_purpose, status public.phone_verify_status, code text,
               expires_at timestamptz, phone text, linked boolean)
language sql stable security definer set search_path = '' as $$
  select v.purpose, v.status, v.code, v.expires_at, v.phone, v.tg_user_id is not null
    from public.phone_verifications v
   where v.ticket_hash = p_ticket_hash;
$$;

-- One-time hand-off after a successful verification: returns the auth e-mail
-- the server uses to open a session, and marks the ticket consumed.
create or replace function public.phone_verify_consume(p_ticket_hash text)
returns table (purpose public.phone_verify_purpose, user_id uuid, email text)
language plpgsql security definer set search_path = '' as $$
declare v_row public.phone_verifications%rowtype;
begin
  select * into v_row from public.phone_verifications
   where ticket_hash = p_ticket_hash and status = 'verified' and verified_at > now() - interval '30 minutes'
   for update;
  if not found then
    raise exception 'verification_not_ready' using errcode = 'P0002';
  end if;
  update public.phone_verifications set status = 'consumed', consumed_at = now() where id = v_row.id;
  return query select v_row.purpose, v_row.user_id, u.email::text from auth.users u where u.id = v_row.user_id;
end $$;

-- Sign-in by phone: the auth e-mail behind a verified phone (null if none).
create or replace function public.auth_email_for_phone(p_phone text)
returns text language sql stable security definer set search_path = '' as $$
  select u.email::text from private.user_phones p join auth.users u on u.id = p.user_id where p.phone = p_phone;
$$;

-- Removes old verification rows and the phone accounts that were never
-- verified (they cannot sign in: verifying is what confirms them).
create or replace function public.phone_verify_cleanup()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_users int; v_rows int;
begin
  delete from auth.users u
   where u.email like '%@phone.malaab.invalid' and u.email_confirmed_at is null
     and u.created_at < now() - interval '1 day'
     and not exists (select 1 from public.phone_verifications v
                      where v.user_id = u.id and v.status = 'pending' and v.expires_at > now());
  get diagnostics v_users = row_count;
  delete from public.phone_verifications where created_at < now() - interval '2 days';
  get diagnostics v_rows = row_count;
  return jsonb_build_object('deleted_pending_users', v_users, 'deleted_verifications', v_rows);
end $$;

revoke execute on function
  public.phone_verify_start(public.phone_verify_purpose, text, text, uuid, text),
  public.tg_link_code(text, bigint),
  public.tg_receive_contact(bigint, text),
  public.phone_verify_lookup(text),
  public.phone_verify_consume(text),
  public.auth_email_for_phone(text),
  public.phone_verify_cleanup()
from public, anon, authenticated;
grant execute on function
  public.phone_verify_start(public.phone_verify_purpose, text, text, uuid, text),
  public.tg_link_code(text, bigint),
  public.tg_receive_contact(bigint, text),
  public.phone_verify_lookup(text),
  public.phone_verify_consume(text),
  public.auth_email_for_phone(text),
  public.phone_verify_cleanup()
to service_role;
