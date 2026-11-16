-- =============================================================================
-- Deleting a member completely (Admin → Users → «حذف نهائي»).
--
-- Admins only: moderators can't, and nobody can through the API without the
-- admin role (and, with an authenticator app, the second step: require_admin
-- goes through require_user).
--
--   public.admin_user_deletion_preview(p_user_id)  what would go with the member,
--     and what stops it, for the confirmation page.
--   public.admin_delete_user(p_user_id, p_reason)  does it in one transaction,
--     and returns the files the site then removes from Storage.
--
-- What goes:
--   - the account and everything that is the member's own, through the
--     existing ON DELETE CASCADE: profile, phone number, roles, settings,
--     notifications, WhatsApp consent and waiting messages, memberships
--     (teams, conversations, venue staff), places in matches, invitations,
--     requests, reviews they wrote and reviews about them, blocks, calls;
--   - the matches, series and tournaments they organised (CASCADE, as for any
--     organiser); the confirmation page says how many;
--   - the messages they sent, with their pictures and voice notes;
--   - their profile picture.
-- What stays, without their name:
--   - bookings, which are the venue's record: they become the venue's own
--     (kind 'manual', like a booking its staff typed in) under the name
--     «عضو محذوف», and the note is cleared. Upcoming ones are cancelled first,
--     the venue's staff are notified, and a reported or received deposit is
--     marked to refund;
--   - reports they filed, the audit log, and the teams and venues they created.
-- What stops it:
--   - deleting oneself;
--   - deleting an admin (remove the role first);
--   - deleting the owner of a venue: a venue has exactly one owner, and its
--     bookings and its customers' would be left with nobody to answer for
--     them. Venue managers and staff can be deleted; the venue stays.
--
-- Each deletion is in the audit log, with counts only and the optional
-- reason. Safe to run twice. No data changes by itself.
-- =============================================================================

-- What stops a deletion: oneself, an admin, the owner of a venue (the venues' names).
create or replace function private.member_deletion_blockers(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'self', p_user_id = (select auth.uid()),
    'admin', exists (select 1 from public.user_roles r where r.user_id = p_user_id and r.role = 'admin'),
    'owns_venues', coalesce((
      select jsonb_agg(v.name order by v.name)
        from public.venues v
        join public.venue_staff s on s.venue_id = v.id and s.user_id = p_user_id and s.role = 'owner'
    ), '[]'::jsonb));
$$;
revoke all on function private.member_deletion_blockers(uuid) from public, anon, authenticated;

-- What goes with the member (numbers only).
create or replace function private.member_deletion_counts(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'matches', (select count(*) from public.matches where organizer_id = p_user_id),
    'tournaments', (select count(*) from public.tournaments where organizer_id = p_user_id),
    'messages', (select count(*) from public.messages where sender_id = p_user_id and deleted_at is null),
    'bookings', (select count(*) from public.bookings where requested_by = p_user_id),
    'upcoming_bookings', (select count(*) from public.bookings
                           where requested_by = p_user_id and status in ('requested', 'confirmed') and ends_at > now()),
    'teams', (select count(*) from public.team_members where user_id = p_user_id),
    'reviews', (select count(*) from public.reviews where reviewer_id = p_user_id or subject_user_id = p_user_id));
$$;
revoke all on function private.member_deletion_counts(uuid) from public, anon, authenticated;

drop function if exists public.admin_user_deletion_preview(uuid);
create function public.admin_user_deletion_preview(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_name text;
begin
  perform private.require_admin();
  select display_name into v_name from public.profiles where id = p_user_id;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('display_name', v_name, 'blockers', private.member_deletion_blockers(p_user_id))
         || private.member_deletion_counts(p_user_id);
end $$;

drop function if exists public.admin_delete_user(uuid, text);
create function public.admin_delete_user(p_user_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_avatar text;
  v_blockers jsonb;
  v_counts jsonb;
  v_images text[];
  v_voices text[];
  r record;
begin
  select avatar_path into v_avatar from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  v_blockers := private.member_deletion_blockers(p_user_id);
  if (v_blockers ->> 'self')::boolean then
    raise exception 'cannot_delete_self' using errcode = 'P0001';
  end if;
  if (v_blockers ->> 'admin')::boolean then
    raise exception 'cannot_delete_admin' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_blockers -> 'owns_venues') > 0 then
    raise exception 'venue_owner' using errcode = 'P0001';
  end if;
  v_counts := private.member_deletion_counts(p_user_id);

  -- The files the site removes from Storage once this commits.
  select coalesce(array_agg(m.image_path) filter (where m.image_path is not null), '{}'),
         coalesce(array_agg(m.voice_path) filter (where m.voice_path is not null), '{}')
    into v_images, v_voices
    from public.messages m where m.sender_id = p_user_id;

  -- Upcoming bookings are cancelled, so the venue gets the time back, and its staff hear of it.
  for r in
    update public.bookings b
       set status = 'cancelled', cancelled_by = v_admin, cancelled_at = now(), expires_at = null,
           cancel_reason = 'حُذف حساب صاحب الحجز',
           deposit_status = case when b.deposit_status in ('reported', 'received')
                                 then 'refund_due'::public.deposit_status else b.deposit_status end
     where b.requested_by = p_user_id and b.status in ('requested', 'confirmed') and b.ends_at > now()
     returning b.id, b.venue_id, b.starts_at
  loop
    perform private.notify_venue_staff(r.venue_id, 'booking_cancelled',
      jsonb_build_object('booking_id', r.id, 'venue_id', r.venue_id,
                         'venue_name', (select v.name from public.venues v where v.id = r.venue_id),
                         'starts_at', r.starts_at, 'by', 'customer'),
      'booking_cancelled:' || r.id);
  end loop;
  -- What stays of their bookings is the venue's record, without their name or note. A customer's
  -- booking must name its customer, so it becomes one like the staff type in for someone off the site.
  update public.bookings
     set kind = case when kind = 'customer' then 'manual'::public.booking_kind else kind end,
         customer_name = 'عضو محذوف', customer_note = null
   where requested_by = p_user_id;

  delete from public.messages where sender_id = p_user_id;

  perform private.audit('user_deleted', 'user', p_user_id::text,
    v_counts || jsonb_build_object('reason', nullif(left(btrim(coalesce(p_reason, '')), 500), '')));

  -- The account; everything that is the member's own goes with it (ON DELETE CASCADE).
  delete from auth.users where id = p_user_id;

  return jsonb_build_object('deleted', true, 'files', jsonb_build_object(
    'avatars', to_jsonb(case when v_avatar is null then '{}'::text[] else array[v_avatar] end),
    'message-images', to_jsonb(v_images),
    'message-voice', to_jsonb(v_voices)));
end $$;

-- Through the API for signed-in people only; each function checks the admin role itself.
revoke all on function public.admin_user_deletion_preview(uuid) from public, anon;
revoke all on function public.admin_delete_user(uuid, text) from public, anon;
grant execute on function public.admin_user_deletion_preview(uuid) to authenticated, service_role;
grant execute on function public.admin_delete_user(uuid, text) to authenticated, service_role;
