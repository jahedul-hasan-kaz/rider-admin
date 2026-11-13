-- M4: KPI rollups (hand-checked fixtures, no double counting), dashboard and analytics, exports, alerts,
-- settings and flags, retention.
begin;
create extension if not exists pgtap with schema extensions;
select plan(127);

\set inviter '''00000000-0000-0000-0000-00000004a000'''
\set sa      '''00000000-0000-0000-0000-00000004a001'''
\set finance '''00000000-0000-0000-0000-00000004a002'''
\set analyst '''00000000-0000-0000-0000-00000004a003'''
\set support '''00000000-0000-0000-0000-00000004a004'''
\set p1  '''00000000-0000-0000-0000-00000004b001'''
\set p2  '''00000000-0000-0000-0000-00000004b002'''
\set p3  '''00000000-0000-0000-0000-00000004b003'''
\set u1  '''00000000-0000-0000-0000-00000004c001'''
\set d1  '''00000000-0000-0000-0000-00000004d001'''
\set zone '''00000000-0000-0000-0000-00000004e001'''

insert into auth.users (id, email) values (:inviter, 'inv.m4@test.local');
insert into public.admin_invitations (email, full_name, template_ids, reason, invited_by)
select e.email, e.name, array(select id from public.permission_templates where code = e.tpl), 'fixture', :inviter
from (values ('sa.m4@test.local', 'Super M4', 'super_admin'), ('finance.m4@test.local', 'Finance M4', 'finance'),
             ('analyst.m4@test.local', 'Analyst M4', 'analyst'), ('support.m4@test.local', 'Support M4', 'support')) e(email, name, tpl);
insert into auth.users (id, email) values
  (:sa, 'sa.m4@test.local'), (:finance, 'finance.m4@test.local'), (:analyst, 'analyst.m4@test.local'), (:support, 'support.m4@test.local'),
  (:p1, 'p1.m4@test.local'), (:p2, 'p2.m4@test.local'), (:p3, 'p3.m4@test.local'), (:u1, 'u1.m4@test.local');
select private.promote_user_role(x, 'passenger') from unnest(array[:p1::uuid, :p2::uuid, :p3::uuid]) x;
update public.profiles set full_name = '=1+1' where id = :p1;
update public.profiles set full_name = 'Pax Two' where id = :p2;

select id as bike from public.vehicle_categories where code = 'bike' \gset
-- A private patch of map far from anything else, so leftover data cannot leak into the figures.
insert into public.service_zones (id, code, name, boundary, area_km2, active)
values (:zone, 'm4_zone', 'M4 Zone',
  extensions.st_multi(extensions.st_geomfromtext('POLYGON((80.45 12.65,80.55 12.65,80.55 12.75,80.45 12.75,80.45 12.65))', 4326))::extensions.geography, 100, true);

create function pg_temp.as_user(p_id uuid, p_aal text default 'aal2') returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

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
select pg_temp.mk_driver(:u1, :d1, '00000000-0000-0000-0000-00000004f101', 'M4-DRV-1', 12.703, 80.503);

create function pg_temp.finish_trip(p_trip uuid, p_drv_user uuid) returns void
language plpgsql security definer as $$
begin
  perform pg_temp.as_user(p_drv_user, 'aal1');
  perform api.driver_update_locations((select jsonb_agg(jsonb_build_object('lat', 12.70 + i * 0.003, 'lng', 80.50 + i * 0.003,
    'speed', 23, 'accuracy', 10, 'recorded_at', now() - make_interval(secs => 160 - i * 20))) from generate_series(0, 7) i));
  update public.trips set started_at = now() - interval '10 minutes', arrived_at = now() - interval '14 minutes' where id = p_trip;
  perform api.complete_trip(p_trip);
end $$;

create function pg_temp.ride(p_pax uuid, p_drv_user uuid, p_promo text default null, p_stage text default 'completed') returns uuid
language plpgsql security definer as $$
declare
  v_quote uuid;
  v_req uuid;
  v_trip uuid;
