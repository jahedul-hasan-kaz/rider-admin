-- Staff create/update/delete: accounts, vehicles, documents, booked rides, manual assignment, alerts, cash, refunds.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

\set inviter '''00000000-0000-0000-0000-00000007a000'''
\set sa      '''00000000-0000-0000-0000-00000007a001'''
\set support '''00000000-0000-0000-0000-00000007a002'''
\set newp    '''00000000-0000-0000-0000-00000007b001'''
\set newd    '''00000000-0000-0000-0000-00000007b002'''
\set zone    '''00000000-0000-0000-0000-00000007e001'''

insert into auth.users (id, email) values (:inviter, 'inv.m7@test.local');
insert into public.admin_invitations (email, full_name, template_ids, reason, invited_by)
select e.email, e.name, array(select id from public.permission_templates where code = e.tpl), 'fixture', :inviter
from (values ('sa.m7@test.local', 'Super M7', 'super_admin'), ('support.m7@test.local', 'Support M7', 'support')) e(email, name, tpl);
insert into auth.users (id, email) values (:sa, 'sa.m7@test.local'), (:support, 'support.m7@test.local'),
  (:newp, 'newp.m7@test.local'), (:newd, 'newd.m7@test.local');
insert into public.service_zones (id, code, name, boundary, area_km2, active)
values (:zone, 'm7_zone', 'M7 Zone',
  extensions.st_multi(extensions.st_geomfromtext('POLYGON((70.55 12.75,70.65 12.75,70.65 12.85,70.55 12.85,70.55 12.75))', 4326))::extensions.geography, 100, true);
select id as bike from public.vehicle_categories where code = 'bike' \gset

create function pg_temp.as_user(p_id uuid, p_aal text default 'aal2') returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

select ok((select count(*) = 7 from public.permissions where code in ('passengers.create', 'passengers.delete', 'drivers.create', 'drivers.delete', 'documents.manage', 'trips.create', 'alerts.manage')),
  'the new permissions are in the catalogue');
select is((select count(*)::int from public.permissions p where not exists (select 1 from public.permission_template_items i join public.permission_templates t on t.id = i.template_id
  where t.code = 'super_admin' and i.permission_code = p.code and i.removed_at is null)), 0, 'the super admin template holds all of them');

select is(private.normalize_phone('01712-345 678'), '+8801712345678', 'a local number is stored in international form');
select is(private.normalize_phone('8801712345678'), '+8801712345678', 'so is one without the plus');
select is(private.normalize_phone('  '), null, 'an empty phone is no phone');
set local role authenticated;
select pg_temp.as_user(:sa);
select is(api.admin_find_unused_account('NEWD.M7@test.local'), :newd::uuid, 'an unused identity can be found by email to finish a create');
reset role;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(:support);
select throws_ok(format($$select api.admin_setup_account(%L, 'driver', 'New Driver', null, null, 'Walk-in signup')$$, :newd), 'P0001', 'FORBIDDEN', 'support cannot create drivers');
select pg_temp.as_user(:sa);
select throws_ok(format($$select api.admin_setup_account(%L, 'passenger', 'New Passenger', null, null, 'x')$$, :newp), 'P0001', 'VALIDATION_FAILED', 'a reason is required');
select throws_ok(format($$select api.admin_setup_account(%L, 'admin', 'Sneaky', null, null, 'Make an admin')$$, :newp), 'P0001', 'VALIDATION_FAILED', 'an admin cannot be created this way');
select is(api.admin_setup_account(:newp, 'passenger', 'New Passenger', '+8801700000711', null, 'Phone booking customer') ->> 'role', 'passenger', 'staff create a passenger');
select is((api.admin_setup_account(:newd, 'driver', 'New Driver', '+8801700000712', :zone, 'Walk-in signup') ->> 'driver_id') is not null, true, 'and a driver with a driver profile');
select throws_ok(format($$select api.admin_setup_account(%L, 'driver', 'Again', null, null, 'Second time')$$, :newp), 'P0001', 'ALREADY_EXISTS', 'an existing account cannot be set up twice');
select throws_ok($$select api.admin_update_contact('00000000-0000-0000-0000-00000007b001', 'Renamed', '+8801700000712', 'Fix the phone')$$, 'P0001', 'ALREADY_EXISTS', 'phone numbers stay unique');
select lives_ok($$select api.admin_update_contact('00000000-0000-0000-0000-00000007b001', 'Renamed Passenger', '01755-555555', 'Customer asked by phone')$$, 'staff edit the name and phone');
reset role;
select is((select full_name from public.profiles where id = :newp), 'Renamed Passenger', 'the change is saved');
select is((select phone from public.profiles where id = :newp), '+8801755555555', 'a phone typed the local way is stored in international form');
select ok(exists (select 1 from public.admin_audit_logs where action = 'passenger.update_contact' and entity_id = :newp), 'and audited');
select is((select onboarding_status::text from public.driver_profiles where user_id = :newd), 'draft', 'a new driver starts in onboarding, not approved');

