-- Demo accounts for a hosted (staging) project. Idempotent; run after migrations and after
-- scripts/seed-hosted-users.mjs has created the auth users. NOT for production.
-- One statement on purpose: `supabase db query` runs a single statement.
do $seed$
begin
-- admin@yopmail.com: super admin (same as the bootstrap migration, without the forced password change).
-- The new-user trigger may already have created this profile as 'user'; the role guard forbids user -> admin,
-- so the bootstrap admin is fixed with the guard switched off for this one transaction.
alter table public.profiles disable trigger trg_profiles_role_guard;
update public.profiles set role = 'admin', full_name = 'Super Admin'
where lower(email) = 'admin@yopmail.com' and role = 'user';
alter table public.profiles enable trigger trg_profiles_role_guard;

insert into public.profiles (id, role, status, full_name, email)
select u.id, 'admin', 'active', 'Super Admin', lower(u.email) from auth.users u
where lower(u.email) = 'admin@yopmail.com'
on conflict (id) do nothing;

insert into public.admin_profiles (id, must_change_password)
select p.id, false from public.profiles p where lower(p.email) = 'admin@yopmail.com' and p.role = 'admin'
on conflict (id) do nothing;

insert into public.admin_template_assignments (admin_id, template_id, assigned_by, reason)
select p.id, t.id, null, 'Demo bootstrap'
from public.profiles p join public.permission_templates t on t.code = 'super_admin'
where lower(p.email) = 'admin@yopmail.com' and p.role = 'admin'
  and not exists (select 1 from public.admin_template_assignments a where a.admin_id = p.id and a.template_id = t.id and a.revoked_at is null);

-- customer@yopmail.com: passenger.
update public.profiles set full_name = 'Demo Passenger' where lower(email) = 'customer@yopmail.com';
perform private.promote_user_role(p.id, 'passenger') from public.profiles p
where lower(p.email) = 'customer@yopmail.com' and p.role = 'user';

-- rider@yopmail.com: approved driver with an active bike (offline until they go online).
update public.profiles set full_name = 'Demo Driver' where lower(email) = 'rider@yopmail.com';
perform private.promote_user_role(p.id, 'driver') from public.profiles p
where lower(p.email) = 'rider@yopmail.com' and p.role = 'user';

insert into public.driver_profiles (user_id, onboarding_status, approved_at)
select p.id, 'approved', now() from public.profiles p
where lower(p.email) = 'rider@yopmail.com' and p.role = 'driver'
  and not exists (select 1 from public.driver_profiles d where d.user_id = p.id);

insert into public.vehicles (driver_id, category_id, make, model, color, registration_number, year, status)
select d.id, (select id from public.vehicle_categories where code = 'bike'), 'Honda', 'CB Shine', 'Red', 'DEMO-0001', 2022, 'active'
from public.driver_profiles d join public.profiles p on p.id = d.user_id
where lower(p.email) = 'rider@yopmail.com'
  and not exists (select 1 from public.vehicles v where v.driver_id = d.id);

update public.driver_profiles d set current_vehicle_id = (select v.id from public.vehicles v where v.driver_id = d.id limit 1)
from public.profiles p
where p.id = d.user_id and lower(p.email) = 'rider@yopmail.com' and d.current_vehicle_id is null;
end $seed$;
