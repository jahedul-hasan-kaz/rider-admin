-- Adds is_super_admin to the admin context so the UI can show super-admin-only
-- controls (template editing, super_admin assignment). The RPCs still enforce it.
create or replace function api.my_admin_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', p.id,
    'role', p.role,
    'status', p.status,
    'full_name', p.full_name,
    'email', p.email,
    'preferred_language', p.preferred_language,
    'version', p.version,
    'must_change_password', coalesce(ap.must_change_password, false),
    'mfa_enrolled_at', ap.mfa_enrolled_at,
    'is_super_admin', case when private.has_aal2() then private.is_super_admin(p.id) else false end,
    'permissions', case
      when p.role = 'admin' and p.status = 'active' and p.deleted_at is null and private.has_aal2()
      then to_jsonb(private.permission_codes_of(p.id))
      else '[]'::jsonb
    end
  )
  from public.profiles p
  left join public.admin_profiles ap on ap.id = p.id
  where p.id = auth.uid();
$$;
