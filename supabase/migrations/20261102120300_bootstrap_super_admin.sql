-- Bootstrap super admin (docs/spec/02-roles-permissions.md §6).
-- Idempotent. Looks up the existing auth user by email; never creates a user
-- and never stores a password. Does nothing where that user does not exist
-- (e.g. a fresh local database).

insert into public.profiles (id, role, status, full_name, email)
select u.id, 'admin', 'active', 'Super Admin', lower(u.email)
from auth.users u
where lower(u.email) = 'admin@yopmail.com'
on conflict (id) do nothing;

-- Must change the shared password on first sign-in (docs/spec/07-security.md §2.4).
insert into public.admin_profiles (id, must_change_password)
select p.id, true
from public.profiles p
where lower(p.email) = 'admin@yopmail.com' and p.role = 'admin'
on conflict (id) do nothing;

insert into public.admin_template_assignments (admin_id, template_id, assigned_by, reason)
select p.id, t.id, null, 'Bootstrap super admin'
from public.profiles p
join public.permission_templates t on t.code = 'super_admin'
where lower(p.email) = 'admin@yopmail.com' and p.role = 'admin'
  and not exists (
    select 1 from public.admin_template_assignments a
    where a.admin_id = p.id and a.template_id = t.id and a.revoked_at is null
  );
