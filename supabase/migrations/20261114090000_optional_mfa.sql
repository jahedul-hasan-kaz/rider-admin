-- Two-factor authentication is optional. An admin who has not turned it on works with their password alone; an admin who
-- has turned it on must verify a code every time they sign in. Settings → Feature flags → `require_admin_mfa` makes it
-- mandatory again for everyone (then admins without a factor are sent to set one up).
--
-- `private.has_aal2()` keeps its name because every permission check and row-level-security policy already calls it; it
-- now means "this session satisfies the two-factor rule":
--   * a session verified with a code (aal2), or
--   * the admin has no verified factor and the flag is off (a code is not possible for them, so password alone is enough).
-- A person WITH a verified factor who signed in with a password only (aal1) is still locked out until the code is verified.

insert into public.feature_flags (key, enabled, description) values
  ('require_admin_mfa', false, 'Every admin must use two-factor authentication (admins without it are asked to set it up).')
on conflict (key) do nothing;

create or replace function private.has_mfa_factor(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.mfa_factors f where f.user_id = p_user and f.status = 'verified');
$$;

create or replace function private.has_aal2() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or (auth.uid() is not null
          and not private.flag_enabled('require_admin_mfa')
          and not private.has_mfa_factor(auth.uid()));
$$;

-- The admin context tells the app where the person stands, so it can route them (verify, set up, or straight in).
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
    'mfa_enabled', private.has_mfa_factor(p.id),
    'mfa_required', private.flag_enabled('require_admin_mfa'),
    'mfa_satisfied', private.has_aal2(),
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

-- Turning two-factor off is an auth event like turning it on. "Last sign-in" means full authentication: a verified code,
-- or a password sign-in by someone who does not use two-factor (a password sign-in that still needs a code does not count).
create or replace function api.record_admin_auth_event(p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_ip text := btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1));
  v_full_auth boolean;
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  if not private.is_active_admin(auth.uid()) then
    perform private.raise_error('FORBIDDEN');
  end if;
  if p_event not in ('sign_in', 'mfa_enrolled', 'mfa_removed', 'mfa_verified', 'mfa_failed', 'password_changed', 'sign_out') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"event","message":"Unknown event."}]}');
  end if;
  v_full_auth := p_event in ('mfa_enrolled', 'mfa_verified') or (p_event = 'sign_in' and private.has_aal2());

  insert into public.admin_profiles (id) values (auth.uid()) on conflict (id) do nothing;

  update public.admin_profiles set
    last_login_at = case when v_full_auth then now() else last_login_at end,
    last_login_ip = case when v_full_auth and v_ip ~ '^[0-9a-fA-F:.]+$' then v_ip::inet else last_login_ip end,
    mfa_enrolled_at = case when p_event = 'mfa_enrolled' then coalesce(mfa_enrolled_at, now())
                           when p_event = 'mfa_removed' then null else mfa_enrolled_at end,
    must_change_password = case when p_event = 'password_changed' then false else must_change_password end
  where id = auth.uid();

  perform private.log_admin_action('auth.' || p_event, 'admin', auth.uid(), null, null, null);
end $$;

-- Tokens carry whether the person has a verified factor, so the proxy can send them to the code page without a lookup.
create or replace function private.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_claims jsonb := coalesce(event -> 'claims', '{}');
  v_role public.app_role;
  v_status public.account_status;
begin
  select p.role, p.status into v_role, v_status
  from public.profiles p where p.id = (event ->> 'user_id')::uuid;

  if v_role is null then
    v_claims := v_claims - 'app_role' - 'status' - 'mfa_enrolled';
  else
    v_claims := v_claims || jsonb_build_object('app_role', v_role, 'status', v_status,
      'mfa_enrolled', private.has_mfa_factor((event ->> 'user_id')::uuid));
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end $$;

revoke execute on function private.has_mfa_factor(uuid) from public, anon;
grant execute on function private.has_mfa_factor(uuid) to authenticated, supabase_auth_admin;
grant execute on function private.has_aal2() to authenticated;
grant execute on function private.custom_access_token_hook(jsonb) to supabase_auth_admin;
