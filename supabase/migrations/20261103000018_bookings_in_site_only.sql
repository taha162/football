-- =============================================================================
-- Bookings happen in the site only, and each venue's bookings are its own.
--
-- 1. Every venue takes bookings through the site: the "contact only" mode is
--    gone. A venue becomes bookable once verified (and, while deposits are on,
--    once it has written how to pay the deposit), as before.
-- 2. A match at a listed venue is booked through the site too: it can no
--    longer be marked "booked outside the app". That remains for places that
--    aren't listed.
-- 3. A booking is seen by the customer who made it, the venue's own staff,
--    and the platform's admins and moderators. Admins and moderators handle
--    any venue's bookings with the same powers as its staff (confirm or
--    decline, deposits, cancel, outcomes, manual bookings and blocks); the
--    venue's settings (fields, hours, prices, staff, profile) stay its own.
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

-- 3. Who sees and handles bookings.
drop policy if exists bookings_read on public.bookings;
create policy bookings_read on public.bookings for select
  using (requested_by = (select auth.uid()) or private.is_venue_staff(venue_id) or private.is_moderator());

-- The platform's admins and moderators (for the person acting, not the session).
create or replace function private.handles_all_bookings(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = p_user and role in ('admin', 'moderator'));
$$;

-- Owners and managers edit the venue. Handling bookings (p_manage = false):
-- all of the venue's staff, and the platform's admins and moderators.
create or replace function private.require_venue_role(p_venue uuid, p_user uuid, p_manage boolean)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_role public.venue_role;
begin
  if not exists (select 1 from public.venues where id = p_venue) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  v_role := private.venue_role_of(p_venue, p_user);
  if v_role is null and not p_manage and private.handles_all_bookings(p_user) then
    return;
  end if;
  if v_role is null or (p_manage and v_role = 'staff') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

-- Cancelling: the platform's admins and moderators cancel as the venue does
-- (no customer deadline; a deposit that arrived is owed back).
create or replace function public.cancel_booking(p_booking_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(false);
  v_b public.bookings%rowtype;
  v_venue public.venues%rowtype;
  v_is_staff boolean;
  v_deposit public.deposit_status;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  select * into v_venue from public.venues where id = v_b.venue_id;
  v_is_staff := private.venue_role_of(v_b.venue_id, v_uid) is not null
             or (v_b.requested_by is distinct from v_uid and private.handles_all_bookings(v_uid));
  if not v_is_staff and v_b.requested_by is distinct from v_uid then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_b.status not in ('requested', 'confirmed') then
    raise exception 'booking_not_cancellable' using errcode = 'P0001';
  end if;
  if v_b.ends_at <= now() then
    raise exception 'booking_already_ended' using errcode = 'P0001';
  end if;
  -- Customers may cancel a confirmed booking only before the venue's deadline.
  if not v_is_staff and v_b.status = 'confirmed'
     and now() > v_b.starts_at - make_interval(hours => v_venue.cancellation_deadline_hours) then
    raise exception 'cancellation_deadline_passed' using errcode = 'P0001';
  end if;
  update public.bookings set status = 'cancelled', cancelled_by = v_uid, cancelled_at = now(),
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''), expires_at = null,
         deposit_status = case
           when deposit_status in ('reported', 'received')
             then (case when v_is_staff then 'refund_due' else 'forfeited' end)::public.deposit_status
           else deposit_status end
   where id = p_booking_id
   returning deposit_status into v_deposit;
  if v_is_staff and v_b.requested_by is not null and v_b.requested_by <> v_uid then
    perform private.notify(v_b.requested_by,
      case when v_deposit = 'refund_due' then 'booking_cancelled_refund' else 'booking_cancelled' end,
      jsonb_build_object('booking_id', v_b.id, 'venue_id', v_b.venue_id, 'venue_name', v_venue.name,
                         'starts_at', v_b.starts_at, 'by', 'venue'), 'booking_cancelled:' || v_b.id);
  elsif not v_is_staff then
    perform private.notify_venue_staff(v_b.venue_id, 'booking_cancelled',
      jsonb_build_object('booking_id', v_b.id, 'venue_id', v_b.venue_id, 'venue_name', v_venue.name,
                         'starts_at', v_b.starts_at, 'by', 'customer'), 'booking_cancelled:' || v_b.id);
  end if;
  perform private.audit('booking.cancelled', 'booking', v_b.id::text,
                        jsonb_build_object('by_staff', v_is_staff, 'deposit', v_deposit));
end $$;
