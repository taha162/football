-- =============================================================================
-- Phone numbers where the owner looks for them.
--
-- 1. Supabase's own user list (Authentication → Users) shows a "Phone"
--    column, which stayed empty: verified numbers lived only in
--    private.user_phones. They are now also written to auth.users.phone
--    (with phone_confirmed_at) when Telegram verifies a number, and copied
--    for numbers verified before. Sign-in is unchanged (phone accounts still
--    sign in through their internal address), and no SMS is involved.
-- 2. The admin user list returns each phone account's number, and can be
--    searched by number (local 07… form included). Admins only, as before.
--
-- Safe to run twice; a number another auth user already holds is skipped
-- (auth.users.phone is unique).
-- =============================================================================

update auth.users u
   set phone = p.phone, phone_confirmed_at = coalesce(u.phone_confirmed_at, p.verified_at)
  from private.user_phones p
 where p.user_id = u.id
   and u.phone is distinct from p.phone
   and not exists (select 1 from auth.users o where o.phone = p.phone and o.id <> u.id);

create or replace function public.tg_receive_contact(p_tg_user_id bigint, p_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_row public.phone_verifications%rowtype;
  v_owner uuid;
  v_status public.phone_verify_status;
begin
  if p_tg_user_id is null or p_tg_user_id <= 0 then
    return jsonb_build_object('matched', false, 'reason', 'invalid_sender');
  end if;
  if v_phone !~ '^[1-9][0-9]{7,14}$' then
    return jsonb_build_object('matched', false, 'reason', 'invalid_phone');
  end if;
  select * into v_row from public.phone_verifications
   where tg_user_id = p_tg_user_id and status = 'pending' and expires_at > now()
   order by created_at desc
   limit 1
   for update;
  if not found then
    select * into v_row from public.phone_verifications
     where tg_user_id = p_tg_user_id and phone = v_phone and verified_at > now() - interval '30 minutes'
     order by verified_at desc
     limit 1;
    if found then
      return jsonb_build_object('matched', true, 'repeat', true, 'purpose', v_row.purpose,
                                'status', case when v_row.status = 'consumed' then 'verified' else v_row.status::text end);
    end if;
    return jsonb_build_object('matched', false, 'reason', 'no_pending_code');
  end if;

  if v_row.purpose = 'signup' then
    select user_id into v_owner from private.user_phones where phone = v_phone;
    if v_owner is not null and v_owner <> v_row.user_id then
      update public.phone_verifications set status = 'phone_taken', phone = v_phone, verified_at = now() where id = v_row.id;
      return jsonb_build_object('matched', true, 'purpose', 'signup', 'status', 'phone_taken');
    end if;
    insert into private.user_phones (user_id, phone) values (v_row.user_id, v_phone)
      on conflict (user_id) do update set phone = excluded.phone, verified_at = now();
    -- The phone, not an e-mail, is this account's verified identifier; it also
    -- appears in Supabase's user list.
    update auth.users
       set email_confirmed_at = coalesce(email_confirmed_at, now()),
           phone = case when exists (select 1 from auth.users o where o.phone = v_phone and o.id <> v_row.user_id) then phone else v_phone end,
           phone_confirmed_at = coalesce(phone_confirmed_at, now())
     where id = v_row.user_id;
    update public.phone_verifications set status = 'verified', phone = v_phone, verified_at = now() where id = v_row.id;
    return jsonb_build_object('matched', true, 'purpose', 'signup', 'status', 'verified');
  end if;

  -- Password reset: the shared number identifies the account.
  select user_id into v_owner from private.user_phones where phone = v_phone;
  v_status := case when v_owner is null then 'no_account' else 'verified' end;
  update public.phone_verifications
     set status = v_status, user_id = v_owner, phone = v_phone, verified_at = now()
   where id = v_row.id;
  return jsonb_build_object('matched', true, 'purpose', 'reset', 'status', v_status);
end $$;
revoke execute on function public.tg_receive_contact(bigint, text) from public, anon, authenticated;
grant execute on function public.tg_receive_contact(bigint, text) to service_role;

-- Admin user directory, with e-mail and phone (admins only). The return type
-- changes, so the function is replaced rather than altered.
drop function if exists public.admin_list_users(text, int, int);
create function public.admin_list_users(p_search text default null, p_limit int default 50, p_offset int default 0)
returns table (id uuid, display_name text, email text, phone text, status public.account_status, roles public.app_role[],
               created_at timestamptz, last_sign_in_at timestamptz, city_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  -- Digits of the search, without a leading 0, so "0770 123 4567" finds 9647701234567.
  v_digits text := ltrim(regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g'), '0');
begin
  perform private.require_admin();
  return query
    select p.id, p.display_name, u.email::text, ph.phone, p.status,
           coalesce(array(select r.role from public.user_roles r where r.user_id = p.id), '{}'),
           p.created_at, u.last_sign_in_at, p.city_id
      from public.profiles p
      join auth.users u on u.id = p.id
      left join private.user_phones ph on ph.user_id = p.id
     where p_search is null
        or p.display_name ilike '%' || p_search || '%'
        or u.email ilike '%' || p_search || '%'
        or (length(v_digits) >= 4 and ph.phone like '%' || v_digits || '%')
     order by p.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;
revoke execute on function public.admin_list_users(text, int, int) from public, anon;
grant execute on function public.admin_list_users(text, int, int) to authenticated;
