-- M2: fares, quotes, dispatch, trips, cancellations, admin views, realtime authorisation.
begin;
create extension if not exists pgtap with schema extensions;
select plan(100);

\set inviter '''00000000-0000-0000-0000-00000000a000'''
\set sa      '''00000000-0000-0000-0000-00000000a001'''
\set ops     '''00000000-0000-0000-0000-00000000a002'''
\set support '''00000000-0000-0000-0000-00000000a003'''
\set analyst '''00000000-0000-0000-0000-00000000a004'''
\set p1  '''00000000-0000-0000-0000-00000000b001'''
\set p2  '''00000000-0000-0000-0000-00000000b002'''
\set p3  '''00000000-0000-0000-0000-00000000b003'''
\set u1  '''00000000-0000-0000-0000-00000000c001'''
\set u2  '''00000000-0000-0000-0000-00000000c002'''
\set u3  '''00000000-0000-0000-0000-00000000c003'''
\set d1  '''00000000-0000-0000-0000-00000000d001'''
\set d2  '''00000000-0000-0000-0000-00000000d002'''
\set d3  '''00000000-0000-0000-0000-00000000d003'''

-- Isolate from data other test runs left behind.
update public.driver_profiles set availability = 'offline' where availability <> 'offline';

insert into auth.users (id, email) values (:inviter, 'inv.m2@test.local');
insert into public.admin_invitations (email, full_name, template_ids, reason, invited_by)
select e.email, e.name, array(select id from public.permission_templates where code = e.tpl), 'fixture', :inviter
from (values ('sa.m2@test.local', 'Super M2', 'super_admin'), ('ops.m2@test.local', 'Ops M2', 'operations'),
             ('support.m2@test.local', 'Support M2', 'support'), ('analyst.m2@test.local', 'Analyst M2', 'analyst')) e(email, name, tpl);
insert into auth.users (id, email) values
  (:sa, 'sa.m2@test.local'), (:ops, 'ops.m2@test.local'), (:support, 'support.m2@test.local'), (:analyst, 'analyst.m2@test.local'),
  (:p1, 'p1.m2@test.local'), (:p2, 'p2.m2@test.local'), (:p3, 'p3.m2@test.local'),
  (:u1, 'u1.m2@test.local'), (:u2, 'u2.m2@test.local'), (:u3, 'u3.m2@test.local');
select private.promote_user_role(x, 'passenger') from unnest(array[:p1::uuid, :p2::uuid, :p3::uuid]) x;

select id as bike from public.vehicle_categories where code = 'bike' \gset

-- A small zone (smaller than any leftover zone so it always wins) and three approved, online drivers.
insert into public.service_zones (id, code, name, boundary, area_km2, active)
values ('00000000-0000-0000-0000-00000000e001', 'm2_zone', 'M2 Zone',
  extensions.st_multi(extensions.st_geomfromtext('POLYGON((90.35 23.75,90.45 23.75,90.45 23.85,90.35 23.85,90.35 23.75))', 4326))::extensions.geography,
  120, true);

create function pg_temp.mk_driver(p_user uuid, p_drv uuid, p_veh uuid, p_plate text, p_lat double precision, p_lng double precision) returns void
language plpgsql as $$
begin
  perform private.promote_user_role(p_user, 'driver');
  insert into public.driver_profiles (id, user_id, onboarding_status, approved_at) values (p_drv, p_user, 'approved', now());
  insert into public.vehicles (id, driver_id, category_id, make, model, color, registration_number, year, status)
  values (p_veh, p_drv, (select id from public.vehicle_categories where code = 'bike'), 'Honda', 'CB', 'Red', p_plate, 2022, 'active');
  update public.driver_profiles set current_vehicle_id = p_veh, availability = 'online' where id = p_drv;
  insert into public.driver_live_locations (driver_id, location, recorded_at, updated_at) values (p_drv, private.point(p_lat, p_lng), now(), now());
