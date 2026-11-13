-- M1 supply onboarding (docs/spec/09-roadmap.md M1 exit criteria):
--   * only approved drivers with active vehicles can go online
--   * unauthorised data access is rejected (roles, RLS, column privileges, storage)
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

\set inviter '''00000000-0000-0000-0000-00000000e000'''
\set ops     '''00000000-0000-0000-0000-00000000e001'''
\set support '''00000000-0000-0000-0000-00000000e002'''
\set analyst '''00000000-0000-0000-0000-00000000e003'''
\set d1      '''00000000-0000-0000-0000-00000000f001'''
\set d2      '''00000000-0000-0000-0000-00000000f002'''
\set p1      '''00000000-0000-0000-0000-00000000f003'''

insert into auth.users (id, email) values (:inviter, 'inviter.m1@test.local');
insert into public.admin_invitations (email, full_name, template_ids, reason, invited_by)
select e.email, e.name, array(select id from public.permission_templates where code = e.tpl), 'fixture', :inviter
from (values ('ops.m1@test.local', 'Ops M1', 'operations'),
             ('support.m1@test.local', 'Support M1', 'support'),
             ('analyst.m1@test.local', 'Analyst M1', 'analyst')) e(email, name, tpl);
insert into auth.users (id, email) values
  (:ops, 'ops.m1@test.local'), (:support, 'support.m1@test.local'), (:analyst, 'analyst.m1@test.local'),
  (:d1, 'd1@test.local'), (:d2, 'd2@test.local'), (:p1, 'p1@test.local');
update public.profiles set phone = '+8801711000001' where id = :d1;
update public.profiles set phone = '+8801711000003' where id = :p1;

create function pg_temp.as_user(p_id uuid, p_aal text default 'aal2') returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Zone (ops: zones.manage)
-- ---------------------------------------------------------------------------
select pg_temp.as_user(:ops);
select throws_ok(
  $$select api.save_zone(null, 'dhaka_core', 'Dhaka core', '{"type":"Polygon","coordinates":[[[90.30,23.70],[90.50,23.70],[90.50,23.90],[90.30,23.90],[90.30,23.70]]]}', true, null, 'x')$$,
  'P0001', 'VALIDATION_FAILED', 'zone changes need a reason');
select throws_ok(
  $$select api.save_zone(null, 'bowtie', 'Bad', '{"type":"Polygon","coordinates":[[[90.30,23.70],[90.50,23.90],[90.50,23.70],[90.30,23.90],[90.30,23.70]]]}', true, null, 'Self intersecting test')$$,
  'P0001', 'VALIDATION_FAILED', 'self-intersecting boundaries are rejected');
select ok((api.save_zone(null, 'dhaka_core', 'Dhaka core',
  '{"type":"Polygon","coordinates":[[[90.30,23.70],[90.50,23.70],[90.50,23.90],[90.30,23.90],[90.30,23.70]]]}',
  true, null, 'Pilot launch zone') ->> 'area_km2')::numeric > 400, 'zone saved with computed area');

select pg_temp.as_user(:analyst);
select throws_ok($$select api.save_zone(null, 'z2', 'Z2', '{"type":"Polygon","coordinates":[[[90,23],[90.1,23],[90.1,23.1],[90,23]]]}', true, null, 'Not allowed here')$$,
  'P0001', 'FORBIDDEN', 'analyst cannot edit zones');

-- ---------------------------------------------------------------------------
-- Onboarding as a driver
-- ---------------------------------------------------------------------------
select pg_temp.as_user(:d1, 'aal1');
select is(api.onboard_driver('Rahim Uddin') ->> 'role', 'driver', 'user becomes a driver through onboarding');
select throws_ok($$select api.onboard_passenger('Rahim')$$, 'P0001', 'ROLE_NOT_ALLOWED', 'a driver cannot also become a passenger');
select is(api.driver_onboarding_state() ->> 'onboarding_status', 'draft', 'application starts as draft');
select throws_ok($$select api.driver_set_availability(true, 23.80, 90.40)$$, 'P0001', 'DRIVER_NOT_APPROVED',
  'a draft driver cannot go online');
select throws_ok($$select api.driver_submit_application()$$, 'P0001', 'VALIDATION_FAILED',
  'cannot submit without documents and a vehicle');

select (api.driver_add_vehicle((select id from public.vehicle_categories where code = 'bike'),
  'Honda', 'CB Hornet', 'Red', 'dhaka metro-la 12-3456', 2022) ->> 'vehicle_id') as vehicle_id \gset
