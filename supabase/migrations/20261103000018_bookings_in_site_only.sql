-- =============================================================================
-- Bookings happen in the site only, and each venue's bookings are its own.
--
-- 1. Every venue takes bookings through the site: the "contact only" mode is
--    gone. A venue becomes bookable once verified (and, while deposits are on,
--    once it has written how to pay the deposit), as before.
-- 2. A match at a listed venue is booked through the site too: it can no
--    longer be marked "booked outside the app". That remains for places that
--    aren't listed.
-- 3. A booking is seen only by the customer who made it and the venue's own
--    staff. Platform moderators and admins no longer read bookings.
--
-- Safe to run twice (SQL Editor or `supabase db push`).
-- =============================================================================

-- 1. Every venue books in the site.
alter table public.venues alter column booking_mode set default 'platform';
update public.venues set booking_mode = 'platform' where booking_mode <> 'platform';

-- Whatever a form or an older function asks for, a venue stays bookable in the site.
create or replace function private.venue_books_in_site()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.booking_mode := 'platform';
  return new;
end $$;
drop trigger if exists venues_book_in_site on public.venues;
create trigger venues_book_in_site before insert or update of booking_mode on public.venues
  for each row execute function private.venue_books_in_site();

-- 2. "Booked outside the app" only for a place that isn't a listed venue.
create or replace function private.match_books_listed_venue_in_site()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.venue_id is not null and new.booking_status = 'external' then
    new.booking_status := 'none';
  end if;
  return new;
end $$;
drop trigger if exists matches_book_listed_venue_in_site on public.matches;
create trigger matches_book_listed_venue_in_site before insert or update of venue_id, booking_status on public.matches
  for each row execute function private.match_books_listed_venue_in_site();

-- 3. A booking is the customer's and the venue's.
drop policy if exists bookings_read on public.bookings;
create policy bookings_read on public.bookings for select
  using (requested_by = (select auth.uid()) or private.is_venue_staff(venue_id));
