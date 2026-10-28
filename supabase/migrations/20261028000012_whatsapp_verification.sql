-- =============================================================================
-- "Reverse" WhatsApp verification: the user sends a one-time code from their
-- own WhatsApp to the platform's number. Meta's WhatsApp Cloud API delivers
-- the message to our webhook (signature-checked), and the sender's number is
-- taken from WhatsApp itself, which proves the user controls it. Nothing is
-- sent to the user, so there is no per-message cost.
--
-- Accounts created this way have no real e-mail: the auth user gets an
-- internal address on the reserved `.invalid` TLD and signs in with phone +
-- password (the app maps the phone to that address server-side).
--
-- Every function here is for the server (service_role) only.
-- =============================================================================

create type public.wa_purpose as enum ('signup', 'reset');
create type public.wa_status as enum ('pending', 'verified', 'phone_taken', 'no_account', 'consumed');

create table public.whatsapp_verifications (
  id uuid primary key default gen_random_uuid(),
  purpose public.wa_purpose not null,
  code text not null check (code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  -- SHA-256 of the random ticket kept in the browser's httpOnly cookie.
  ticket_hash text not null unique check (ticket_hash ~ '^[0-9a-f]{64}$'),
  -- signup: the pending (unconfirmed) auth user; reset: filled in on match.
  user_id uuid references auth.users(id) on delete cascade,
  status public.wa_status not null default 'pending',
  phone text,
  wa_message_id text unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  verified_at timestamptz,
  consumed_at timestamptz,
  check (purpose = 'reset' or user_id is not null)
);
create unique index whatsapp_verifications_pending_code on public.whatsapp_verifications(code) where status = 'pending';
alter table public.whatsapp_verifications enable row level security;
revoke all on public.whatsapp_verifications from anon, authenticated;

-- Verified phone numbers (E.164 digits, no "+"). Private: never exposed to clients.
create table private.user_phones (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  phone text not null unique check (phone ~ '^[1-9][0-9]{7,14}$'),
  verified_at timestamptz not null default now()
);

insert into public.platform_settings (key, value, description) values
  ('whatsapp.max_starts_per_hour', '10', 'WhatsApp verifications one client (IP) may start per hour');

-- ---------------------------------------------------------------------------
-- Start a verification. p_client_key identifies the client (e.g. IP) for
-- rate limiting; it is hashed and never stored.
-- ---------------------------------------------------------------------------
create or replace function public.wa_create_verification(
  p_purpose public.wa_purpose, p_code text, p_ticket_hash text, p_user_id uuid, p_client_key text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_expires timestamptz;
begin
  perform private.rate_limit(md5('wa_start:' || coalesce(p_client_key, 'unknown'))::uuid, 'wa_start',
    private.setting_int('whatsapp.max_starts_per_hour', 10), interval '1 hour');
  if p_purpose = 'signup' then
    if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id and email_confirmed_at is null) then
      raise exception 'invalid_user' using errcode = '22023';
    end if;
  elsif p_user_id is not null then
    raise exception 'invalid_user' using errcode = '22023';
  end if;
  insert into public.whatsapp_verifications (purpose, code, ticket_hash, user_id)
  values (p_purpose, upper(p_code), p_ticket_hash, p_user_id)
  returning expires_at into v_expires;
  return v_expires;
end $$;

-- ---------------------------------------------------------------------------
-- Called by the webhook for every inbound text message. Idempotent per
-- WhatsApp message id. Returns what happened so the webhook can reply.
-- ---------------------------------------------------------------------------
create or replace function public.wa_receive(p_from text, p_body text, p_message_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := regexp_replace(coalesce(p_from, ''), '[^0-9]', '', 'g');
  v_match text[];
  v_row public.whatsapp_verifications%rowtype;
  v_owner uuid;
begin
  if v_phone !~ '^[1-9][0-9]{7,14}$' then
    return jsonb_build_object('matched', false, 'reason', 'invalid_sender');
  end if;
  if p_message_id is not null and exists (select 1 from public.whatsapp_verifications where wa_message_id = p_message_id) then
    return jsonb_build_object('matched', false, 'reason', 'duplicate');
  end if;
  -- The message may contain other text; try every code-shaped token in it.
  for v_match in select regexp_matches(upper(coalesce(p_body, '')), '([A-Z0-9]{4})[- ]?([A-Z0-9]{4})', 'g') loop
    select * into v_row from public.whatsapp_verifications
     where code = v_match[1] || '-' || v_match[2] and status = 'pending' and expires_at > now()
     for update;
    exit when found;
  end loop;
  if v_row.id is null then
    return jsonb_build_object('matched', false, 'reason', 'no_pending_code');
  end if;

  if v_row.purpose = 'signup' then
    select user_id into v_owner from private.user_phones where phone = v_phone;
    if v_owner is not null and v_owner <> v_row.user_id then
      update public.whatsapp_verifications
         set status = 'phone_taken', phone = v_phone, wa_message_id = p_message_id, verified_at = now()
       where id = v_row.id;
      return jsonb_build_object('matched', true, 'purpose', 'signup', 'status', 'phone_taken');
    end if;
    insert into private.user_phones (user_id, phone) values (v_row.user_id, v_phone)
      on conflict (user_id) do update set phone = excluded.phone, verified_at = now();
    -- The phone, not an e-mail, is this account's verified identifier.
    update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = v_row.user_id;
    update public.whatsapp_verifications
       set status = 'verified', phone = v_phone, wa_message_id = p_message_id, verified_at = now()
     where id = v_row.id;
    return jsonb_build_object('matched', true, 'purpose', 'signup', 'status', 'verified');
  end if;

  -- Password reset: the sender's number identifies the account.
  select user_id into v_owner from private.user_phones where phone = v_phone;
  update public.whatsapp_verifications
     set status = case when v_owner is null then 'no_account' else 'verified' end::public.wa_status,
         user_id = v_owner, phone = v_phone, wa_message_id = p_message_id, verified_at = now()
   where id = v_row.id;
  return jsonb_build_object('matched', true, 'purpose', 'reset',
                            'status', case when v_owner is null then 'no_account' else 'verified' end);
end $$;

-- Current state of a verification, looked up by the browser's ticket.
create or replace function public.wa_get_verification(p_ticket_hash text)
returns table (purpose public.wa_purpose, status public.wa_status, code text, expires_at timestamptz, phone text)
language sql stable security definer set search_path = '' as $$
  select v.purpose, v.status, v.code, v.expires_at, v.phone
    from public.whatsapp_verifications v
   where v.ticket_hash = p_ticket_hash;
$$;

-- One-time hand-off after a successful verification: returns the auth e-mail
-- the server uses to open a session, and marks the ticket consumed.
create or replace function public.wa_consume_verification(p_ticket_hash text)
returns table (purpose public.wa_purpose, user_id uuid, email text)
language plpgsql security definer set search_path = '' as $$
declare v_row public.whatsapp_verifications%rowtype;
begin
  select * into v_row from public.whatsapp_verifications
   where ticket_hash = p_ticket_hash and status = 'verified' and verified_at > now() - interval '30 minutes'
   for update;
  if not found then
    raise exception 'verification_not_ready' using errcode = 'P0002';
  end if;
  update public.whatsapp_verifications set status = 'consumed', consumed_at = now() where id = v_row.id;
  return query select v_row.purpose, v_row.user_id, u.email::text from auth.users u where u.id = v_row.user_id;
end $$;

-- Sign-in by phone: the auth e-mail behind a verified phone (null if none).
create or replace function public.wa_auth_email_for_phone(p_phone text)
returns text language sql stable security definer set search_path = '' as $$
  select u.email::text from private.user_phones p join auth.users u on u.id = p.user_id where p.phone = p_phone;
$$;

-- The signed-in user's verified phone, if any.
create or replace function public.my_phone()
returns text language sql stable security definer set search_path = '' as $$
  select phone from private.user_phones where user_id = (select auth.uid());
$$;

-- Removes stale verifications and the never-verified accounts they created.
create or replace function public.wa_cleanup()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_users int; v_rows int;
begin
  with stale as (
    select v.user_id from public.whatsapp_verifications v
     where v.purpose = 'signup' and v.status in ('pending', 'phone_taken') and v.created_at < now() - interval '1 day'
  )
  delete from auth.users u using stale
   where u.id = stale.user_id and u.email_confirmed_at is null and u.email like '%@phone.malaab.invalid';
  get diagnostics v_users = row_count;
  delete from public.whatsapp_verifications where created_at < now() - interval '2 days';
  get diagnostics v_rows = row_count;
  return jsonb_build_object('deleted_pending_users', v_users, 'deleted_verifications', v_rows);
end $$;

revoke execute on function
  public.wa_create_verification(public.wa_purpose, text, text, uuid, text),
  public.wa_receive(text, text, text),
  public.wa_get_verification(text),
  public.wa_consume_verification(text),
  public.wa_auth_email_for_phone(text),
  public.wa_cleanup()
from public, anon, authenticated;
grant execute on function
  public.wa_create_verification(public.wa_purpose, text, text, uuid, text),
  public.wa_receive(text, text, text),
  public.wa_get_verification(text),
  public.wa_consume_verification(text),
  public.wa_auth_email_for_phone(text),
  public.wa_cleanup()
to service_role;
revoke execute on function public.my_phone() from public, anon;
grant execute on function public.my_phone() to authenticated;
