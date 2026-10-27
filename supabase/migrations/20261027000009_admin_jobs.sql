-- =============================================================================
-- Administration, moderation and scheduled maintenance jobs.
-- Every administrative action is authorized here (never by UI visibility) and
-- recorded in audit_logs.
-- =============================================================================

create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'users_suspended', (select count(*) from public.profiles where status = 'suspended'),
    'users_new_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'matches_upcoming', (select count(*) from public.matches where status in ('open', 'full', 'confirmed') and starts_at > now()),
    'matches_completed_30d', (select count(*) from public.matches where status = 'completed' and starts_at > now() - interval '30 days'),
    'matches_cancelled_30d', (select count(*) from public.matches where status = 'cancelled' and starts_at > now() - interval '30 days'),
    'participations_30d', (select count(*) from public.match_participants where status = 'confirmed' and joined_at > now() - interval '30 days'),
    'teams', (select count(*) from public.teams where not is_archived),
    'venues', (select count(*) from public.venues),
    'venues_pending_verification', (select count(*) from public.venues where verification_status = 'pending'),
    'bookings_pending', (select count(*) from public.bookings where status = 'requested'),
    'bookings_confirmed_30d', (select count(*) from public.bookings where status in ('confirmed', 'completed') and created_at > now() - interval '30 days'),
    'tournaments_active', (select count(*) from public.tournaments where status in ('registration_open', 'registration_closed', 'in_progress')),
    'reports_open', (select count(*) from public.reports where status in ('open', 'in_review'))
  );
end $$;

