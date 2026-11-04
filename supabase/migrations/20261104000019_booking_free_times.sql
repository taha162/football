-- =============================================================================
-- Which times a customer can book, and why a time can't be.
--
-- The booking page listed the day's busy times and answered a chosen time with
-- "this time is booked" and nothing more. A time is also taken by a request
-- waiting for its deposit (held for an hour, then until the venue checks a
-- deposit the customer says they sent), by the customer's own booking, and by
-- the minutes a venue keeps between two bookings, and none of that was said:
-- the customer saw a free-looking time turned down.
--
-- 1. free_start_times: the start times of a day, every 30 minutes, that can be
--    booked for a duration, checked by the same rules as a booking request.
-- 2. quote_booking also says what a taken time runs into: the customer's own
--    booking, a request waiting for its deposit, the venue's gap between
--    bookings, a time the venue closed, or another booking.
--
-- Nothing is stored; no data changes. Safe to run twice (SQL Editor or
-- `supabase db push`).
-- =============================================================================

-- 1. The day's free start times.
create or replace function public.free_start_times(p_field_id uuid, p_local_date date, p_duration_minutes int)
returns table (start_local text, starts_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_field public.venue_fields%rowtype;
  v_venue public.venues%rowtype;
  v_tz text;
  v_step int;
  v_starts timestamptz;
  v_ends timestamptz;
begin
  -- The same refusals a quote gives for the field, the venue and the duration.
  select * into v_field from public.venue_fields where id = p_field_id;
  if not found or not v_field.is_active then
    raise exception 'field_not_found' using errcode = 'P0002';
  end if;
  select * into v_venue from public.venues where id = v_field.venue_id;
  if v_venue.is_hidden then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 30 or p_duration_minutes > 360 or p_duration_minutes % 30 <> 0 then
    raise exception 'invalid_duration' using errcode = '22023';
  end if;
  v_tz := private.venue_timezone(v_venue.id);
  -- Every 30 minutes of the calendar day, as the booking form steps.
  for v_step in 0..47 loop
    v_starts := (p_local_date + make_interval(mins => v_step * 30)) at time zone v_tz;
    v_ends := v_starts + make_interval(mins => p_duration_minutes);
    -- As private.validate_booking_slot (with the notice rules) and private.slot_is_free.
    continue when v_starts <= now()
               or v_starts < now() + make_interval(mins => v_venue.min_notice_minutes)
               or v_starts > now() + make_interval(days => v_venue.max_advance_days);
    continue when not private.within_opening_hours(v_venue.id, v_starts, v_ends);
    continue when not private.slot_is_free(p_field_id, v_starts, v_ends + make_interval(mins => v_venue.buffer_minutes));
    start_local := to_char(v_starts at time zone v_tz, 'HH24:MI');
    starts_at := v_starts;
    return next;
  end loop;
end $$;

grant execute on function public.free_start_times(uuid, date, int) to anon, authenticated;

-- 2. A quote says what a taken time runs into. "available" is unchanged.
--    conflict: mine   - the customer's own booking or held request
--              held   - another customer's request waiting for its deposit
--              closed - the venue closed this time
--              booked - another booking
--              gap    - no booking at that time, but too close to one for the
--                       minutes the venue keeps between bookings
create or replace function public.quote_booking(p_field_id uuid, p_start_local timestamp, p_duration_minutes int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v record;
  v_uid uuid := auth.uid();
  v_available boolean;
  v_gap int;
  v_hit record;
  v_conflict text;
  v_held_until timestamptz;
begin
  select * into v from private.validate_booking_slot(p_field_id, p_start_local, p_duration_minutes, true);
  v_available := private.slot_is_free(p_field_id, v.starts_at, v.occupied_until);
  select buffer_minutes into v_gap from public.venues where id = v.venue_id;
  if not v_available then
    -- The same bookings slot_is_free counts; the closest reason first.
    select b.id, b.kind, b.status, b.deposit_status, b.expires_at,
           coalesce(b.requested_by = v_uid, false) as mine,
           tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(v.starts_at, v.ends_at, '[)') as overlaps
      into v_hit
      from public.bookings b
     where b.field_id = p_field_id
       and (b.status in ('confirmed', 'completed', 'no_show')
            or (b.status = 'requested' and b.deposit_status is not null and b.expires_at > now()))
       and tstzrange(b.starts_at, b.occupied_until, '[)') && tstzrange(v.starts_at, v.occupied_until, '[)')
     order by coalesce(b.requested_by = v_uid, false) desc,
              (tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(v.starts_at, v.ends_at, '[)')) desc,
              b.starts_at
     limit 1;
    if found then
      v_conflict := case
        when v_hit.mine then 'mine'
        when not v_hit.overlaps then 'gap'
        when v_hit.status = 'requested' then 'held'
        when v_hit.kind = 'block' then 'closed'
        else 'booked' end;
      -- Until when another customer's request holds the time, while it waits for the deposit itself.
      if v_conflict = 'held' and v_hit.deposit_status = 'pending' then
        v_held_until := v_hit.expires_at;
      end if;
    end if;
  end if;
  return jsonb_build_object(
    'starts_at', v.starts_at, 'ends_at', v.ends_at, 'price_total', v.price, 'currency', v.currency,
    'available', v_available,
    'conflict', v_conflict,
    'held_until', v_held_until,
    'gap_minutes', v_gap,
    'deposit_amount', nullif(private.deposit_for(v.price), 0),
    'deposit_hold_minutes', private.setting_int('booking.deposit_hold_minutes', 60));
end $$;