end $$;
select pg_temp.mk_driver(:u1, '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f101', 'M2-DRV-1', 23.801, 90.401);
select pg_temp.mk_driver(:u2, '00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-00000000f102', 'M2-DRV-2', 23.810, 90.410);
select pg_temp.mk_driver(:u3, '00000000-0000-0000-0000-00000000f003', '00000000-0000-0000-0000-00000000f103', 'M2-DRV-3', 23.790, 90.390);

create function pg_temp.as_user(p_id uuid, p_aal text default 'aal2') returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

-- ---------------------------------------------------------------------------
-- Fare engine
-- ---------------------------------------------------------------------------
select is(
  private.compute_fare('{"base_fare":40,"per_km":20,"per_minute":2,"minimum_fare":60,"booking_fee":0,"waiting_per_minute":2,"free_waiting_minutes":3,"platform_commission_pct":0.15,"max_surge_multiplier":1.5,"commissionable_components":["base","distance","time","waiting","surge"]}',
                       5000, 1200, 0, 1, 10) - 'surge_multiplier',
  '{"distance_m":5000,"duration_s":1200,"tax_amount":0,"base_amount":40,"booking_fee":0,"time_amount":40.00,"surge_amount":0.00,"total_amount":170,"commission_pct":0.15,"driver_earning":153.00,"waiting_amount":0.00,"discount_amount":10,"distance_amount":100.00,"rounding_amount":0.00,"minimum_adjustment":0,"cancellation_amount":0,"platform_commission":27.00,"commissionable_amount":180.00}'::jsonb,
  'blueprint example: fare 180, discount 10 -> pays 170, commission 27, driver 153');
select is((private.compute_fare('{"base_fare":40,"per_km":20,"per_minute":2,"minimum_fare":60,"booking_fee":10,"waiting_per_minute":2,"free_waiting_minutes":3,"platform_commission_pct":0.15,"max_surge_multiplier":1.5,"commissionable_components":["base","distance","time"]}', 300, 60, 0, 1) ->> 'total_amount')::numeric,
  70::numeric, 'minimum fare applies, booking fee added on top');
select is((private.compute_fare('{"base_fare":40,"per_km":20,"per_minute":2,"minimum_fare":60,"booking_fee":0,"waiting_per_minute":2,"free_waiting_minutes":3,"platform_commission_pct":0.15,"max_surge_multiplier":1.5,"commissionable_components":["base","distance","time","waiting","surge"]}', 5000, 1200, 0, 3) ->> 'surge_multiplier')::numeric,
  1.5::numeric, 'surge is capped by the rule');
select is((private.compute_fare('{"base_fare":40,"per_km":20,"per_minute":2,"minimum_fare":60,"booking_fee":0,"waiting_per_minute":2,"free_waiting_minutes":3,"platform_commission_pct":0.15,"max_surge_multiplier":1.5,"commissionable_components":["base"]}', 5000, 1200, 600, 1) ->> 'commissionable_amount')::numeric,
  40::numeric, 'only listed components are commissionable');

-- ---------------------------------------------------------------------------
-- Fare rule administration
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(:ops);
select (api.save_fare_draft(null, :'bike', '00000000-0000-0000-0000-00000000e001',
  '{"base_fare":40,"per_km":20,"per_minute":2,"minimum_fare":60,"booking_fee":0,"waiting_per_minute":2,"free_waiting_minutes":3,"cancellation_fee":30,"platform_commission_pct":0.15,"max_surge_multiplier":1.5}',
  'Pilot rates', null)) as rule1 \gset
select is((api.get_fare_rule(:'rule1') ->> 'status'), 'draft', 'ops (fares.manage) creates a draft');
select throws_ok(format($$select api.publish_fare_rule(%L, null, 'Go live for the pilot')$$, :'rule1'),
  'P0001', 'FORBIDDEN', 'ops cannot publish (needs fares.publish)');
