-- Driver app support: driver push (offer, cancelled trip, forced offline, application decisions), the
-- availability_changed event, timings in client config, and the driver trip list.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

\set inviter '''00000000-0000-0000-0000-0000000da000'''
\set sa      '''00000000-0000-0000-0000-0000000da001'''
\set p1      '''00000000-0000-0000-0000-0000000db001'''
\set u1      '''00000000-0000-0000-0000-0000000dc001'''
\set u2      '''00000000-0000-0000-0000-0000000dc002'''
\set drv     '''00000000-0000-0000-0000-0000000df001'''
\set drv2    '''00000000-0000-0000-0000-0000000df002'''
\set veh     '''00000000-0000-0000-0000-0000000df101'''
\set zone    '''00000000-0000-0000-0000-0000000de001'''

update public.driver_profiles set availability = 'offline' where availability <> 'offline';

insert into auth.users (id, email) values (:inviter, 'inv.da@test.local');
insert into public.admin_invitations (email, full_name, template_ids, reason, invited_by)
select 'sa.da@test.local', 'Super DA', array(select id from public.permission_templates where code = 'super_admin'), 'fixture', :inviter;
insert into auth.users (id, email) values (:sa, 'sa.da@test.local'), (:p1, 'p1.da@test.local'), (:u1, 'u1.da@test.local'), (:u2, 'u2.da@test.local');
select private.promote_user_role(:p1, 'passenger');
select id as bike from public.vehicle_categories where code = 'bike' \gset

insert into public.service_zones (id, code, name, boundary, area_km2, active)
values (:zone, 'da_zone', 'DA Zone',
  extensions.st_multi(extensions.st_geomfromtext('POLYGON((90.36 23.76,90.44 23.76,90.44 23.84,90.36 23.84,90.36 23.76))', 4326))::extensions.geography,
  80, true);

select private.promote_user_role(:u1, 'driver');
insert into public.driver_profiles (id, user_id, onboarding_status, approved_at) values (:drv, :u1, 'approved', now());
insert into public.vehicles (id, driver_id, category_id, make, model, color, registration_number, year, status)
values (:veh, :drv, :'bike', 'Honda', 'CB', 'Red', 'DA-DRV-1', 2022, 'active');
update public.driver_profiles set current_vehicle_id = :veh, availability = 'online' where id = :drv;
insert into public.driver_live_locations (driver_id, location, recorded_at, updated_at) values (:drv, private.point(23.801, 90.401), now(), now());

-- A second driver, still applying.
select private.promote_user_role(:u2, 'driver');
insert into public.driver_profiles (id, user_id, onboarding_status) values (:drv2, :u2, 'under_review');

-- Both drivers have a phone registered for push; the passenger does not.
insert into public.push_devices (user_id, platform, token)
values (:u1, 'android', 'ExponentPushToken[da-test-device-0001]'), (:u2, 'android', 'ExponentPushToken[da-test-device-0002]');

create function pg_temp.as_user(p_id uuid, p_aal text default 'aal2') returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

set local role authenticated;
select pg_temp.as_user(:sa);
select (api.save_fare_draft(null, :'bike', :zone,
  '{"base_fare":40,"per_km":20,"per_minute":2,"minimum_fare":60,"booking_fee":0,"waiting_per_minute":2,"free_waiting_minutes":3,"cancellation_fee":30,"platform_commission_pct":0.15,"max_surge_multiplier":1.5}',
  'DA rates', null)) as rule \gset
select api.publish_fare_rule(:'rule', null, 'Driver app tests');

-- ---------------------------------------------------------------------------
-- Client config timings
-- ---------------------------------------------------------------------------
select pg_temp.as_user(:u1, 'aal1');
select is(api.client_config() -> 'settings' ->> 'offer_timeout_s', '15', 'config carries the offer timeout');
select is(api.client_config() -> 'settings' ->> 'no_show_wait_min', '5', 'and the no-show wait');

-- ---------------------------------------------------------------------------
-- Offer push
-- ---------------------------------------------------------------------------
select pg_temp.as_user(:p1, 'aal1');
select (api.create_quote(:'bike', 23.805, 90.405, 'Gulshan', 23.82, 90.42, 'Banani', 5000, 1200) ->> 'id') as quote \gset
select (api.create_ride_request(:'quote'::uuid, 'cash', null) ->> 'id') as ride \gset
reset role;
select is((select count(*)::int from public.notification_outbox where recipient_id = :u1 and data ->> 'type' = 'offer.created'), 1,
  'a new offer queues one push for the driver');
select is((select category from public.notification_outbox where recipient_id = :u1 and data ->> 'type' = 'offer.created'), 'driver.offers',
  'on the driver offers channel');
