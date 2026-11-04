-- M0 audit trail, batch permission changes and admin read RPCs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

\set inviter '''00000000-0000-0000-0000-0000000000d0'''
\set sa      '''00000000-0000-0000-0000-0000000000d1'''
\set target  '''00000000-0000-0000-0000-0000000000d2'''
\set analyst '''00000000-0000-0000-0000-0000000000d3'''

insert into auth.users (id, email) values (:inviter, 'inviter2@test.local');
insert into public.admin_invitations (email, full_name, template_ids, reason, invited_by)
select e.email, e.name, array(select id from public.permission_templates where code = any (e.templates)), 'fixture', :inviter
from (values
  ('sa.d@test.local', 'Super D', array['super_admin']),
  ('target.d@test.local', 'Target D', array['support']),
  ('analyst.d@test.local', 'Analyst D', array['analyst'])
) as e(email, name, templates);
insert into auth.users (id, email) values
  (:sa, 'sa.d@test.local'), (:target, 'target.d@test.local'), (:analyst, 'analyst.d@test.local');

-- System invitation (no inviter) is possible for the database owner only.
select lives_ok($$insert into public.admin_invitations (email, full_name, reason) values ('sys@test.local', 'System', 'bootstrap')$$,
  'owner can create a system invitation');

create function pg_temp.as_user(p_id uuid, p_aal text default 'aal2') returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

-- Change log captures profile creation.
select ok(exists (select 1 from audit.change_log where table_name = 'public.profiles' and record_id = :target and op = 'INSERT'),
  'change log records inserts');

set local role authenticated;
select pg_temp.as_user(:sa);

-- Batch changes are atomic: an invalid item rolls back the whole batch.
select throws_ok(
  format($f$select api.apply_admin_permission_changes(%L, array[(select id from public.permission_templates where code = 'finance')], null, '[{"permission":"audit.view","effect":"bogus"}]', 'Restructure team')$f$, :target),
  'P0001', 'VALIDATION_FAILED', 'invalid override effect is rejected');
select ok(not ((api.get_admin(:target) -> 'permissions') ? 'ledger.view'), 'rejected batch changed nothing');

select lives_ok(
  format($f$select api.apply_admin_permission_changes(%L,
      array[(select id from public.permission_templates where code = 'finance')],
      array[(select id from public.permission_templates where code = 'support')],
      '[{"permission":"refunds.approve","effect":"deny"},{"permission":"settings.manage","effect":"grant"}]',
      'Moving to the finance team')$f$, :target),
  'batch applies templates and overrides together');
select ok((api.get_admin(:target) -> 'permissions') ? 'ledger.view', 'finance template applied');
select ok(not ((api.get_admin(:target) -> 'permissions') ? 'refunds.approve'), 'deny override applied');
select ok((api.get_admin(:target) -> 'permissions') ? 'settings.manage', 'grant override applied');
select ok(not ((api.get_admin(:target) -> 'permissions') ? 'support.manage'), 'support template removed');
select is(jsonb_array_length(api.get_admin(:target) -> 'overrides'), 2, 'detail lists active overrides');

-- Lists
select ok(jsonb_array_length(api.list_admins(null, null)) >= 3, 'list_admins returns admins');
select is(jsonb_array_length(api.list_admins('Target', null)), 1, 'list_admins filters by search');
select ok(jsonb_array_length(api.list_permission_catalogue() -> 'templates') >= 6, 'catalogue lists templates');

-- Audit pagination
select is(jsonb_array_length(api.list_admin_audit_logs(p_entity_id => :target, p_limit => 2) -> 'rows'), 2,
  'audit log honours the page size');
select ok(api.list_admin_audit_logs(p_entity_id => :target, p_limit => 2) -> 'next_cursor' is not null,
  'audit log returns a next cursor when more rows exist');

-- Auth events
select lives_ok($$select api.record_admin_auth_event('sign_in')$$, 'sign-in is recorded');

-- Analyst cannot read the admin list
select pg_temp.as_user(:analyst);
select throws_ok('select api.list_admins(null, null)', 'P0001', 'FORBIDDEN', 'analyst cannot list admins');

select * from finish();
rollback;