select throws_ok($$select api.save_fare_draft(null, (select id from public.vehicle_categories where code = 'bike'), null,
  '{"base_fare":-1,"per_km":20,"per_minute":2,"minimum_fare":60,"booking_fee":0,"waiting_per_minute":2,"cancellation_fee":0,"platform_commission_pct":0.15,"max_surge_multiplier":1}', null, null)$$,
  'P0001', 'VALIDATION_FAILED', 'negative amounts are rejected');
select throws_ok($$select api.save_fare_draft(null, (select id from public.vehicle_categories where code = 'bike'), null,
  '{"base_fare":40,"per_km":20,"per_minute":2,"minimum_fare":60,"booking_fee":0,"waiting_per_minute":2,"cancellation_fee":0,"platform_commission_pct":0.9,"max_surge_multiplier":1}', null, null)$$,
  'P0001', 'VALIDATION_FAILED', 'commission above 50% is rejected');
select is((api.simulate_fare('{"base_fare":40,"per_km":20,"per_minute":2,"minimum_fare":60,"booking_fee":0,"waiting_per_minute":2,"free_waiting_minutes":3,"platform_commission_pct":0.15,"max_surge_multiplier":1.5}', 5000, 1200, 0, 1, null) -> 'breakdown' ->> 'total_amount')::numeric,
  180::numeric, 'simulator prices unsaved values');

select pg_temp.as_user(:analyst);
select throws_ok(format($$select api.save_fare_draft(%L, null, null, '{}', null, 1)$$, :'rule1'), 'P0001', 'FORBIDDEN', 'analyst cannot edit fares');

select pg_temp.as_user(:p1, 'aal1');
select throws_ok($$select api.create_quote((select id from public.vehicle_categories where code = 'bike'), 23.80, 90.40, 'A', 23.82, 90.42, 'B', 4000, 900)$$,
  'P0001', 'PRICING_UNAVAILABLE', 'no published rule means no quote');

select pg_temp.as_user(:sa);
select is((api.publish_fare_rule(:'rule1', null, 'Go live for the pilot') ->> 'live_state'), 'active', 'super admin publishes: rule is live');
select throws_ok(format($$select api.save_fare_draft(%L, null, null, '{"base_fare":1,"per_km":1,"per_minute":1,"minimum_fare":1,"booking_fee":0,"waiting_per_minute":0,"cancellation_fee":0,"platform_commission_pct":0.1,"max_surge_multiplier":1}', null, 1)$$, :'rule1'),
  'P0001', 'INVALID_STATE_TRANSITION', 'a published rule cannot be edited');
reset role;
select throws_ok(format($$update public.fare_rules set base_fare = 1 where id = %L$$, :'rule1'), 'P0001', 'IMMUTABLE_ROW', 'published fields are immutable even for the owner');
select throws_ok(format($$insert into public.fare_rules (category_id, zone_id, rule_version, status, base_fare, per_km, per_minute, minimum_fare, platform_commission_pct, effective_from)
  values (%L, '00000000-0000-0000-0000-00000000e001', 99, 'active', 1, 1, 1, 1, 0.1, now())$$, :'bike'),
  '23P01', null, 'two live rules cannot overlap for the same slot');

set local role authenticated;
select pg_temp.as_user(:sa);
select (api.clone_fare_rule(:'rule1')) as rule2 \gset
select is((api.get_fare_rule(:'rule2') ->> 'rule_version')::int, 2, 'clone is the next version');
select is((api.publish_fare_rule(:'rule2', now() + interval '2 days', 'Rate change from Friday') ->> 'live_state'), 'scheduled', 'a future publish is scheduled');
select is((select effective_to is not null from public.fare_rules where id = :'rule1'), true, 'the current rule ends when the new one starts');
select is((select effective_to = effective_from from public.fare_rules r2 join (select effective_from as ef from public.fare_rules where id = :'rule2') x on true where r2.id = :'rule1' and r2.effective_to = x.ef limit 1) is not null, true,
  'the current rule ends exactly at the new start');