-- ---------------------------------------------------------------------------
-- Vehicles
-- ---------------------------------------------------------------------------
select id as drv from public.driver_profiles where user_id = :newd \gset
set local role authenticated;
select pg_temp.as_user(:sa);
select (api.admin_save_vehicle(null, :'drv', :'bike', 'Honda', 'CB', 'Red', 'M7-111', 2022, 'Added at the office') ->> 'id') as veh \gset
select ok(:'veh' is not null, 'staff add a vehicle for a driver');
select throws_ok(format($$select api.admin_save_vehicle(null, %L, %L, 'Honda', 'CB', 'Red', 'm7-111', 2022, 'Duplicate plate')$$, :'drv', :'bike'), 'P0001', 'ALREADY_EXISTS', 'plates stay unique');
select lives_ok(format($$select api.admin_save_vehicle(%L, null, %L, 'Honda', 'CB Shine', 'Blue', 'M7-111', 2023, 'Corrected colour')$$, :'veh', :'bike'), 'staff edit a vehicle');
reset role;
select is((select color from public.vehicles where id = :'veh'), 'Blue', 'the edit is saved');
update public.vehicles set status = 'active' where id = :'veh';
update public.driver_profiles set current_vehicle_id = :'veh', onboarding_status = 'approved', approved_at = now(), availability = 'online' where id = :'drv';
insert into public.driver_live_locations (driver_id, location, recorded_at, updated_at) values (:'drv', private.point(12.80, 70.60), now(), now());
set local role authenticated;
select pg_temp.as_user(:sa);
select throws_ok(format($$select api.admin_retire_vehicle(%L, 'No longer used')$$, :'veh'), 'P0001', 'INVALID_STATE_TRANSITION', 'a vehicle in use cannot be retired');

-- ---------------------------------------------------------------------------
-- Booked rides and manual assignment
-- ---------------------------------------------------------------------------
select (api.save_fare_draft(null, :'bike', :zone,
  '{"base_fare":40,"per_km":20,"per_minute":2,"minimum_fare":60,"booking_fee":0,"waiting_per_minute":2,"free_waiting_minutes":3,"cancellation_fee":30,"platform_commission_pct":0.15,"max_surge_multiplier":1.5}',
  'M7 rates', null)) as rule1 \gset
