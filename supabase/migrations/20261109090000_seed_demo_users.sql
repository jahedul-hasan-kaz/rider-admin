-- Demo accounts for staging, applied by the app when it starts (src/instrumentation.ts) after it has created the sign-in
-- identities. Idempotent. Callable only with the service key, and it only ever touches the three fixed demo addresses.
--   admin@yopmail.com     super admin (every permission, always, including permissions added later)
--   rider@yopmail.com     approved driver with an active bike
--   customer@yopmail.com  passenger

create function api.seed_demo_users() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid;
  v_super uuid;
  v_missing integer;
begin
  perform private.require_service_role();

  -- admin: the new-user trigger may have made the profile a plain 'user'; the role guard forbids user -> admin, so the
  -- bootstrap admin is promoted with the guard switched off for this transaction only.
  alter table public.profiles disable trigger trg_profiles_role_guard;
  update public.profiles set role = 'admin', status = 'active', full_name = 'Super Admin', deleted_at = null
  where lower(email) = 'admin@yopmail.com' and role = 'user';
  alter table public.profiles enable trigger trg_profiles_role_guard;

  insert into public.profiles (id, role, status, full_name, email)
  select u.id, 'admin', 'active', 'Super Admin', lower(u.email) from auth.users u where lower(u.email) = 'admin@yopmail.com'
  on conflict (id) do nothing;

  select id into v_admin from public.profiles where lower(email) = 'admin@yopmail.com' and role = 'admin';
  select id into v_super from public.permission_templates where code = 'super_admin';

  if v_admin is not null then
    insert into public.admin_profiles (id, must_change_password) values (v_admin, false) on conflict (id) do nothing;
    -- Never locked out by an old suspension or ban on the demo account.
    update public.profiles set status = 'active' where id = v_admin and status <> 'active';
    update auth.users set banned_until = null where id = v_admin and banned_until is not null;
    insert into public.admin_template_assignments (admin_id, template_id, assigned_by, reason)
    select v_admin, v_super, null, 'Demo bootstrap'
    where not exists (select 1 from public.admin_template_assignments a where a.admin_id = v_admin and a.template_id = v_super and a.revoked_at is null);
  end if;

  -- The super admin template must hold every permission in the catalogue.
  insert into public.permission_template_items (template_id, permission_code)
  select v_super, p.code from public.permissions p
  where not exists (select 1 from public.permission_template_items i where i.template_id = v_super and i.permission_code = p.code and i.removed_at is null);

  -- customer: passenger.
  update public.profiles set full_name = 'Demo Passenger' where lower(email) = 'customer@yopmail.com' and role = 'user';
  perform private.promote_user_role(p.id, 'passenger') from public.profiles p where lower(p.email) = 'customer@yopmail.com' and p.role = 'user';

  -- rider: approved driver with an active bike.
  update public.profiles set full_name = 'Demo Driver' where lower(email) = 'rider@yopmail.com' and role = 'user';
  perform private.promote_user_role(p.id, 'driver') from public.profiles p where lower(p.email) = 'rider@yopmail.com' and p.role = 'user';

  insert into public.driver_profiles (user_id, onboarding_status, approved_at)
  select p.id, 'approved', now() from public.profiles p
  where lower(p.email) = 'rider@yopmail.com' and p.role = 'driver'
    and not exists (select 1 from public.driver_profiles d where d.user_id = p.id);

  insert into public.vehicles (driver_id, category_id, make, model, color, registration_number, year, status)
  select d.id, (select id from public.vehicle_categories where code = 'bike'), 'Honda', 'CB Shine', 'Red', 'DEMO-0001', 2022, 'active'
  from public.driver_profiles d join public.profiles p on p.id = d.user_id
  where lower(p.email) = 'rider@yopmail.com' and not exists (select 1 from public.vehicles v where v.driver_id = d.id);

  update public.driver_profiles d set current_vehicle_id = (select v.id from public.vehicles v where v.driver_id = d.id limit 1)
  from public.profiles p where p.id = d.user_id and lower(p.email) = 'rider@yopmail.com' and d.current_vehicle_id is null;

  select count(*) into v_missing from public.permissions p
  where not exists (select 1 from public.permission_template_items i where i.template_id = v_super and i.permission_code = p.code and i.removed_at is null);

  return jsonb_build_object(
    'admin', exists (select 1 from public.profiles where lower(email) = 'admin@yopmail.com' and role = 'admin'),
    'driver', exists (select 1 from public.profiles where lower(email) = 'rider@yopmail.com' and role = 'driver'),
    'passenger', exists (select 1 from public.profiles where lower(email) = 'customer@yopmail.com' and role = 'passenger'),
    'permissions_missing_from_super_admin', v_missing);
end $$;

revoke execute on function api.seed_demo_users() from public, anon, authenticated;
grant execute on function api.seed_demo_users() to service_role;
