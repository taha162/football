-- =============================================================================
-- Adding or changing one's phone number and e-mail, step 2 of 2 (0047; run
-- 0046 first, on its own).
--
-- Phone: a signed-in member types the number (after their password, checked
-- by the site) and sends the code from that number's WhatsApp, as at sign-up.
-- When the bot receives it:
-- - the number is another account's: 'phone_taken', nothing changes;
-- - otherwise it becomes this account's number (private.user_phones, and the
--   number Supabase shows): signing in with it works at once, and the old
--   number, if any, is free for others.
-- E-mail: Supabase Auth sends the code and makes the change; the site then
-- records it with account_changed().
-- Either way the member gets a notification that can't be switched off (in
-- case it wasn't them), and the change goes in the audit log.
--
-- Changes no existing data. Safe to run twice.
-- =============================================================================

-- Security notices are always sent (as in 0032, with the two new ones).
create or replace function private.is_mandatory_notification(p_type text)
returns boolean language sql immutable set search_path = '' as $$
  select p_type in ('match_cancelled', 'match_updated', 'waitlist_promoted', 'booking_confirmed',
                    'booking_rejected', 'booking_cancelled', 'participant_removed', 'account_notice',
                    'security_alert', 'phone_changed', 'email_changed');
$$;

-- ---------------------------------------------------------------------------
-- Starting a verification (as in 0029), now also for a new number of an
-- existing account. Called by the site's server only, with the member it
-- checked.
-- ---------------------------------------------------------------------------
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
  elsif p_purpose = 'phone_change' then
    -- An existing, active account, and the number it wants (typed, so the code counts only from it).
    if p_user_id is null or v_phone is null
       or not exists (select 1 from auth.users u join public.profiles p on p.id = u.id
                       where u.id = p_user_id and u.email_confirmed_at is not null and p.status = 'active') then
      raise exception 'invalid_user' using errcode = '22023';
    end if;
    if exists (select 1 from private.user_phones where phone = v_phone and user_id = p_user_id) then
      raise exception 'same_phone' using errcode = '22023';
    end if;
    if exists (select 1 from private.user_phones where phone = v_phone and user_id <> p_user_id) then
      raise exception 'phone_taken' using errcode = 'P0001';
    end if;
  elsif p_user_id is not null then
    raise exception 'invalid_user' using errcode = '22023';
  end if;
  insert into public.phone_verifications (purpose, code, ticket_hash, user_id, client_ref, claimed_phone)
  values (p_purpose, upper(p_code), p_ticket_hash, p_user_id, v_ref, v_phone)
  returning expires_at into v_expires;
  return v_expires;
end $$;

-- ---------------------------------------------------------------------------
-- The bot received a code (as in 0029), with the new number of an existing
-- account as one more case.
-- ---------------------------------------------------------------------------
create or replace function public.wa_bot_receive(p_phone text, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_codes text[] := private.wa_codes(p_body);
  v_key uuid;
  v_row public.phone_verifications%rowtype;
  v_owner uuid;
  v_had_phone boolean;
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

  -- A new number for an existing account: it becomes the account's number, unless another account has it.
  if v_row.purpose = 'phone_change' then
    select user_id into v_owner from private.user_phones where phone = v_phone;
    if v_owner is not null and v_owner <> v_row.user_id then
      update public.phone_verifications set status = 'phone_taken', phone = v_phone, verified_at = now() where id = v_row.id;
      return jsonb_build_object('matched', true, 'purpose', 'phone_change', 'status', 'phone_taken');
    end if;
    v_had_phone := exists (select 1 from private.user_phones where user_id = v_row.user_id);
    insert into private.user_phones (user_id, phone) values (v_row.user_id, v_phone)
      on conflict (user_id) do update set phone = excluded.phone, verified_at = now();
    update auth.users
       set phone = case when exists (select 1 from auth.users o where o.phone = v_phone and o.id <> v_row.user_id) then phone else v_phone end,
           phone_confirmed_at = now()
     where id = v_row.user_id;
    update public.phone_verifications set status = 'verified', phone = v_phone, verified_at = now() where id = v_row.id;
    perform private.notify(v_row.user_id, 'phone_changed', jsonb_build_object('phone_end', right(v_phone, 4)));
    perform private.audit('account.phone_changed', 'user', v_row.user_id::text, jsonb_build_object('had_phone', v_had_phone));
    return jsonb_build_object('matched', true, 'purpose', 'phone_change', 'status', 'verified');
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
-- E-mail: Supabase Auth made the change; the site's server records it.
-- ---------------------------------------------------------------------------
create or replace function public.account_email_changed(p_user_id uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_at int := position('@' in coalesce(p_email, ''));
begin
  if p_user_id is null or v_at < 2 then
    raise exception 'invalid' using errcode = '22023';
  end if;
  -- The address, partly hidden: «a•••@gmail.com».
  perform private.notify(p_user_id, 'email_changed',
    jsonb_build_object('email_hint', left(p_email, 1) || '•••' || substr(p_email, v_at)));
  perform private.audit('account.email_changed', 'user', p_user_id::text, '{}'::jsonb);
end $$;

revoke all on function public.phone_verify_start(public.phone_verify_purpose, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.phone_verify_start(public.phone_verify_purpose, text, text, uuid, text, text) to service_role;
revoke all on function public.wa_bot_receive(text, text) from public, anon, authenticated;
grant execute on function public.wa_bot_receive(text, text) to service_role;
revoke all on function public.account_email_changed(uuid, text) from public, anon, authenticated;
grant execute on function public.account_email_changed(uuid, text) to service_role;