select is(api.retire_fare_rule(:'rule2', 'Changed our mind') ->> 'live_state', 'ended', 'a scheduled rule can be retired');

-- ---------------------------------------------------------------------------
-- Quotes
-- ---------------------------------------------------------------------------
select pg_temp.as_user(:p1, 'aal1');
select throws_ok($$select api.create_quote((select id from public.vehicle_categories where code = 'bike'), 22.30, 91.80, 'Far', 22.31, 91.81, 'Far2', 4000, 900)$$,
  'P0001', 'OUT_OF_SERVICE_AREA', 'a pickup outside every zone cannot be quoted');
select throws_ok($$select api.create_quote((select id from public.vehicle_categories where code = 'bike'), 23.80, 90.40, 'A', 23.82, 90.42, 'B', 5, 900)$$,
  'P0001', 'VALIDATION_FAILED', 'an implausibly short route is rejected');
select (api.create_quote(:'bike', 23.805, 90.405, 'Gulshan', 23.82, 90.42, 'Banani', 5000, 1200)) as quote1 \gset
select is((:'quote1'::jsonb ->> 'estimated_fare')::numeric, 180::numeric, 'quote uses the live rule');
select is((:'quote1'::jsonb ->> 'available_drivers')::int, 3, 'quote reports nearby drivers');
select pg_temp.as_user(:u1, 'aal1');
select throws_ok($$select api.create_quote((select id from public.vehicle_categories where code = 'bike'), 23.80, 90.40, 'A', 23.82, 90.42, 'B', 4000, 900)$$,
  'P0001', 'ROLE_NOT_ALLOWED', 'only passengers can request quotes');

-- ---------------------------------------------------------------------------
-- Request + dispatch
-- ---------------------------------------------------------------------------
select pg_temp.as_user(:p1, 'aal1');
select throws_ok(format($$select api.create_ride_request(%L, 'bkash', null)$$, (:'quote1'::jsonb ->> 'id')), 'P0001', 'VALIDATION_FAILED',
  'payment methods that are not enabled are refused');
select (api.create_ride_request((:'quote1'::jsonb ->> 'id')::uuid, 'cash', 'Blue gate')) as ride1 \gset
select is((:'ride1'::jsonb ->> 'status'), 'searching', 'request starts searching');
select (:'ride1'::jsonb ->> 'id') as req1 \gset
reset role;
select is((select count(*)::int from public.dispatch_offers where request_id = :'req1' and response = 'pending'), 1, 'the nearest driver gets an offer');
select is((select driver_id::text from public.dispatch_offers where request_id = :'req1'), '00000000-0000-0000-0000-00000000f001', 'nearest driver is offered first');
set local role authenticated;
select pg_temp.as_user(:p1, 'aal1');
select (api.create_quote(:'bike', 23.805, 90.405, 'Gulshan', 23.82, 90.42, 'Banani', 5000, 1200) ->> 'id') as quote_b \gset
select throws_ok(format($$select api.create_ride_request(%L, 'cash', null)$$, :'quote_b'), 'P0001', 'ACTIVE_REQUEST_EXISTS', 'one open request per passenger');

select pg_temp.as_user(:p3, 'aal1');
select (api.create_quote(:'bike', 23.805, 90.405, 'Gulshan', 23.82, 90.42, 'Banani', 5000, 1200) ->> 'id') as quote_p3 \gset
reset role;
update public.fare_quotes set expires_at = now() - interval '1 minute' where id = :'quote_p3';
set local role authenticated;
select pg_temp.as_user(:p3, 'aal1');
select throws_ok(format($$select api.create_ride_request(%L, 'cash', null)$$, :'quote_p3'), 'P0001', 'QUOTE_EXPIRED', 'an expired quote cannot be used');

