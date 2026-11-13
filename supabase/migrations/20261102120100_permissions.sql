-- Admin permissions: catalogue, templates, assignments, overrides, guardrails,
-- custom access token hook, RLS and the admin RPCs.
-- Spec: docs/spec/02-roles-permissions.md

-- ---------------------------------------------------------------------------
-- Generic guard: on UPDATE only the listed columns may change, and the first
-- listed column (a "revoked/removed at" timestamp) may be set only once.
-- ---------------------------------------------------------------------------
create function private.only_revocation_columns_change() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_allowed text[] := tg_argv;
begin
  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    perform private.raise_error('IMMUTABLE_ROW', jsonb_build_object('table', tg_table_name));
  end if;
  if (to_jsonb(old) ->> v_allowed[1]) is not null then
    perform private.raise_error('IMMUTABLE_ROW', jsonb_build_object('table', tg_table_name));
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.permissions (
  code text primary key,
  module text not null,
  description text not null,
  is_high_impact boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint chk_permissions_code check (code ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$')
);

create table public.permission_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_builtin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  version integer not null default 1,
  constraint chk_permission_templates_code check (code ~ '^[a-z][a-z0-9_]{2,40}$'),
  constraint chk_permission_templates_name check (length(btrim(name)) between 2 and 80)
);

create table public.permission_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.permission_templates (id),
  permission_code text not null references public.permissions (code),
  created_at timestamptz not null default now(),
  created_by uuid,
  removed_at timestamptz,
  removed_by uuid
);

create unique index uq_template_items_active
  on public.permission_template_items (template_id, permission_code) where removed_at is null;

create table public.admin_profiles (
  id uuid primary key references public.profiles (id),
  title text,
  department text,
  mfa_enrolled_at timestamptz,
  must_change_password boolean not null default false,
  last_login_at timestamptz,
  last_login_ip inet,
  invited_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

create table public.admin_invitations (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null,
  full_name text not null,
  template_ids uuid[] not null default '{}',
  reason text not null,
  status text not null default 'pending',
  expires_at timestamptz not null default now() + interval '7 days',
  invited_by uuid not null references public.profiles (id),
  accepted_profile_id uuid references public.profiles (id),
  accepted_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint chk_admin_invitations_status check (status in ('pending', 'accepted', 'cancelled')),
  constraint chk_admin_invitations_email check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint chk_admin_invitations_full_name check (length(btrim(full_name)) between 1 and 120)
);

create unique index uq_admin_invitations_pending on public.admin_invitations (email) where status = 'pending';

create table public.admin_template_assignments (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles (id),
  template_id uuid not null references public.permission_templates (id),
  assigned_by uuid references public.profiles (id),
  reason text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  revoke_reason text,
  constraint chk_assignment_revoke_reason check (revoked_at is null or revoke_reason is not null)
);

create unique index uq_admin_template_assignments_active
  on public.admin_template_assignments (admin_id, template_id) where revoked_at is null;
create index idx_admin_template_assignments_template
  on public.admin_template_assignments (template_id) where revoked_at is null;

create table public.admin_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles (id),
  permission_code text not null references public.permissions (code),
  effect text not null,
  reason text not null,
  granted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  revoke_reason text,
  constraint chk_override_effect check (effect in ('grant', 'deny')),
  constraint chk_override_revoke_reason check (revoked_at is null or revoke_reason is not null)
);

create unique index uq_admin_permission_overrides_active
  on public.admin_permission_overrides (admin_id, permission_code) where revoked_at is null;

-- History is kept: rows are revoked, never deleted.
create trigger trg_permission_templates_stamp before insert or update on public.permission_templates
  for each row execute function private.stamp_row();
create trigger trg_admin_profiles_stamp before insert or update on public.admin_profiles
  for each row execute function private.stamp_row();

create trigger trg_template_items_revoke_only before update on public.permission_template_items
  for each row execute function private.only_revocation_columns_change('removed_at', 'removed_by');
create trigger trg_assignments_revoke_only before update on public.admin_template_assignments
  for each row execute function private.only_revocation_columns_change('revoked_at', 'revoked_by', 'revoke_reason');
create trigger trg_overrides_revoke_only before update on public.admin_permission_overrides
  for each row execute function private.only_revocation_columns_change('revoked_at', 'revoked_by', 'revoke_reason');

