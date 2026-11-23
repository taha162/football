-- =============================================================================
-- Name search that uses an index.
--
-- Searching by name (players to invite, teams, venues, matches) used
-- ILIKE '%...%', which no index here could serve: every search read the whole
-- table. Measured on a million names: 189 ms for the first eight, 1.3 s to count
-- them; with a trigram index, about 1 ms. Trigram indexes (pg_trgm) serve
-- ILIKE '%...%' directly, Arabic included (checked: en_US.UTF-8 database).
--
-- - pg_trgm, and a GIN trigram index on profiles.display_name, teams.name,
--   venues.name and matches.title.
-- - The three tsvector indexes on those names are dropped: no query uses them
--   (the site never searched with full-text operators), and each one cost every
--   write.
-- - search_matches: the same filters and results; only its "title or venue name"
--   condition is written so that both halves can use an index.
--
-- Changes no data. Safe to run twice. On very large tables, build the indexes
-- first with CREATE INDEX CONCURRENTLY, one statement at a time (DEPLOYMENT.md).
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- The operator class lives wherever pg_trgm was installed (extensions on Supabase).
do $$
declare
  s text;
begin
  select n.nspname into s from pg_opclass o join pg_namespace n on n.oid = o.opcnamespace
   where o.opcname = 'gin_trgm_ops' limit 1;
  execute format('create index if not exists profiles_display_name_trgm on public.profiles using gin (display_name %I.gin_trgm_ops)', s);
  execute format('create index if not exists teams_name_trgm on public.teams using gin (name %I.gin_trgm_ops)', s);
  execute format('create index if not exists venues_name_trgm on public.venues using gin (name %I.gin_trgm_ops)', s);
  execute format('create index if not exists matches_title_trgm on public.matches using gin (title %I.gin_trgm_ops)', s);
end $$;

drop index if exists public.profiles_display_name_idx;
drop index if exists public.teams_name_idx;
drop index if exists public.venues_name_idx;

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
    -- Title or venue name. Written so that both sides can use an index (trigram
    -- on matches.title, the venue ids found through the trigram index on venues.name).
    and ($21 is null or m.title ilike '%' || replace(replace(replace(left($21, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%'
         or m.venue_id = any (array(
              select vv.id from public.venues vv
               where vv.name ilike '%' || replace(replace(replace(left($21, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%')))
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
