-- =============================================================================
-- Two-step verification (TOTP) that the database itself enforces.
--
-- People may add an authenticator app to their account (Settings). Once they
-- have, a password alone is not enough: until the session has also passed the
-- code (Supabase's assurance level "aal2"), the person can neither read nor
-- change anything as themselves, through the site or straight through the API.
--
-- - private.mfa_satisfied(): true for everyone without a verified factor, and
--   for sessions that passed the second step.
-- - private.require_user(), which every RPC that acts as a person goes through,
--   refuses with 'mfa_required' when it is false.
-- - Every table (and storage) gets a RESTRICTIVE policy for the authenticated
--   role: it is AND-ed with the existing policies, so it can only take access
--   away, never grant it. People without a factor keep exactly the access they
--   have; anonymous visitors are untouched.
-- - Admins can reset the factor of someone who lost their phone (audited);
--   the site then deletes it through the Auth admin API.
--
-- Safe to run twice. No data changes.
-- =============================================================================

create or replace function private.mfa_satisfied()
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = (select auth.uid()) and f.status = 'verified'
      );
$$;
revoke all on function private.mfa_satisfied() from public;
grant execute on function private.mfa_satisfied() to anon, authenticated, service_role;

create or replace function private.require_user(p_require_onboarded boolean default true)
returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- An account with an authenticator app acts only after the second step.
  if not private.mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '28000';
  end if;
  select * into v_profile from public.profiles where id = v_uid;
  if not found then
    raise exception 'profile_missing' using errcode = 'P0001';
  end if;
  if v_profile.status = 'suspended' then
    raise exception 'account_suspended' using errcode = '42501';
  end if;
  if p_require_onboarded and v_profile.onboarded_at is null then
    raise exception 'profile_incomplete' using errcode = 'P0001';
  end if;
  return v_uid;
end $$;

-- The few reads that act as the person without going through require_user()
-- (they bypass row-level security) see them as nobody until the second step.
-- Each body is the latest one unchanged, apart from the marked line.
create or replace function public.my_phone()
returns text language sql stable security definer set search_path = '' as $$
  select phone from private.user_phones
   where user_id = (select auth.uid()) and (select private.mfa_satisfied()); -- second step
$$;

create or replace function public.my_conversations(p_limit int default 50)
returns table (
  conversation_id uuid, kind public.conversation_kind, ref_id uuid, title text, is_locked boolean,
  last_message_at timestamptz, last_message text, unread_count bigint, last_kind text
) language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid where private.mfa_satisfied()) -- second step
  select c.id, c.kind,
    coalesce(c.match_id, c.team_id, c.booking_id, c.challenge_id, c.tournament_id),
    case c.kind
      when 'match' then (select title from public.matches where id = c.match_id)
      when 'team' then (select name from public.teams where id = c.team_id)
      when 'booking' then (select v.name from public.bookings b join public.venues v on v.id = b.venue_id where b.id = c.booking_id)
      when 'challenge' then (select t1.name || ' – ' || t2.name from public.opponent_challenges ch
                              join public.teams t1 on t1.id = ch.challenger_team_id join public.teams t2 on t2.id = ch.target_team_id
                              where ch.id = c.challenge_id)
      when 'tournament' then (select name from public.tournaments where id = c.tournament_id)
      when 'direct' then (select p.display_name from public.conversation_members cm join public.profiles p on p.id = cm.user_id, me
                          where cm.conversation_id = c.id and cm.user_id <> me.uid limit 1)
    end,
    c.is_locked,
    c.last_message_at,
    lm.body,
    (select count(*) from public.messages m, me
      where m.conversation_id = c.id and m.sender_id is distinct from me.uid
        and m.created_at > coalesce((select r.last_read_at from public.conversation_reads r
                                     where r.conversation_id = c.id and r.user_id = me.uid), '-infinity'::timestamptz)),
    lm.kind
  from me, public.conversations c
  left join lateral (
    select left(m.body, 120) as body,
           case when m.deleted_at is not null then 'text'
                when m.call_outcome is not null then 'call'
                when m.voice_path is not null then 'voice'
                when m.location_lat is not null then 'location'
                when m.image_path is not null then 'image'
                else 'text' end as kind
      from public.messages m where m.conversation_id = c.id order by m.id desc limit 1
  ) lm on true
  where c.id in (select private.my_conversation_ids(me.uid)) and (c.last_message_at is not null or c.kind = 'direct')
  order by c.last_message_at desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