begin
  perform pg_temp.as_user(p_pax, 'aal1');
  v_quote := (api.create_quote((select id from public.vehicle_categories where code = 'bike'), 12.70, 80.50, 'Start', 12.73, 80.53, 'End', 5000, 1200) ->> 'id')::uuid;
  v_req := (api.create_ride_request(v_quote, 'cash', null) ->> 'id')::uuid;
  if p_promo is not null then
    perform api.apply_promo(v_req, p_promo);
  end if;
  if p_stage = 'cancel' then
    perform api.cancel_ride(v_req, 'Changed my mind');
    return v_req;
  end if;
  perform pg_temp.as_user(p_drv_user, 'aal1');
  v_trip := (api.accept_offer((api.driver_current_offer() ->> 'offer_id')::uuid) ->> 'id')::uuid;
  perform api.driver_trip_arriving(v_trip);
  perform api.driver_trip_arrived(v_trip, true);
  perform api.driver_trip_start(v_trip);
  if p_stage = 'completed' then
    perform pg_temp.finish_trip(v_trip, p_drv_user);
  end if;
  return v_trip;
end $$;

set local role authenticated;
select pg_temp.as_user(:sa);
select (api.save_fare_draft(null, :'bike', :zone,
  '{"base_fare":40,"per_km":20,"per_minute":2,"minimum_fare":60,"booking_fee":0,"waiting_per_minute":2,"free_waiting_minutes":3,"cancellation_fee":30,"platform_commission_pct":0.15,"max_surge_multiplier":1.5}',
  'M4 rates', null)) as rule1 \gset
select api.publish_fare_rule(:'rule1', null, 'Go live for the insight tests');
select api.save_promotion(null, jsonb_build_object('code', 'M4PROMO', 'name', 'M4 promo', 'discount_type', 'fixed', 'discount_value', 20,
  'starts_at', now() - interval '1 hour', 'ends_at', now() + interval '30 days', 'budget_limit', 500, 'per_user_limit', 3));
select api.set_promotion_status((select id from public.promotions where code = 'M4PROMO'), 'active', 'Launch for the insight tests');
reset role;

-- Three requests: A completes, B completes with a 20 discount, C is cancelled by the passenger while searching.
select pg_temp.ride(:p1, :u1) as trip_a \gset
select pg_temp.ride(:p2, :u1, 'M4PROMO') as trip_b \gset
select pg_temp.ride(:p3, :u1, null, 'cancel') as req_c \gset

select private.rollup_kpi('day', now() - interval '2 days', now() + interval '1 day');
select private.rollup_kpi('15m', now() - interval '3 hours', now() + interval '1 hour');

-- ---------------------------------------------------------------------------
-- Rollups: every figure is checked against an independent computation from the source tables
-- ---------------------------------------------------------------------------
select is((select requests from public.kpi_rollups where grain = 'day' and zone_id = :zone and category_id = :'bike'), 3, 'three requests were made');
select is((select matched from public.kpi_rollups where grain = 'day' and zone_id = :zone), 2, 'two were matched (the cancelled one never was)');
select is((select started from public.kpi_rollups where grain = 'day' and zone_id = :zone), 2, 'two trips started');
select is((select completed_requests from public.kpi_rollups where grain = 'day' and zone_id = :zone), 2, 'two completed');
select is((select cancelled_passenger from public.kpi_rollups where grain = 'day' and zone_id = :zone), 1, 'one was cancelled by the passenger');
select is((select no_driver + cancelled_driver + cancelled_admin + failed_requests from public.kpi_rollups where grain = 'day' and zone_id = :zone), 0, 'and nothing else failed');
select is((select completed_trips from public.kpi_rollups where grain = 'day' and zone_id = :zone), 2, 'two completed trips');
select is((select gross_bookings from public.kpi_rollups where grain = 'day' and zone_id = :zone),
  (select sum(total_amount + discount_amount) from public.trip_fare_breakdowns where trip_id in (:'trip_a', :'trip_b')),
  'gross bookings are the fares before discount');
select is((select platform_revenue from public.kpi_rollups where grain = 'day' and zone_id = :zone),
  (select sum(round((total_amount + discount_amount) * 0.15, 2)) from public.trip_fare_breakdowns where trip_id in (:'trip_a', :'trip_b')),
  'platform revenue is 15% commission per trip (no booking fee)');
