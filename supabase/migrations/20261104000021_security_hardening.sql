-- =============================================================================
-- Security hardening before the nationwide launch.
--
-- 1. Sign-in, sign-up, password-reset and e-mail-code attempts are counted per
--    device (IP address) and per account, and refused past a limit. The site
--    calls Supabase Auth from its own server, so Supabase sees the server's
--    address for every visitor: its per-address limits can't tell an attacker
--    from everyone else. The counts live here, keyed by a keyed hash computed
--    on the server (never the raw address or e-mail), and each limit is a
--    platform setting admins can change (Administration > Settings).
-- 2. Three booking-deposit functions could be called without signing in. They
--    refused at once, but anonymous callers shouldn't reach them at all.
--
-- Safe to run twice (SQL Editor or `supabase db push`).
-- =============================================================================

-- 1. Attempts, by hashed key.
create table if not exists private.auth_attempts (
  key text not null check (char_length(key) between 8 and 200),
  created_at timestamptz not null default now()
);
create index if not exists auth_attempts_key_idx on private.auth_attempts (key, created_at);

insert into public.platform_settings (key, value, description, is_public) values
  ('auth.signin_failures_per_device', '50', 'Failed sign-ins (and wrong e-mail codes) allowed from one device (IP address) in 15 minutes. Mobile networks share addresses, so keep it generous.', false),
  ('auth.signin_failures_per_account', '10', 'Failed sign-ins allowed on one account in 15 minutes.', false),
  ('auth.signups_per_device', '20', 'Sign-ups allowed from one device (IP address) in an hour.', false),
  ('auth.resets_per_device', '10', 'Password-reset e-mails allowed from one device (IP address) in an hour.', false),
  ('auth.resets_per_account', '5', 'Password-reset e-mails allowed for one account in an hour.', false),
  ('auth.code_failures_per_account', '10', 'Wrong e-mail codes allowed for one account in 15 minutes.', false),
  ('auth.code_resends_per_account', '5', 'E-mail code resends allowed for one account in an hour.', false)
on conflict (key) do nothing;

-- Whether every bucket still allows an attempt; with p_record, one attempt is
-- also counted against each. A bucket: {"key", "setting", "default", "window"}
-- (window in seconds; the limit is the setting, or the default without one).
-- Only the site's server calls it, with its service key.
create or replace function public.auth_throttle(p_buckets jsonb, p_record boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  b jsonb;
  v_count int;
begin
  if jsonb_typeof(p_buckets) <> 'array' or jsonb_array_length(p_buckets) > 4 then
    raise exception 'invalid_buckets' using errcode = '22023';
  end if;
  for b in select value from jsonb_array_elements(p_buckets) order by value->>'key' loop
    -- Serialize per key so a burst of parallel attempts can't all slip under the limit.
    perform pg_advisory_xact_lock(hashtextextended('auth:' || (b->>'key'), 0));
    select count(*) into v_count from private.auth_attempts
     where key = b->>'key' and created_at > now() - make_interval(secs => greatest(coalesce((b->>'window')::int, 900), 1));
    if v_count >= private.setting_int(b->>'setting', coalesce((b->>'default')::int, 10)) then
      return false;
    end if;
  end loop;
  if p_record then
    insert into private.auth_attempts (key) select value->>'key' from jsonb_array_elements(p_buckets);
  end if;
  -- Now and then, forget attempts older than a day.
  if random() < 0.02 then
    delete from private.auth_attempts where created_at < now() - interval '1 day';
  end if;
  return true;
end $$;

revoke execute on function public.auth_throttle(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.auth_throttle(jsonb, boolean) to service_role;

-- 2. Signed-in callers only.
revoke execute on function public.report_booking_deposit(uuid, text), public.mark_deposit_refunded(uuid),
  public.set_venue_deposit_instructions(uuid, text) from public, anon;
grant execute on function public.report_booking_deposit(uuid, text), public.mark_deposit_refunded(uuid),
  public.set_venue_deposit_instructions(uuid, text) to authenticated;
