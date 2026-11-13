-- Passenger app support: consent, notification preferences, saved places, trusted contacts, live category data,
-- current ride, passenger push events, trip share links, push worker interface.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

\set inviter '''00000000-0000-0000-0000-0000000aa000'''
\set sa      '''00000000-0000-0000-0000-0000000aa001'''
\set p1      '''00000000-0000-0000-0000-0000000ab001'''
\set p2      '''00000000-0000-0000-0000-0000000ab002'''
\set u1      '''00000000-0000-0000-0000-0000000ac001'''
\set drv     '''00000000-0000-0000-0000-0000000af001'''
\set veh     '''00000000-0000-0000-0000-0000000af101'''
\set zone    '''00000000-0000-0000-0000-0000000ae001'''

update public.driver_profiles set availability = 'offline' where availability <> 'offline';

insert into auth.users (id, email) values (:inviter, 'inv.pa@test.local');
insert into public.admin_invitations (email, full_name, template_ids, reason, invited_by)
select 'sa.pa@test.local', 'Super PA', array(select id from public.permission_templates where code = 'super_admin'), 'fixture', :inviter;
insert into auth.users (id, email) values (:sa, 'sa.pa@test.local'), (:p1, 'p1.pa@test.local'), (:p2, 'p2.pa@test.local'), (:u1, 'u1.pa@test.local');
select private.promote_user_role(x, 'passenger') from unnest(array[:p1::uuid, :p2::uuid]) x;
select id as bike from public.vehicle_categories where code = 'bike' \gset

insert into public.service_zones (id, code, name, boundary, area_km2, active)
values (:zone, 'pa_zone', 'PA Zone',
  extensions.st_multi(extensions.st_geomfromtext('POLYGON((90.36 23.76,90.44 23.76,90.44 23.84,90.36 23.84,90.36 23.76))', 4326))::extensions.geography,
  80, true);

select private.promote_user_role(:u1, 'driver');
insert into public.driver_profiles (id, user_id, onboarding_status, approved_at) values (:drv, :u1, 'approved', now());
insert into public.vehicles (id, driver_id, category_id, make, model, color, registration_number, year, status)
values (:veh, :drv, :'bike', 'Honda', 'CB', 'Red', 'PA-DRV-1', 2022, 'active');
update public.driver_profiles set current_vehicle_id = :veh, availability = 'online' where id = :drv;
insert into public.driver_live_locations (driver_id, location, recorded_at, updated_at) values (:drv, private.point(23.801, 90.401), now(), now());

-- The passenger has a phone registered for push.
insert into public.push_devices (user_id, platform, token) values (:p1, 'android', 'ExponentPushToken[pa-test-device-0001]');

create function pg_temp.as_user(p_id uuid, p_aal text default 'aal2') returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

-- A live fare rule for the zone.
set local role authenticated;
select pg_temp.as_user(:sa);
select (api.save_fare_draft(null, :'bike', :zone,
  '{"base_fare":40,"per_km":20,"per_minute":2,"minimum_fare":60,"booking_fee":0,"waiting_per_minute":2,"free_waiting_minutes":3,"cancellation_fee":30,"platform_commission_pct":0.15,"max_surge_multiplier":1.5}',
  'PA rates', null)) as rule \gset
select api.publish_fare_rule(:'rule', null, 'Passenger app tests');

-- ---------------------------------------------------------------------------
-- Consent (B13)
-- ---------------------------------------------------------------------------
select pg_temp.as_user(:p1, 'aal1');
select is(api.record_consent('2026-11') ->> 'terms_version', '2026-11', 'consent is recorded');
select throws_ok($$select api.record_consent('<script>')$$, 'P0001', 'VALIDATION_FAILED', 'a malformed terms version is refused');
reset role;
select is((select terms_version from public.profiles where id = :p1), '2026-11', 'the profile keeps the accepted version');
select ok((select terms_accepted_at is not null from public.profiles where id = :p1), 'and when it was accepted');
set local role authenticated;
select pg_temp.as_user(:p1, 'aal1');

-- ---------------------------------------------------------------------------
-- Notification preferences (B4)
-- ---------------------------------------------------------------------------
select is(api.get_notification_preferences(), '{"ride":true,"support":true,"offers":false,"safety":true}'::jsonb, 'defaults: ride and support on, offers off');
select is(api.set_notification_preferences(true, false, true), '{"ride":true,"support":false,"offers":true,"safety":true}'::jsonb, 'preferences are saved');
select is(api.set_notification_preferences(true, true, false) ->> 'support', 'true', 'and can be changed back');

