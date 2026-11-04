-- Roles & permissions (docs/spec/02-roles-permissions.md).
-- Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

-- ---------------------------------------------------------------------------
-- Fixtures. Admins are created the only way they can be: through an invitation.
-- ---------------------------------------------------------------------------
\set inviter   '''00000000-0000-0000-0000-0000000000a0'''
\set sa        '''00000000-0000-0000-0000-0000000000a1'''
\set sa2       '''00000000-0000-0000-0000-0000000000a2'''
\set ops       '''00000000-0000-0000-0000-0000000000a3'''
\set plain     '''00000000-0000-0000-0000-0000000000a4'''
\set rider     '''00000000-0000-0000-0000-0000000000b1'''
\set sneaky    '''00000000-0000-0000-0000-0000000000b2'''

insert into auth.users (id, email) values (:inviter, 'inviter@test.local');

insert into public.admin_invitations (email, full_name, template_ids, reason, invited_by)
select e.email, e.name, array(select id from public.permission_templates where code = any (e.templates)), 'test fixture', :inviter
from (values
  ('sa@test.local', 'Super One', array['super_admin']),
  ('sa2@test.local', 'Super Two', array['super_admin']),
  ('ops@test.local', 'Ops Person', array['operations']),
  ('plain@test.local', 'Plain Admin', array[]::text[])
) as e(email, name, templates);

insert into auth.users (id, email) values
  (:sa, 'sa@test.local'), (:sa2, 'sa2@test.local'), (:ops, 'ops@test.local'), (:plain, 'plain@test.local');
insert into auth.users (id, email, raw_user_meta_data) values
  (:rider, 'rider@test.local', '{"full_name":"Rider"}'),
  (:sneaky, 'sneaky@test.local', '{"full_name":"Sneaky","app_role":"admin","role":"admin"}');

-- Signs in as a user with the given assurance level for the rest of the block.
create function pg_temp.as_user(p_id uuid, p_aal text default 'aal2') returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

-- ---------------------------------------------------------------------------
-- Catalogue and templates
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.permissions), 62, 'catalogue has 62 permissions');
select is(
  (select count(*)::int from public.permission_template_items i
   join public.permission_templates t on t.id = i.template_id
   where t.code = 'super_admin' and i.removed_at is null),
  62, 'super_admin template holds every permission');
select ok(not private.admin_holds(:ops, 'ledger.view'), 'operations does not hold ledger.view');
select ok(private.admin_holds(:ops, 'drivers.approve'), 'operations holds drivers.approve');
select is((select count(*)::int from public.permission_templates where is_builtin), 6, 'six built-in templates');

-- ---------------------------------------------------------------------------
-- Role creation and immutability
-- ---------------------------------------------------------------------------
select is((select role::text from public.profiles where id = :sa), 'admin', 'invited user becomes admin');
select is((select role::text from public.profiles where id = :rider), 'user', 'uninvited sign-up becomes user');
select is((select role::text from public.profiles where id = :sneaky), 'user', 'user metadata cannot make an admin');

select throws_ok(format('update public.profiles set role = %L where id = %L', 'admin', :rider),
  'P0001', 'ROLE_IMMUTABLE', 'role cannot be changed directly');
select throws_ok(format('update public.profiles set role = %L where id = %L', 'passenger', :rider),
  'P0001', 'ROLE_IMMUTABLE', 'even user -> passenger is blocked outside the promotion path');
select lives_ok(format('select private.promote_user_role(%L, %L)', :rider, 'passenger'),
  'onboarding promotes user -> passenger');
select throws_ok(format('select private.promote_user_role(%L, %L)', :rider, 'driver'),
  'P0001', 'ROLE_IMMUTABLE', 'passenger -> driver is not a promotion');
select throws_ok(format('delete from public.profiles where id = %L', :plain),
  'P0001', 'DELETE_FORBIDDEN', 'profiles are never hard-deleted');

-- ---------------------------------------------------------------------------
-- Access token hook
-- ---------------------------------------------------------------------------
select is(
  private.custom_access_token_hook(jsonb_build_object('user_id', :ops, 'claims', '{"sub":"x"}'::jsonb))
    -> 'claims' ->> 'app_role',
  'admin', 'hook adds app_role');