-- Drivers: isolation and accept
select pg_temp.as_user(:u2, 'aal1');
select is(api.driver_current_offer(), null, 'a driver without an offer sees none');
select pg_temp.as_user(:u1, 'aal1');
select (api.driver_current_offer() ->> 'offer_id') as offer1 \gset
select is((api.driver_current_offer() ->> 'estimated_fare')::numeric, 180::numeric, 'the driver sees the offer with the fare');
select ok((api.driver_current_offer() ->> 'estimated_driver_earning')::numeric = 153, 'the driver sees their expected earning');
select pg_temp.as_user(:u2, 'aal1');
select throws_ok(format($$select api.accept_offer(%L)$$, :'offer1'), 'P0001', 'OFFER_NO_LONGER_AVAILABLE', 'a driver cannot accept another driver''s offer');
select pg_temp.as_user(:u1, 'aal1');
select (api.accept_offer(:'offer1') ->> 'id') as trip1 \gset
select is((api.get_driver_trip(:'trip1') ->> 'status'), 'driver_assigned', 'accepting creates a trip');
select is((api.accept_offer(:'offer1') ->> 'id'), :'trip1', 'accepting twice returns the same trip');
reset role;
select is((select count(*)::int from public.trips where request_id = :'req1'), 1, 'exactly one trip per request');
select is((select availability::text from public.driver_profiles where id = '00000000-0000-0000-0000-00000000f001'), 'on_trip', 'the driver is on a trip');
select is((select status::text from public.ride_requests where id = :'req1'), 'matched', 'the request is matched');
select throws_ok(format($$update public.trips set status = 'completed' where id = %L$$, :'trip1'), 'P0001', 'INVALID_STATE_TRANSITION',
  'trip status cannot be changed outside transition_trip');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- State machine
-- ---------------------------------------------------------------------------
select pg_temp.as_user(:u1, 'aal1');
select throws_ok(format($$select api.driver_trip_start(%L)$$, :'trip1'), 'P0001', 'INVALID_STATE_TRANSITION', 'cannot start before arriving');
select throws_ok(format($$select api.complete_trip(%L)$$, :'trip1'), 'P0001', 'INVALID_STATE_TRANSITION', 'cannot complete before starting');
select is((api.driver_trip_arriving(:'trip1') ->> 'status'), 'driver_arriving', 'driver is on the way');
select throws_ok(format($$select api.driver_trip_arrived(%L)$$, :'trip1'), 'P0001', 'TOO_FAR_FROM_PICKUP', 'arrival is checked against the pickup location');
select is((api.driver_trip_arrived(:'trip1', true) ->> 'status'), 'arrived', 'arrival with a logged override');
select pg_temp.as_user(:u2, 'aal1');
select throws_ok(format($$select api.driver_trip_start(%L)$$, :'trip1'), 'P0001', 'NOT_FOUND', 'another driver cannot act on this trip');
select pg_temp.as_user(:u1, 'aal1');
select is((api.driver_trip_start(:'trip1') ->> 'status'), 'in_progress', 'the ride starts');
select pg_temp.as_user(:p1, 'aal1');
select throws_ok(format($$select api.cancel_ride(%L, 'changed my mind')$$, :'req1'), 'P0001', 'INVALID_STATE_TRANSITION', 'a passenger cannot cancel a ride in progress');

-- Completion with a recorded trail (about 3 km north-east in 8 points).
select pg_temp.as_user(:u1, 'aal1');
select api.driver_update_locations((select jsonb_agg(jsonb_build_object('lat', 23.801 + i * 0.003, 'lng', 90.401 + i * 0.003,
  'speed', 23, 'accuracy', 10, 'recorded_at', now() - make_interval(secs => 160 - i * 20))) from generate_series(0, 7) i));