-- ---------------------------------------------------------------------------
-- Saved places (B6)
-- ---------------------------------------------------------------------------
select is(api.save_place('home', null, 'Road 11, Banani', 'Dhaka 1213', 23.79, 90.40, 'Gate 2', false) ->> 'kind', 'home', 'home is saved');
select is(api.save_place('home', null, 'House 5, Gulshan', null, 23.78, 90.41, null, false) ->> 'label', 'House 5, Gulshan', 'a new home replaces the old one');
select is(jsonb_array_length(api.list_saved_places()), 1, 'only one home is listed');
select throws_ok($$select api.save_place('other', null, 'Gym', null, 23.78, 90.41, null, false)$$, 'P0001', 'VALIDATION_FAILED', 'other places need a name');
select throws_ok($$select api.save_place('home', null, 'Nowhere', null, 123, 90.41, null, false)$$, 'P0001', 'VALIDATION_FAILED', 'an impossible position is refused');
select (api.save_place('other', 'Gym', 'Road 2, Gulshan', null, 23.781, 90.412, null, true) ->> 'id') as gym \gset
select is((api.list_saved_places() -> 1 ->> 'suggest_mornings')::boolean, false, 'morning suggestions apply to Office only');
select is(jsonb_array_length(api.list_saved_places()), 2, 'home and gym are listed');
select pg_temp.as_user(:p2, 'aal1');
select is(api.list_saved_places(), '[]'::jsonb, 'another passenger sees none of them');
select throws_ok(format($$select api.remove_saved_place(%L)$$, :'gym'), 'P0001', 'NOT_FOUND', 'and cannot remove them');
select pg_temp.as_user(:p1, 'aal1');
select lives_ok(format($$select api.remove_saved_place(%L)$$, :'gym'), 'the owner removes a place');
select is(jsonb_array_length(api.list_saved_places()), 1, 'it is gone from the list');
reset role;
select ok((select deleted_at is not null from public.saved_places where id = :'gym'), 'removal is a soft delete');
set local role authenticated;
select pg_temp.as_user(:p1, 'aal1');

-- ---------------------------------------------------------------------------
-- Trusted contacts (B7)
-- ---------------------------------------------------------------------------
select is(api.add_trusted_contact('Ayesha', '+8801711111111') ->> 'name', 'Ayesha', 'a contact is added');
select throws_ok($$select api.add_trusted_contact('Bad', '01711111111')$$, 'P0001', 'VALIDATION_FAILED', 'phones must be international');
select throws_ok($$select api.add_trusted_contact('Again', '+8801711111111')$$, 'P0001', 'ALREADY_EXISTS', 'the same number twice is refused');
select api.add_trusted_contact('Karim', '+8801722222222');
select api.add_trusted_contact('Nadia', '+8801733333333');
select throws_ok($$select api.add_trusted_contact('Fourth', '+8801744444444')$$, 'P0001', 'VALIDATION_FAILED', 'at most three contacts');
select pg_temp.as_user(:p2, 'aal1');
select is(api.list_trusted_contacts(), '[]'::jsonb, 'contacts are private to their owner');
select pg_temp.as_user(:p1, 'aal1');
select is(jsonb_array_length(api.list_trusted_contacts()), 3, 'the owner sees three');

-- ---------------------------------------------------------------------------
-- Live category data (B11) and current ride (B9)
-- ---------------------------------------------------------------------------
select ok((select (c ->> 'available_drivers')::int >= 1 from jsonb_array_elements(api.list_active_categories(23.805, 90.405)) c where c ->> 'code' = 'bike'),
  'bike shows at least one nearby driver');
select ok((select (c ->> 'pickup_eta_s')::int >= 60 from jsonb_array_elements(api.list_active_categories(23.805, 90.405)) c where c ->> 'code' = 'bike'),
  'and a pickup ETA of at least a minute');
select is((select c ->> 'available_drivers' from jsonb_array_elements(api.list_active_categories()) c where c ->> 'code' = 'bike'), '0',
  'without a point there is no live data');
select is(api.current_ride(), null, 'no current ride before requesting');

select (api.create_quote(:'bike', 23.805, 90.405, 'Gulshan', 23.82, 90.42, 'Banani', 5000, 1200) ->> 'id') as quote \gset
select (api.create_ride_request(:'quote'::uuid, 'cash', null) ->> 'id') as ride \gset
select is(api.current_ride() ->> 'id', :'ride', 'the open request is the current ride');
select pg_temp.as_user(:p2, 'aal1');
select is(api.current_ride(), null, 'other passengers have no current ride');

-- ---------------------------------------------------------------------------
-- Push events (B3)
-- ---------------------------------------------------------------------------
select pg_temp.as_user(:u1, 'aal1');
select api.accept_offer((api.driver_current_offer() ->> 'offer_id')::uuid);
reset role;
select is((select data ->> 'type' from public.notification_outbox where recipient_id = :p1 and channel = 'push' order by created_at desc limit 1),
  'ride.driver_assigned', 'accepting the offer queues "driver found" for the passenger');