-- ---------------------------------------------------------------------------
-- Two-factor is optional: no factor means the password is enough; a verified factor means a code is required;
-- the `require_admin_mfa` flag makes it mandatory for everyone.
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(:ops, 'aal1');
select ok(private.has_permission('trips.view'), 'an admin without two-factor works with a password alone');
select is((api.my_admin_context() ->> 'mfa_satisfied')::boolean, true, 'and the context says the rule is satisfied');
select is((api.my_admin_context() ->> 'mfa_enabled')::boolean, false, 'with two-factor reported off');
reset role;

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values (gen_random_uuid(), :ops, 'test', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP');
set local role authenticated;
select pg_temp.as_user(:ops, 'aal1');
select ok(not private.has_permission('trips.view'), 'once two-factor is on, a password-only session has no permissions');
select is(jsonb_array_length(api.my_admin_context() -> 'permissions'), 0, 'context lists no permissions until the code is verified');
select is((api.my_admin_context() ->> 'mfa_enabled')::boolean, true, 'and reports two-factor on');
select throws_ok('select api.template_impact(gen_random_uuid())', 'P0001', 'MFA_REQUIRED', 'RPCs ask for the code');
reset role;
delete from auth.mfa_factors where user_id = :ops;

update public.feature_flags set enabled = true where key = 'require_admin_mfa';
set local role authenticated;
select pg_temp.as_user(:ops, 'aal1');
select ok(not private.has_permission('trips.view'), 'when two-factor is required, an admin without it is locked out until they set it up');
select is((api.my_admin_context() ->> 'mfa_required')::boolean, true, 'and the context says it is required');
reset role;
update public.feature_flags set enabled = false where key = 'require_admin_mfa';
set local role authenticated;

select pg_temp.as_user(:ops);
select ok(private.has_permission('trips.view'), 'aal2 admin holds trips.view');
select ok((api.my_admin_context() -> 'permissions') ? 'drivers.approve', 'context lists template permissions');

-- ---------------------------------------------------------------------------
-- RLS: reads are scoped; direct writes are impossible
-- ---------------------------------------------------------------------------
select pg_temp.as_user(:rider);
select is((select count(*)::int from public.permissions), 0, 'non-admin cannot read the catalogue');
select is((select count(*)::int from public.profiles), 1, 'non-admin sees only their own profile');

select pg_temp.as_user(:plain);
select is((select count(*)::int from public.profiles), 1, 'admin without admins.view sees only self');
select is((select count(*)::int from public.permissions), 62, 'any MFA-verified admin can read the catalogue');
select throws_ok(
  format('insert into public.admin_permission_overrides (admin_id, permission_code, effect, reason) values (%L, %L, %L, %L)',
    :plain, 'ledger.view', 'grant', 'self grant'),
  '42501', null, 'direct table writes are rejected');

-- ---------------------------------------------------------------------------
-- Guardrails
-- ---------------------------------------------------------------------------
select pg_temp.as_user(:sa);
select throws_ok(
  format('select api.set_permission_override(%L, %L, %L, %L)', :ops, 'admins.manage_permissions', 'grant', 'x'),
  'P0001', 'VALIDATION_FAILED', 'a reason is required');
select lives_ok(
  format('select api.set_permission_override(%L, %L, %L, %L)', :ops, 'admins.manage_permissions', 'grant', 'Ops lead manages the team'),
  'super admin grants manage_permissions to ops');

select pg_temp.as_user(:ops);
select throws_ok(
  format('select api.set_permission_override(%L, %L, %L, %L)', :plain, 'ledger.view', 'grant', 'Needs ledger access'),
  'P0001', 'PRIVILEGE_ESCALATION', 'cannot grant a permission you do not hold');
select throws_ok(
  format('select api.assign_permission_template(%L, (select id from public.permission_templates where code = %L), %L)',
    :plain, 'finance', 'Moving to finance'),
  'P0001', 'PRIVILEGE_ESCALATION', 'cannot assign a template with permissions you do not hold');
select throws_ok(
  format('select api.assign_permission_template(%L, (select id from public.permission_templates where code = %L), %L)',
    :plain, 'super_admin', 'Promote to super admin'),
  'P0001', 'PRIVILEGE_ESCALATION', 'only super admins assign super_admin');
select lives_ok(
  format('select api.assign_permission_template(%L, (select id from public.permission_templates where code = %L), %L)',
    :plain, 'operations', 'Joining the ops team'),
  'can assign a template whose permissions you hold');
select throws_ok(
  format('select api.set_permission_override(%L, %L, %L, %L)', :ops, 'admins.manage_permissions', 'deny', 'Removing my own access'),
  'P0001', 'SELF_LOCKOUT', 'cannot remove manage_permissions from yourself');
select throws_ok(
  format('select api.suspend_admin(%L, %L)', :plain, 'Left the company'),
  'P0001', 'FORBIDDEN', 'suspending needs admins.suspend');

select pg_temp.as_user(:sa);
select throws_ok(format('select api.suspend_admin(%L, %L)', :sa, 'Suspending myself'),
  'P0001', 'SELF_LOCKOUT', 'cannot suspend yourself');
select lives_ok(format('select api.suspend_admin(%L, %L)', :sa2, 'Account under review'),
  'super admin suspends another super admin');
select is((select status::text from public.profiles where id = :sa2), 'suspended', 'suspension applied');
reset role;
select ok(not private.admin_holds(:sa2, 'dashboard.view'), 'suspended admin holds nothing');
set local role authenticated;

select throws_ok(
  format('select api.delete_permission_template((select id from public.permission_templates where code = %L), %L)',
    'operations', 'Not needed anymore'),
  'P0001', 'BUILTIN_TEMPLATE', 'built-in templates cannot be deleted');
select throws_ok(
  format('select api.set_template_permissions((select id from public.permission_templates where code = %L), array[%L], %L)',
    'super_admin', 'dashboard.view', 'Trim super admin'),
  'P0001', 'BUILTIN_TEMPLATE', 'super_admin permissions are locked');
select lives_ok(
  format('select api.create_permission_template(%L, %L, null, array[%L], %L)',
    'night_ops', 'Night operations', 'trips.view', 'Night shift coverage'),
  'super admin creates a custom template');
select lives_ok(
  format('select api.assign_permission_template(%L, (select id from public.permission_templates where code = %L), %L)',
    :plain, 'night_ops', 'Night shift rota'),
  'custom template assigned');
select throws_ok(
  format('select api.delete_permission_template((select id from public.permission_templates where code = %L), %L)',
    'night_ops', 'No longer used'),
  'P0001', 'TEMPLATE_IN_USE', 'a template in use cannot be deleted');

-- Invitations
select lives_ok(
  format('select api.invite_admin(%L, %L, array[(select id from public.permission_templates where code = %L)], %L)',
    'New.Hire@Test.local', 'New Hire', 'support', 'Hiring a support agent'),
  'super admin invites an admin');
select throws_ok(
  format('select api.invite_admin(%L, %L, null, %L)', 'rider@test.local', 'Rider', 'Make rider an admin'),
  'P0001', 'ALREADY_EXISTS', 'an existing account cannot be invited (role is immutable)');

reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'new.hire@test.local');
select ok(private.admin_holds('00000000-0000-0000-0000-0000000000c1', 'support.manage'),
  'accepted invitation creates an admin with the invited template');