select is((select discounts from public.kpi_rollups where grain = 'day' and zone_id = :zone), 20::numeric, 'discounts are exactly the 20 given');
select is((select contribution from public.kpi_rollups where grain = 'day' and zone_id = :zone),
  (select platform_revenue - 20 from public.kpi_rollups where grain = 'day' and zone_id = :zone), 'contribution is revenue minus discounts');
select is((select driver_earnings from public.kpi_rollups where grain = 'day' and zone_id = :zone),
  (select sum(net_earning) from public.driver_earnings where trip_id in (:'trip_a', :'trip_b')), 'driver earnings match the earnings table');
select is((select active_drivers from public.kpi_rollups where grain = 'day' and zone_id = :zone), 1, 'one driver was active');
select ok((select match_p50_s is not null and match_p90_s >= match_p50_s from public.kpi_rollups where grain = 'day' and zone_id = :zone), 'match percentiles are ordered');

-- No double counting: recomputing changes nothing, and the 15-minute and daily views agree.
select md5(string_agg(k::text, '' order by k::text)) as before_sum from (select * from public.kpi_rollups where zone_id = :zone and grain = 'day') k \gset
select private.rollup_kpi('day', now() - interval '2 days', now() + interval '1 day');
select private.rollup_kpi('day', now() - interval '2 days', now() + interval '1 day');
select is((select md5(string_agg(k::text, '' order by k::text)) from (select * from public.kpi_rollups where zone_id = :zone and grain = 'day') k), :'before_sum',
  'recomputing a rollup (twice) leaves the figures untouched');
select is((select sum(completed_trips) from public.kpi_rollups where grain = '15m' and zone_id = :zone),
          (select sum(completed_trips) from public.kpi_rollups where grain = 'day' and zone_id = :zone), '15-minute buckets add up to the daily figure (trips)');
select is((select sum(gross_bookings) from public.kpi_rollups where grain = '15m' and zone_id = :zone),
          (select sum(gross_bookings) from public.kpi_rollups where grain = 'day' and zone_id = :zone), 'and bookings');
select is((select sum(requests) from public.kpi_rollups where grain = '15m' and zone_id = :zone),
          (select sum(requests) from public.kpi_rollups where grain = 'day' and zone_id = :zone), 'and requests');
select is((select count(*)::int from public.kpi_rollups where grain = 'day' and zone_id = :zone), 1, 'exactly one daily row for the zone and category');

-- ---------------------------------------------------------------------------
-- Dashboard
-- ---------------------------------------------------------------------------
select ((now() at time zone 'Asia/Dhaka')::date)::text as today \gset
select sum(net_earning) as earn_total from public.driver_earnings where trip_id in (:'trip_a', :'trip_b') \gset
set local role authenticated;
select pg_temp.as_user(:analyst);
select is((api.dashboard(:'today', :'today', :zone) -> 'current' ->> 'completed_trips')::int, 2, 'the dashboard shows two completed rides');
select is((api.dashboard(:'today', :'today', :zone) -> 'current' ->> 'match_rate')::numeric, 66.7, 'request-to-match rate is 2 of 3 = 66.7%');
select is((api.dashboard(:'today', :'today', :zone) -> 'current' ->> 'gross_bookings')::numeric,
  (select gross_bookings from public.kpi_rollups where grain = 'day' and zone_id = :zone), 'gross bookings match the rollup');
select is((api.dashboard(:'today', :'today', :zone) -> 'current' ->> 'contribution_per_ride')::numeric,
  (select round(contribution / 2, 2) from public.kpi_rollups where grain = 'day' and zone_id = :zone), 'contribution per ride is contribution over rides');
select isnt((api.dashboard(:'today', :'today', :zone) -> 'current' ->> 'contribution_subsidised'), null, 'subsidised contribution is shown separately');
select isnt((api.dashboard(:'today', :'today', :zone) -> 'current' ->> 'contribution_unsubsidised'), null, 'and the unsubsidised one');
select ok((api.dashboard(:'today', :'today', :zone) -> 'current' ->> 'contribution_subsidised')::numeric < (api.dashboard(:'today', :'today', :zone) -> 'current' ->> 'contribution_unsubsidised')::numeric,
  'a subsidised ride contributes less than an unsubsidised one');