create trigger trg_permissions_no_delete before delete on public.permissions
  for each row execute function private.forbid_delete();
create trigger trg_permission_templates_no_delete before delete on public.permission_templates
  for each row execute function private.forbid_delete();
create trigger trg_template_items_no_delete before delete on public.permission_template_items
  for each row execute function private.forbid_delete();
create trigger trg_admin_profiles_no_delete before delete on public.admin_profiles
  for each row execute function private.forbid_delete();
create trigger trg_admin_invitations_no_delete before delete on public.admin_invitations
  for each row execute function private.forbid_delete();
create trigger trg_assignments_no_delete before delete on public.admin_template_assignments
  for each row execute function private.forbid_delete();
create trigger trg_overrides_no_delete before delete on public.admin_permission_overrides
  for each row execute function private.forbid_delete();

-- ---------------------------------------------------------------------------
-- Effective permissions = (template permissions ∪ grants) − denies
-- ---------------------------------------------------------------------------
create view public.admin_effective_permissions with (security_invoker = true) as
with granted as (
  select a.admin_id, i.permission_code
  from public.admin_template_assignments a
  join public.permission_templates t on t.id = a.template_id and t.deleted_at is null
  join public.permission_template_items i on i.template_id = a.template_id and i.removed_at is null
  where a.revoked_at is null
  union
  select o.admin_id, o.permission_code
  from public.admin_permission_overrides o
  where o.effect = 'grant' and o.revoked_at is null
)
select g.admin_id, g.permission_code
from granted g
where not exists (
  select 1 from public.admin_permission_overrides d
  where d.admin_id = g.admin_id
    and d.permission_code = g.permission_code
    and d.effect = 'deny'
    and d.revoked_at is null
);

-- ---------------------------------------------------------------------------
-- Permission helpers (SECURITY DEFINER: they read across RLS)
-- ---------------------------------------------------------------------------
create function private.is_active_admin(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.role = 'admin' and p.status = 'active' and p.deleted_at is null
  );
$$;

create function private.admin_holds(p_admin_id uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active_admin(p_admin_id) and exists (
    select 1 from public.admin_effective_permissions e
    where e.admin_id = p_admin_id and e.permission_code = p_permission
  );
$$;

create function private.permission_codes_of(p_admin_id uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct e.permission_code order by e.permission_code), '{}')
  from public.admin_effective_permissions e
  where e.admin_id = p_admin_id;
$$;