select is((select link from public.notification_outbox where recipient_id = :p1 and data ->> 'type' = 'ride.driver_assigned'), '/ride/' || :'ride',
  'it opens the ride screen');
select ok((select body like '%PA-DRV-1%' and body not like '%+880%' from public.notification_outbox where recipient_id = :p1 and data ->> 'type' = 'ride.driver_assigned'),
  'it names the plate and never a phone number');
select is((select category from public.notification_outbox where recipient_id = :p1 and data ->> 'type' = 'ride.driver_assigned'), 'ride', 'filed under ride updates');
select is((select count(*)::int from public.notification_outbox where recipient_id = :p2), 0, 'nothing for anyone else');
select (id) as trip from public.trips where request_id = :'ride' \gset

-- Turning ride updates off stops them.
set local role authenticated;
select pg_temp.as_user(:p1, 'aal1');
select api.set_notification_preferences(false, true, false);
select pg_temp.as_user(:u1, 'aal1');
select api.driver_trip_arrived(:'trip', true);
reset role;
select is((select count(*)::int from public.notification_outbox where recipient_id = :p1 and data ->> 'type' = 'ride.driver_arrived'), 0,
  'no "arrived" push when ride updates are off');

-- Bengali copy for Bengali users.
update public.profiles set preferred_language = 'bn' where id = :p1;
update public.notification_preferences set ride = true where user_id = :p1;
set local role authenticated;
select pg_temp.as_user(:u1, 'aal1');
select api.driver_trip_start(:'trip', null);
reset role;
select is((select subject from public.notification_outbox where recipient_id = :p1 and data ->> 'type' = 'ride.started'), 'যাত্রা শুরু হয়েছে',
  'the trip-started push is in Bengali');

-- Support replies reach the passenger; internal notes never do.
set local role authenticated;
select pg_temp.as_user(:p1, 'aal1');
select (api.create_ticket(null, 'trip', 'Lost umbrella', 'I left it on the seat.') ->> 'id') as ticket \gset
reset role;
insert into public.support_ticket_messages (ticket_id, author_id, author_type, body, is_internal)
values (:'ticket', :sa, 'admin', 'Internal: check with driver', true);
select is((select count(*)::int from public.notification_outbox where recipient_id = :p1 and data ->> 'type' = 'support.reply'), 0, 'internal notes send nothing');
insert into public.support_ticket_messages (ticket_id, author_id, author_type, body, is_internal)
values (:'ticket', :sa, 'admin', 'We found it.', false);
select is((select data ->> 'ticket_id' from public.notification_outbox where recipient_id = :p1 and data ->> 'type' = 'support.reply'),
  :'ticket', 'a support reply is pushed with its ticket');

-- ---------------------------------------------------------------------------
-- Trip share links (B5)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(:p2, 'aal1');
select throws_ok(format($$select api.create_trip_share(%L)$$, :'trip'), 'P0001', 'NOT_FOUND', 'only the passenger can share their trip');
select pg_temp.as_user(:p1, 'aal1');
select (api.create_trip_share(:'trip') ->> 'token') as token \gset
select ok(length(:'token') >= 30, 'a long random token is returned');
reset role;
select isnt((select share_token_hash from public.trips where id = :'trip'), :'token', 'only a hash is stored');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(format($$select api.get_shared_trip(%L)$$, :'token'), '42501', null, 'anonymous callers cannot reach the api schema');
reset role;
set local role authenticated;
select pg_temp.as_user(:p2, 'aal1');
select throws_ok(format($$select api.get_shared_trip(%L)$$, :'token'), '42501', null, 'nor can signed-in users call it directly');
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(api.get_shared_trip(:'token') -> 'vehicle' ->> 'registration_number', 'PA-DRV-1', 'anyone with the link sees the vehicle');
select ok(api.get_shared_trip(:'token')::text !~ '\+880', 'and no phone numbers');
select ok(api.get_shared_trip(:'token') ? 'driver_location', 'with the live driver position');
select throws_ok($$select api.get_shared_trip('not-a-real-token-but-long-enough-1234')$$, 'P0001', 'NOT_FOUND', 'a wrong token finds nothing');

-- ---------------------------------------------------------------------------
-- Push worker interface (B2)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(:p1, 'aal1');
select throws_ok($$select api.forget_push_tokens(array['x'])$$, '42501', null, 'users cannot remove push tokens');
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select ok(exists (select 1 from jsonb_array_elements(api.claim_notifications(100)) m where m ->> 'category' = 'ride' and m -> 'data' ? 'ride_id'
  and m -> 'tokens' ? 'ExponentPushToken[pa-test-device-0001]'), 'the worker receives data, category and the device token');
select is(api.forget_push_tokens(array['ExponentPushToken[pa-test-device-0001]']), 1, 'the worker removes a dead token');

select * from finish();
rollback;
