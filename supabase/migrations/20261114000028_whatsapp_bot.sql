-- =============================================================================
-- WhatsApp through the platform's own number: no Meta account, no Cloud API.
--
-- A small bot service (whatsapp-bot/, built on Baileys) is linked to the
-- platform's WhatsApp number the way WhatsApp Web is. It forwards to the site
-- only the messages that carry a code (or ask to stop messages), and sends
-- what the site hands it, slowly, from one queue.
--
-- 1. Verification, like Telegram's but in one step. The site shows a code;
--    the user sends it from their own WhatsApp, so the sender's number is the
--    verified number (wa_bot_receive). It reuses phone_verifications and the
--    phone_verify_start / lookup / consume functions of the Telegram file.
-- 2. "0", "stop" or «إلغاء» stops every WhatsApp message to that number
--    (wa_bot_unsubscribe).
-- 3. Outgoing messages (outbound_messages, closed to API roles):
--    - booking confirmations, changes and cancellations, queued by a trigger
--      on bookings that can never make a booking fail;
--    - promotional campaigns (whatsapp_campaigns), sent by admins only to
--      people who ticked the opt-in box (whatsapp_consent).
--    A worker (/api/cron) hands them to the bot in small batches
--    (wa_outbox_*); promotions also stay under a daily limit that starts low
--    and grows a little every day.
--
-- Every bot and worker function is for the server (service_role) only. Safe
-- to run twice. No existing data changes. Works whether or not the
-- two-step-verification file (…0027) was applied.
-- =============================================================================

insert into public.platform_settings (key, value, description, is_public) values
  ('whatsapp.max_codes_per_hour', '20', 'Codes one WhatsApp number may send to the bot per hour', false),
  ('whatsapp.booking_messages', 'false', 'Send booking confirmations, changes and cancellations on WhatsApp (true or false). Turn on once the bot is linked', false),
  ('whatsapp.max_attempts', '3', 'Times one WhatsApp message is tried before it counts as failed', false),
  ('whatsapp.batch_size', '10', 'WhatsApp messages handed to the bot per run of the scheduled job', false),
  ('whatsapp.promo_daily_start', '20', 'Promotional WhatsApp messages on the first day of sending; the daily limit grows from here', false),
  ('whatsapp.promo_daily_step', '10', 'How much the daily limit of promotional WhatsApp messages grows each day', false),
  ('whatsapp.promo_daily_max', '150', 'Highest daily number of promotional WhatsApp messages', false)
on conflict (key) do nothing;