select is((select registration_number from public.vehicles where id = :'vehicle_id'), 'DHAKA METRO-LA 12-3456',
  'registration number is normalised');
select throws_ok($$select api.driver_add_vehicle((select id from public.vehicle_categories where code = 'bike'),
  'Honda', 'CB', 'Blue', 'DHAKA METRO-LA 12-3456', 2021)$$, 'P0001', 'ALREADY_EXISTS', 'duplicate plates are rejected');

-- Reserve + upload + complete every required document.
create function pg_temp.upload(p_type public.document_type, p_vehicle uuid, p_number text default null) returns uuid
language plpgsql as $$
declare
  r jsonb := api.driver_create_document(p_type, p_vehicle, 'image/jpeg', 2048);
begin
  insert into storage.objects (bucket_id, name, metadata) values ('driver-documents', r ->> 'storage_path', '{"size":2048}');
  perform api.driver_complete_document((r ->> 'document_id')::uuid, repeat('a', 64), 2048, p_number, null, current_date + 365);
  return (r ->> 'document_id')::uuid;
end $$;

select lives_ok($$select pg_temp.upload('profile_photo', null)$$, 'driver uploads a profile photo');
select lives_ok($$select pg_temp.upload('national_id', null, '1990123456789')$$, 'driver uploads the NID');
select lives_ok($$select pg_temp.upload('driving_licence', null, 'DK-1234567')$$, 'driver uploads the licence');
select lives_ok(format($$select pg_temp.upload(t::public.document_type, %L) from unnest(array['vehicle_registration','fitness_certificate','tax_token','insurance']) t$$, :'vehicle_id'),
  'driver uploads the vehicle documents');

select is((select document_number_masked from public.driver_documents where document_type = 'national_id' and driver_id = private.my_driver_id()),
  '••••••789', 'document numbers are stored masked only');

-- Storage: uploads only to the reserved path of one's own pending record.
select throws_ok($$insert into storage.objects (bucket_id, name) values ('driver-documents', 'drivers/someone-else/x.jpg')$$,
  '42501', null, 'cannot upload outside a reserved path');

select is(api.driver_submit_application() ->> 'onboarding_status', 'submitted', 'complete application is submitted');

-- ---------------------------------------------------------------------------
-- Isolation between drivers and passengers
-- ---------------------------------------------------------------------------
select pg_temp.as_user(:d2, 'aal1');
select lives_ok($$select api.onboard_driver('Karim')$$, 'second driver onboards');
select is((select count(*)::int from public.driver_documents), 0, 'a driver cannot see other drivers'' documents');
select is((select count(*)::int from public.vehicles), 0, 'a driver cannot see other drivers'' vehicles');
select is((select count(*)::int from public.driver_profiles), 1, 'a driver sees only their own driver profile');
select is((select count(*)::int from storage.objects where bucket_id = 'driver-documents'), 0, 'a driver cannot read document files');
select throws_ok($$select api.list_drivers()$$, 'P0001', 'FORBIDDEN', 'drivers cannot use admin RPCs');

select pg_temp.as_user(:p1, 'aal1');
select is(api.onboard_passenger('Nadia') ->> 'role', 'passenger', 'user becomes a passenger');
select throws_ok($$select api.driver_onboarding_state()$$, 'P0001', 'ROLE_NOT_ALLOWED', 'passengers cannot call driver RPCs');
select is((select count(*)::int from public.driver_profiles), 0, 'passengers see no driver profiles');

-- ---------------------------------------------------------------------------
-- Least privilege among admins
-- ---------------------------------------------------------------------------
select pg_temp.as_user(:analyst);
select throws_ok($$select api.list_drivers()$$, 'P0001', 'FORBIDDEN', 'analyst cannot list drivers');
select throws_ok($$select api.list_passengers()$$, 'P0001', 'FORBIDDEN', 'analyst cannot list passengers');

select pg_temp.as_user(:support);
select ok(jsonb_array_length(api.list_drivers('applications') -> 'rows') >= 1, 'support can list driver applications');
select ok((api.list_drivers('all', 'Rahim') -> 'rows' -> 0 ->> 'phone_masked') like '+88017%••%001', 'phone numbers are masked in lists');
select throws_ok(format('select api.reveal_pii(%L, %L, %L)', :d1, 'phone', 'Customer called in'),
  'P0001', 'FORBIDDEN', 'support cannot reveal driver PII');
