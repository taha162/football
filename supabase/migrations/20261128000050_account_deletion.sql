-- =============================================================================
-- Members delete their own account (0050; after 0030).
--
-- Google Play and the App Store require it inside the app, and Google Play a
-- page on the web too (/legal/account-deletion). Settings → «حذف الحساب».
--
-- What goes, and what stays, is what an admin's deletion does (0030): the
-- deletion itself moves into private.delete_member(), which both use.
--
-- A session alone is not enough: the site checks the password first, then
-- (with the server key) allows one deletion for the next 5 minutes
-- (allow_account_deletion). delete_my_account() runs as the member, so the
-- second step (authenticator app) is required as for everything else.
-- What stops it:
--   - an admin of the site (another admin removes the role first);
--   - the owner of a venue (its bookings and customers need someone to answer
--     for them: the ownership moves to someone else first).
--
-- Adds a table and functions; admin_delete_user keeps its behaviour. Safe to
-- run twice. No data changes by itself.
-- =============================================================================

-- One deletion allowed, for a few minutes, after the password was checked.
create table if not exists private.account_deletion_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  expires_at timestamptz not null
);
revoke all on private.account_deletion_grants from public, anon, authenticated;

-- The deletion itself (was the body of admin_delete_user, 0030). Returns the files the site
-- removes from Storage once this commits. Callers check who may.
create or replace function private.delete_member(p_user_id uuid, p_by uuid, p_cancel_reason text, p_audit_action text, p_details jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_avatar text;
  v_images text[];
  v_voices text[];
  r record;
begin
  select avatar_path into v_avatar from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(m.image_path) filter (where m.image_path is not null), '{}'),
         coalesce(array_agg(m.voice_path) filter (where m.voice_path is not null), '{}')
    into v_images, v_voices
    from public.messages m where m.sender_id = p_user_id;

  -- Upcoming bookings are cancelled, so the venue gets the time back, and its staff hear of it.
  for r in
    update public.bookings b
       set status = 'cancelled', cancelled_by = p_by, cancelled_at = now(), expires_at = null,
           cancel_reason = p_cancel_reason,
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
  -- What stays of their bookings is the venue's record, without their name or note.
  update public.bookings
     set kind = case when kind = 'customer' then 'manual'::public.booking_kind else kind end,
         customer_name = 'عضو محذوف', customer_note = null
   where requested_by = p_user_id;

  delete from public.messages where sender_id = p_user_id;

  perform private.audit(p_audit_action, 'user', p_user_id::text, p_details);

  -- The account; everything that is the member's own goes with it (ON DELETE CASCADE).
  delete from auth.users where id = p_user_id;

  return jsonb_build_object('deleted', true, 'files', jsonb_build_object(
    'avatars', to_jsonb(case when v_avatar is null then '{}'::text[] else array[v_avatar] end),
    'message-images', to_jsonb(v_images),
    'message-voice', to_jsonb(v_voices)));
end $$;
revoke all on function private.delete_member(uuid, uuid, text, text, jsonb) from public, anon, authenticated;

-- Admins (unchanged: same checks, same result, same audit entry).
create or replace function public.admin_delete_user(p_user_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_blockers jsonb;
begin
  perform 1 from public.profiles where id = p_user_id;
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
  return private.delete_member(p_user_id, v_admin, 'حُذف حساب صاحب الحجز', 'user_deleted',
    private.member_deletion_counts(p_user_id)
      || jsonb_build_object('reason', nullif(left(btrim(coalesce(p_reason, '')), 500), '')));
end $$;

-- The site, after checking the member's password (server key only).
create or replace function public.allow_account_deletion(p_user_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into private.account_deletion_grants (user_id, expires_at)
  select id, now() + interval '5 minutes' from auth.users where id = p_user_id
  on conflict (user_id) do update set expires_at = excluded.expires_at;
$$;

-- What stops the member deleting their account, and what goes with it (the settings page).
create or replace function public.my_account_deletion_preview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(false);
  v_blockers jsonb := private.member_deletion_blockers(v_uid);
begin
  return jsonb_build_object('admin', (v_blockers ->> 'admin')::boolean, 'owns_venues', v_blockers -> 'owns_venues')
         || private.member_deletion_counts(v_uid);
end $$;

-- The member deletes their own account (after allow_account_deletion). Returns the files to remove.
create or replace function public.delete_my_account(p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user(false);
  v_blockers jsonb;
begin
  delete from private.account_deletion_grants where user_id = v_uid and expires_at > now();
  if not found then
    raise exception 'password_check_required' using errcode = 'P0001';
  end if;
  v_blockers := private.member_deletion_blockers(v_uid);
  if (v_blockers ->> 'admin')::boolean then
    raise exception 'admin_account' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_blockers -> 'owns_venues') > 0 then
    raise exception 'owns_venue' using errcode = 'P0001';
  end if;
  return private.delete_member(v_uid, v_uid, 'حذف صاحب الحجز حسابه', 'account.self_deleted',
    private.member_deletion_counts(v_uid)
      || jsonb_build_object('reason', nullif(left(btrim(coalesce(p_reason, '')), 500), '')));
end $$;

revoke all on function public.allow_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.allow_account_deletion(uuid) to service_role;
revoke all on function public.my_account_deletion_preview() from public, anon;
grant execute on function public.my_account_deletion_preview() to authenticated;
revoke all on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;
