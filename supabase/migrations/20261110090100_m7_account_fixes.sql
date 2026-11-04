-- Fixes for staff account creation (20261110090000_m7_admin_crud.sql):
--   * Phones typed the local way (01712345678) failed the profiles check constraint; they are now stored as +8801712345678.
--   * A create that failed half-way left an unused sign-in identity that could not be removed (profiles are never
--     deleted), so retrying with the same email said it was taken. Staff can now pick that identity up and finish.

-- Phone numbers are stored in international form (+8801712345678). Accepts the local forms people type
-- (01712345678, 8801712345678, with spaces or dashes) and returns null when nothing usable was given.
create function private.normalize_phone(p_phone text) returns text
language sql immutable set search_path = '' as $$
  select case
    when d is null then null
    when d ~ '^01[3-9][0-9]{8}$' then '+88' || d
    when d ~ '^8801[3-9][0-9]{8}$' then '+' || d
    else d
  end
  from (select nullif(regexp_replace(coalesce(p_phone, ''), '[\s().-]', '', 'g'), '') as d) x;
$$;

-- An existing sign-in identity with this email that was never used (role "user", no rides): staff can turn it into a
-- passenger or driver instead of being told the email is taken (for example after an interrupted create).
create function api.admin_find_unused_account(p_email text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.has_permission('passengers.create') or private.has_permission('drivers.create')) then
    perform private.raise_error('FORBIDDEN');
  end if;
  return (select p.id from public.profiles p where lower(p.email::text) = lower(btrim(p_email)) and p.role = 'user' and p.deleted_at is null);
end $$;

create or replace function api.admin_setup_account(p_user_id uuid, p_role text, p_full_name text, p_phone text, p_home_zone_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.require_reason(p_reason);
  v_profile public.profiles;
  v_phone text := private.normalize_phone(p_phone);
  v_driver uuid;
begin
  if p_role not in ('passenger', 'driver') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"role","message":"Choose passenger or driver."}]}');
  end if;
  perform private.require_permission(case when p_role = 'driver' then 'drivers.create' else 'passengers.create' end);
  if p_full_name is null or length(btrim(p_full_name)) not between 2 and 100 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"full_name","message":"Enter a name of 2 to 100 characters."}]}');
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"phone","message":"Enter a phone number like 01712345678 or +8801712345678."}]}');
  end if;
  if v_phone is not null and exists (select 1 from public.profiles where phone = v_phone and id <> p_user_id) then
    perform private.raise_error('ALREADY_EXISTS', '{"fields":[{"path":"phone","message":"Another account uses this phone number."}]}');
  end if;
  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if v_profile.role <> 'user' then
    perform private.raise_error('ALREADY_EXISTS', '{"fields":[{"path":"email","message":"This email already belongs to an account."}]}');
  end if;

  update public.profiles set full_name = btrim(p_full_name), phone = v_phone where id = p_user_id;
  perform private.promote_user_role(p_user_id, p_role::public.app_role);
  if p_role = 'driver' then
    if p_home_zone_id is not null and not exists (select 1 from public.service_zones where id = p_home_zone_id) then
      perform private.raise_error('NOT_FOUND', '{"field":"home_zone_id"}');
    end if;
    insert into public.driver_profiles (user_id, onboarding_status, home_zone_id)
    values (p_user_id, 'draft', p_home_zone_id)
    on conflict (user_id) do nothing
    returning id into v_driver;
  end if;
  perform private.log_admin_action(p_role || '.create', 'profile', p_user_id, null,
    jsonb_build_object('role', p_role, 'full_name', btrim(p_full_name), 'phone', private.mask_phone(v_phone)), v_reason);
  return jsonb_build_object('user_id', p_user_id, 'role', p_role, 'driver_id', v_driver);
end $$;

-- Name and phone for a passenger or driver (the email is the sign-in identity and is changed by the server).
create or replace function api.admin_update_contact(p_profile_id uuid, p_full_name text, p_phone text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.require_reason(p_reason);
  v_profile public.profiles;
  v_phone text := private.normalize_phone(p_phone);
begin
  select * into v_profile from public.profiles where id = p_profile_id and role in ('passenger', 'driver') for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  perform private.require_permission(case when v_profile.role = 'driver' then 'drivers.update' else 'passengers.update' end);
  if p_full_name is null or length(btrim(p_full_name)) not between 2 and 100 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"full_name","message":"Enter a name of 2 to 100 characters."}]}');
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"phone","message":"Enter a phone number like 01712345678 or +8801712345678."}]}');
  end if;
  if v_phone is not null and exists (select 1 from public.profiles where phone = v_phone and id <> p_profile_id) then
    perform private.raise_error('ALREADY_EXISTS', '{"fields":[{"path":"phone","message":"Another account uses this phone number."}]}');
  end if;
  -- An empty phone keeps the current one (staff only ever see it masked).
  v_phone := coalesce(v_phone, v_profile.phone);
  update public.profiles set full_name = btrim(p_full_name), phone = v_phone where id = p_profile_id;
  perform private.log_admin_action(v_profile.role || '.update_contact', 'profile', p_profile_id,
    jsonb_build_object('full_name', v_profile.full_name, 'phone', private.mask_phone(v_profile.phone)),
    jsonb_build_object('full_name', btrim(p_full_name), 'phone', private.mask_phone(v_phone)), v_reason);
  return jsonb_build_object('id', p_profile_id);
end $$;

-- Lint: every path returns.
create or replace function api.admin_pick_people(p_role text, p_query text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  q text := '%' || replace(replace(btrim(coalesce(p_query, '')), '%', ''), '_', '') || '%';
begin
  if p_role = 'passenger' then
    perform private.require_permission('passengers.view');
    return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'phone', private.mask_phone(p.phone)) order by p.full_name), '[]')
      from (select * from public.profiles where role = 'passenger' and status = 'active' and deleted_at is null
              and (full_name ilike q or email::text ilike q or phone like q) order by full_name limit 20) p);
  elsif p_role = 'driver' then
    perform private.require_permission('drivers.view');
    return (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', p.full_name, 'phone', private.mask_phone(p.phone),
        'availability', d.availability, 'status', d.onboarding_status,
        'vehicle', (select v.registration_number || ' · ' || c.name from public.vehicles v join public.vehicle_categories c on c.id = v.category_id where v.id = d.current_vehicle_id),
        'category_id', (select v.category_id from public.vehicles v where v.id = d.current_vehicle_id)) order by p.full_name), '[]')
      from (select * from public.driver_profiles) d join public.profiles p on p.id = d.user_id
      where p.deleted_at is null and (p.full_name ilike q or p.email::text ilike q or p.phone like q)
      limit 20);
  end if;
  perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"role","message":"Unknown list."}]}');
  return null; -- not reached: raise_error always raises
end $$;

revoke execute on function private.normalize_phone(text) from public, anon, authenticated;
revoke execute on function api.admin_find_unused_account(text) from public, anon;
grant execute on function api.admin_find_unused_account(text) to authenticated;