create function private.is_super_admin(p_admin_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active_admin(p_admin_id) and exists (
    select 1
    from public.admin_template_assignments a
    join public.permission_templates t on t.id = a.template_id
    where a.admin_id = p_admin_id and a.revoked_at is null
      and t.code = 'super_admin' and t.deleted_at is null
  );
$$;

create function private.has_aal2() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

-- Used by RLS policies: active admin, MFA verified, holds the permission.
create function private.has_permission(p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and private.has_aal2() and private.admin_holds(auth.uid(), p_permission);
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and private.has_aal2() and private.is_active_admin(auth.uid());
$$;

create function private.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

-- First statement of every admin RPC.
create function private.require_permission(p_permission text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  if not private.is_active_admin(auth.uid()) then
    perform private.raise_error('FORBIDDEN');
  end if;
  if not private.has_aal2() then
    perform private.raise_error('MFA_REQUIRED');
  end if;
  if not private.admin_holds(auth.uid(), p_permission) then
    perform private.raise_error('FORBIDDEN', jsonb_build_object('permission', p_permission));
  end if;
end $$;

create function private.require_super_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('admins.manage_permissions');
  if not private.is_super_admin(auth.uid()) then
    perform private.raise_error('FORBIDDEN', '{"requires":"super_admin"}');
  end if;
end $$;

-- Guardrail 1: no self-escalation — only permissions the caller holds can be granted.
create function private.assert_can_grant(p_codes text[]) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_missing text[];
begin
  select coalesce(array_agg(c order by c), '{}') into v_missing
  from unnest(p_codes) c
  where not private.admin_holds(auth.uid(), c);

  if cardinality(v_missing) > 0 then
    perform private.raise_error('PRIVILEGE_ESCALATION', jsonb_build_object('missing', v_missing));
  end if;
end $$;

-- Guardrail 3: an admin cannot remove admins.manage_permissions from themselves.
create function private.assert_no_self_lockout(p_target uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_target = auth.uid() and not private.admin_holds(auth.uid(), 'admins.manage_permissions') then
    perform private.raise_error('SELF_LOCKOUT');
  end if;
end $$;

create function private.require_admin_target(p_admin_id uuid) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles
  where id = p_admin_id and role = 'admin' and deleted_at is null
  for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  return v_profile;
end $$;

-- ---------------------------------------------------------------------------
-- Guardrail 2: at least one active super admin must always exist.
-- Deferred so multi-step changes in one transaction are judged at commit.
-- ---------------------------------------------------------------------------
create function private.assert_super_admin_exists() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1
    from public.admin_template_assignments a
    join public.permission_templates t on t.id = a.template_id and t.code = 'super_admin'
    join public.profiles p on p.id = a.admin_id
    where a.revoked_at is null and p.role = 'admin' and p.status = 'active' and p.deleted_at is null
  ) then
    perform private.raise_error('LAST_SUPER_ADMIN');
  end if;
  return null;
end $$;

create constraint trigger trg_assignments_keep_super_admin
  after update on public.admin_template_assignments
  deferrable initially deferred
  for each row when (old.revoked_at is null and new.revoked_at is not null)
  execute function private.assert_super_admin_exists();

create constraint trigger trg_profiles_keep_super_admin
  after update of status on public.profiles
  deferrable initially deferred
  for each row when (old.role = 'admin' and old.status = 'active' and new.status <> 'active')
  execute function private.assert_super_admin_exists();

-- Built-in templates cannot be renamed, un-built-in or deleted; the super_admin
-- template's permissions are locked (it always holds the whole catalogue).
create function private.protect_builtin_template() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.is_builtin and (
    new.is_builtin is distinct from old.is_builtin
    or new.code is distinct from old.code
    or new.deleted_at is not null
  ) then
    perform private.raise_error('BUILTIN_TEMPLATE');
  end if;
  return new;
end $$;

create trigger trg_permission_templates_builtin before update on public.permission_templates
  for each row execute function private.protect_builtin_template();

create function private.protect_super_admin_items() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.removed_at is not null and exists (
    select 1 from public.permission_templates t where t.id = old.template_id and t.code = 'super_admin'
  ) then
    perform private.raise_error('BUILTIN_TEMPLATE');
  end if;
  return new;
end $$;

create trigger trg_template_items_super_admin before update on public.permission_template_items
  for each row execute function private.protect_super_admin_items();

-- New catalogue permissions are added to super_admin automatically.
create function private.grant_new_permission_to_super_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.permission_template_items (template_id, permission_code)
  select t.id, new.code from public.permission_templates t where t.code = 'super_admin'
  on conflict do nothing;
  return new;
end $$;

create trigger trg_permissions_super_admin after insert on public.permissions
  for each row execute function private.grant_new_permission_to_super_admin();

-- ---------------------------------------------------------------------------
-- New auth users: create the profile. Admin accounts exist only through a
-- pending invitation created by an authorised admin (never from user metadata).
-- ---------------------------------------------------------------------------
create function private.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_invitation public.admin_invitations;
  v_name text;
  v_phone text;
begin
  select * into v_invitation from public.admin_invitations
  where email = lower(new.email)::extensions.citext and status = 'pending' and expires_at > now()
  for update;

  if v_invitation.id is not null then
    insert into public.profiles (id, role, status, full_name, email, created_by)
    values (new.id, 'admin', 'active', v_invitation.full_name, new.email, v_invitation.invited_by);

    insert into public.admin_profiles (id, invited_by, created_by)
    values (new.id, v_invitation.invited_by, v_invitation.invited_by);

    insert into public.admin_template_assignments (admin_id, template_id, assigned_by, reason)
    select new.id, t.id, v_invitation.invited_by, 'Invitation: ' || v_invitation.reason
    from public.permission_templates t
    where t.id = any (v_invitation.template_ids) and t.deleted_at is null;

    update public.admin_invitations
    set status = 'accepted', accepted_profile_id = new.id, accepted_at = now()
    where id = v_invitation.id;
    return new;
  end if;

  v_name := left(coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'User'), 120);
  v_phone := case
    when new.phone ~ '^\+[1-9][0-9]{7,14}$' then new.phone
    when new.phone ~ '^[1-9][0-9]{7,14}$' then '+' || new.phone
  end;

  insert into public.profiles (id, role, full_name, email, phone)
  values (new.id, 'user', v_name, new.email, v_phone);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Custom Access Token Hook: adds app_role and status to the JWT for routing.
-- Authorisation in the DB always re-reads profiles.
-- ---------------------------------------------------------------------------
create function private.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_claims jsonb := coalesce(event -> 'claims', '{}');
  v_role public.app_role;
  v_status public.account_status;
begin
  select p.role, p.status into v_role, v_status
  from public.profiles p where p.id = (event ->> 'user_id')::uuid;

  if v_role is null then
    v_claims := v_claims - 'app_role' - 'status';
  else
    v_claims := v_claims || jsonb_build_object('app_role', v_role, 'status', v_status);
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end $$;

grant usage on schema private to supabase_auth_admin;
grant execute on function private.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Admin RPCs (api schema)
-- ---------------------------------------------------------------------------

-- One round trip for the admin Data Access Layer.
create function api.my_admin_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', p.id,
    'role', p.role,
    'status', p.status,
    'full_name', p.full_name,
    'email', p.email,
    'must_change_password', coalesce(ap.must_change_password, false),
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

create function api.invite_admin(p_email text, p_full_name text, p_template_ids uuid[], p_reason text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_email extensions.citext := lower(btrim(p_email));
  v_template_ids uuid[] := coalesce(p_template_ids, '{}');
  v_codes text[];
  v_found integer;
  v_id uuid;
begin
  perform private.require_permission('admins.invite');
  v_reason := private.require_reason(p_reason);

  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"email","message":"Enter a valid email."}]}');
  end if;
  if p_full_name is null or length(btrim(p_full_name)) not between 1 and 120 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"full_name","message":"Enter a name."}]}');
  end if;

  if exists (select 1 from public.profiles where email = v_email)
     or exists (select 1 from auth.users where lower(email) = v_email::text) then
    perform private.raise_error('ALREADY_EXISTS', '{"field":"email"}');
  end if;

  -- An expired pending invitation is closed so a fresh one can be issued.
  update public.admin_invitations
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
  where email = v_email and status = 'pending' and expires_at <= now();

  if exists (select 1 from public.admin_invitations where email = v_email and status = 'pending') then
    perform private.raise_error('ALREADY_EXISTS', '{"field":"email","reason":"pending_invitation"}');
  end if;

  if cardinality(v_template_ids) > 0 then
    perform private.require_permission('admins.manage_permissions');

    select count(*) into v_found from public.permission_templates
    where id = any (v_template_ids) and deleted_at is null;
    if v_found <> cardinality(array(select distinct unnest(v_template_ids))) then
      perform private.raise_error('NOT_FOUND', '{"field":"template_ids"}');
    end if;

    if exists (select 1 from public.permission_templates where id = any (v_template_ids) and code = 'super_admin')
       and not private.is_super_admin(auth.uid()) then
      perform private.raise_error('PRIVILEGE_ESCALATION', '{"template":"super_admin"}');
    end if;

    select coalesce(array_agg(distinct i.permission_code), '{}') into v_codes
    from public.permission_template_items i
    where i.template_id = any (v_template_ids) and i.removed_at is null;
    perform private.assert_can_grant(v_codes);
  end if;

  insert into public.admin_invitations (email, full_name, template_ids, reason, invited_by)
  values (v_email, btrim(p_full_name), v_template_ids, v_reason, auth.uid())
  returning id into v_id;

  perform private.log_admin_action('admin.invite', 'admin_invitation', v_id, null,
    jsonb_build_object('email', v_email, 'template_ids', v_template_ids), v_reason);
  return v_id;