select is((select link from public.notification_outbox where recipient_id = :u1 and data ->> 'type' = 'offer.created'), '/offer', 'it opens the offer card');
select ok((select body not like '%+880%' and body not like '%Gulshan%' from public.notification_outbox where recipient_id = :u1 and data ->> 'type' = 'offer.created'),
  'it carries no address or phone number');

-- ---------------------------------------------------------------------------
-- Cancelled trip push
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(:u1, 'aal1');
select api.accept_offer((api.driver_current_offer() ->> 'offer_id')::uuid);
reset role;
select (id) as trip from public.trips where request_id = :'ride' \gset
select is((select count(*)::int from public.notification_outbox where recipient_id = :u1 and data ->> 'type' = 'trip.cancelled'), 0,
  'no cancel push before anything is cancelled');
set local role authenticated;
select pg_temp.as_user(:p1, 'aal1');
select api.cancel_ride(:'ride', 'changed plans');
reset role;
select is((select data ->> 'trip_id' from public.notification_outbox where recipient_id = :u1 and data ->> 'type' = 'trip.cancelled'), :'trip',
  'a passenger cancel tells the driver');
select is((select link from public.notification_outbox where recipient_id = :u1 and data ->> 'type' = 'trip.cancelled'), '/trip/' || :'trip',
  'it opens the trip');

-- ---------------------------------------------------------------------------
-- Trip list
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(:u1, 'aal1');
select is(jsonb_array_length(api.driver_trips() -> 'rows'), 1, 'the cancelled trip is in the driver''s history');
select is(api.driver_trips() -> 'rows' -> 0 ->> 'status', 'cancelled_by_passenger', 'with its status');
select is(api.driver_trips() -> 'rows' -> 0 ->> 'pickup_label', 'Gulshan', 'and where it was');
select is(api.driver_trips() ->> 'next_cursor', null, 'no further page');
select throws_ok($$select api.driver_trips(30, 'not-a-cursor')$$, 'P0001', 'VALIDATION_FAILED', 'a broken cursor is refused');
select pg_temp.as_user(:u2, 'aal1');
select is(jsonb_array_length(api.driver_trips() -> 'rows'), 0, 'other drivers do not see it');
select pg_temp.as_user(:p1, 'aal1');
select throws_ok($$select api.driver_trips()$$, 'P0001', 'ROLE_NOT_ALLOWED', 'passengers cannot list driver trips');
reset role;

-- ---------------------------------------------------------------------------
-- Forced offline and application decisions
-- ---------------------------------------------------------------------------
update public.driver_profiles set availability = 'online' where id = :drv;
delete from public.notification_outbox where recipient_id = :u1 and data ->> 'type' = 'forced_offline';

-- The driver going offline themselves: no push.
set local role authenticated;
select pg_temp.as_user(:u1, 'aal1');
select api.driver_set_availability(false, null, null, null);
reset role;
select is((select count(*)::int from public.notification_outbox where recipient_id = :u1 and data ->> 'type' = 'forced_offline'), 0,
  'going offline yourself sends no push');

-- Taken offline by the system (no caller, e.g. the stale-location sweep).
update public.driver_profiles set availability = 'online' where id = :drv;
select set_config('request.jwt.claims', '', true);
update public.driver_profiles set availability = 'offline' where id = :drv;
select is((select count(*)::int from public.notification_outbox where recipient_id = :u1 and data ->> 'type' = 'forced_offline'), 1,
  'being taken offline queues a push');
select is((select category from public.notification_outbox where recipient_id = :u1 and data ->> 'type' = 'forced_offline'), 'driver.account',
  'on the account channel');

update public.driver_profiles set onboarding_status = 'approved', approved_at = now() where id = :drv2;
select is((select link from public.notification_outbox where recipient_id = :u2 and data ->> 'type' = 'account.approved'), '/home',
  'approval tells the applicant');
update public.driver_profiles set onboarding_status = 'suspended', suspended_reason = 'test' where id = :drv2;
select is((select link from public.notification_outbox where recipient_id = :u2 and data ->> 'type' = 'account.suspended'), '/support',
  'suspension points to support');
select is((select count(*)::int from public.notification_outbox where recipient_id = :u2 and data ->> 'type' = 'forced_offline'), 0,
  'an application decision is not also reported as forced offline');

update public.profiles set preferred_language = 'bn' where id = :u2;
update public.driver_profiles set onboarding_status = 'rejected', rejected_reason = 'Blurry licence photo', suspended_reason = null where id = :drv2;
select is((select subject from public.notification_outbox where recipient_id = :u2 and data ->> 'type' = 'account.rejected'), 'আবেদনে সংশোধন দরকার',
  'Bengali drivers get Bengali copy');

-- The helpers are not callable from clients.
set local role authenticated;
select pg_temp.as_user(:u1, 'aal1');
select throws_ok($$select private.driver_push_text('offer', 'en')$$, '42501', null, 'push copy helper is private');
reset role;

select * from finish();
rollback;
