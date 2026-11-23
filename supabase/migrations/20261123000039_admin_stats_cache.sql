-- =============================================================================
-- The administration overview's numbers, worked out at most every 5 minutes.
--
-- admin_stats() counted fourteen things across the largest tables (members,
-- matches, players in matches, bookings...) every time an administrator opened
-- the overview. At millions of rows those counts take seconds. The result is
-- now kept for 5 minutes (private.admin_stats_cache, one row) and returned as is
-- within that time, with the moment it was worked out (computed_at). The numbers
-- themselves are counted exactly as before.
--
-- Changes no data. Safe to run twice.
-- =============================================================================

create table if not exists private.admin_stats_cache (
  id int primary key default 1 check (id = 1),
  computed_at timestamptz not null,
  data jsonb not null
);
revoke all on private.admin_stats_cache from public;

create or replace function public.admin_stats()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v jsonb;
  v_at timestamptz;
begin
  perform private.require_moderator();
  select c.data, c.computed_at into v, v_at from private.admin_stats_cache c where c.id = 1;
  if v is not null and v_at > now() - interval '5 minutes' then
    return v || jsonb_build_object('computed_at', v_at);
  end if;
  v := jsonb_build_object(
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
  insert into private.admin_stats_cache (id, computed_at, data) values (1, now(), v)
  on conflict (id) do update set computed_at = excluded.computed_at, data = excluded.data;
  return v || jsonb_build_object('computed_at', now());
end $$;
revoke all on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated, service_role;
