-- "Last sign-in" means full authentication (AAL2). Invited admins never pass
-- through the password sign-in step, so stamp last_login_* on MFA success too.
create or replace function api.record_admin_auth_event(p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_ip text := btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1));
  v_full_auth boolean := p_event in ('mfa_enrolled', 'mfa_verified');
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  if not private.is_active_admin(auth.uid()) then
    perform private.raise_error('FORBIDDEN');
  end if;
  if p_event not in ('sign_in', 'mfa_enrolled', 'mfa_verified', 'mfa_failed', 'password_changed', 'sign_out') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"event","message":"Unknown event."}]}');
  end if;

  insert into public.admin_profiles (id) values (auth.uid()) on conflict (id) do nothing;

  update public.admin_profiles set
    last_login_at = case when v_full_auth then now() else last_login_at end,
    last_login_ip = case when v_full_auth and v_ip ~ '^[0-9a-fA-F:.]+$' then v_ip::inet else last_login_ip end,
    mfa_enrolled_at = case when p_event = 'mfa_enrolled' then coalesce(mfa_enrolled_at, now()) else mfa_enrolled_at end,
    must_change_password = case when p_event = 'password_changed' then false else must_change_password end
  where id = auth.uid();

  perform private.log_admin_action('auth.' || p_event, 'admin', auth.uid(), null, null, null);
end $$;
