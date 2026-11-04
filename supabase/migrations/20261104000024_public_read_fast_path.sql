-- =============================================================================
-- Public listings that stay fast as the country fills them.
--
-- The read policies on matches, teams, tournaments, venues, courts and opening
-- hours each called a security-definer function per row (can_view_match()…),
-- which looks the row up again; such functions can't be inlined. A list
-- sorted by time (the home page, the matches page) checks every upcoming row
-- before it can return the first page: with 10,586 matches a guest's matches
-- page took ~500 ms in the database alone.
--
-- Each policy now tests the plain public condition first, inline (the same
-- condition each function starts with), and calls the function only for rows
-- that aren't public (private matches, hidden venues…): who can see what is
-- unchanged. Upcoming matches across all cities get an index by start time,
-- so the first page stops after a dozen rows.
--
-- Safe to run twice.
-- =============================================================================

drop policy if exists matches_read on public.matches;
create policy matches_read on public.matches for select
  using ((visibility = 'public' and status <> 'draft' and not is_hidden) or private.can_view_match(id));

drop policy if exists teams_read on public.teams;
create policy teams_read on public.teams for select
  using ((visibility = 'public' and not is_hidden) or private.can_view_team(id));

drop policy if exists tournaments_read on public.tournaments;
create policy tournaments_read on public.tournaments for select
  using ((status <> 'draft' and not is_hidden) or private.can_view_tournament(id));

drop policy if exists venues_read on public.venues;
create policy venues_read on public.venues for select
  using (not is_hidden or private.can_view_venue(id));

drop policy if exists venue_fields_read on public.venue_fields;
create policy venue_fields_read on public.venue_fields for select
  using (exists (select 1 from public.venues v where v.id = venue_id and not v.is_hidden) or private.can_view_venue(venue_id));

drop policy if exists venue_hours_read on public.venue_opening_hours;
create policy venue_hours_read on public.venue_opening_hours for select
  using (exists (select 1 from public.venues v where v.id = venue_id and not v.is_hidden) or private.can_view_venue(venue_id));

create index if not exists matches_upcoming_idx on public.matches (starts_at)
  where status in ('open', 'full', 'confirmed') and not is_hidden;