select throws_ok(format($$select api.open_driver_document((select id from public.driver_documents where document_type = 'national_id' limit 1))$$),
  'P0001', 'FORBIDDEN', 'support cannot open driver documents');
select is((select count(*)::int from storage.objects where bucket_id = 'driver-documents'), 0, 'support cannot read document files');
select throws_ok($$select phone from public.profiles limit 1$$, '42501', null, 'raw phone column is not selectable');
select throws_ok($$select licence_number_enc from public.driver_profiles limit 1$$, '42501', null,
  'encrypted licence column is not selectable');

-- ---------------------------------------------------------------------------
-- Review and approval (ops)
-- ---------------------------------------------------------------------------
select pg_temp.as_user(:ops);
select (select id from public.driver_profiles where user_id = :d1) as driver_id \gset

select throws_ok(format('select api.approve_driver(%L, null)', :'driver_id'), 'P0001', 'VALIDATION_FAILED',
  'cannot approve with documents pending');
select throws_ok(format($$select api.review_driver_document(id, 'reject', 'no', version) from public.driver_documents where document_type = 'national_id' and driver_id = %L$$, :'driver_id'),
  'P0001', 'VALIDATION_FAILED', 'rejecting a document needs a reason');
select lives_ok(format($$select api.review_driver_document(id, 'approve', null, version) from public.driver_documents where driver_id = %L and uploaded_at is not null$$, :'driver_id'),
  'ops approves every document');
select is((select onboarding_status::text from public.driver_profiles where id = :'driver_id'), 'under_review',
  'first review moves the application under review');
select throws_ok(format('select api.approve_driver(%L, null)', :'driver_id'), 'P0001', 'VALIDATION_FAILED',
  'cannot approve without an active vehicle');
select is(api.verify_vehicle(:'vehicle_id', null) ->> 'status', 'active', 'vehicle verified once its documents are approved');
select is(api.approve_driver(:'driver_id', 'All checks passed') ->> 'onboarding_status', 'approved', 'driver approved');
select is((select current_vehicle_id::text from public.driver_profiles where id = :'driver_id'), :'vehicle_id',
  'the verified vehicle becomes current');
reset role; -- ops lacks audit.view, so read the logs as the owner
select ok(exists (select 1 from public.admin_audit_logs where action = 'driver.approve' and entity_id = :'driver_id'),
  'approval is audited');
set local role authenticated;

select is(api.reveal_pii(:d1, 'licence_number', 'Verifying licence with BRTA'), 'DK-1234567', 'licence number decrypts for drivers.view_pii');
reset role;
select ok(exists (select 1 from public.pii_access_logs where subject_profile_id = :d1 and field = 'licence_number'),
  'PII reveal is logged');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Going online
-- ---------------------------------------------------------------------------
select pg_temp.as_user(:d1, 'aal1');
select throws_ok($$select api.driver_set_availability(true, 22.30, 91.80)$$, 'P0001', 'OUT_OF_SERVICE_AREA',
  'cannot go online outside a service zone');
select is(api.driver_set_availability(true, 23.80, 90.40) ->> 'availability', 'online', 'approved driver goes online in zone');

select pg_temp.as_user(:ops);
select lives_ok(format('select api.suspend_vehicle(%L, %L)', :'vehicle_id', 'Fitness certificate under review'),
  'ops suspends the vehicle');
select is((select availability::text from public.driver_profiles where id = :'driver_id'), 'offline',
  'suspending the current vehicle takes the driver offline');

select pg_temp.as_user(:d1, 'aal1');
select throws_ok($$select api.driver_set_availability(true, 23.80, 90.40)$$, 'P0001', 'VEHICLE_NOT_ACTIVE',
  'cannot go online without an active vehicle');

select pg_temp.as_user(:ops);
select lives_ok(format('select api.verify_vehicle(%L, %L)', :'vehicle_id', 'Certificate confirmed valid'), 'vehicle reinstated');
select lives_ok(format('select api.suspend_driver(%L, %L)', :'driver_id', 'Customer safety complaint'), 'ops suspends the driver');

select pg_temp.as_user(:d1, 'aal1');
select throws_ok($$select api.driver_set_availability(true, 23.80, 90.40)$$, 'P0001', 'DRIVER_NOT_APPROVED',
  'a suspended driver cannot go online');

select * from finish();
rollback;