-- Admin user directory, including e-mail (admins only).
create or replace function public.admin_list_users(p_search text default null, p_limit int default 50, p_offset int default 0)
returns table (id uuid, display_name text, email text, status public.account_status, roles public.app_role[],
               created_at timestamptz, last_sign_in_at timestamptz, city_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return query
    select p.id, p.display_name, u.email::text, p.status,
           coalesce(array(select r.role from public.user_roles r where r.user_id = p.id), '{}'),
           p.created_at, u.last_sign_in_at, p.city_id
      from public.profiles p join auth.users u on u.id = p.id
     where p_search is null or p.display_name ilike '%' || p_search || '%' or u.email ilike '%' || p_search || '%'
     order by p.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

create or replace function public.admin_set_user_status(p_user_id uuid, p_status public.account_status, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_moderator();
begin
  if p_user_id = v_uid then
    raise exception 'cannot_moderate_self' using errcode = '42501';
  end if;
  if exists (select 1 from public.user_roles where user_id = p_user_id and role = 'admin') and not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status = 'suspended' and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  update public.profiles set status = p_status,
         suspended_at = case when p_status = 'suspended' then now() end,
         suspension_reason = case when p_status = 'suspended' then btrim(p_reason) end
   where id = p_user_id;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  perform private.audit(case when p_status = 'suspended' then 'user.suspended' else 'user.restored' end,
    'user', p_user_id::text, jsonb_build_object('reason', p_reason));
  perform private.notify(p_user_id, 'account_notice', jsonb_build_object('status', p_status));
end $$;

create or replace function public.admin_set_role(p_user_id uuid, p_role public.app_role, p_grant boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_admin();
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if p_grant then
    insert into public.user_roles (user_id, role, granted_by) values (p_user_id, p_role, v_uid) on conflict do nothing;
  else
    if p_role = 'admin' and p_user_id = v_uid then
      raise exception 'cannot_revoke_own_admin' using errcode = '42501';
    end if;
    delete from public.user_roles where user_id = p_user_id and role = p_role;
  end if;
  perform private.audit(case when p_grant then 'role.granted' else 'role.revoked' end, 'user', p_user_id::text,
    jsonb_build_object('role', p_role));
end $$;

create or replace function public.admin_set_hidden(p_entity_type text, p_entity_id uuid, p_hidden boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_moderator();
  v_owner uuid;
  v_name text;
begin
  if p_hidden and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  case p_entity_type
    when 'match' then
      update public.matches set is_hidden = p_hidden, hidden_reason = case when p_hidden then p_reason end
       where id = p_entity_id returning organizer_id, title into v_owner, v_name;
    when 'team' then
      update public.teams set is_hidden = p_hidden, hidden_reason = case when p_hidden then p_reason end
       where id = p_entity_id returning created_by, name into v_owner, v_name;
    when 'venue' then
      update public.venues set is_hidden = p_hidden, hidden_reason = case when p_hidden then p_reason end
       where id = p_entity_id returning created_by, name into v_owner, v_name;
    when 'tournament' then
      update public.tournaments set is_hidden = p_hidden, hidden_reason = case when p_hidden then p_reason end
       where id = p_entity_id returning organizer_id, name into v_owner, v_name;
    when 'review' then
      update public.reviews set status = case when p_hidden then 'hidden' else 'published' end::public.review_status,
             hidden_reason = case when p_hidden then p_reason end
       where id = p_entity_id returning reviewer_id into v_owner;
    else
      raise exception 'invalid_entity_type' using errcode = '22023';
  end case;
  if not found then
    raise exception 'entity_not_found' using errcode = 'P0002';
  end if;
  -- Notify the current responsible person rather than the original creator.
  if p_entity_type = 'team' then
    v_owner := coalesce((select user_id from public.team_members where team_id = p_entity_id and role = 'captain'), v_owner);
  elsif p_entity_type = 'venue' then
    v_owner := coalesce((select user_id from public.venue_staff where venue_id = p_entity_id and role = 'owner'), v_owner);
  end if;
  perform private.audit(case when p_hidden then 'moderation.hidden' else 'moderation.unhidden' end, p_entity_type,
    p_entity_id::text, jsonb_build_object('reason', p_reason));
  if v_owner is not null then
    perform private.notify(v_owner, 'moderation_notice',
      jsonb_build_object('entity_type', p_entity_type, 'entity_id', p_entity_id, 'name', v_name, 'hidden', p_hidden));
  end if;
end $$;

create or replace function public.admin_set_venue_verification(p_venue_id uuid, p_status public.verification_status, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_moderator();
  v_name text;
begin
  update public.venues set verification_status = p_status, verification_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_venue_id returning name into v_name;
  if not found then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  -- Unverified venues cannot take platform bookings.
  if p_status <> 'verified' then
    update public.venues set booking_mode = 'contact_only' where id = p_venue_id;
  end if;
  perform private.audit('venue.verification_set', 'venue', p_venue_id::text, jsonb_build_object('status', p_status, 'note', p_note));
  perform private.notify_venue_staff(p_venue_id, 'venue_verification',
    jsonb_build_object('venue_id', p_venue_id, 'venue_name', v_name, 'status', p_status));
end $$;

create or replace function public.admin_update_report(p_report_id uuid, p_status public.report_status, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_moderator();
begin
  update public.reports set status = p_status, resolution_note = nullif(btrim(coalesce(p_note, '')), ''),
         handled_by = v_uid, handled_at = now()
   where id = p_report_id;
  if not found then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;
  perform private.audit('report.updated', 'report', p_report_id::text, jsonb_build_object('status', p_status));
end $$;

create or replace function public.admin_update_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_old jsonb;
begin
  select value into v_old from public.platform_settings where key = p_key;
  if not found then
    raise exception 'setting_not_found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(v_old) <> jsonb_typeof(p_value) then
    raise exception 'invalid_setting_value' using errcode = '22023';
  end if;
  update public.platform_settings set value = p_value, updated_by = v_uid, updated_at = now() where key = p_key;
  perform private.audit('setting.updated', 'setting', p_key, jsonb_build_object('from', v_old, 'to', p_value));
end $$;

create or replace function public.admin_upsert_city(
  p_id uuid, p_slug text, p_name_en text, p_name_ar text, p_country_code text, p_timezone text, p_currency text,
  p_latitude numeric default null, p_longitude numeric default null, p_is_active boolean default true
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_id uuid;
begin
  if p_id is null then
    insert into public.cities (slug, name_en, name_ar, country_code, timezone, currency, latitude, longitude, is_active)
    values (p_slug, p_name_en, p_name_ar, upper(p_country_code), p_timezone, upper(p_currency), p_latitude, p_longitude, p_is_active)
    returning id into v_id;
  else
    update public.cities set slug = p_slug, name_en = p_name_en, name_ar = p_name_ar, country_code = upper(p_country_code),
      timezone = p_timezone, currency = upper(p_currency), latitude = p_latitude, longitude = p_longitude, is_active = p_is_active
    where id = p_id returning id into v_id;
  end if;
  perform private.audit('city.upserted', 'city', v_id::text);
  return v_id;
exception when check_violation or foreign_key_violation or unique_violation then
  raise exception 'invalid_city' using errcode = '22023';
end $$;

create or replace function public.admin_upsert_area(
  p_id uuid, p_city_id uuid, p_slug text, p_name_en text, p_name_ar text,
  p_latitude numeric default null, p_longitude numeric default null, p_is_active boolean default true
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_id uuid;
begin
  if p_id is null then
    insert into public.areas (city_id, slug, name_en, name_ar, latitude, longitude, is_active)
    values (p_city_id, p_slug, p_name_en, p_name_ar, p_latitude, p_longitude, p_is_active) returning id into v_id;
  else
    update public.areas set slug = p_slug, name_en = p_name_en, name_ar = p_name_ar, latitude = p_latitude,
      longitude = p_longitude, is_active = p_is_active
    where id = p_id returning id into v_id;
  end if;
  perform private.audit('area.upserted', 'area', v_id::text);
  return v_id;
exception when check_violation or foreign_key_violation or unique_violation then
  raise exception 'invalid_area' using errcode = '22023';
end $$;

-- ---------------------------------------------------------------------------
-- Scheduled maintenance (called by a trusted cron caller with service_role).
-- Idempotent: safe to run repeatedly; notifications are deduplicated.
-- ---------------------------------------------------------------------------
create or replace function public.run_scheduled_jobs()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_expired_bookings int := 0;
  v_reminders int := 0;
  v_completed int := 0;
  v_closed int := 0;
  v_count int;
begin
  -- 1. Booking requests nobody decided on.
  for r in update public.bookings set status = 'expired', expires_at = null
           where status = 'requested' and expires_at <= now()
           returning id, requested_by, venue_id, starts_at loop
    perform private.notify(r.requested_by, 'booking_expired',
      jsonb_build_object('booking_id', r.id, 'venue_id', r.venue_id, 'starts_at', r.starts_at,
                         'venue_name', (select name from public.venues where id = r.venue_id)),
      'booking_decision:' || r.id);
    v_expired_bookings := v_expired_bookings + 1;
  end loop;

  -- 2. Confirmed bookings not marked by the venue within a day of ending.
  update public.bookings set status = 'completed'
   where status = 'confirmed' and kind <> 'block' and ends_at < now() - interval '1 day';

  -- 3. Expired listings.
  update public.team_recruitment set status = 'closed', closed_at = now() where status = 'open' and expires_at <= now();
  get diagnostics v_count = row_count; v_closed := v_closed + v_count;
  update public.opponent_requests set status = 'closed' where status = 'open' and latest_start <= now();
  get diagnostics v_count = row_count; v_closed := v_closed + v_count;
  update public.opponent_challenges set status = 'expired', responded_at = now()
   where status = 'pending' and proposed_starts_at <= now();
  update public.match_invitations i set status = 'expired', responded_at = now()
    from public.matches m where m.id = i.match_id and i.status = 'pending' and m.starts_at <= now();
  update public.team_invitations set status = 'expired', responded_at = now()
   where status = 'pending' and created_at < now() - interval '30 days';

  -- 4. Reminders for matches starting within 24 hours.
  for r in select p.user_id, m.id as match_id, m.title, m.starts_at from public.matches m
             join public.match_participants p on p.match_id = m.id and p.status = 'confirmed'
            where m.status in ('open', 'full', 'confirmed') and m.starts_at between now() and now() + interval '24 hours' loop
    perform private.notify(r.user_id, 'match_reminder',
      jsonb_build_object('match_id', r.match_id, 'match_title', r.title, 'starts_at', r.starts_at),
      'match_reminder:' || r.match_id);
    v_reminders := v_reminders + 1;
  end loop;

  -- 5. Auto-complete matches well past their end time.
  for r in select id from public.matches
            where status in ('open', 'full', 'confirmed', 'in_progress')
              and ends_at < now() - make_interval(hours => private.setting_int('match.auto_complete_after_hours', 3))
            for update skip locked loop
    update public.matches set status = 'completed', completed_at = now() where id = r.id;
    update public.match_participants set status = 'rejected' where match_id = r.id and status = 'pending';
    update public.match_waitlist set status = 'expired', resolved_at = now() where match_id = r.id and status = 'waiting';
    perform private.recount_match(r.id);
    v_completed := v_completed + 1;
  end loop;
  -- Drafts that never got published.
  update public.matches set status = 'cancelled', cancelled_at = now(), cancelled_reason = 'draft_expired'
   where status = 'draft' and starts_at < now();

  -- 6. Tournament registration deadlines.
  update public.tournaments set status = 'registration_closed'
   where status = 'registration_open' and registration_deadline <= now();

  -- 7. Housekeeping.
  delete from private.rate_events where created_at < now() - interval '2 days';

  return jsonb_build_object('expired_bookings', v_expired_bookings, 'reminders', v_reminders,
                            'completed_matches', v_completed, 'closed_listings', v_closed);
end $$;