reset role;
select is((select count(*)::int from public.trip_location_points where trip_id = :'trip1'), 8, 'the trail is recorded during the ride');
update public.trips set started_at = now() - interval '10 minutes', arrived_at = now() - interval '14 minutes' where id = :'trip1';
set local role authenticated;
select pg_temp.as_user(:u1, 'aal1');
select (api.complete_trip(:'trip1') ->> 'final_fare')::numeric as fare1 \gset
select ok(:'fare1'::numeric > 100, 'completion computes a final fare');
reset role;
select is((select distance_source from public.trips where id = :'trip1'), 'trail', 'distance comes from the recorded trail');
select is((select total_amount from public.trip_fare_breakdowns where trip_id = :'trip1'), :'fare1'::numeric, 'the frozen breakdown matches the final fare');
select is((select availability::text from public.driver_profiles where id = '00000000-0000-0000-0000-00000000f001'), 'online', 'the driver is free again');
select is((select status::text from public.ride_requests where id = :'req1'), 'completed', 'the request is completed');
select throws_ok(format($$update public.trip_fare_breakdowns set total_amount = 1 where trip_id = %L$$, :'trip1'), 'P0001', 'APPEND_ONLY', 'a completed fare breakdown is frozen');
set local role authenticated;
select pg_temp.as_user(:u1, 'aal1');
select is((api.complete_trip(:'trip1') ->> 'final_fare')::numeric, :'fare1'::numeric, 'completing twice is idempotent');
select pg_temp.as_user(:p1, 'aal1');
select is((api.get_receipt(:'trip1') ->> 'final_fare')::numeric, :'fare1'::numeric, 'the passenger receipt matches');

-- ---------------------------------------------------------------------------
-- Rejection, expiry, no driver, cancellation
-- ---------------------------------------------------------------------------
select (api.create_quote(:'bike', 23.805, 90.405, 'Gulshan', 23.82, 90.42, 'Banani', 5000, 1200) ->> 'id') as quote2 \gset
select (api.create_ride_request(:'quote2'::uuid, 'cash', null) ->> 'id') as req2 \gset
select pg_temp.as_user(:u1, 'aal1');
select (api.driver_current_offer() ->> 'offer_id') as offer2 \gset
select api.reject_offer(:'offer2', 'too far');
reset role;
select is((select driver_id::text from public.dispatch_offers where request_id = :'req2' and response = 'pending'), '00000000-0000-0000-0000-00000000f002',
  'a rejection moves the offer to the next driver');
update public.dispatch_offers set expires_at = now() - interval '1 second' where request_id = :'req2' and response = 'pending';
select ok((private.dispatch_tick() ->> 'offers_expired')::int >= 1, 'the tick expires unanswered offers');
select is((select count(*)::int from public.dispatch_offers where request_id = :'req2' and response = 'pending'), 1, 'and offers the next driver (3 km radius)');
update public.ride_requests set expires_at = now() - interval '1 second' where id = :'req2';
select ok((private.dispatch_tick() ->> 'requests_expired')::int >= 1, 'the tick expires requests past their time limit');
select is((select status::text from public.ride_requests where id = :'req2'), 'no_driver_found', 'an unmatched request ends as no_driver_found');
select is((select count(*)::int from public.dispatch_offers where request_id = :'req2' and response = 'pending'), 0, 'and its pending offer is withdrawn');

set local role authenticated;
select pg_temp.as_user(:p2, 'aal1');
select (api.create_quote(:'bike', 23.752, 90.448, 'Far corner', 23.76, 90.44, 'Other', 5000, 1200) ->> 'id') as quote_far \gset
select is((api.create_ride_request(:'quote_far'::uuid, 'cash', null) ->> 'status'), 'no_driver_found', 'no driver in any radius closes the request at once');

select pg_temp.as_user(:p1, 'aal1');
select (api.create_quote(:'bike', 23.805, 90.405, 'Gulshan', 23.82, 90.42, 'Banani', 5000, 1200) ->> 'id') as quote3 \gset
select (api.create_ride_request(:'quote3'::uuid, 'cash', null) ->> 'id') as req3 \gset
select is((api.cancel_ride(:'req3', 'changed my mind') ->> 'status'), 'cancelled_by_passenger', 'a passenger cancels while searching');
reset role;
select is((select count(*)::int from public.dispatch_offers where request_id = :'req3' and response = 'pending'), 0, 'cancelling withdraws the live offer');