end $$;

create function api.cancel_admin_invitation(p_invitation_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
begin
  perform private.require_permission('admins.invite');
  v_reason := private.require_reason(p_reason);

  update public.admin_invitations
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
  where id = p_invitation_id and status = 'pending';
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;

  perform private.log_admin_action('admin.invite.cancel', 'admin_invitation', p_invitation_id, null, null, v_reason);
end $$;

create function api.assign_permission_template(p_admin_id uuid, p_template_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_template public.permission_templates;
  v_before text[];
  v_codes text[];
begin
  perform private.require_permission('admins.manage_permissions');
  v_reason := private.require_reason(p_reason);
  perform private.require_admin_target(p_admin_id);

  select * into v_template from public.permission_templates
  where id = p_template_id and deleted_at is null;
  if not found then
    perform private.raise_error('NOT_FOUND', '{"field":"template_id"}');
  end if;

  if exists (select 1 from public.admin_template_assignments
             where admin_id = p_admin_id and template_id = p_template_id and revoked_at is null) then
    return; -- already assigned: idempotent
  end if;

  if v_template.code = 'super_admin' and not private.is_super_admin(auth.uid()) then
    perform private.raise_error('PRIVILEGE_ESCALATION', '{"template":"super_admin"}');
  end if;

  select coalesce(array_agg(permission_code), '{}') into v_codes
  from public.permission_template_items where template_id = p_template_id and removed_at is null;
  perform private.assert_can_grant(v_codes);

  v_before := private.permission_codes_of(p_admin_id);

  insert into public.admin_template_assignments (admin_id, template_id, assigned_by, reason)
  values (p_admin_id, p_template_id, auth.uid(), v_reason);

  perform private.log_admin_action('admin.template.assign', 'admin', p_admin_id,
    jsonb_build_object('permissions', v_before),
    jsonb_build_object('permissions', private.permission_codes_of(p_admin_id), 'template', v_template.code),
    v_reason);

  if p_admin_id <> auth.uid() then
    perform private.notify(p_admin_id, 'permissions.changed', 'Your permissions changed',
      'You were given the ' || v_template.name || ' permission set.', '/profile');
  end if;
end $$;

create function api.revoke_permission_template(p_admin_id uuid, p_template_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_template public.permission_templates;
  v_before text[];
begin
  perform private.require_permission('admins.manage_permissions');
  v_reason := private.require_reason(p_reason);
  perform private.require_admin_target(p_admin_id);

  select * into v_template from public.permission_templates where id = p_template_id;
  if not found then
    perform private.raise_error('NOT_FOUND', '{"field":"template_id"}');
  end if;
  if v_template.code = 'super_admin' and not private.is_super_admin(auth.uid()) then
    perform private.raise_error('PRIVILEGE_ESCALATION', '{"template":"super_admin"}');
  end if;

  v_before := private.permission_codes_of(p_admin_id);

  update public.admin_template_assignments
  set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = v_reason
  where admin_id = p_admin_id and template_id = p_template_id and revoked_at is null;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;

  perform private.assert_no_self_lockout(p_admin_id);

  perform private.log_admin_action('admin.template.revoke', 'admin', p_admin_id,
    jsonb_build_object('permissions', v_before),
    jsonb_build_object('permissions', private.permission_codes_of(p_admin_id), 'template', v_template.code),
    v_reason);

  if p_admin_id <> auth.uid() then
    perform private.notify(p_admin_id, 'permissions.changed', 'Your permissions changed',
      'The ' || v_template.name || ' permission set was removed from your account.', '/profile');
  end if;
end $$;

create function api.set_permission_override(p_admin_id uuid, p_permission text, p_effect text, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_before text[];
begin
  perform private.require_permission('admins.manage_permissions');
  v_reason := private.require_reason(p_reason);
  perform private.require_admin_target(p_admin_id);

  if p_effect is null or p_effect not in ('grant', 'deny') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"effect","message":"Must be grant or deny."}]}');
  end if;
  if not exists (select 1 from public.permissions where code = p_permission) then
    perform private.raise_error('NOT_FOUND', '{"field":"permission"}');
  end if;

  if p_effect = 'grant' then
    perform private.assert_can_grant(array[p_permission]);
  elsif private.is_super_admin(p_admin_id) and not private.is_super_admin(auth.uid()) then
    -- Only a super admin may restrict another super admin.
    perform private.raise_error('PRIVILEGE_ESCALATION', '{"target":"super_admin"}');
  end if;

  v_before := private.permission_codes_of(p_admin_id);

  update public.admin_permission_overrides
  set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = 'Replaced: ' || v_reason
  where admin_id = p_admin_id and permission_code = p_permission and revoked_at is null;

  insert into public.admin_permission_overrides (admin_id, permission_code, effect, reason, granted_by)
  values (p_admin_id, p_permission, p_effect, v_reason, auth.uid());

  perform private.assert_no_self_lockout(p_admin_id);

  perform private.log_admin_action('admin.permission.' || p_effect, 'admin', p_admin_id,
    jsonb_build_object('permissions', v_before),
    jsonb_build_object('permissions', private.permission_codes_of(p_admin_id), 'permission', p_permission),
    v_reason);

  if p_admin_id <> auth.uid() then
    perform private.notify(p_admin_id, 'permissions.changed', 'Your permissions changed',
      case p_effect when 'grant' then 'You were granted ' else 'You lost access to ' end || p_permission || '.',
      '/profile');
  end if;
end $$;

create function api.clear_permission_override(p_admin_id uuid, p_permission text, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_override public.admin_permission_overrides;
  v_before text[];
begin
  perform private.require_permission('admins.manage_permissions');
  v_reason := private.require_reason(p_reason);
  perform private.require_admin_target(p_admin_id);

  select * into v_override from public.admin_permission_overrides
  where admin_id = p_admin_id and permission_code = p_permission and revoked_at is null
  for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;

  -- Clearing a deny can restore access, so it counts as a grant.
  if v_override.effect = 'deny' then
    perform private.assert_can_grant(array[p_permission]);
  end if;

  v_before := private.permission_codes_of(p_admin_id);

  update public.admin_permission_overrides
  set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = v_reason
  where id = v_override.id;

  perform private.assert_no_self_lockout(p_admin_id);

  perform private.log_admin_action('admin.permission.clear', 'admin', p_admin_id,
    jsonb_build_object('permissions', v_before),
    jsonb_build_object('permissions', private.permission_codes_of(p_admin_id), 'permission', p_permission),
    v_reason);

  if p_admin_id <> auth.uid() then
    perform private.notify(p_admin_id, 'permissions.changed', 'Your permissions changed',
      'An individual permission change for ' || p_permission || ' was removed.', '/profile');
  end if;
end $$;

create function api.suspend_admin(p_admin_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_target public.profiles;
begin
  perform private.require_permission('admins.suspend');
  v_reason := private.require_reason(p_reason);
  v_target := private.require_admin_target(p_admin_id);

  if p_admin_id = auth.uid() then
    perform private.raise_error('SELF_LOCKOUT');
  end if;
  if private.is_super_admin(p_admin_id) and not private.is_super_admin(auth.uid()) then
    perform private.raise_error('PRIVILEGE_ESCALATION', '{"target":"super_admin"}');
  end if;
  if v_target.status <> 'active' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', v_target.status));
  end if;

  update public.profiles set status = 'suspended', suspended_reason = v_reason where id = p_admin_id;

  insert into public.account_status_events (profile_id, old_status, new_status, reason, actor_id, actor_type)
  values (p_admin_id, v_target.status, 'suspended', v_reason, auth.uid(), 'admin');

  perform private.log_admin_action('admin.suspend', 'admin', p_admin_id,
    jsonb_build_object('status', v_target.status), jsonb_build_object('status', 'suspended'), v_reason);
end $$;

create function api.reactivate_admin(p_admin_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_target public.profiles;
begin
  perform private.require_permission('admins.suspend');
  v_reason := private.require_reason(p_reason);
  v_target := private.require_admin_target(p_admin_id);

  if v_target.status <> 'suspended' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', v_target.status));
  end if;

  update public.profiles set status = 'active', suspended_reason = null where id = p_admin_id;

  insert into public.account_status_events (profile_id, old_status, new_status, reason, actor_id, actor_type)
  values (p_admin_id, 'suspended', 'active', v_reason, auth.uid(), 'admin');

  perform private.log_admin_action('admin.reactivate', 'admin', p_admin_id,
    jsonb_build_object('status', 'suspended'), jsonb_build_object('status', 'active'), v_reason);

  perform private.notify(p_admin_id, 'account.reactivated', 'Your account was reactivated', null, '/dashboard');
end $$;

-- Template management (super admins only, guardrail 5).
create function private.assert_known_permissions(p_codes text[]) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_unknown text[];
begin
  select coalesce(array_agg(c), '{}') into v_unknown
  from unnest(p_codes) c
  where not exists (select 1 from public.permissions p where p.code = c);
  if cardinality(v_unknown) > 0 then
    perform private.raise_error('NOT_FOUND', jsonb_build_object('permissions', v_unknown));
  end if;
end $$;

create function api.create_permission_template(
  p_code text, p_name text, p_description text, p_permissions text[], p_reason text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_codes text[] := array(select distinct unnest(coalesce(p_permissions, '{}')));
  v_id uuid;
begin
  perform private.require_super_admin();
  v_reason := private.require_reason(p_reason);

  if p_code is null or p_code !~ '^[a-z][a-z0-9_]{2,40}$' then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"code","message":"Use 3-41 lowercase letters, digits or underscores."}]}');
  end if;
  if p_name is null or length(btrim(p_name)) not between 2 and 80 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"name","message":"Enter a name of 2-80 characters."}]}');
  end if;
  if exists (select 1 from public.permission_templates where code = p_code) then
    perform private.raise_error('ALREADY_EXISTS', '{"field":"code"}');
  end if;
  perform private.assert_known_permissions(v_codes);

  insert into public.permission_templates (code, name, description, is_builtin)
  values (p_code, btrim(p_name), nullif(btrim(p_description), ''), false)
  returning id into v_id;

  insert into public.permission_template_items (template_id, permission_code, created_by)
  select v_id, c, auth.uid() from unnest(v_codes) c;

  perform private.log_admin_action('permission_template.create', 'permission_template', v_id, null,
    jsonb_build_object('code', p_code, 'permissions', v_codes), v_reason);
  return v_id;
