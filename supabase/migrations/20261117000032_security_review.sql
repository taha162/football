-- =============================================================================
-- Security review, 17 November 2026 (SECURITY_REVIEW.md). Changes nobody's
-- data, and running it twice does no harm.
--
-- 1. Five wrong passwords, or five wrong codes, on one account within 15
--    minutes, and it waits: the defaults go from 10 to 5. A value an admin
--    already changed in Admin → Settings is left as it is.
--
-- 2. Profiles: the suspension reason and time were readable by anyone through
--    the API (the anon key is public by design). Visitors and members now read
--    every column but those two. A column added to profiles later must be
--    granted here too, or it stays hidden.
--
-- 3. public.security_event(): the site's server records security events in the
--    audit log (Admin → Audit): a changed password, and an account or device
--    stopped after repeated wrong passwords or codes. For the latter it also
--    alerts every admin in the site's notifications, at most once an hour for
--    the same account. Server only (service role); the alert can't be muted.
-- =============================================================================

-- 1. Lockout after 5.
update public.platform_settings
   set value = '5'::jsonb,
       description = 'Failed sign-ins allowed on one account in 15 minutes; then it waits, and admins are alerted.'
 where key = 'auth.signin_failures_per_account' and value = '10'::jsonb;

update public.platform_settings
   set value = '5'::jsonb,
       description = 'Wrong codes (e-mailed, or from the authenticator app) allowed for one account in 15 minutes; then it waits, and admins are alerted.'
 where key = 'auth.code_failures_per_account' and value = '10'::jsonb;

-- 2. Moderation notes stay with the moderators.
revoke select on public.profiles from anon, authenticated;
grant select (id, display_name, avatar_path, bio, city_id, area_id, positions, skill_level,
              preferred_formats, show_match_history, status, onboarded_at, created_at, updated_at)
  on public.profiles to anon, authenticated;

-- 3. Security events and alerts.
create or replace function private.is_mandatory_notification(p_type text)
returns boolean language sql immutable set search_path = '' as $$
  select p_type in ('match_cancelled', 'match_updated', 'waitlist_promoted', 'booking_confirmed',
                    'booking_rejected', 'booking_cancelled', 'participant_removed', 'account_notice',
                    'security_alert');
$$;

create or replace function public.security_event(
  p_action text,
  p_user uuid default null,
  p_details jsonb default '{}'::jsonb,
  p_alert_key text default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_dedupe text;
  v_admin uuid;
begin
  if p_action not in ('password_changed', 'sign_in_blocked', 'code_blocked') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  if p_details is not null and jsonb_typeof(p_details) <> 'object' then
    raise exception 'invalid_details' using errcode = '22023';
  end if;
  if p_alert_key is not null then
    if char_length(p_alert_key) not between 8 and 200 then
      raise exception 'invalid_key' using errcode = '22023';
    end if;
    -- One alert an hour for the same account (or device): the rest only wait.
    v_dedupe := 'security:' || p_action || ':' || p_alert_key || ':' || to_char(now() at time zone 'UTC', 'YYYYMMDDHH24');
    if exists (select 1 from public.audit_logs
                where created_at > now() - interval '2 hours'
                  and action = p_action and details ->> 'dedupe' = v_dedupe) then
      return false;
    end if;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
  values (p_user, p_action, 'security', coalesce(p_user::text, 'site'),
          coalesce(p_details, '{}'::jsonb)
            || case when v_dedupe is null then '{}'::jsonb else jsonb_build_object('dedupe', v_dedupe) end);

  if v_dedupe is not null then
    for v_admin in select user_id from public.user_roles where role = 'admin' loop
      perform private.notify(v_admin, 'security_alert',
        jsonb_build_object('kind', p_action, 'account', coalesce(p_details ->> 'account', ''),
                           'has_account', coalesce(p_details ->> 'account', '') <> ''),
        v_dedupe);
    end loop;
  end if;
  return true;
end $$;

revoke all on function public.security_event(text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.security_event(text, uuid, jsonb, text) to service_role;

comment on function public.security_event(text, uuid, jsonb, text) is
  'Security events from the site''s server (audit log), with an admin alert at most hourly per account. Service role only. Migration 0032.';
