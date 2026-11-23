-- =============================================================================
-- An index behind every foreign key that had none.
--
-- PostgreSQL doesn't index foreign keys by itself. Without an index, deleting
-- the row a key points at means reading the whole table that points at it. The
-- clearest case is deleting a member (Administration): their profile is
-- referenced from 59 places, among them messages.sender_id and six columns of
-- bookings, and each was a full read of its table. Measured on the local copy:
-- 12 ms for 135,000 messages and 3-5 ms per bookings column for 22,000 bookings,
-- about 0.5 s and 1 s each at 5 million rows, all while holding the rows. The
-- same indexes serve lookups by these columns (a member's join requests, a
-- match's reviews, the matches of a booking or a series...).
--
-- Columns that are often empty (who cancelled, who decided...) get a partial
-- index that leaves the empty rows out, so it stays small. References to the
-- currency table get none: currencies are never deleted.
--
-- Changes no data. Safe to run twice. On very large tables, build them first
-- with CREATE INDEX CONCURRENTLY, one statement at a time (DEPLOYMENT.md).
-- =============================================================================

create index if not exists audit_logs_actor_id_fk_idx on public.audit_logs (actor_id) where actor_id is not null;
create index if not exists bookings_cancelled_by_fk_idx on public.bookings (cancelled_by) where cancelled_by is not null;
create index if not exists bookings_created_by_fk_idx on public.bookings (created_by) where created_by is not null;
create index if not exists bookings_decided_by_fk_idx on public.bookings (decided_by) where decided_by is not null;
create index if not exists bookings_deposit_received_by_fk_idx on public.bookings (deposit_received_by) where deposit_received_by is not null;
create index if not exists bookings_deposit_refunded_by_fk_idx on public.bookings (deposit_refunded_by) where deposit_refunded_by is not null;
create index if not exists bookings_match_id_fk_idx on public.bookings (match_id) where match_id is not null;
create index if not exists call_signals_sender_id_fk_idx on public.call_signals (sender_id);
create index if not exists calls_conversation_id_fk_idx on public.calls (conversation_id);
create index if not exists conversation_reads_user_id_fk_idx on public.conversation_reads (user_id);
create index if not exists match_events_recorded_by_fk_idx on public.match_events (recorded_by) where recorded_by is not null;
create index if not exists match_invitations_invited_by_fk_idx on public.match_invitations (invited_by) where invited_by is not null;
create index if not exists match_participants_payment_marked_by_fk_idx on public.match_participants (payment_marked_by) where payment_marked_by is not null;
create index if not exists match_results_confirmed_by_fk_idx on public.match_results (confirmed_by) where confirmed_by is not null;
create index if not exists match_results_reported_by_fk_idx on public.match_results (reported_by) where reported_by is not null;
create index if not exists match_series_organizer_id_fk_idx on public.match_series (organizer_id);
create index if not exists matches_area_id_fk_idx on public.matches (area_id) where area_id is not null;
create index if not exists matches_booking_id_fk_idx on public.matches (booking_id) where booking_id is not null;
create index if not exists matches_cancelled_by_fk_idx on public.matches (cancelled_by) where cancelled_by is not null;
create index if not exists matches_field_id_fk_idx on public.matches (field_id) where field_id is not null;
create index if not exists matches_series_id_fk_idx on public.matches (series_id) where series_id is not null;
create index if not exists messages_sender_id_fk_idx on public.messages (sender_id) where sender_id is not null;
create index if not exists opponent_challenges_created_by_fk_idx on public.opponent_challenges (created_by) where created_by is not null;
create index if not exists opponent_challenges_match_id_fk_idx on public.opponent_challenges (match_id) where match_id is not null;
create index if not exists opponent_challenges_responded_by_fk_idx on public.opponent_challenges (responded_by) where responded_by is not null;
create index if not exists opponent_challenges_venue_id_fk_idx on public.opponent_challenges (venue_id) where venue_id is not null;
create index if not exists opponent_requests_created_by_fk_idx on public.opponent_requests (created_by) where created_by is not null;
create index if not exists opponent_requests_match_id_fk_idx on public.opponent_requests (match_id) where match_id is not null;
create index if not exists opponent_requests_venue_id_fk_idx on public.opponent_requests (venue_id) where venue_id is not null;
create index if not exists phone_verifications_user_id_fk_idx on public.phone_verifications (user_id) where user_id is not null;
create index if not exists platform_settings_updated_by_fk_idx on public.platform_settings (updated_by) where updated_by is not null;
create index if not exists profiles_area_id_fk_idx on public.profiles (area_id) where area_id is not null;
create index if not exists reports_handled_by_fk_idx on public.reports (handled_by) where handled_by is not null;
create index if not exists reviews_booking_id_fk_idx on public.reviews (booking_id) where booking_id is not null;
create index if not exists reviews_match_id_fk_idx on public.reviews (match_id) where match_id is not null;
create index if not exists team_invitations_invited_by_fk_idx on public.team_invitations (invited_by) where invited_by is not null;
create index if not exists team_join_requests_decided_by_fk_idx on public.team_join_requests (decided_by) where decided_by is not null;
create index if not exists team_join_requests_recruitment_id_fk_idx on public.team_join_requests (recruitment_id) where recruitment_id is not null;
create index if not exists team_join_requests_user_id_fk_idx on public.team_join_requests (user_id);
create index if not exists team_recruitment_created_by_fk_idx on public.team_recruitment (created_by) where created_by is not null;
create index if not exists teams_area_id_fk_idx on public.teams (area_id) where area_id is not null;
create index if not exists teams_created_by_fk_idx on public.teams (created_by) where created_by is not null;
create index if not exists teams_home_venue_id_fk_idx on public.teams (home_venue_id) where home_venue_id is not null;
create index if not exists tournament_announcements_author_id_fk_idx on public.tournament_announcements (author_id) where author_id is not null;
create index if not exists tournament_matches_away_team_id_fk_idx on public.tournament_matches (away_team_id) where away_team_id is not null;
create index if not exists tournament_matches_confirmed_by_fk_idx on public.tournament_matches (confirmed_by) where confirmed_by is not null;
create index if not exists tournament_matches_home_team_id_fk_idx on public.tournament_matches (home_team_id) where home_team_id is not null;
create index if not exists tournament_matches_next_match_id_fk_idx on public.tournament_matches (next_match_id) where next_match_id is not null;
create index if not exists tournament_matches_submitted_by_fk_idx on public.tournament_matches (submitted_by) where submitted_by is not null;
create index if not exists tournament_matches_winner_team_id_fk_idx on public.tournament_matches (winner_team_id) where winner_team_id is not null;
create index if not exists tournament_teams_registered_by_fk_idx on public.tournament_teams (registered_by) where registered_by is not null;
create index if not exists tournaments_venue_id_fk_idx on public.tournaments (venue_id) where venue_id is not null;
create index if not exists user_roles_granted_by_fk_idx on public.user_roles (granted_by) where granted_by is not null;
create index if not exists venue_staff_added_by_fk_idx on public.venue_staff (added_by) where added_by is not null;
create index if not exists venues_area_id_fk_idx on public.venues (area_id) where area_id is not null;
create index if not exists venues_created_by_fk_idx on public.venues (created_by) where created_by is not null;
create index if not exists whatsapp_campaigns_city_id_fk_idx on public.whatsapp_campaigns (city_id) where city_id is not null;
create index if not exists whatsapp_campaigns_created_by_fk_idx on public.whatsapp_campaigns (created_by) where created_by is not null;
create index if not exists whatsapp_campaigns_stopped_by_fk_idx on public.whatsapp_campaigns (stopped_by) where stopped_by is not null;
