-- =============================================================================
-- Reads that stay fast as the platform grows (performance audit, 6 Nov).
--
-- Measured on national-size local data (2,449 venues, 10,877 matches, 20,689
-- bookings, 100,876 messages), with each query's plan (EXPLAIN ANALYZE) before
-- and after. Nothing here changes who can see what, or any result: only how
-- the database finds it.
--
-- 1. Access rules (RLS) that check the role once per query, not per row.
--    16 read policies called private.is_moderator()/is_admin() for every row,
--    some after a per-row function (bookings: is_venue_staff(venue_id) for all
--    20,689 rows before sorting): the admin bookings list took ~600 ms. Each
--    policy now compares the person's own rows first, then the role check
--    wrapped in (select ...) (evaluated once, as an InitPlan), then any per-row
--    function. Same conditions, same results.
-- 2. Indexes in the order the lists are read, ending with id so pages are
--    stable. The API computes each row's embedded data (city, area, courts,
--    members) before sorting unless an index already gives the order; with one,
--    it reads the first page and stops. Write cost: one more btree per table,
--    on columns that never change after insert (or rarely: a venue's name or
--    verification), so updates stay HOT-eligible.
-- 3. Match search planned for each call: it now runs its same query through
--    EXECUTE ... USING, so filters left empty drop out and the default order
--    (start time) follows the upcoming-matches index and stops after a page.
--    Results identical (compared on 8 kinds of search); 47.9 -> 0.7 ms for
--    "any city", 13.4 -> 0.6 ms for one city.
-- 4. private.distance_km can be inlined (no SET clause on this pure-arithmetic,
--    invoker function), so "near me" no longer calls a function twice per
--    match: 113 -> 10.5 ms with coordinates on 2,000 venues. Same values.
--
-- Safe to run twice. Takes a brief lock on each table while its index is
-- built (milliseconds at today's sizes).
-- =============================================================================

-- 1. Access rules ------------------------------------------------------------

drop policy if exists areas_read on public.areas;
create policy areas_read on public.areas for select
  using (is_active or (select private.is_admin()));

drop policy if exists cities_read on public.cities;
create policy cities_read on public.cities for select
  using (is_active or (select private.is_admin()));

drop policy if exists settings_read on public.platform_settings;
create policy settings_read on public.platform_settings for select
  using (is_public or (select private.is_admin()));

drop policy if exists audit_read_admin on public.audit_logs;
create policy audit_read_admin on public.audit_logs for select
  using ((select private.is_admin()));

drop policy if exists roles_read on public.user_roles;
create policy roles_read on public.user_roles for select
  using (user_id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists bookings_read on public.bookings;
create policy bookings_read on public.bookings for select
  using (requested_by = (select auth.uid()) or (select private.is_moderator()) or private.is_venue_staff(venue_id));

drop policy if exists venue_staff_read on public.venue_staff;
create policy venue_staff_read on public.venue_staff for select
  using (user_id = (select auth.uid()) or (select private.is_moderator()) or private.is_venue_staff(venue_id));

drop policy if exists reports_read on public.reports;
create policy reports_read on public.reports for select
  using (reporter_id = (select auth.uid()) or (select private.is_moderator()));

drop policy if exists reviews_read on public.reviews;
create policy reviews_read on public.reviews for select
  using ((status = 'published' and venue_id is not null)
         or reviewer_id = (select auth.uid())
         or subject_user_id = (select auth.uid())
         or (select private.is_moderator()));

drop policy if exists match_invitations_read on public.match_invitations;
create policy match_invitations_read on public.match_invitations for select
  using (invitee_id = (select auth.uid()) or (select private.is_moderator())
         or private.is_match_organizer(match_id, (select auth.uid())));

drop policy if exists match_waitlist_read on public.match_waitlist;
create policy match_waitlist_read on public.match_waitlist for select
  using (user_id = (select auth.uid()) or (select private.is_moderator())
         or private.is_match_organizer(match_id, (select auth.uid())));

drop policy if exists team_invitations_read on public.team_invitations;
create policy team_invitations_read on public.team_invitations for select
  using (invitee_id = (select auth.uid()) or (select private.is_moderator()) or private.is_team_manager(team_id));

drop policy if exists team_join_requests_read on public.team_join_requests;
create policy team_join_requests_read on public.team_join_requests for select
  using (user_id = (select auth.uid()) or (select private.is_moderator()) or private.is_team_manager(team_id));

drop policy if exists match_participants_read on public.match_participants;
create policy match_participants_read on public.match_participants for select
  using (user_id = (select auth.uid())
         or (select private.is_moderator())
         or ((select auth.uid()) is not null
             and private.can_view_match(match_id)
             and (exists (select 1 from public.matches m
                          where m.id = match_participants.match_id and m.status not in ('completed', 'cancelled'))
                  or exists (select 1 from public.profiles pr
                             where pr.id = match_participants.user_id and pr.show_match_history)
                  or private.is_match_organizer(match_id, (select auth.uid()))
                  or private.is_confirmed_participant(match_id, (select auth.uid())))));

drop policy if exists message_images_read on storage.objects;
create policy message_images_read on storage.objects for select to authenticated
  using (bucket_id = 'message-images'
         and ((select private.is_moderator())
              or private.can_access_conversation(private.try_uuid((storage.foldername(name))[1]))));

drop policy if exists message_voice_read on storage.objects;
create policy message_voice_read on storage.objects for select to authenticated
  using (bucket_id = 'message-voice'
         and ((select private.is_moderator())
              or private.can_access_conversation(private.try_uuid((storage.foldername(name))[1]))));

-- 2. Indexes in the lists' order ----------------------------------------------

-- Venues list: verified first, then by name (src/server/venues/queries.ts).
create index if not exists venues_listing_idx on public.venues (verification_status desc, name, id) where not is_hidden;
-- Teams list: newest first (src/server/teams/queries.ts).
create index if not exists teams_listing_idx on public.teams (created_at desc, id desc)
  where not is_archived and not is_hidden and visibility = 'public';
-- Administration: latest bookings and latest matches.
create index if not exists bookings_created_idx on public.bookings (created_at desc, id desc);
create index if not exists matches_created_idx on public.matches (created_at desc, id desc);

-- 3. Match search, planned per call ------------------------------------------

CREATE OR REPLACE FUNCTION public.search_matches(p_city_id uuid DEFAULT NULL::uuid, p_area_id uuid DEFAULT NULL::uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_time_from time without time zone DEFAULT NULL::time without time zone, p_time_to time without time zone DEFAULT NULL::time without time zone, p_format match_format DEFAULT NULL::match_format, p_skill_level skill_level DEFAULT NULL::skill_level, p_max_price bigint DEFAULT NULL::bigint, p_position player_position DEFAULT NULL::player_position, p_min_open_slots integer DEFAULT NULL::integer, p_booking_confirmed boolean DEFAULT NULL::boolean, p_join_policy match_join_policy DEFAULT NULL::match_join_policy, p_include_full boolean DEFAULT true, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_radius_km numeric DEFAULT NULL::numeric, p_sort text DEFAULT 'time'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_query text DEFAULT NULL::text)
 RETURNS SETOF matches
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  -- Planned for each call with its own values: filters left empty drop out, and the
  -- default order (start time) can follow the upcoming-matches index and stop early.
  return query execute $q$
select m.* from public.matches m
  join public.cities c on c.id = m.city_id
  left join public.venues v on v.id = m.venue_id
  left join public.areas a on a.id = m.area_id
  where m.status in ('open', 'full', 'confirmed')
    and not m.is_hidden
    and m.visibility = 'public'
    and m.starts_at > now()
    and ($1 is null or m.city_id = $1)
    and ($2 is null or m.area_id = $2)
    and ($3 is null or (m.starts_at at time zone c.timezone)::date >= $3)
    and ($4 is null or (m.starts_at at time zone c.timezone)::date <= $4)
    and ($5 is null or (m.starts_at at time zone c.timezone)::time >= $5)
    and ($6 is null or (m.starts_at at time zone c.timezone)::time <= $6)
    and ($7 is null or m.format = $7)
    and ($8 is null or m.skill_level is null or m.skill_level = $8)
    and ($9 is null or m.price_per_player <= $9)
    and ($10 is null or m.positions_needed = '{}'::jsonb or m.positions_needed ? $10::text)
    and ($11 is null or m.total_players - m.reserved_spots - m.confirmed_count >= $11)
    and ($14 or m.total_players - m.reserved_spots - m.confirmed_count > 0)
    and ($12 is null or (m.booking_status = 'confirmed') = $12)
    and ($13 is null or m.join_policy = $13)
    and ($21 is null or m.title ilike '%' || replace(replace(replace(left($21, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%'
         or v.name ilike '%' || replace(replace(replace(left($21, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%')
    and ($17 is null or $15 is null or $16 is null or
         private.distance_km($15, $16, coalesce(v.latitude, a.latitude), coalesce(v.longitude, a.longitude)) <= $17)
  order by
    case when $18 = 'relevance' then (m.total_players - m.reserved_spots - m.confirmed_count > 0) end desc nulls last,
    case when $18 = 'distance' then
      private.distance_km($15, $16, coalesce(v.latitude, a.latitude), coalesce(v.longitude, a.longitude)) end asc nulls last,
    m.starts_at asc, m.id
  limit least(greatest(coalesce($19, 20), 1), 100) offset greatest(coalesce($20, 0), 0)
  $q$ using p_city_id, p_area_id, p_date_from, p_date_to, p_time_from, p_time_to, p_format, p_skill_level, p_max_price, p_position, p_min_open_slots, p_booking_confirmed, p_join_policy, p_include_full, p_lat, p_lng, p_radius_km, p_sort, p_limit, p_offset, p_query;
end
$function$;

-- 4. Distance that the planner can inline ------------------------------------

create or replace function private.distance_km(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns double precision language sql immutable as $$
  -- Pure arithmetic on built-in functions, run with the caller's rights: no SET
  -- clause, so it is inlined into the query instead of called once per row.
  select case when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null else
    6371.0 * 2 * asin(sqrt(
      power(sin(radians((lat2 - lat1)::double precision) / 2), 2) +
      cos(radians(lat1::double precision)) * cos(radians(lat2::double precision)) *
      power(sin(radians((lng2 - lng1)::double precision) / 2), 2)))
  end;
$$;
alter function private.distance_km(numeric, numeric, numeric, numeric) reset all;

-- 5. Stable pages in the admin users list -----------------------------------

-- Same list; people who joined in the same instant keep one order, so paging
-- (limit/offset) never repeats or skips anyone.
CREATE OR REPLACE FUNCTION public.admin_list_users(p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, display_name text, email text, phone text, status account_status, roles app_role[], created_at timestamp with time zone, last_sign_in_at timestamp with time zone, city_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- Digits of the search, without a leading 0, so "0770 123 4567" finds 9647701234567.
  v_digits text := ltrim(regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g'), '0');
begin
  perform private.require_admin();
  return query
    select p.id, p.display_name, u.email::text, ph.phone, p.status,
           coalesce(array(select r.role from public.user_roles r where r.user_id = p.id), '{}'),
           p.created_at, u.last_sign_in_at, p.city_id
      from public.profiles p
      join auth.users u on u.id = p.id
      left join private.user_phones ph on ph.user_id = p.id
     where p_search is null
        or p.display_name ilike '%' || p_search || '%'
        or u.email ilike '%' || p_search || '%'
        or (length(v_digits) >= 4 and ph.phone like '%' || v_digits || '%')
     order by p.created_at desc, p.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $function$;
