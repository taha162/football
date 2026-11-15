-- =============================================================================
-- 0029: WhatsApp verification with the number typed on the site.
--
-- WhatsApp more and more hides the sender's number behind an anonymous id (a
-- "LID"), so the bot can't always tell which number a code came from. The user
-- now also types their number on the site, and the code counts only from that
-- number:
--   - when WhatsApp shows the sender's number, it must be the typed one
--     (wa_bot_receive answers 'other_number' otherwise);
--   - when WhatsApp hides it, wa_bot_claimed_phone tells the bot which number
--     the code was requested for; the bot asks WhatsApp for that number's LID
--     and goes on only if it is the sender's.
-- Verifications started without a typed number (Telegram, or WhatsApp before
-- this file) work as before.
--
-- Safe to run more than once. Changes no existing data.
-- =============================================================================

alter table public.phone_verifications
  -- WhatsApp: the number the user typed; the code is accepted only from it.
  add column if not exists claimed_phone text check (claimed_phone ~ '^[1-9][0-9]{7,14}$');

-- Every token shaped like a code in a message, from the code alphabet only (no 0, O, 1, I or L).
-- Arabic-Indic and Persian digits typed by hand count as the same digits.
create or replace function private.wa_codes(p_body text)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct m[1] || '-' || m[2]), '{}')
    from regexp_matches(
           upper(translate(left(coalesce(p_body, ''), 500), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')),
           '(?:^|[^A-Z0-9])([A-HJKMNP-Z2-9]{4})[- _]?([A-HJKMNP-Z2-9]{4})(?![A-Z0-9])', 'g') as m;
$$;

-- ---------------------------------------------------------------------------
-- Start a verification (as in 0014), now with the typed number for WhatsApp.
-- ---------------------------------------------------------------------------
drop function if exists public.phone_verify_start(public.phone_verify_purpose, text, text, uuid, text);
create or replace function public.phone_verify_start(
  p_purpose public.phone_verify_purpose, p_code text, p_ticket_hash text, p_user_id uuid, p_client_key text,
  p_phone text default null)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_ref uuid := md5('verify:' || coalesce(p_client_key, 'unknown'))::uuid;
  -- Null or blank: no typed number (Telegram). Anything else must be a number.
  v_phone text := case when btrim(coalesce(p_phone, '')) = '' then null else regexp_replace(p_phone, '[^0-9]', '', 'g') end;
  v_expires timestamptz;
begin
  if v_phone is not null and v_phone !~ '^[1-9][0-9]{7,14}$' then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;
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
  insert into public.phone_verifications (purpose, code, ticket_hash, user_id, client_ref, claimed_phone)
  values (p_purpose, upper(p_code), p_ticket_hash, p_user_id, v_ref, v_phone)
  returning expires_at into v_expires;
  return v_expires;
end $$;

-- The browser's view of its verification (as in 0014), with the typed number.
drop function if exists public.phone_verify_lookup(text);
create or replace function public.phone_verify_lookup(p_ticket_hash text)
returns table (purpose public.phone_verify_purpose, status public.phone_verify_status, code text,
               expires_at timestamptz, phone text, linked boolean, claimed_phone text)
language sql stable security definer set search_path = '' as $$
  select v.purpose, v.status, v.code, v.expires_at, v.phone, v.tg_user_id is not null, v.claimed_phone
    from public.phone_verifications v
   where v.ticket_hash = p_ticket_hash;
$$;

-- ---------------------------------------------------------------------------
-- The bot received a code from a number it can see (as in 0028). A code
-- requested for a typed number counts only from that number.
-- ---------------------------------------------------------------------------
create or replace function public.wa_bot_receive(p_phone text, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_codes text[] := private.wa_codes(p_body);
  v_key uuid;
  v_row public.phone_verifications%rowtype;
  v_owner uuid;
  v_status public.phone_verify_status;
begin
  if v_phone !~ '^[1-9][0-9]{7,14}$' then
    return jsonb_build_object('matched', false, 'reason', 'invalid_sender');
  end if;
  if cardinality(v_codes) = 0 then
    return jsonb_build_object('matched', false, 'reason', 'no_code');
  end if;

  -- One number at a time, so a message delivered twice at once gets one answer.
  v_key := md5('wa_code:' || v_phone)::uuid;
  perform pg_advisory_xact_lock(hashtextextended(v_key::text, 0));

  -- The same message delivered again (the bot retried, WhatsApp re-sent it): the same answer.
  select * into v_row from public.phone_verifications
   where code = any(v_codes) and phone = v_phone and verified_at > now() - interval '30 minutes'
   order by verified_at desc
   limit 1;
  if found then
    return jsonb_build_object('matched', true, 'repeat', true, 'purpose', v_row.purpose,
                              'status', case when v_row.status = 'consumed' then 'verified' else v_row.status::text end);
  end if;

  -- Each number may try a limited number of codes per hour, which bounds guessing.
  if (select count(*) from private.rate_events
       where user_id = v_key and bucket = 'wa_code' and created_at > now() - interval '1 hour')
     >= private.setting_int('whatsapp.max_codes_per_hour', 20) then
    return jsonb_build_object('matched', false, 'reason', 'rate_limited');
  end if;
  insert into private.rate_events (user_id, bucket) values (v_key, 'wa_code');

  select * into v_row from public.phone_verifications
   where code = any(v_codes) and status = 'pending' and expires_at > now()
   order by created_at desc
   limit 1
   for update;
  if not found then
    return jsonb_build_object('matched', false, 'reason', 'no_pending_code');
  end if;
  -- Opened in Telegram first: that Telegram account owns it, as between two Telegram accounts.
  if v_row.tg_user_id is not null then
    return jsonb_build_object('matched', false, 'reason', 'claimed');
  end if;
  -- Requested for another number: it stays open for that number.
  if v_row.claimed_phone is not null and v_row.claimed_phone <> v_phone then
    return jsonb_build_object('matched', false, 'reason', 'other_number', 'claimed', v_row.claimed_phone);
  end if;

  if v_row.purpose = 'signup' then
    select user_id into v_owner from private.user_phones where phone = v_phone;
    if v_owner is not null and v_owner <> v_row.user_id then
      update public.phone_verifications set status = 'phone_taken', phone = v_phone, verified_at = now() where id = v_row.id;
      return jsonb_build_object('matched', true, 'purpose', 'signup', 'status', 'phone_taken');
    end if;
    insert into private.user_phones (user_id, phone) values (v_row.user_id, v_phone)
      on conflict (user_id) do update set phone = excluded.phone, verified_at = now();
    -- As with Telegram: the phone is this account's verified identifier, and it
    -- shows in Supabase's own user list.
    update auth.users
       set email_confirmed_at = coalesce(email_confirmed_at, now()),
           phone = case when exists (select 1 from auth.users o where o.phone = v_phone and o.id <> v_row.user_id) then phone else v_phone end,
           phone_confirmed_at = coalesce(phone_confirmed_at, now())
     where id = v_row.user_id;
    update public.phone_verifications set status = 'verified', phone = v_phone, verified_at = now() where id = v_row.id;
    return jsonb_build_object('matched', true, 'purpose', 'signup', 'status', 'verified');
  end if;

  -- Password reset: the sender's number identifies the account.
  select user_id into v_owner from private.user_phones where phone = v_phone;
  v_status := case when v_owner is null then 'no_account' else 'verified' end;
  update public.phone_verifications
     set status = v_status, user_id = v_owner, phone = v_phone, verified_at = now()
   where id = v_row.id;
  return jsonb_build_object('matched', true, 'purpose', 'reset', 'status', v_status);
end $$;

-- ---------------------------------------------------------------------------
-- A code from a sender whose number WhatsApp hides: which number was it
-- requested for? The bot then asks WhatsApp whether the sender is that number,
-- and only then calls wa_bot_receive with it. Recently finished verifications
-- count too, so the same message delivered again gets the same answer.
--   {found: false}                    no such code (wrong or expired)
--   {found: true, reason: 'claimed'}  opened in Telegram
--   {found: true, phone: null}        started without a typed number
--   {found: true, phone: '964…'}      the typed number
-- ---------------------------------------------------------------------------
create or replace function public.wa_bot_claimed_phone(p_body text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_codes text[] := private.wa_codes(p_body);
  v_row public.phone_verifications%rowtype;
begin
  if cardinality(v_codes) = 0 then
    return jsonb_build_object('found', false);
  end if;
  select * into v_row from public.phone_verifications
   where code = any(v_codes)
     and ((status = 'pending' and expires_at > now()) or verified_at > now() - interval '30 minutes')
   order by created_at desc
   limit 1;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  if v_row.tg_user_id is not null then
    return jsonb_build_object('found', true, 'reason', 'claimed');
  end if;
  return jsonb_build_object('found', true, 'phone', v_row.claimed_phone);
end $$;

-- The admin page's summary (as in 0028), saying this file is applied.
create or replace function public.admin_whatsapp_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_day timestamptz := ((now() at time zone 'Asia/Baghdad')::date)::timestamp at time zone 'Asia/Baghdad';
begin
  perform private.require_admin();
  return jsonb_build_object(
    'schema', 29,
    'booking_messages', private.setting_bool('whatsapp.booking_messages', false),
    'promo_left_today', private.wa_promo_allowance(),
    'sent_today', (select count(*)::int from public.outbound_messages where sent_at >= v_day),
    'failed_today', (select count(*)::int from public.outbound_messages where status = 'failed' and updated_at >= v_day),
    'queued', (select count(*)::int from public.outbound_messages where status = 'queued'),
    'sending', (select count(*)::int from public.outbound_messages where status = 'sending'),
    'opted_in', (select count(*)::int from private.wa_promo_audience(null)));
end $$;

-- ---------------------------------------------------------------------------
-- Grants: the server only, as before. (A new function is executable by
-- everyone until revoked.)
-- ---------------------------------------------------------------------------
revoke execute on function
  private.wa_codes(text),
  public.phone_verify_start(public.phone_verify_purpose, text, text, uuid, text, text),
  public.phone_verify_lookup(text),
  public.wa_bot_claimed_phone(text)
from public, anon, authenticated;
grant execute on function
  public.phone_verify_start(public.phone_verify_purpose, text, text, uuid, text, text),
  public.phone_verify_lookup(text),
  public.wa_bot_claimed_phone(text)
to service_role;
