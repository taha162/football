-- =============================================================================
-- Open pages check for news every 90 seconds instead of 30.
--
-- Every check re-renders the page on the server (a session check and about a
-- dozen database requests). With tens of thousands of members online, every 30
-- seconds is thousands of page loads a second while people only look. News for
-- the person still arrives at once (notifications over Realtime; messages where
-- they are shown), so the check is only for changes nobody is told about (another
-- player joining a match, a time being booked...). Pages also spread their checks
-- by ±10% (src/components/layout/live-refresh.tsx).
--
-- Only a setting still at its old default (30) moves: a value an administrator
-- chose stays. Changes no other data. Safe to run twice.
-- =============================================================================

update public.platform_settings
   set value = '90',
       description = 'How often open pages check for news, in seconds (15 to 300; 90 by default). Raise it if the database gets busy as the platform grows.'
 where key = 'live.check_seconds' and value = '30';

insert into public.platform_settings (key, value, description, is_public) values
  ('live.check_seconds', '90', 'How often open pages check for news, in seconds (15 to 300; 90 by default). Raise it if the database gets busy as the platform grows.', true)
on conflict (key) do nothing;
