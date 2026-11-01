-- =============================================================================
-- Booking deposits
--
-- A customer booking is confirmed once the venue has received a deposit
-- (`booking.deposit_amount`, 5,000 IQD; never more than the booking itself).
-- The customer pays the venue directly, by wallet transfer or in cash as the
-- venue's instructions say. The platform never touches the money: it records
-- what each side reports.
--
--   pending    the request holds its slot for `booking.deposit_hold_minutes`
--              (60) while the customer sends the deposit;
--   reported   the customer says it is sent, with a reference; the slot stays
--              held until the venue checks, at most until kickoff;
--   received   venue staff confirmed it, and the booking is confirmed;
--   forfeited  the customer cancelled: the venue keeps the deposit;
--   refund_due the venue cancelled, or never checked a reported deposit before
--              kickoff: the venue owes it back;
--   refunded   venue staff recorded the refund.
--
-- An amount of 0 turns deposits off and requests behave as before.
-- =============================================================================

create type public.deposit_status as enum ('pending', 'reported', 'received', 'refund_due', 'refunded', 'forfeited');

-- How customers pay this venue's deposits (wallet numbers, cash at the desk…).
alter table public.venues
  add column deposit_instructions text check (char_length(deposit_instructions) <= 500);

alter table public.bookings
  add column deposit_amount bigint check (deposit_amount > 0),
  add column deposit_status public.deposit_status,
  add column deposit_reference text check (char_length(deposit_reference) <= 120),
  add column deposit_reported_at timestamptz,
  add column deposit_received_at timestamptz,
  add column deposit_received_by uuid references public.profiles(id) on delete set null,
  add column deposit_refunded_at timestamptz,
  add column deposit_refunded_by uuid references public.profiles(id) on delete set null,
  add constraint bookings_deposit_both check ((deposit_amount is null) = (deposit_status is null));

-- A request waiting for its deposit holds its slot like a confirmed booking,
-- so two customers can never pay for the same time.
alter table public.bookings drop constraint bookings_no_overlap;
alter table public.bookings add constraint bookings_no_overlap exclude using gist (
  field_id with =,
  tstzrange(starts_at, occupied_until, '[)') with &&
) where (status in ('confirmed', 'completed', 'no_show') or (status = 'requested' and deposit_status is not null));
create index bookings_refund_due_idx on public.bookings(venue_id) where deposit_status = 'refund_due';

insert into public.platform_settings (key, value, description) values
  ('booking.deposit_amount', '5000', 'Deposit a customer pays the venue to confirm a booking, in the venue''s currency (never more than the booking). 0 turns deposits off'),
  ('booking.deposit_hold_minutes', '60', 'Minutes a new booking holds its slot while the customer sends the deposit')
on conflict (key) do nothing;

create or replace function private.deposit_for(p_price bigint)
returns bigint language sql stable security definer set search_path = '' as $$
  select least(greatest(private.setting_int('booking.deposit_amount', 5000), 0)::bigint, greatest(p_price, 0));
$$;

-- A held request blocks its slot until it expires.
create or replace function private.slot_is_free(p_field uuid, p_starts timestamptz, p_occupied_until timestamptz, p_ignore uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.bookings b
    where b.field_id = p_field
      and (b.status in ('confirmed', 'completed', 'no_show')
           or (b.status = 'requested' and b.deposit_status is not null and b.expires_at > now()))
      and (p_ignore is null or b.id <> p_ignore)
      and tstzrange(b.starts_at, b.occupied_until, '[)') && tstzrange(p_starts, p_occupied_until, '[)')
  );
$$;

-- Holds past their time stop blocking the field. Called under the field lock
-- before anything that needs the slot, so the release never waits for the
-- scheduled job.
create or replace function private.release_expired_holds(p_field uuid)
returns void language sql security definer set search_path = '' as $$
  update public.bookings set status = 'expired', expires_at = null
   where field_id = p_field and status = 'requested' and deposit_status is not null and expires_at <= now();
$$;

-- Whoever expires a held request (the release above or the scheduled job),
-- the customer hears why, and a deposit the venue never checked is owed back.
create or replace function private.booking_deposit_expired()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_venue_name text;
begin
  if new.status = 'expired' and old.status = 'requested' and old.deposit_status is not null then
    select name into v_venue_name from public.venues where id = new.venue_id;
    if old.deposit_status = 'reported' then
      new.deposit_status := 'refund_due';
      perform private.notify_venue_staff(new.venue_id, 'booking_deposit_refund_due',
        jsonb_build_object('booking_id', new.id, 'venue_id', new.venue_id, 'venue_name', v_venue_name, 'starts_at', new.starts_at),
        'booking_deposit_refund_due:' || new.id);
    end if;
    -- Same key as the scheduled job's generic notice, which is then skipped.
    perform private.notify(new.requested_by, 'booking_deposit_expired',
      jsonb_build_object('booking_id', new.id, 'venue_id', new.venue_id, 'venue_name', v_venue_name, 'starts_at', new.starts_at,
                         'refund', new.deposit_status = 'refund_due'),
      'booking_decision:' || new.id);
  end if;
  return new;