select is((api.dashboard(:'today', :'today', :zone) -> 'previous' ->> 'completed_trips')::int, 0, 'the previous period is empty');
select is((api.dashboard(:'today', :'today', :zone) -> 'delta' ->> 'completed_trips'), null, 'so no percentage change is invented');
select is((api.dashboard(:'today', :'today', :zone) -> 'funnel'), '{"requests":3,"matched":2,"started":2,"completed":2}'::jsonb, 'the funnel is 3, 2, 2, 2');
select is((api.dashboard(:'today', :'today', :zone) -> 'cancellations' ->> 'passenger')::int, 1, 'one passenger cancellation');
select is((select (z ->> 'requests')::int from jsonb_array_elements(api.dashboard(:'today', :'today', :zone) -> 'zones') z limit 1), 3, 'zone health lists the zone with its requests');
select is((select z ->> 'health' from jsonb_array_elements(api.dashboard(:'today', :'today', :zone) -> 'zones') z limit 1), 'idle', 'too few requests to judge the zone');
select is((api.dashboard(:'today', :'today', :zone) -> 'days' -> 0 ->> 'completed_trips')::int, 2, 'the day series carries the figures');
select is((api.dashboard(:'today', :'today', '00000000-0000-0000-0000-0000000000aa') -> 'current' ->> 'completed_trips')::int, 0, 'filtering to another zone excludes these rides');
select ok((api.dashboard(:'today', :'today', :zone) -> 'attention') ?& array['documents_pending', 'refunds_waiting', 'tickets_breaching', 'incidents_open', 'fare_flags', 'cash_mismatches', 'alerts_open'],
  'the attention panel carries every item');
select throws_ok(format($$select api.dashboard(%L, %L)$$, '2026-01-01', '2024-01-01'), 'P0001', 'VALIDATION_FAILED', 'an inverted range is rejected');
select throws_ok(format($$select api.dashboard(%L, %L)$$, '2020-01-01', '2026-01-01'), 'P0001', 'VALIDATION_FAILED', 'a range over a year is rejected');
select pg_temp.as_user(:support);
select is((api.dashboard(:'today', :'today', :zone) -> 'current' ->> 'completed_trips')::int, 2, 'support holds dashboard.view');
select throws_ok(format($$select api.analytics('funnel', %L, %L)$$, :'today', :'today'), 'P0001', 'FORBIDDEN', 'but not analytics.view');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000004b001', 'aal1');
select throws_ok(format($$select api.dashboard(%L, %L)$$, :'today', :'today'), 'P0001', 'FORBIDDEN', 'a passenger cannot read the dashboard');
select is((select count(*)::int from public.kpi_rollups), 0, 'nor the rollup table directly');
reset role;

-- ---------------------------------------------------------------------------
-- Analytics pages
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(:analyst);
select throws_ok(format($$select api.analytics('bogus', %L, %L)$$, :'today', :'today'), 'P0001', 'VALIDATION_FAILED', 'an unknown analytics page is rejected');
select is((api.analytics('funnel', :'today', :'today', :zone) -> 'totals' ->> 'requests')::int, 3, 'funnel totals');
select is((api.analytics('funnel', :'today', :'today', :zone) -> 'by_zone' -> 0 ->> 'requests')::int, 3, 'funnel by zone');
select is((api.analytics('economics', :'today', :'today', :zone) -> 'detail' -> 'subsidised' ->> 'trips')::int, 1, 'one subsidised trip');
select is((api.analytics('economics', :'today', :'today', :zone) -> 'detail' -> 'unsubsidised' ->> 'trips')::int, 1, 'one unsubsidised trip');
select is((api.analytics('economics', :'today', :'today', :zone) -> 'detail' -> 'subsidised' ->> 'discounts')::numeric, 20::numeric, 'the subsidy is the 20 discount');
select is((api.analytics('drivers', :'today', :'today', :zone) -> 'drivers' -> 0 ->> 'trips')::int, 2, 'the driver completed two trips');
select is((api.analytics('drivers', :'today', :'today', :zone) -> 'drivers' -> 0 ->> 'earnings')::numeric,
  :'earn_total'::numeric, 'and earned their share');