create or replace function public.unread_counts()
returns jsonb language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid where private.mfa_satisfied()) -- second step
  select jsonb_build_object(
    'notifications', (select count(*) from public.notifications, me where user_id = me.uid and read_at is null),
    'messages', (select count(*) from me
                   cross join lateral private.my_conversation_ids(me.uid) ids(id)
                   join public.messages m on m.conversation_id = ids.id
                   left join public.conversation_reads r on r.conversation_id = ids.id and r.user_id = me.uid
                  where m.sender_id is distinct from me.uid
                    and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz))
  );
$$;

create or replace function public.entity_conversation_id(p_kind public.conversation_kind, p_entity_id uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.mfa_satisfied() then return null; end if; -- second step
  select id into v_id from public.conversations c
   where c.kind = p_kind and p_entity_id = case p_kind
     when 'match' then c.match_id when 'team' then c.team_id when 'booking' then c.booking_id
     when 'challenge' then c.challenge_id when 'tournament' then c.tournament_id end;
  if v_id is null or not private.can_access_conversation(v_id) then
    return null;
  end if;
  return v_id;
end $$;

create or replace function public.player_stats(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not exists (select 1 from public.profiles where id = p_user_id
                                 and (show_match_history or (id = auth.uid() and private.mfa_satisfied()))) -- second step
    then null else jsonb_build_object(
    'matches_played', (select count(*) from public.match_participants p join public.matches m on m.id = p.match_id
                        where p.user_id = p_user_id and p.status = 'confirmed' and m.status = 'completed'
                          and coalesce(p.attendance, 'attended') <> 'no_show'),
    'attendance_marked', (select count(*) from public.match_participants p where p.user_id = p_user_id and p.attendance is not null),
    'no_shows', (select count(*) from public.match_participants p where p.user_id = p_user_id and p.attendance = 'no_show'),
    'late_withdrawals', (select count(*) from public.match_participants p where p.user_id = p_user_id and p.late_withdrawal),
    'goals', (select count(*) from public.match_events e left join public.match_results r on r.match_id = e.match_id
               where e.user_id = p_user_id and e.event_type = 'goal' and coalesce(r.status::text, '') <> 'disputed'),
    'assists', (select count(*) from public.match_events e left join public.match_results r on r.match_id = e.match_id
                 where e.user_id = p_user_id and e.event_type = 'assist' and coalesce(r.status::text, '') <> 'disputed'),
    'clean_sheets', (select count(*) from public.match_events e left join public.match_results r on r.match_id = e.match_id
                      where e.user_id = p_user_id and e.event_type = 'clean_sheet' and coalesce(r.status::text, '') <> 'disputed'),
    'verified_results', (select count(*) from public.match_participants p join public.match_results r on r.match_id = p.match_id
                          where p.user_id = p_user_id and p.status = 'confirmed' and r.status = 'confirmed')
  ) end;
$$;

create or replace function public.quote_booking(p_field_id uuid, p_start_local timestamp, p_duration_minutes int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v record;
  v_uid uuid := case when private.mfa_satisfied() then auth.uid() end; -- second step
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

-- Reads too: a restrictive policy on every table with row-level security.
do $$
declare
  t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
  loop
    execute format('drop policy if exists second_factor on public.%I', t.relname);
    execute format(
      'create policy second_factor on public.%I as restrictive for all to authenticated
         using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()))',
      t.relname);
  end loop;
end $$;

drop policy if exists second_factor on storage.objects;
create policy second_factor on storage.objects as restrictive for all to authenticated
  using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()));

-- Which of these people use two-step verification (admins only: the users list).
create or replace function public.admin_users_with_second_factor(p_user_ids uuid[])
returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return query
    select distinct f.user_id from auth.mfa_factors f
    where f.user_id = any(p_user_ids) and f.status = 'verified';
end $$;
revoke all on function public.admin_users_with_second_factor(uuid[]) from public, anon;
grant execute on function public.admin_users_with_second_factor(uuid[]) to authenticated;

-- An admin resets someone's two-step verification (they lost their phone).
-- Authorizes and records it; the site then removes the factors through the
-- Auth admin API. Admins can't reset their own (another admin must).
create or replace function public.admin_reset_second_factor(p_user_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  if p_user_id = v_uid then
    raise exception 'cannot_moderate_self' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  perform private.audit('second_factor_reset', 'user', p_user_id::text,
    jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), '')));
end $$;
revoke all on function public.admin_reset_second_factor(uuid, text) from public, anon;
grant execute on function public.admin_reset_second_factor(uuid, text) to authenticated;