end $$;
create trigger bookings_deposit_expired before update of status on public.bookings
  for each row execute function private.booking_deposit_expired();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.quote_booking(p_field_id uuid, p_start_local timestamp, p_duration_minutes int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v record;
begin
  select * into v from private.validate_booking_slot(p_field_id, p_start_local, p_duration_minutes, true);
  return jsonb_build_object(
    'starts_at', v.starts_at, 'ends_at', v.ends_at, 'price_total', v.price, 'currency', v.currency,
    'available', private.slot_is_free(p_field_id, v.starts_at, v.occupied_until),
    'deposit_amount', nullif(private.deposit_for(v.price), 0),
    'deposit_hold_minutes', private.setting_int('booking.deposit_hold_minutes', 60));
end $$;

create or replace function public.field_busy_intervals(p_field_id uuid, p_local_date date)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_venue uuid;
  v_tz text;
  v_from timestamptz;
begin
  select venue_id into v_venue from public.venue_fields where id = p_field_id;
  if v_venue is null or not private.can_view_venue(v_venue) then
    raise exception 'field_not_found' using errcode = 'P0002';
  end if;
  v_tz := private.venue_timezone(v_venue);
  v_from := p_local_date::timestamp at time zone v_tz;
  return query
    select b.starts_at, b.occupied_until from public.bookings b
     where b.field_id = p_field_id
       and (b.status in ('confirmed', 'completed', 'no_show')
            or (b.status = 'requested' and b.deposit_status is not null and b.expires_at > now()))
       and b.starts_at < v_from + interval '30 hours' and b.occupied_until > v_from
     order by b.starts_at;
end $$;

create or replace function public.request_booking(
  p_field_id uuid, p_start_local timestamp, p_duration_minutes int, p_note text default null, p_match_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v record;
  v_venue public.venues%rowtype;
  v_booking public.bookings%rowtype;
  v_status public.booking_status;
  v_deposit bigint;
begin
  select * into v from private.validate_booking_slot(p_field_id, p_start_local, p_duration_minutes, true);
  select * into v_venue from public.venues where id = v.venue_id;
  if v_venue.booking_mode <> 'platform' then
    raise exception 'venue_not_bookable' using errcode = 'P0001';
  end if;
  if v_venue.verification_status <> 'verified' then
    raise exception 'venue_not_verified' using errcode = 'P0001';
  end if;
  v_deposit := private.deposit_for(v.price);
  if v_deposit > 0 and coalesce(btrim(v_venue.deposit_instructions), '') = '' then
    raise exception 'venue_deposit_not_set' using errcode = 'P0001';
  end if;
  if v_deposit > 0 or v_venue.auto_confirm_bookings then
    perform private.lock_field(p_field_id);
    perform private.release_expired_holds(p_field_id);
  end if;
  if (select count(*) from public.bookings
       where requested_by = v_uid and status = 'requested' and (expires_at is null or expires_at > now()))
       >= private.setting_int('booking.max_pending_per_user', 5) then
    raise exception 'too_many_pending_bookings' using errcode = 'P0001';
  end if;
  perform private.rate_limit(v_uid, 'booking_request', 20, interval '1 day');
  if not private.slot_is_free(p_field_id, v.starts_at, v.occupied_until) then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;
  -- With a deposit, confirmation waits for the venue to receive it, whatever
  -- the venue's auto-confirm setting says.
  v_status := case when v_deposit = 0 and v_venue.auto_confirm_bookings then 'confirmed' else 'requested' end;
  begin
    insert into public.bookings (venue_id, field_id, kind, requested_by, created_by, starts_at, ends_at, occupied_until,
                                 status, price_total, currency, customer_note, expires_at, decided_at,
                                 deposit_amount, deposit_status)
    values (v.venue_id, p_field_id, 'customer', v_uid, v_uid, v.starts_at, v.ends_at, v.occupied_until,
            v_status, v.price, v.currency, nullif(btrim(coalesce(p_note, '')), ''),
            case
              when v_status = 'confirmed' then null
              when v_deposit > 0
                then least(v.starts_at, now() + make_interval(mins => private.setting_int('booking.deposit_hold_minutes', 60)))
              else least(v.starts_at, now() + make_interval(hours => private.setting_int('booking.request_expiry_hours', 24)))
            end,
            case when v_status = 'confirmed' then now() end,
            nullif(v_deposit, 0),
            case when v_deposit > 0 then 'pending'::public.deposit_status end)
    returning * into v_booking;
  exception when exclusion_violation then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end;
  if p_match_id is not null then
    perform private.link_booking_to_match(v_booking.id, p_match_id, v_uid);
  end if;
  if v_status = 'confirmed' then
    perform private.reject_overlapping_requests(v_booking);
    perform private.notify(v_uid, 'booking_confirmed',
      jsonb_build_object('booking_id', v_booking.id, 'venue_id', v.venue_id, 'venue_name', v_venue.name, 'starts_at', v.starts_at),
      'booking_decision:' || v_booking.id);
  end if;
  perform private.notify_venue_staff(v.venue_id,
    case when v_status = 'confirmed' then 'booking_new_confirmed'
         when v_deposit > 0 then 'booking_awaiting_deposit'
         else 'booking_requested' end,
    jsonb_build_object('booking_id', v_booking.id, 'venue_id', v.venue_id, 'venue_name', v_venue.name, 'starts_at', v.starts_at,
                       'user_name', (select display_name from public.profiles where id = v_uid)),
    'booking_new:' || v_booking.id);
  return jsonb_build_object('booking_id', v_booking.id, 'status', v_status, 'price_total', v.price, 'currency', v.currency,
                            'deposit_amount', nullif(v_deposit, 0), 'expires_at', v_booking.expires_at);
end $$;

-- The customer says the deposit is on its way, with something the venue can
-- match it by (the sending number, a transfer code…).
create or replace function public.report_booking_deposit(p_booking_id uuid, p_reference text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_field uuid;
  v_b public.bookings%rowtype;
  v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
begin
  if v_ref is null or char_length(v_ref) > 120 then
    raise exception 'invalid_reference' using errcode = '22023';
  end if;
  select field_id into v_field from public.bookings where id = p_booking_id and requested_by = v_uid;
  if v_field is null then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  perform private.lock_field(v_field);
  perform private.release_expired_holds(v_field);
  select * into v_b from public.bookings where id = p_booking_id for update;
  if v_b.status = 'expired' and v_b.deposit_status is not null then
    raise exception 'deposit_window_closed' using errcode = 'P0001';
  end if;
  if v_b.status <> 'requested' or v_b.deposit_status is distinct from 'pending' then
    raise exception 'deposit_not_pending' using errcode = 'P0001';
  end if;
  -- From here the slot stays held until the venue checks, at most until kickoff.
  update public.bookings set deposit_status = 'reported', deposit_reference = v_ref, deposit_reported_at = now(),
         expires_at = starts_at
   where id = p_booking_id;
  perform private.notify_venue_staff(v_b.venue_id, 'booking_deposit_reported',
    jsonb_build_object('booking_id', v_b.id, 'venue_id', v_b.venue_id, 'starts_at', v_b.starts_at,
                       'venue_name', (select name from public.venues where id = v_b.venue_id),
                       'user_name', (select display_name from public.profiles where id = v_uid)),
    'booking_deposit_reported:' || v_b.id);
  perform private.audit('booking.deposit_reported', 'booking', v_b.id::text);
end $$;

-- Venue staff approve or decline a request. With a deposit, approving means
-- "the deposit has arrived" and declining means "it has not".
create or replace function public.decide_booking(p_booking_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_field uuid;
  v_b public.bookings%rowtype;
  v_venue_name text;
  v_deposit boolean;
begin
  select field_id into v_field from public.bookings where id = p_booking_id;
  if v_field is null then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  perform private.lock_field(v_field);
  select * into v_b from public.bookings where id = p_booking_id for update;
  perform private.require_venue_role(v_b.venue_id, v_uid, false);
  perform private.release_expired_holds(v_field);
  select * into v_b from public.bookings where id = p_booking_id;
  if v_b.status <> 'requested' then
    raise exception 'booking_not_pending' using errcode = 'P0001';
  end if;
  if p_approve and v_b.starts_at <= now() then
    raise exception 'start_in_past' using errcode = 'P0001';
  end if;
  v_deposit := v_b.deposit_status is not null;
  begin
    update public.bookings set
      status = case when p_approve then 'confirmed' else 'rejected' end::public.booking_status,
      decided_by = v_uid, decided_at = now(),
      decision_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''),
                               case when v_deposit and not p_approve then 'deposit_not_received' end),
      expires_at = null,
      deposit_status = case when v_deposit and p_approve then 'received'::public.deposit_status else deposit_status end,
      deposit_received_at = case when v_deposit and p_approve then now() else deposit_received_at end,
      deposit_received_by = case when v_deposit and p_approve then v_uid else deposit_received_by end
    where id = p_booking_id
    returning * into v_b;
  exception when exclusion_violation then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end;
  select name into v_venue_name from public.venues where id = v_b.venue_id;
  if p_approve then
    perform private.reject_overlapping_requests(v_b);
  end if;
  perform private.notify(v_b.requested_by, case when p_approve then 'booking_confirmed' else 'booking_rejected' end,
    jsonb_build_object('booking_id', v_b.id, 'venue_id', v_b.venue_id, 'venue_name', v_venue_name, 'starts_at', v_b.starts_at,
                       'note', v_b.decision_note),
    'booking_decision:' || v_b.id);
  if v_deposit then
    perform private.audit(case when p_approve then 'booking.deposit_received' else 'booking.deposit_not_received' end,
                          'booking', v_b.id::text);
  end if;
end $$;

-- Cancelling: a customer who cancels loses a deposit already sent; when the
-- venue cancels, it owes the deposit back.
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
  v_is_staff := private.venue_role_of(v_b.venue_id, v_uid) is not null;
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

create or replace function public.mark_deposit_refunded(p_booking_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_b public.bookings%rowtype;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  perform private.require_venue_role(v_b.venue_id, v_uid, false);
  if v_b.deposit_status is distinct from 'refund_due' then
    raise exception 'deposit_not_refundable' using errcode = 'P0001';
  end if;
  update public.bookings set deposit_status = 'refunded', deposit_refunded_at = now(), deposit_refunded_by = v_uid
   where id = p_booking_id;
  perform private.notify(v_b.requested_by, 'booking_deposit_refunded',
    jsonb_build_object('booking_id', v_b.id, 'venue_id', v_b.venue_id, 'starts_at', v_b.starts_at,
                       'venue_name', (select name from public.venues where id = v_b.venue_id)),
    'booking_deposit_refunded:' || v_b.id);
  perform private.audit('booking.deposit_refunded', 'booking', v_b.id::text);
end $$;

-- Where deposits go is a fraud target, so only owners and managers change it,
-- and every change is audited.
create or replace function public.set_venue_deposit_instructions(p_venue_id uuid, p_instructions text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform private.require_venue_role(p_venue_id, v_uid, true);
  if char_length(coalesce(p_instructions, '')) > 500 then
    raise exception 'too_long' using errcode = '22023';
  end if;
  update public.venues set deposit_instructions = nullif(btrim(coalesce(p_instructions, '')), '') where id = p_venue_id;
  perform private.audit('venue.deposit_instructions_updated', 'venue', p_venue_id::text);
end $$;

-- Staff bookings must not collide with an expired hold that is still waiting
-- for the scheduled job.
create or replace function public.create_manual_booking(
  p_field_id uuid, p_start_local timestamp, p_duration_minutes int, p_kind public.booking_kind,
  p_customer_name text default null, p_note text default null, p_price_total bigint default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v record;
  v_id uuid;
begin
  if p_kind not in ('manual', 'block') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  select * into v from private.validate_booking_slot(p_field_id, p_start_local, p_duration_minutes, false);
  perform private.require_venue_role(v.venue_id, v_uid, false);
  perform private.lock_field(p_field_id);
  perform private.release_expired_holds(p_field_id);
  if p_price_total is not null and p_price_total < 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  begin
    insert into public.bookings (venue_id, field_id, kind, created_by, starts_at, ends_at, occupied_until, status,
                                 price_total, currency, customer_name, internal_note, decided_by, decided_at)
    values (v.venue_id, p_field_id, p_kind, v_uid, v.starts_at, v.ends_at, v.occupied_until, 'confirmed',
            case when p_kind = 'block' then 0 else coalesce(p_price_total, v.price) end, v.currency,
            nullif(btrim(coalesce(p_customer_name, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), v_uid, now())
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end;
  perform private.reject_overlapping_requests((select b from public.bookings b where b.id = v_id));
  return v_id;
end $$;

grant execute on function
  public.report_booking_deposit(uuid, text),
  public.mark_deposit_refunded(uuid),
  public.set_venue_deposit_instructions(uuid, text)
to authenticated;