select api.publish_fare_rule(:'rule1', null, 'Go live for the admin tests');
reset role;
update public.driver_profiles set availability = 'offline' where id = :'drv'; -- keep automatic dispatch away
set local role authenticated;
select pg_temp.as_user(:sa);
select (api.admin_book_ride(:newp, :'bike', 12.80, 70.60, 'Office', 12.83, 70.63, 'Home', 5000, 1200, 'cash', 'Gate 2', 'Phone booking') ->> 'id') as req \gset
select ok(:'req' is not null, 'staff book a ride for a passenger');
reset role;
select is((select booked_by from public.ride_requests where id = :'req'), :sa::uuid, 'the booking records who made it');
select is((select passenger_id from public.ride_requests where id = :'req'), :newp::uuid, 'for the passenger');
select ok((select status in ('searching', 'no_driver_found') from public.ride_requests where id = :'req'), 'it goes through normal dispatch');
update public.ride_requests set status = 'searching', closed_at = null, expires_at = now() + interval '5 minutes' where id = :'req';
set local role authenticated;
select pg_temp.as_user(:sa);
select lives_ok(format($$select api.admin_update_request(%L, 'Blue gate', 'Passenger called')$$, :'req'), 'staff edit the pickup note while searching');
select throws_ok(format($$select api.admin_assign_driver(%L, %L, 'Nearest driver')$$, :'req', :'drv'), 'P0001', 'VALIDATION_FAILED', 'an offline driver cannot be assigned');
reset role;
update public.driver_profiles set availability = 'online' where id = :'drv';
set local role authenticated;
select pg_temp.as_user(:support);
select throws_ok(format($$select api.admin_assign_driver(%L, %L, 'Nearest driver')$$, :'req', :'drv'), 'P0001', 'FORBIDDEN', 'support cannot assign drivers');
select pg_temp.as_user(:sa);
select (api.admin_assign_driver(:'req', :'drv', 'Nearest driver, called them') ->> 'id') as trip \gset
select ok(:'trip' is not null, 'staff create the trip by assigning a driver');
reset role;
select is((select status::text from public.ride_requests where id = :'req'), 'matched', 'the request is matched');
select is((select availability::text from public.driver_profiles where id = :'drv'), 'on_trip', 'the driver is on the trip');
select is((select response::text from public.dispatch_offers where request_id = :'req' and driver_id = :'drv'), 'accepted', 'through an accepted offer');
select is(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', :sa, 'the staff identity is restored afterwards');
set local role authenticated;
select pg_temp.as_user(:sa);
select lives_ok(format($$select api.admin_cancel_request(%L, 'Passenger no longer needs it')$$, :'req'), 'cancelling a matched request cancels its trip');
reset role;
select is((select status::text from public.trips where id = :'trip'), 'cancelled_by_admin', 'the trip is cancelled by admin');
select is((select availability::text from public.driver_profiles where id = :'drv'), 'online', 'and the driver is free again');

-- ---------------------------------------------------------------------------
-- Documents, alerts, account deletion
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(:sa);
select (api.admin_create_document(:'drv', 'driving_licence', null, 'image/png', 2048) ->> 'document_id') as doc \gset
select ok(:'doc' is not null, 'staff reserve a document upload for a driver');
select throws_ok(format($$select api.admin_complete_document(%L, %L, 2048, 'DL123', null, null, 'Scanned at the office')$$, :'doc', repeat('a', 64)), 'P0001', 'VALIDATION_FAILED', 'it cannot complete before the file is stored');
select lives_ok(format($$select api.admin_update_document(%L, '2024-01-01', '2030-01-01', 'Dates from the card')$$, :'doc'), 'staff correct document dates');
select lives_ok(format($$select api.admin_withdraw_document(%L, 'Wrong file')$$, :'doc'), 'staff withdraw a document');
reset role;
select ok((select withdrawn_at is not null and superseded_at is not null from public.driver_documents where id = :'doc'), 'it is kept but no longer current');

set local role authenticated;
select pg_temp.as_user(:sa);
select (api.admin_create_alert('warning', 'Road closed near the airport', 'Expect slower pickups') ->> 'id') as alert \gset
select is((select count(*)::int from jsonb_array_elements(api.list_alerts('open')) a where a ->> 'id' = :'alert'), 1, 'a manual alert is listed');
select api.resolve_alert(:'alert', 'Road reopened');
reset role;
select is((select status from public.ops_alerts where id = :'alert'), 'resolved', 'and can be resolved');

set local role authenticated;
select pg_temp.as_user(:support);
select throws_ok(format($$select api.admin_delete_account(%L, 'Customer asked')$$, :newp), 'P0001', 'FORBIDDEN', 'support cannot delete accounts');
select pg_temp.as_user(:sa);
select is(api.admin_delete_account(:newp, 'Customer asked by email') ->> 'status', 'deactivated', 'staff delete a passenger account');
reset role;
select is((select status from public.profiles where id = :newp), 'deactivated', 'it is deactivated');
select is((select status from public.account_deletion_requests where user_id = :newp), 'pending', 'and restorable during the grace period');

-- Pickers
set local role authenticated;
select pg_temp.as_user(:sa);
select ok(jsonb_array_length(api.admin_pick_people('driver', 'New Driver')) >= 1, 'the driver picker finds drivers');
select pg_temp.as_user(:support);
select throws_ok($$select api.admin_create_alert('info', 'Hello there', null)$$, 'P0001', 'FORBIDDEN', 'alerts need alerts.manage');
reset role;

select * from finish();
rollback;