select is((api.analytics('drivers', :'today', :'today', :zone) ->> 'active_drivers')::int, 1, 'one active driver');
select is((api.analytics('passengers', :'today', :'today', :zone) -> 'match_buckets' ->> 'lt30')::int
        + (api.analytics('passengers', :'today', :'today', :zone) -> 'match_buckets' ->> 'lt60')::int
        + (api.analytics('passengers', :'today', :'today', :zone) -> 'match_buckets' ->> 'lt120')::int
        + (api.analytics('passengers', :'today', :'today', :zone) -> 'match_buckets' ->> 'gte120')::int, 2, 'every matched request lands in exactly one match-time bucket');
select is((api.analytics('passengers', :'today', :'today', :zone) ->> 'repeat_riders_pct')::numeric, 0::numeric, 'nobody rode twice');
select ok((api.analytics('finance', :'today', :'today', :zone) -> 'payments') ?& array['pending', 'unreconciled', 'mismatches'], 'finance and risk carries payment health');
reset role;

-- ---------------------------------------------------------------------------
-- Exports
-- ---------------------------------------------------------------------------
select is(private.csv_cell('=HYPERLINK("x")'), '"''=HYPERLINK(""x"")"', 'a formula-looking cell is neutralised and quoted');
select is(private.csv_cell('+1'), '''+1', 'a leading plus is neutralised');
select is(private.csv_cell('a,b'), '"a,b"', 'commas are quoted');
select is(private.csv_cell(null), '', 'null is an empty cell');
select is(private.csv_row('a', 'b"c', null), 'a,"b""c",', 'a row joins escaped cells');

set local role authenticated;
select pg_temp.as_user(:support);
select throws_ok(format($$select api.request_export('trips', %L, %L)$$, :'today', :'today'), 'P0001', 'FORBIDDEN', 'support cannot export (no analytics.export)');
select pg_temp.as_user(:analyst);
select throws_ok(format($$select api.request_export('payments', %L, %L)$$, :'today', :'today'), 'P0001', 'FORBIDDEN', 'an analyst cannot export payments without payments.view');
select throws_ok(format($$select api.request_export('bogus', %L, %L)$$, :'today', :'today'), 'P0001', 'VALIDATION_FAILED', 'an unknown export kind is rejected');
select pg_temp.as_user(:finance);
select throws_ok(format($$select api.request_export('trips', %L, %L)$$, '2020-01-01', '2026-01-01'), 'P0001', 'VALIDATION_FAILED', 'a range over a year is rejected');
select (api.request_export('trips', :'today', :'today') ->> 'id') as exp1 \gset
select is((select status from public.export_jobs where id = :'exp1'), 'ready', 'a small export is ready immediately');
select ok((select row_count >= 2 from public.export_jobs where id = :'exp1'), 'it holds the trips');
select is((api.get_export_content(:'exp1') ->> 'filename'), 'trips-' || :'today' || '-' || :'today' || '.csv', 'the download has a sensible file name');
select ok((api.get_export_content(:'exp1') ->> 'content') like 'trip_id,status,%', 'the CSV starts with its header');
select ok((api.get_export_content(:'exp1') ->> 'content') like '%''=1+1%', 'a passenger named like a formula is neutralised in the file');
select ok(position('@' in (api.get_export_content(:'exp1') ->> 'content')) = 0, 'no email addresses are exported');
select throws_ok(format($$select content from public.export_jobs where id = %L$$, :'exp1'), '42501', null, 'the CSV cannot be selected directly');
select pg_temp.as_user(:sa);
select throws_ok(format($$select api.get_export_content(%L)$$, :'exp1'), 'P0001', 'NOT_FOUND', 'another admin cannot download it');
reset role;
select ok((select count(*) from public.admin_audit_logs where action = 'export.download' and entity_id = :'exp1'::uuid) >= 1, 'the download is audited');
select ok((select count(*) from public.admin_audit_logs where action = 'export.request' and entity_id = :'exp1'::uuid) = 1, 'and so is the request');

update public.app_settings set value = '1' where key = 'exports.alert_rows';
set local role authenticated;
select pg_temp.as_user(:finance);
select (api.request_export('trips', :'today', :'today') ->> 'id') as exp2 \gset
reset role;
select ok((select count(*) from public.notifications where kind = 'export_large' and recipient_id = :sa) >= 1, 'a large export alerts the people who watch the audit log');
update public.export_jobs set expires_at = now() - interval '1 minute' where id = :'exp1';
select private.process_exports();
select is((select status from public.export_jobs where id = :'exp1'), 'expired', 'an old export expires');
select is((select content from public.export_jobs where id = :'exp1'), null, 'and its contents are dropped');

-- ---------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------
-- Incidents left by earlier runs would keep the SOS alert open: close them so this test sees only its own.
update public.safety_incidents set status = 'closed' where status not in ('resolved', 'closed');
select private.evaluate_alerts();
select pg_temp.ride(:p1, :u1, null, 'started') as trip_live \gset
set local role authenticated;
select pg_temp.as_user(:p1, 'aal1');
select (api.trigger_sos(:'trip_live', 'Test SOS') ->> 'id') as sos1 \gset
reset role;
select private.evaluate_alerts();
select is((select count(*)::int from public.ops_alerts where alert_key = 'sos_unacked' and status = 'open'), 0, 'a fresh SOS is not an alert yet');
update public.safety_incidents set reported_at = now() - interval '5 minutes' where id = :'sos1';
select private.evaluate_alerts();
select is((select count(*)::int from public.ops_alerts where alert_key = 'sos_unacked' and status = 'open'), 1, 'an SOS nobody acknowledged for minutes raises an alert');
select private.evaluate_alerts();
select is((select count(*)::int from public.ops_alerts where alert_key = 'sos_unacked'), 1, 'it fires once while the condition holds');
select ok((select count(*) from public.notifications where kind = 'ops_alert' and recipient_id = :sa) >= 1, 'the safety team is notified');
set local role authenticated;
select pg_temp.as_user(:analyst);
select throws_ok(format($$select api.acknowledge_alert(%L, 'Looking at it now')$$, (select id from public.ops_alerts where alert_key = 'sos_unacked' and status = 'open')), 'P0001', 'FORBIDDEN', 'an analyst cannot acknowledge alerts');
select pg_temp.as_user(:sa);
select api.acknowledge_alert((select id from public.ops_alerts where alert_key = 'sos_unacked' and status = 'open'), 'Calling the driver now');
select is((select count(*)::int from jsonb_array_elements(api.list_alerts('open')) a where a ->> 'key' = 'sos_unacked' and a ->> 'ack_note' is not null), 1, 'the acknowledgement is recorded');
select api.advance_incident(:'sos1', 'acknowledged', 'Calling the driver now');
reset role;
select private.evaluate_alerts();
select is((select status from public.ops_alerts where alert_key = 'sos_unacked' order by first_seen_at desc limit 1), 'resolved', 'the alert clears once the incident is acknowledged');

update public.driver_profiles set availability = 'offline' where id = :d1;
select private.evaluate_alerts();
select is((select count(*)::int from public.ops_alerts where alert_key = 'no_supply:' || :zone::text and status = 'open'), 1, 'a zone with requests and no online driver raises an alert');
update public.driver_profiles set availability = 'online' where id = :d1;
select private.evaluate_alerts();
select is((select count(*)::int from public.ops_alerts where alert_key = 'no_supply:' || :zone::text and status = 'open'), 0, 'and clears when a driver comes online');

insert into public.ledger_verification_runs (accounts_checked, drift_count, unbalanced_count, details) values (3, 1, 0, '[]');
select private.evaluate_alerts();
select is((select count(*)::int from public.ops_alerts where alert_key = 'ledger_verification' and status = 'open'), 1, 'a failed ledger verification raises an alert');
insert into public.ledger_verification_runs (accounts_checked, drift_count, unbalanced_count, details) values (3, 0, 0, '[]');
select private.evaluate_alerts();
select is((select count(*)::int from public.ops_alerts where alert_key = 'ledger_verification' and status = 'open'), 0, 'and clears after a clean run');

-- ---------------------------------------------------------------------------
-- Settings and flags
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(:support);
select throws_ok($$select api.update_setting('dispatch.offer_timeout_s', '20', null, 'Slower drivers need more time')$$, 'P0001', 'FORBIDDEN', 'support cannot change settings');
select pg_temp.as_user(:finance);
select is(jsonb_typeof(api.list_settings()), 'array', 'viewers can list settings');
select pg_temp.as_user(:sa);
select ok((select bool_and(s -> 'schema' is not null) from jsonb_array_elements(api.list_settings()) s), 'every setting carries its validation schema');
select is((api.update_setting('dispatch.offer_timeout_s', '20', null, 'Slower drivers need more time') ->> 'value')::int, 20, 'a valid change is applied');
select throws_ok($$select api.update_setting('dispatch.offer_timeout_s', '500', null, 'Way too long to wait')$$, 'P0001', 'VALIDATION_FAILED', 'a value outside the range is rejected');
select throws_ok($$select api.update_setting('dispatch.offer_timeout_s', '12.5', null, 'Fractions are not allowed')$$, 'P0001', 'VALIDATION_FAILED', 'an integer setting rejects fractions');
select throws_ok($$select api.update_setting('dispatch.offer_timeout_s', '"fast"', null, 'Text is not a number')$$, 'P0001', 'VALIDATION_FAILED', 'and text');
select throws_ok($$select api.update_setting('dispatch.search_radius_m', '[5000, 3000]', null, 'Radii must grow outward')$$, 'P0001', 'VALIDATION_FAILED', 'search radii must be strictly ascending');
select is((api.update_setting('dispatch.search_radius_m', '[1000, 2500, 6000]', null, 'Wider search for the pilot') ->> 'version')::int >= 2, true, 'a valid radius list is accepted');
select throws_ok($$select api.update_setting('payments.enabled_methods', '["bkash"]', null, 'Turn on digital payments')$$, 'P0001', 'VALIDATION_FAILED', 'unsupported payment methods cannot be enabled');
select throws_ok($$select api.update_setting('onboarding.required_documents', '{}', null, 'Not editable from here')$$, 'P0001', 'IMMUTABLE_ROW', 'structured settings are not editable here');
select throws_ok($$select api.update_setting('no.such.key', '1', null, 'A key that does not exist')$$, 'P0001', 'NOT_FOUND', 'an unknown key is not found');
select throws_ok($$select api.update_setting('dispatch.offer_timeout_s', '25', 1, 'Stale version should be refused')$$, 'P0001', 'STALE_VERSION', 'a stale version is refused');
select throws_ok($$select api.update_setting('dispatch.offer_timeout_s', '25', null, 'no')$$, 'P0001', 'VALIDATION_FAILED', 'a reason is required');
select is((api.setting_history('dispatch.offer_timeout_s') -> 0 ->> 'after')::int, 20, 'the history records the change');
select is((api.setting_history('dispatch.offer_timeout_s') -> 0 ->> 'before')::int, 15, 'with the value it replaced');
reset role;
select is((private.setting('dispatch.offer_timeout_s'))::int, 20, 'the new value is what the engine reads');

set local role authenticated;
select pg_temp.as_user(:sa);
select throws_ok($$select api.set_flag('pickup_pin', true, '{"bogus": 1}', null, 'Try an unknown rule')$$, 'P0001', 'VALIDATION_FAILED', 'unknown flag rules are rejected');
select throws_ok($$select api.set_flag('pickup_pin', true, '{"percentage": 150}', null, 'Over one hundred percent')$$, 'P0001', 'VALIDATION_FAILED', 'a percentage above 100 is rejected');
select is((api.set_flag('pickup_pin', true, '{"percentage": 50}', null, 'Pilot to half of the riders') ->> 'enabled')::boolean, true, 'a flag can be switched on for a share of users');
reset role;
select ok((select count(*) filter (where private.flag_enabled('pickup_pin', null, null, gen_random_uuid())) between 150 and 350 from generate_series(1, 500)),
  'a 50% rollout reaches roughly half of the users');
select is(private.flag_enabled('pickup_pin', null, null, '00000000-0000-0000-0000-00000004b001'), private.flag_enabled('pickup_pin', null, null, '00000000-0000-0000-0000-00000004b001'),
  'and the same user always gets the same answer');
select is(private.flag_enabled('pickup_pin', null, null, null), false, 'a percentage rollout never applies to an anonymous check');
set local role authenticated;
select pg_temp.as_user(:sa);
select api.set_flag('auto_surge', true, jsonb_build_object('zone_ids', jsonb_build_array(:zone::text)), null, 'Surge only in the pilot zone');
reset role;
select is(private.flag_enabled('auto_surge', :zone::uuid, null, null), true, 'a zone rule enables the flag in that zone');
select is(private.flag_enabled('auto_surge', '00000000-0000-0000-0000-0000000000aa', null, null), false, 'and not elsewhere');
select is(private.flag_enabled('digital_payments', null, null, null), false, 'a disabled flag is off everywhere');
set local role authenticated;
select pg_temp.as_user(:p2, 'aal1');
select ok((api.client_config() -> 'flags') ? 'promo_codes', 'clients receive the evaluated flags');
select is((api.client_config() -> 'settings' ->> 'cancellation_free_window_s')::int, 120, 'and the settings they need');
reset role;

-- ---------------------------------------------------------------------------
-- Retention and archival
-- ---------------------------------------------------------------------------
create table audit.change_log_2020_01 partition of audit.change_log for values from ('2020-01-01') to ('2020-02-01');
insert into audit.change_log (table_name, op, created_at) values ('old_table', 'UPDATE', '2020-01-05'), ('old_table', 'UPDATE', '2020-01-06');
select is(private.archive_old_partitions() >= 1, true, 'an old partition is archived');
select is((select row_count from public.archive_runs where partition_name = 'change_log_2020_01'), 2::bigint, 'the run records how many rows it held');
select ok((select checksum from public.archive_runs where partition_name = 'change_log_2020_01') ~ '^[0-9a-f]{32}$', 'and a checksum');
select is((select count(*)::int from pg_inherits where inhrelid = 'archive.change_log_2020_01'::regclass), 0, 'the partition is detached from the live table');
select is((select count(*)::int from archive.change_log_2020_01), 2, 'and nothing was lost');
select is((select count(*)::int from audit.change_log where table_name = 'old_table'), 0, 'the live table no longer carries the old rows');
select is(private.archive_old_partitions(), 0, 'archiving again does nothing new');
select is((select count(*)::int from public.archive_runs where partition_name = 'change_log_2020_01'), 1, 'and logs nothing twice');
select throws_ok($$update public.archive_runs set row_count = 0$$, 'P0001', 'APPEND_ONLY', 'the archive log cannot be edited');

select is((select count(*)::int from pg_inherits i where i.inhparent = 'public.trip_location_points'::regclass and i.inhrelid::regclass::text like '%' || to_char(now(), 'YYYY_MM')), 1,
  'the current month stays on the live table');

-- Unused, expired quotes are purged; a quote that a request used is kept.
set local role authenticated;
select pg_temp.as_user(:p1, 'aal1');
select (api.create_quote((select id from public.vehicle_categories where code = 'bike'), 12.70, 80.50, 'S', 12.73, 80.53, 'E', 5000, 1200) ->> 'id') as old_quote \gset
reset role;
update public.fare_quotes set expires_at = now() - interval '30 days' where id in (:'old_quote', (select quote_id from public.ride_requests where id = :'req_c'));
select private.cleanup_expired();
select is((select count(*)::int from public.fare_quotes where id = :'old_quote'), 0, 'an unused expired quote is purged');
select is((select count(*)::int from public.fare_quotes where id = (select quote_id from public.ride_requests where id = :'req_c')), 1, 'a quote a request used is kept');
select ok((select count(*) from public.archive_runs where kind = 'purge' and source = 'fare_quotes') >= 1, 'and the purge is logged');

select * from finish();
rollback;