-- Cancellation fee: free in the window, charged after it
set local role authenticated;
select pg_temp.as_user(:p1, 'aal1');
select (api.create_quote(:'bike', 23.805, 90.405, 'Gulshan', 23.82, 90.42, 'Banani', 5000, 1200) ->> 'id') as quote4 \gset
select (api.create_ride_request(:'quote4'::uuid, 'cash', null) ->> 'id') as req4 \gset
select pg_temp.as_user(:u1, 'aal1');
select (api.accept_offer((api.driver_current_offer() ->> 'offer_id')::uuid) ->> 'id') as trip4 \gset
select pg_temp.as_user(:p1, 'aal1');
select is((api.cancel_preview(:'req4') ->> 'fee')::numeric, 0::numeric, 'cancelling inside the free window costs nothing');
reset role;
update public.trips set accepted_at = now() - interval '5 minutes', accepted_pickup_eta_s = 600 where id = :'trip4';
set local role authenticated;
select pg_temp.as_user(:p1, 'aal1');
select is((api.cancel_preview(:'req4') ->> 'fee')::numeric, 30::numeric, 'after the window the rule''s cancellation fee applies');
select is((api.cancel_ride(:'req4', 'driver is slow') ->> 'status'), 'cancelled_by_passenger', 'the passenger cancels the assigned ride');
reset role;
select is((select cancellation_fee from public.trips where id = :'trip4'), 30::numeric, 'the fee is recorded on the trip');
select is((select availability::text from public.driver_profiles where id = '00000000-0000-0000-0000-00000000f001'), 'online', 'the driver is released after the cancellation');

-- Driver cancel and admin cancel
set local role authenticated;
select pg_temp.as_user(:p1, 'aal1');
select (api.create_quote(:'bike', 23.805, 90.405, 'Gulshan', 23.82, 90.42, 'Banani', 5000, 1200) ->> 'id') as quote5 \gset
select (api.create_ride_request(:'quote5'::uuid, 'cash', null) ->> 'id') as req5 \gset
select pg_temp.as_user(:u1, 'aal1');
select (api.accept_offer((api.driver_current_offer() ->> 'offer_id')::uuid) ->> 'id') as trip5 \gset
select throws_ok(format($$select api.driver_trip_cancel(%L, '')$$, :'trip5'), 'P0001', 'VALIDATION_FAILED', 'a driver must say why they cancel');
select is((api.driver_trip_cancel(:'trip5', 'Bike broke down') ->> 'status'), 'cancelled_by_driver', 'the driver cancels');
reset role;
select is((select status::text from public.ride_requests where id = :'req5'), 'cancelled_by_driver', 'the request mirrors the driver cancellation');

set local role authenticated;
select pg_temp.as_user(:p1, 'aal1');
select (api.create_quote(:'bike', 23.805, 90.405, 'Gulshan', 23.82, 90.42, 'Banani', 5000, 1200) ->> 'id') as quote6 \gset
select (api.create_ride_request(:'quote6'::uuid, 'cash', null) ->> 'id') as req6 \gset
select pg_temp.as_user(:u1, 'aal1');
select (api.accept_offer((api.driver_current_offer() ->> 'offer_id')::uuid) ->> 'id') as trip6 \gset

