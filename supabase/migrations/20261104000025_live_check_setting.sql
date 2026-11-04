-- =============================================================================
-- How often open pages check for news (seconds), for administrators to tune.
--
-- Every open, in-use page re-fetches itself this often (news for the person
-- arrives at once anyway, over Realtime). Each check is a page load on the
-- server and the database: with 1,000 people active, every 30 seconds means
-- ~33 page loads a second. If the database gets busy as the platform grows,
-- raise it here (Administration > Settings); 15 to 300 seconds.
--
-- Safe to run twice.
-- =============================================================================

insert into public.platform_settings (key, value, description, is_public) values
  ('live.check_seconds', '30', 'How often open pages check for news, in seconds (15 to 300). Raise it if the database gets busy as the platform grows.', true)
on conflict (key) do nothing;