-- Last super admin (deferred check, forced immediate here). Other super admins
-- that exist in the database (e.g. from E2E runs) are revoked inside this
-- rolled-back transaction so :sa is the only one left.
update public.admin_template_assignments a
set revoked_at = now(), revoke_reason = 'test isolation'
from public.permission_templates t
where t.id = a.template_id and t.code = 'super_admin' and a.revoked_at is null and a.admin_id <> :sa;
set constraints all immediate;
select throws_ok(
  format('update public.admin_template_assignments set revoked_at = now(), revoke_reason = %L where admin_id = %L',
    'test', :sa),
  'P0001', 'LAST_SUPER_ADMIN', 'the last active super admin cannot be removed');

-- Audit trail, append-only, notifications
select is((select count(*)::int from public.admin_audit_logs where action = 'admin.suspend' and entity_id = :sa2),
  1, 'suspension is audited');
select ok(
  (select after_data -> 'permissions' ? 'drivers.approve' from public.admin_audit_logs
   where action = 'admin.template.assign' and entity_id = :plain order by id limit 1),
  'audit captures the effective permissions after the change');
select throws_ok('update public.admin_audit_logs set reason = ''edited''',
  'P0001', 'APPEND_ONLY', 'audit log is append-only');
select ok(exists (select 1 from public.notifications where recipient_id = :plain and kind = 'permissions.changed'),
  'affected admin is notified');

select * from finish();
rollback;