-- ---------------------------------------------------------------------------
-- Admin views and interventions
-- ---------------------------------------------------------------------------
select pg_temp.as_user(:analyst);
select throws_ok($$select api.ops_live_snapshot()$$, 'P0001', 'FORBIDDEN', 'analyst cannot open live ops');
select pg_temp.as_user(:ops);
select ok((api.ops_live_snapshot() -> 'metrics' ->> 'active_trips')::int >= 1, 'live ops reports active trips');
select ok(jsonb_array_length(api.ops_live_snapshot() -> 'drivers') >= 3, 'live ops lists online drivers');
select ok(jsonb_array_length(api.list_trips('active') -> 'rows') >= 1, 'ops lists active trips');
select ok(api.get_trip(:'trip1') -> 'trail' <> 'null'::jsonb, 'ops (trips.view_location) sees the route trail');
select pg_temp.as_user(:support);
select is(api.get_trip(:'trip1') -> 'trail', 'null'::jsonb, 'support sees the trip without route or coordinates');
select is(api.get_trip(:'trip1') -> 'pickup', 'null'::jsonb, 'and without precise pickup coordinates');
select ok(api.get_trip(:'trip1') -> 'breakdown' is not null, 'but with the fare breakdown');
select throws_ok(format($$select api.admin_cancel_trip(%L, 'Support cannot cancel trips')$$, :'trip6'), 'P0001', 'FORBIDDEN', 'support cannot cancel trips');
select pg_temp.as_user(:ops);
select throws_ok(format($$select api.admin_cancel_trip(%L, 'x')$$, :'trip6'), 'P0001', 'VALIDATION_FAILED', 'cancelling needs a reason');
select is((api.admin_cancel_trip(:'trip6', 'Driver unreachable, customer called') ->> 'status'), 'cancelled_by_admin', 'ops cancels an active trip');
select lives_ok(format($$select api.add_trip_note(%L, 'Called the driver twice, no answer.')$$, :'trip6'), 'ops adds an internal note');
select is(jsonb_array_length(api.get_trip(:'trip6') -> 'notes'), 1, 'the note is on the trip');

-- Stuck searching request: admin re-dispatches, then expires it
select pg_temp.as_user(:p1, 'aal1');
select (api.create_quote(:'bike', 23.805, 90.405, 'Gulshan', 23.82, 90.42, 'Banani', 5000, 1200) ->> 'id') as quote7 \gset
select (api.create_ride_request(:'quote7'::uuid, 'cash', null) ->> 'id') as req7 \gset
select pg_temp.as_user(:ops);
select ok(jsonb_array_length(api.redispatch_request(:'req7', 'Driver not responding') -> 'offers') >= 2, 're-dispatch moves on to the next driver');
select is((api.expire_request(:'req7', 'No coverage at this hour') ->> 'status'), 'no_driver_found', 'ops expires a stuck request');

-- ---------------------------------------------------------------------------
-- Audit and realtime authorisation
-- ---------------------------------------------------------------------------
reset role;
select ok(exists (select 1 from public.admin_audit_logs where action = 'trip.cancel' and entity_id = :'trip6'), 'interventions are audited');
select ok(exists (select 1 from public.pii_access_logs where field = 'trip_route:' || :'trip1'), 'viewing a route trail is logged');
select ok(exists (select 1 from audit.change_log where table_name = 'public.fare_rules' and record_id = :'rule1'), 'fare rule changes are in the change log');

set local role authenticated;
select pg_temp.as_user(:p1, 'aal1');
select is(private.can_receive_topic('ride:' || :'req1'), true, 'a passenger may listen to their own ride channel');
select pg_temp.as_user(:p2, 'aal1');
select is(private.can_receive_topic('ride:' || :'req1'), false, 'another passenger may not');
select is(private.can_receive_topic('ops:live'), false, 'passengers cannot listen to live ops');
select pg_temp.as_user(:u1, 'aal1');
select is(private.can_receive_topic('driver:00000000-0000-0000-0000-00000000f001'), true, 'a driver listens to their own channel');
select is(private.can_receive_topic('driver:00000000-0000-0000-0000-00000000f002'), false, 'but not another driver''s');
select pg_temp.as_user(:ops);
select is(private.can_receive_topic('ops:live'), true, 'dispatch.view holders may listen to live ops');
select pg_temp.as_user(:analyst);
select is(private.can_receive_topic('ops:live'), false, 'analyst may not');

select * from finish();
rollback;