create or replace function private.setting_bool(p_key text, p_default boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select lower(value #>> '{}') in ('true', '1', 'on', 'yes') from public.platform_settings where key = p_key), p_default);
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regtype('public.outbound_kind') is null then
    create type public.outbound_kind as enum ('booking', 'promo');
  end if;
  -- queued: waiting in the site; sending: handed to the bot, which paces it;
  -- sent / failed / skipped (not sent on purpose: opted out, stopped, stale…).
  if to_regtype('public.outbound_status') is null then
    create type public.outbound_status as enum ('queued', 'sending', 'sent', 'failed', 'skipped');
  end if;
  if to_regtype('public.campaign_status') is null then
    create type public.campaign_status as enum ('sending', 'stopped', 'done');
  end if;
end $$;

-- Who agreed to what. Promotions need an explicit opt-in (a box that starts
-- unticked); booking messages go to verified numbers unless turned off.
create table if not exists public.whatsapp_consent (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  opted_in_at timestamptz,
  opted_out_at timestamptz,
  bookings_off_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_campaigns (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(btrim(body)) between 5 and 1000),
  city_id uuid references public.cities(id) on delete set null,
  status public.campaign_status not null default 'sending',
  recipients int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  stopped_by uuid references public.profiles(id) on delete set null,
  stopped_at timestamptz,
  finished_at timestamptz
);
create unique index if not exists whatsapp_campaigns_one_active on public.whatsapp_campaigns ((true)) where status = 'sending';

create table if not exists public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  phone text not null check (phone ~ '^[1-9][0-9]{7,14}$'),
  kind public.outbound_kind not null,
  -- The text as sent; written when the worker renders it from the payload.
  body text check (char_length(body) <= 2000),
  status public.outbound_status not null default 'queued',
  attempts smallint not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error text check (char_length(error) <= 200),
  -- What the message is about. For bookings, a snapshot taken at the event.
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  booking_id uuid references public.bookings(id) on delete cascade,
  campaign_id uuid references public.whatsapp_campaigns(id) on delete cascade,
  -- One message per booking event, even if the event is recorded twice.
  dedupe_key text unique,
  next_attempt_at timestamptz not null default now(),
  handed_at timestamptz,
  first_handed_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((kind = 'promo') = (campaign_id is not null))
);
create index if not exists outbound_messages_due on public.outbound_messages (kind, next_attempt_at) where status = 'queued';
create index if not exists outbound_messages_sending on public.outbound_messages (handed_at) where status = 'sending';
create index if not exists outbound_messages_campaign on public.outbound_messages (campaign_id, status) where campaign_id is not null;
create index if not exists outbound_messages_booking on public.outbound_messages (booking_id) where booking_id is not null;
create index if not exists outbound_messages_user on public.outbound_messages (user_id);
create index if not exists outbound_messages_phone on public.outbound_messages (phone) where status in ('queued', 'sending');
create index if not exists outbound_messages_promo_handed on public.outbound_messages (first_handed_at) where kind = 'promo';
create index if not exists outbound_messages_promo_sent on public.outbound_messages (sent_at) where kind = 'promo';

-- Closed: no API role reads or writes these, only definer functions and the
-- server. People read their own consent; they change it through an RPC.
alter table public.whatsapp_consent enable row level security;
alter table public.whatsapp_campaigns enable row level security;
alter table public.outbound_messages enable row level security;
revoke all on public.whatsapp_consent, public.whatsapp_campaigns, public.outbound_messages from anon, authenticated;
grant select on public.whatsapp_consent to authenticated;
drop policy if exists whatsapp_consent_read_own on public.whatsapp_consent;
create policy whatsapp_consent_read_own on public.whatsapp_consent for select to authenticated
  using (user_id = (select auth.uid()));

-- The same second-step rule as every other table (migration 0027), when present.
do $$
declare t text;
begin
  if to_regprocedure('private.mfa_satisfied()') is null then
    return;
  end if;
  foreach t in array array['whatsapp_consent', 'whatsapp_campaigns', 'outbound_messages'] loop
    execute format('drop policy if exists second_factor on public.%I', t);
    execute format(
      'create policy second_factor on public.%I as restrictive for all to authenticated
         using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Verification: the user sends the code from their own WhatsApp.
-- ---------------------------------------------------------------------------
create or replace function public.wa_bot_receive(p_phone text, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  -- Arabic-Indic and Persian digits typed by hand count as the same digits.
  v_body text := upper(translate(left(coalesce(p_body, ''), 500), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'));
  v_codes text[];
  v_key uuid;
  v_row public.phone_verifications%rowtype;
  v_owner uuid;
  v_status public.phone_verify_status;
begin
  if v_phone !~ '^[1-9][0-9]{7,14}$' then
    return jsonb_build_object('matched', false, 'reason', 'invalid_sender');
  end if;
  -- Every token shaped like a code, from the code alphabet only (no 0, O, 1, I or L).
  select coalesce(array_agg(distinct m[1] || '-' || m[2]), '{}') into v_codes
    from regexp_matches(v_body, '(?:^|[^A-Z0-9])([A-HJKMNP-Z2-9]{4})[- _]?([A-HJKMNP-Z2-9]{4})(?![A-Z0-9])', 'g') as m;
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
-- 2. Consent: promotions only after an explicit opt-in; "0" / "stop" / «إلغاء»
--    stops everything at once.
-- ---------------------------------------------------------------------------
create or replace function public.wa_bot_unsubscribe(p_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_user uuid;
  v_dropped int;
begin
  if v_phone !~ '^[1-9][0-9]{7,14}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_sender');
  end if;
  select user_id into v_user from private.user_phones where phone = v_phone;
  if v_user is not null then
    insert into public.whatsapp_consent as c (user_id, opted_out_at, bookings_off_at)
    values (v_user, now(), now())
    on conflict (user_id) do update set
      opted_out_at = coalesce(c.opted_out_at, now()),
      bookings_off_at = coalesce(c.bookings_off_at, now()),
      updated_at = now();
  end if;
  -- Whatever still waits for this number is dropped, whoever it was for.
  update public.outbound_messages set status = 'skipped', error = 'opted_out', updated_at = now()
   where phone = v_phone and status = 'queued';
  get diagnostics v_dropped = row_count;
  return jsonb_build_object('ok', true, 'known', v_user is not null, 'dropped', v_dropped);
end $$;

-- Settings page: booking messages on or off, promotions opted in or out.
create or replace function public.set_my_whatsapp_settings(p_bookings boolean, p_promos boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(false);
begin
  if p_bookings is null or p_promos is null then
    raise exception 'invalid_preferences' using errcode = '22023';
  end if;
  insert into public.whatsapp_consent as c (user_id, opted_in_at, bookings_off_at)
  values (v_uid, case when p_promos then now() end, case when not p_bookings then now() end)
  on conflict (user_id) do update set
    opted_in_at = case when p_promos and (c.opted_in_at is null or c.opted_out_at is not null) then now() else c.opted_in_at end,
    opted_out_at = case when p_promos then null
                        when c.opted_in_at is not null and c.opted_out_at is null then now()
                        else c.opted_out_at end,
    bookings_off_at = case when p_bookings then null else coalesce(c.bookings_off_at, now()) end,
    updated_at = now();
  update public.outbound_messages set status = 'skipped', error = 'opted_out', updated_at = now()
   where user_id = v_uid and status = 'queued'
     and ((kind = 'promo' and not p_promos) or (kind = 'booking' and not p_bookings));
end $$;

-- The opt-in box on the phone sign-up forms, recorded for the account the
-- sign-up just created (before its number is verified).
create or replace function public.wa_signup_consent(p_user_id uuid, p_promos boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(p_promos, false) then
    return;
  end if;
  if not exists (select 1 from auth.users where id = p_user_id and email_confirmed_at is null) then
    raise exception 'invalid_user' using errcode = '22023';
  end if;
  insert into public.whatsapp_consent as c (user_id, opted_in_at) values (p_user_id, now())
  on conflict (user_id) do update set opted_in_at = coalesce(c.opted_in_at, now()), opted_out_at = null, updated_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- 3a. Booking messages. A trigger snapshots the booking at the event; any
--     failure here is swallowed, so WhatsApp can never break a booking.
-- ---------------------------------------------------------------------------
create or replace function private.wa_booking_message(p_booking public.bookings, p_event text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_phone text;
  v_venue text;
  v_field text;
  v_several boolean;
begin
  if not private.setting_bool('whatsapp.booking_messages', false) then
    return;
  end if;
  select phone into v_phone from private.user_phones where user_id = p_booking.requested_by;
  if v_phone is null
     or exists (select 1 from public.whatsapp_consent where user_id = p_booking.requested_by and bookings_off_at is not null) then
    return;
  end if;
  select v.name, f.name,
         (select count(*) from public.venue_fields vf where vf.venue_id = v.id and vf.is_active) > 1
    into v_venue, v_field, v_several
    from public.venues v join public.venue_fields f on f.id = p_booking.field_id
   where v.id = p_booking.venue_id;
  -- A newer event replaces what was still waiting for the same booking.
  update public.outbound_messages set status = 'skipped', error = 'superseded', updated_at = now()
   where booking_id = p_booking.id and status = 'queued';
  insert into public.outbound_messages (user_id, phone, kind, booking_id, payload, dedupe_key)
  values (p_booking.requested_by, v_phone, 'booking', p_booking.id,
          jsonb_build_object(
            'event', p_event,
            'booking_id', p_booking.id,
            'venue_name', v_venue,
            'field_name', case when v_several then v_field end,
            'starts_at', p_booking.starts_at,
            'ends_at', p_booking.ends_at,
            'price_total', p_booking.price_total,
            'currency', p_booking.currency,
            'deposit_amount', p_booking.deposit_amount,
            'deposit_status', p_booking.deposit_status,
            'by_customer', p_booking.cancelled_by is not distinct from p_booking.requested_by),
          'booking:' || p_booking.id || ':' || p_event
            || case when p_event = 'changed' then ':' || extract(epoch from p_booking.starts_at)::bigint || ':' || p_booking.field_id else '' end)
  on conflict (dedupe_key) do nothing;
end $$;

create or replace function private.wa_booking_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_event text;
begin
  if new.kind <> 'customer' or new.requested_by is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'confirmed' then v_event := 'confirmed'; end if;
  elsif new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    v_event := 'confirmed';
  elsif new.status = 'cancelled' and old.status = 'confirmed' then
    v_event := 'cancelled';
  elsif new.status = 'confirmed' and old.status = 'confirmed'
        and (new.starts_at, new.ends_at, new.field_id) is distinct from (old.starts_at, old.ends_at, old.field_id) then
    v_event := 'changed';
  end if;
  if v_event is not null then
    begin
      perform private.wa_booking_message(new, v_event);
    exception when others then
      -- The booking stands; only the WhatsApp copy of the notice is lost.
      raise warning 'whatsapp booking message not queued: %', sqlstate;
    end;
  end if;
  return null;
end $$;

drop trigger if exists bookings_whatsapp on public.bookings;
create trigger bookings_whatsapp after insert or update of status, starts_at, ends_at, field_id on public.bookings
  for each row execute function private.wa_booking_event();

-- ---------------------------------------------------------------------------
-- 3b. Promotions (admins only).
-- ---------------------------------------------------------------------------
create or replace function private.wa_promo_audience(p_city_id uuid)
returns table (user_id uuid, phone text, city_id uuid)
language sql stable security definer set search_path = '' as $$
  select p.id, ph.phone, p.city_id
    from public.whatsapp_consent c
    join public.profiles p on p.id = c.user_id and p.status <> 'suspended'
    join private.user_phones ph on ph.user_id = c.user_id
   where c.opted_in_at is not null and c.opted_out_at is null
     and (p_city_id is null or p.city_id = p_city_id);
$$;

-- How many promotional messages may still be handed out today (Baghdad's
-- day): the limit starts at promo_daily_start on the first day one is sent and
-- grows by promo_daily_step a day, up to promo_daily_max.
create or replace function private.wa_promo_allowance()
returns int language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Baghdad')::date;
  v_first date;
  v_cap int;
begin
  select (min(sent_at) at time zone 'Asia/Baghdad')::date into v_first
    from public.outbound_messages where kind = 'promo' and sent_at is not null;
  v_cap := least(private.setting_int('whatsapp.promo_daily_max', 150),
                 private.setting_int('whatsapp.promo_daily_start', 20)
                 + private.setting_int('whatsapp.promo_daily_step', 10) * greatest(coalesce(v_today - v_first, 0), 0));
  return greatest(v_cap - (select count(*)::int from public.outbound_messages
                            where kind = 'promo' and first_handed_at >= (v_today::timestamp at time zone 'Asia/Baghdad')), 0);
end $$;

create or replace function public.admin_whatsapp_audience()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return (select jsonb_build_object('total', coalesce(sum(x.n), 0),
                                    'by_city', coalesce(jsonb_object_agg(x.city_id::text, x.n) filter (where x.city_id is not null), '{}'::jsonb))
            from (select a.city_id, count(*) as n from private.wa_promo_audience(null) a group by a.city_id) x);
end $$;

create or replace function public.admin_start_promo_campaign(p_body text, p_city_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
  v_count int;
begin
  if char_length(v_body) not between 5 and 1000 then
    raise exception 'invalid_message' using errcode = '22023';
  end if;
  if p_city_id is not null and not exists (select 1 from public.cities where id = p_city_id) then
    raise exception 'invalid_city' using errcode = '22023';
  end if;
  -- One campaign at a time, so the daily limit isn't split.
  perform pg_advisory_xact_lock(hashtextextended('wa_campaign', 0));
  if exists (select 1 from public.whatsapp_campaigns where status = 'sending') then
    raise exception 'campaign_in_progress' using errcode = 'P0001';
  end if;
  insert into public.whatsapp_campaigns (body, city_id, created_by) values (v_body, p_city_id, v_uid) returning id into v_id;
  insert into public.outbound_messages (user_id, phone, kind, campaign_id)
  select a.user_id, a.phone, 'promo', v_id from private.wa_promo_audience(p_city_id) a;
  get diagnostics v_count = row_count;
  update public.whatsapp_campaigns
     set recipients = v_count,
         status = case when v_count = 0 then 'done' else 'sending' end::public.campaign_status,
         finished_at = case when v_count = 0 then now() end
   where id = v_id;
  perform private.audit('whatsapp_campaign_started', 'whatsapp_campaign', v_id::text,
    jsonb_build_object('recipients', v_count, 'city_id', p_city_id, 'characters', char_length(v_body)));
  return jsonb_build_object('campaign_id', v_id, 'recipients', v_count);
end $$;

-- Stops a campaign: what still waits in the site is skipped at once; the
-- returned ids are already with the bot, which the server asks to drop.
create or replace function public.admin_stop_promo_campaign(p_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_skipped int;
  v_in_flight uuid[];
begin
  update public.whatsapp_campaigns set status = 'stopped', stopped_by = v_uid, stopped_at = now()
   where id = p_campaign_id and status = 'sending';
  if not found then
    raise exception 'campaign_not_active' using errcode = 'P0001';
  end if;
  update public.outbound_messages set status = 'skipped', error = 'campaign_stopped', updated_at = now()
   where campaign_id = p_campaign_id and status = 'queued';
  get diagnostics v_skipped = row_count;
  select coalesce(array_agg(id), '{}') into v_in_flight
    from public.outbound_messages where campaign_id = p_campaign_id and status = 'sending';
  perform private.audit('whatsapp_campaign_stopped', 'whatsapp_campaign', p_campaign_id::text,
    jsonb_build_object('skipped', v_skipped, 'with_bot', cardinality(v_in_flight)));
  return jsonb_build_object('skipped', v_skipped, 'in_flight', to_jsonb(v_in_flight));
end $$;

drop function if exists public.admin_whatsapp_campaigns(int);
create function public.admin_whatsapp_campaigns(p_limit int default 20)
returns table (id uuid, body text, city_id uuid, status public.campaign_status, recipients int, created_by_name text,
               created_at timestamptz, stopped_at timestamptz, finished_at timestamptz,
               queued int, sending int, sent int, failed int, skipped int)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform private.require_admin();
  return query
    select c.id, c.body, c.city_id, c.status, c.recipients, p.display_name, c.created_at, c.stopped_at, c.finished_at,
           (count(m.id) filter (where m.status = 'queued'))::int,
           (count(m.id) filter (where m.status = 'sending'))::int,
           (count(m.id) filter (where m.status = 'sent'))::int,
           (count(m.id) filter (where m.status = 'failed'))::int,
           (count(m.id) filter (where m.status = 'skipped'))::int
      from public.whatsapp_campaigns c
      left join public.profiles p on p.id = c.created_by
      left join public.outbound_messages m on m.campaign_id = c.id
     group by c.id, p.display_name
     order by c.created_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 100);
end $$;

create or replace function public.admin_whatsapp_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_day timestamptz := ((now() at time zone 'Asia/Baghdad')::date)::timestamp at time zone 'Asia/Baghdad';
begin
  perform private.require_admin();
  return jsonb_build_object(
    'booking_messages', private.setting_bool('whatsapp.booking_messages', false),
    'promo_left_today', private.wa_promo_allowance(),
    'sent_today', (select count(*)::int from public.outbound_messages where sent_at >= v_day),
    'failed_today', (select count(*)::int from public.outbound_messages where status = 'failed' and updated_at >= v_day),
    'queued', (select count(*)::int from public.outbound_messages where status = 'queued'),
    'sending', (select count(*)::int from public.outbound_messages where status = 'sending'),
    'opted_in', (select count(*)::int from private.wa_promo_audience(null)));
end $$;

-- ---------------------------------------------------------------------------
-- 3c. The worker (/api/cron): claim due messages, hand them to the bot,
--     record what the bot reports.
-- ---------------------------------------------------------------------------

-- Messages that must not go out any more are skipped, with the reason.
create or replace function private.wa_skip_ineligible()
returns void language sql security definer set search_path = '' as $$
  with reasons as (
    select m.id,
           case
             when not exists (select 1 from private.user_phones p where p.user_id = m.user_id and p.phone = m.phone) then 'no_phone'
             when m.kind = 'booking' and exists (select 1 from public.whatsapp_consent c
                                                  where c.user_id = m.user_id and c.bookings_off_at is not null) then 'opted_out'
             when m.kind = 'promo' and not exists (select 1 from public.whatsapp_consent c
                                                    where c.user_id = m.user_id and c.opted_in_at is not null and c.opted_out_at is null) then 'opted_out'
             when m.kind = 'promo' and exists (select 1 from public.whatsapp_campaigns c
                                                where c.id = m.campaign_id and c.status <> 'sending') then 'campaign_stopped'
             when m.kind = 'promo' and exists (select 1 from public.profiles p where p.id = m.user_id and p.status = 'suspended') then 'account_suspended'
             -- A booking notice is only useful before the booking starts, and soon after the event.
             when m.kind = 'booking' and (m.created_at < now() - interval '1 day'
                                          or (m.payload ->> 'starts_at')::timestamptz <= now()) then 'stale'
           end as reason
      from public.outbound_messages m
     where m.status = 'queued'
  )
  update public.outbound_messages m set status = 'skipped', error = r.reason, updated_at = now()
    from reasons r
   where r.id = m.id and r.reason is not null;
$$;

create or replace function private.wa_finish_campaigns()
returns void language sql security definer set search_path = '' as $$
  update public.whatsapp_campaigns c set status = 'done', finished_at = now()
   where c.status = 'sending'
     and not exists (select 1 from public.outbound_messages m where m.campaign_id = c.id and m.status in ('queued', 'sending'));
$$;

-- Claims the next messages and marks them as handed to the bot: booking
-- messages first, then promotions within today's allowance.
drop function if exists public.wa_outbox_claim(int);
create function public.wa_outbox_claim(p_limit int default null)
returns table (id uuid, kind public.outbound_kind, phone text, body text, payload jsonb,
               recipient_name text, campaign_body text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, private.setting_int('whatsapp.batch_size', 10)), 1), 100);
  v_max int := greatest(private.setting_int('whatsapp.max_attempts', 3), 1);
  v_ids uuid[];
  v_more uuid[];
  v_room int;
begin
  -- Two runs at once never hand the same message twice nor overshoot today's limit.
  perform pg_advisory_xact_lock(hashtextextended('wa_outbox_claim', 0));

  -- Handed over hours ago and never reported: the bot lost them (for
  -- example a restart without its volume). Hand them again, within the attempts.
  update public.outbound_messages m
     set status = case when m.attempts >= v_max then 'failed' else 'queued' end::public.outbound_status,
         error = case when m.attempts >= v_max then 'no_report' else m.error end,
         handed_at = null, updated_at = now()
   where m.status = 'sending' and m.handed_at < now() - interval '6 hours';

  perform private.wa_skip_ineligible();
  perform private.wa_finish_campaigns();

  select coalesce(array_agg(x.id), '{}') into v_ids from (
    select m.id from public.outbound_messages m
     where m.status = 'queued' and m.kind = 'booking' and m.next_attempt_at <= now()
     order by m.created_at
     limit v_limit
     for update skip locked) x;

  v_room := least(v_limit - cardinality(v_ids), private.wa_promo_allowance());
  if v_room > 0 then
    select coalesce(array_agg(x.id), '{}') into v_more from (
      select m.id from public.outbound_messages m
       where m.status = 'queued' and m.kind = 'promo' and m.next_attempt_at <= now()
       order by m.created_at
       limit v_room
       for update skip locked) x;
    v_ids := v_ids || v_more;
  end if;

  return query
    with claimed as (
      update public.outbound_messages m
         set status = 'sending', attempts = m.attempts + 1, handed_at = now(),
             first_handed_at = coalesce(m.first_handed_at, now()), updated_at = now()
       where m.id = any(v_ids)
       returning m.id, m.kind, m.phone, m.body, m.payload, m.user_id, m.campaign_id, m.created_at
    )
    select c.id, c.kind, c.phone, c.body, c.payload, p.display_name, w.body
      from claimed c
      left join public.profiles p on p.id = c.user_id
      left join public.whatsapp_campaigns w on w.id = c.campaign_id
     order by c.kind, c.created_at;
end $$;

-- What happened when the worker handed each message to the bot:
--   accepted: the bot queued it (it reports the outcome later);
--   later:    not attempted (bot unreachable, paused or full), no attempt used;
--   retry:    attempted and failed for now; failed: will never work.
create or replace function public.wa_outbox_handed(p_results jsonb)
returns void language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_max int := greatest(private.setting_int('whatsapp.max_attempts', 3), 1);
  r record;
begin
  for r in select * from jsonb_to_recordset(coalesce(p_results, '[]'::jsonb)) as x(id uuid, outcome text, body text, error text)
  loop
    update public.outbound_messages m set
      body = coalesce(left(r.body, 2000), m.body),
      status = case
                 when r.outcome = 'accepted' then 'sending'
                 when r.outcome = 'later' then 'queued'
                 when r.outcome = 'retry' and m.attempts < v_max then 'queued'
                 else 'failed'
               end::public.outbound_status,
      attempts = case when r.outcome = 'later' then greatest(m.attempts - 1, 0) else m.attempts end,
      first_handed_at = case when r.outcome = 'later' and m.attempts <= 1 then null else m.first_handed_at end,
      handed_at = case when r.outcome = 'accepted' then m.handed_at end,
      next_attempt_at = case
                          when r.outcome = 'later' then now() + interval '10 minutes'
                          when r.outcome = 'retry' then now() + interval '5 minutes' * power(2, greatest(m.attempts - 1, 0))
                          else m.next_attempt_at
                        end,
      error = case when r.outcome in ('retry', 'failed') then left(coalesce(r.error, 'send_failed'), 200) else m.error end,
      updated_at = now()
    where m.id = r.id and m.status = 'sending' and r.outcome in ('accepted', 'later', 'retry', 'failed');
  end loop;
  perform private.wa_finish_campaigns();
end $$;

-- Messages with the bot, oldest first, to ask it how they went.
create or replace function public.wa_outbox_in_flight(p_limit int default 200)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select id from public.outbound_messages where status = 'sending'
   order by handed_at limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

-- What the bot reports for messages it was handed: sent, failed, dropped
-- (cancelled with a campaign, or the person replied "stop"), or unknown to it
-- (lost; handed again within the attempts).
create or replace function public.wa_outbox_delivered(p_results jsonb)
returns void language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_max int := greatest(private.setting_int('whatsapp.max_attempts', 3), 1);
  r record;
begin
  for r in select * from jsonb_to_recordset(coalesce(p_results, '[]'::jsonb)) as x(id uuid, state text, error text, at timestamptz)
  loop
    update public.outbound_messages m set
      status = case
                 when r.state = 'sent' then 'sent'
                 when r.state in ('cancelled', 'opted_out') then 'skipped'
                 when r.state in ('failed', 'unknown') and m.attempts < v_max
                      and coalesce(r.error, '') not in ('not_on_whatsapp', 'invalid_number') then 'queued'
                 else 'failed'
               end::public.outbound_status,
      sent_at = case when r.state = 'sent' then least(coalesce(r.at, now()), now()) else m.sent_at end,
      error = case
                when r.state = 'sent' then null
                when r.state = 'opted_out' then 'opted_out'
                when r.state = 'cancelled' then left(coalesce(r.error, 'cancelled'), 200)
                when r.state = 'unknown' then 'lost'
                else left(coalesce(r.error, 'send_failed'), 200)
              end,
      handed_at = case when r.state in ('failed', 'unknown') then null else m.handed_at end,
      next_attempt_at = case when r.state in ('failed', 'unknown')
                             then now() + interval '5 minutes' * power(2, greatest(m.attempts - 1, 0))
                             else m.next_attempt_at end,
      updated_at = now()
    where m.id = r.id and m.status = 'sending' and r.state in ('sent', 'failed', 'cancelled', 'opted_out', 'unknown')
      -- "Unknown" right after a handover only means the handover is still under way (another run).
      and (r.state <> 'unknown' or m.handed_at < now() - interval '2 minutes');
  end loop;
  perform private.wa_finish_campaigns();
end $$;

-- Old message rows go after 90 days (campaign totals stay on the campaign).
create or replace function public.wa_outbox_cleanup()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_rows int;
begin
  delete from public.outbound_messages
   where created_at < now() - interval '90 days' and status in ('sent', 'failed', 'skipped');
  get diagnostics v_rows = row_count;
  return jsonb_build_object('deleted_whatsapp_messages', v_rows);
end $$;

-- ---------------------------------------------------------------------------
-- Grants: the bot and worker functions for the server only; the settings
-- function for signed-in people; the admin functions check the role inside.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.wa_bot_receive(text, text),
  public.wa_bot_unsubscribe(text),
  public.wa_signup_consent(uuid, boolean),
  public.wa_outbox_claim(int),
  public.wa_outbox_handed(jsonb),
  public.wa_outbox_in_flight(int),
  public.wa_outbox_delivered(jsonb),
  public.wa_outbox_cleanup()
from public, anon, authenticated;
grant execute on function
  public.wa_bot_receive(text, text),
  public.wa_bot_unsubscribe(text),
  public.wa_signup_consent(uuid, boolean),
  public.wa_outbox_claim(int),
  public.wa_outbox_handed(jsonb),
  public.wa_outbox_in_flight(int),
  public.wa_outbox_delivered(jsonb),
  public.wa_outbox_cleanup()
to service_role;

revoke execute on function
  public.set_my_whatsapp_settings(boolean, boolean),
  public.admin_whatsapp_audience(),
  public.admin_start_promo_campaign(text, uuid),
  public.admin_stop_promo_campaign(uuid),
  public.admin_whatsapp_campaigns(int),
  public.admin_whatsapp_summary()
from public, anon;
grant execute on function
  public.set_my_whatsapp_settings(boolean, boolean),
  public.admin_whatsapp_audience(),
  public.admin_start_promo_campaign(text, uuid),
  public.admin_stop_promo_campaign(uuid),
  public.admin_whatsapp_campaigns(int),
  public.admin_whatsapp_summary()
to authenticated;

revoke execute on function
  private.setting_bool(text, boolean),
  private.wa_booking_message(public.bookings, text),
  private.wa_booking_event(),
  private.wa_promo_audience(uuid),
  private.wa_promo_allowance(),
  private.wa_skip_ineligible(),
  private.wa_finish_campaigns()
from public, anon, authenticated;