end $$;

create function api.set_template_permissions(p_template_id uuid, p_permissions text[], p_reason text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_template public.permission_templates;
  v_new text[] := array(select distinct unnest(coalesce(p_permissions, '{}')) order by 1);
  v_old text[];
  v_affected integer;
  v_admin uuid;
begin
  perform private.require_super_admin();
  v_reason := private.require_reason(p_reason);

  select * into v_template from public.permission_templates
  where id = p_template_id and deleted_at is null for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if v_template.code = 'super_admin' then
    perform private.raise_error('BUILTIN_TEMPLATE');
  end if;
  perform private.assert_known_permissions(v_new);

  select coalesce(array_agg(permission_code order by permission_code), '{}') into v_old
  from public.permission_template_items where template_id = p_template_id and removed_at is null;

  if v_old = v_new then
    return 0;
  end if;

  update public.permission_template_items
  set removed_at = now(), removed_by = auth.uid()
  where template_id = p_template_id and removed_at is null and permission_code <> all (v_new);

  insert into public.permission_template_items (template_id, permission_code, created_by)
  select p_template_id, c, auth.uid() from unnest(v_new) c
  where c <> all (v_old);

  update public.permission_templates set version = version where id = p_template_id; -- bumps updated_at/version

  select count(*) into v_affected from public.admin_template_assignments
  where template_id = p_template_id and revoked_at is null;

  perform private.assert_no_self_lockout(auth.uid());

  perform private.log_admin_action('permission_template.update', 'permission_template', p_template_id,
    jsonb_build_object('permissions', v_old),
    jsonb_build_object('permissions', v_new, 'affected_admins', v_affected),
    v_reason);

  for v_admin in
    select admin_id from public.admin_template_assignments
    where template_id = p_template_id and revoked_at is null and admin_id <> auth.uid()
  loop
    perform private.notify(v_admin, 'permissions.changed', 'Your permissions changed',
      'The ' || v_template.name || ' permission set was updated.', '/profile');
  end loop;

  return v_affected;
end $$;

create function api.delete_permission_template(p_template_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_template public.permission_templates;
begin
  perform private.require_super_admin();
  v_reason := private.require_reason(p_reason);

  select * into v_template from public.permission_templates
  where id = p_template_id and deleted_at is null for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if v_template.is_builtin then
    perform private.raise_error('BUILTIN_TEMPLATE');
  end if;
  if exists (select 1 from public.admin_template_assignments where template_id = p_template_id and revoked_at is null) then
    perform private.raise_error('TEMPLATE_IN_USE');
  end if;

  update public.permission_templates
  set deleted_at = now(), deleted_by = auth.uid(), delete_reason = v_reason
  where id = p_template_id;

  perform private.log_admin_action('permission_template.delete', 'permission_template', p_template_id,
    jsonb_build_object('code', v_template.code), null, v_reason);
end $$;

create function api.template_impact(p_template_id uuid) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare
  v_count integer;
begin
  perform private.require_permission('admins.view');
  select count(*) into v_count from public.admin_template_assignments
  where template_id = p_template_id and revoked_at is null;
  return v_count;
end $$;

create function api.mark_notifications_read(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  update public.notifications set read_at = now()
  where recipient_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: no direct writes from clients; reads are RLS-filtered.
-- ---------------------------------------------------------------------------
revoke all on table
  public.profiles, public.account_status_events, public.admin_audit_logs, public.notifications,
  public.permissions, public.permission_templates, public.permission_template_items,
  public.admin_profiles, public.admin_invitations, public.admin_template_assignments,
  public.admin_permission_overrides, public.admin_effective_permissions
from anon, authenticated;

grant select on table
  public.profiles, public.account_status_events, public.admin_audit_logs, public.notifications,
  public.permissions, public.permission_templates, public.permission_template_items,
  public.admin_profiles, public.admin_invitations, public.admin_template_assignments,
  public.admin_permission_overrides, public.admin_effective_permissions
to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema api from public, anon, authenticated;

-- Helpers referenced from RLS policies run as the requesting role.
grant execute on function
  private.has_permission(text), private.is_admin(), private.has_aal2(), private.current_app_role()
to authenticated;

grant execute on function
  api.my_admin_context(),
  api.invite_admin(text, text, uuid[], text),
  api.cancel_admin_invitation(uuid, text),
  api.assign_permission_template(uuid, uuid, text),
  api.revoke_permission_template(uuid, uuid, text),
  api.set_permission_override(uuid, text, text, text),
  api.clear_permission_override(uuid, text, text),
  api.suspend_admin(uuid, text),
  api.reactivate_admin(uuid, text),
  api.create_permission_template(text, text, text, text[], text),
  api.set_template_permissions(uuid, text[], text),
  api.delete_permission_template(uuid, text),
  api.template_impact(uuid),
  api.mark_notifications_read(uuid[])
to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security (default deny; policies grant reads only)
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.account_status_events enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.permissions enable row level security;
alter table public.permission_templates enable row level security;
alter table public.permission_template_items enable row level security;
alter table public.admin_profiles enable row level security;
alter table public.admin_invitations enable row level security;
alter table public.admin_template_assignments enable row level security;
alter table public.admin_permission_overrides enable row level security;

create policy profiles_select on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or (role = 'admin' and (select private.has_permission('admins.view')))
  or (role in ('passenger', 'user') and (select private.has_permission('passengers.view')))
  or (role = 'driver' and (select private.has_permission('drivers.view')))
);

create policy account_status_events_select on public.account_status_events for select to authenticated
  using ((select private.has_permission('audit.view')));

create policy admin_audit_logs_select on public.admin_audit_logs for select to authenticated
  using ((select private.has_permission('audit.view')));

create policy notifications_select on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()));

create policy permissions_select on public.permissions for select to authenticated
  using ((select private.is_admin()));

create policy permission_templates_select on public.permission_templates for select to authenticated
  using ((select private.is_admin()));

create policy permission_template_items_select on public.permission_template_items for select to authenticated
  using ((select private.is_admin()));

create policy admin_profiles_select on public.admin_profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.has_permission('admins.view')));

create policy admin_invitations_select on public.admin_invitations for select to authenticated
  using ((select private.has_permission('admins.view')));

create policy admin_template_assignments_select on public.admin_template_assignments for select to authenticated
  using (admin_id = (select auth.uid()) or (select private.has_permission('admins.view')));

create policy admin_permission_overrides_select on public.admin_permission_overrides for select to authenticated
  using (admin_id = (select auth.uid()) or (select private.has_permission('admins.view')));
