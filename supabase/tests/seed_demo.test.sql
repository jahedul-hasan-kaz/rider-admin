-- The demo seed: the three accounts get their roles, the admin holds every permission, and only the service key can run it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000d0001', 'admin@yopmail.com'),
  ('00000000-0000-0000-0000-0000000d0002', 'rider@yopmail.com'),
  ('00000000-0000-0000-0000-0000000d0003', 'customer@yopmail.com')
on conflict do nothing;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000d0001","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$select api.seed_demo_users()$$, '42501', null, 'a signed-in user cannot run the seed');
reset role;
set local role anon;
select throws_ok($$select api.seed_demo_users()$$, '42501', null, 'nor can an anonymous caller');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((api.seed_demo_users() ->> 'admin')::boolean, true, 'the admin account is set up');
select is((api.seed_demo_users() ->> 'driver')::boolean, true, 'the driver account is set up');
select is((api.seed_demo_users() ->> 'passenger')::boolean, true, 'the passenger account is set up');
select is((api.seed_demo_users() ->> 'permissions_missing_from_super_admin')::int, 0, 'the super admin template holds every permission');
select is((select count(*)::int from public.vehicles v join public.driver_profiles d on d.id = v.driver_id join public.profiles p on p.id = d.user_id where p.email = 'rider@yopmail.com'), 1, 'running it again does not add a second vehicle');
select is((select count(*)::int from public.admin_template_assignments a join public.profiles p on p.id = a.admin_id where p.email = 'admin@yopmail.com' and a.revoked_at is null), 1, 'or a second super admin assignment');
select is((select role::text from public.profiles where email = 'admin@yopmail.com'), 'admin', 'admin@yopmail.com is an admin');
select is((select count(*)::int from public.permissions p where not exists (
  select 1 from public.admin_template_assignments a join public.permission_template_items i on i.template_id = a.template_id and i.removed_at is null
  join public.profiles pr on pr.id = a.admin_id where pr.email = 'admin@yopmail.com' and a.revoked_at is null and i.permission_code = p.code)), 0, 'the admin account is granted every permission in the catalogue');
select ok((select driver_profiles.current_vehicle_id is not null and onboarding_status = 'approved' from public.driver_profiles join public.profiles p on p.id = user_id where p.email = 'rider@yopmail.com'), 'the driver is approved with a current vehicle');
select ok((select banned_until is null from auth.users where email = 'admin@yopmail.com'), 'the admin can sign in');

select * from finish();
rollback;
