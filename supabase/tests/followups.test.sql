-- Follow-ups: cancellation fee collection, online-time rollup, feature flags (promo codes, pickup PIN),
-- notification outbox, SOS evidence.
begin;
create extension if not exists pgtap with schema extensions;
select plan(85);

\set inviter '''00000000-0000-0000-0000-00000005a000'''
\set sa      '''00000000-0000-0000-0000-00000005a001'''
\set support '''00000000-0000-0000-0000-00000005a002'''
\set p1  '''00000000-0000-0000-0000-00000005b001'''
\set p2  '''00000000-0000-0000-0000-00000005b002'''
\set u1  '''00000000-0000-0000-0000-00000005c001'''
\set d1  '''00000000-0000-0000-0000-00000005d001'''
\set zone '''00000000-0000-0000-0000-00000005e001'''

insert into auth.users (id, email) values (:inviter, 'inv.m5@test.local');
insert into public.admin_invitations (email, full_name, template_ids, reason, invited_by)
select e.email, e.name, array(select id from public.permission_templates where code = e.tpl), 'fixture', :inviter
from (values ('sa.m5@test.local', 'Super M5', 'super_admin'), ('support.m5@test.local', 'Support M5', 'support')) e(email, name, tpl);
insert into auth.users (id, email) values (:sa, 'sa.m5@test.local'), (:support, 'support.m5@test.local'),
  (:p1, 'p1.m5@test.local'), (:p2, 'p2.m5@test.local'), (:u1, 'u1.m5@test.local');
select private.promote_user_role(x, 'passenger') from unnest(array[:p1::uuid, :p2::uuid]) x;
update public.profiles set phone = '+8801700000051' where id = :sa; -- the support admin has no phone

insert into public.service_zones (id, code, name, boundary, area_km2, active)
values (:zone, 'm5_zone', 'M5 Zone',
  extensions.st_multi(extensions.st_geomfromtext('POLYGON((80.55 12.75,80.65 12.75,80.65 12.85,80.55 12.85,80.55 12.75))', 4326))::extensions.geography, 100, true);

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
select pg_temp.mk_driver(:u1, :d1, '00000000-0000-0000-0000-00000005f101', 'M5-DRV-1', 12.803, 80.603);

create function pg_temp.finish_trip(p_trip uuid, p_drv_user uuid) returns void
language plpgsql security definer as $$
begin
  perform pg_temp.as_user(p_drv_user, 'aal1');
  perform api.driver_update_locations((select jsonb_agg(jsonb_build_object('lat', 12.80 + i * 0.003, 'lng', 80.60 + i * 0.003,
    'speed', 23, 'accuracy', 10, 'recorded_at', now() - make_interval(secs => 160 - i * 20))) from generate_series(0, 7) i));
  update public.trips set started_at = now() - interval '10 minutes', arrived_at = now() - interval '14 minutes' where id = p_trip;
  perform api.complete_trip(p_trip);
end $$;

-- Stages: accepted | arrived | started | completed | late_cancel (accepted five minutes ago, then cancelled).
create function pg_temp.ride(p_pax uuid, p_drv_user uuid, p_stage text default 'completed', p_promo text default null) returns uuid
language plpgsql security definer as $$
declare
  v_quote uuid;
  v_req uuid;
  v_trip uuid;
begin
  perform pg_temp.as_user(p_pax, 'aal1');
  v_quote := (api.create_quote((select id from public.vehicle_categories where code = 'bike'), 12.80, 80.60, 'Start', 12.83, 80.63, 'End', 5000, 1200) ->> 'id')::uuid;
  v_req := (api.create_ride_request(v_quote, 'cash', null) ->> 'id')::uuid;
  if p_promo is not null then
    perform api.apply_promo(v_req, p_promo);
  end if;
  perform pg_temp.as_user(p_drv_user, 'aal1');
  v_trip := (api.accept_offer((api.driver_current_offer() ->> 'offer_id')::uuid) ->> 'id')::uuid;
  if p_stage = 'accepted' then
    return v_trip;
  end if;
  if p_stage = 'late_cancel' then
    update public.trips set accepted_at = now() - interval '5 minutes', accepted_pickup_eta_s = 600 where id = v_trip;
    perform pg_temp.as_user(p_pax, 'aal1');
    perform api.cancel_ride(v_req, 'Changed my mind');
    return v_trip;
  end if;
  perform api.driver_trip_arriving(v_trip);
  perform api.driver_trip_arrived(v_trip, true);
  if p_stage = 'arrived' then
    return v_trip;
  end if;
  perform api.driver_trip_start(v_trip);
  if p_stage = 'completed' then
    perform pg_temp.finish_trip(v_trip, p_drv_user);
  end if;
  return v_trip;
end $$;

select id as bike from public.vehicle_categories where code = 'bike' \gset
set local role authenticated;
select pg_temp.as_user(:sa);
select (api.save_fare_draft(null, :'bike', :zone,
  '{"base_fare":40,"per_km":20,"per_minute":2,"minimum_fare":60,"booking_fee":0,"waiting_per_minute":2,"free_waiting_minutes":3,"cancellation_fee":30,"platform_commission_pct":0.15,"max_surge_multiplier":1.5}',
  'M5 rates', null)) as rule1 \gset
select api.publish_fare_rule(:'rule1', null, 'Go live for the follow-up tests');
select api.save_promotion(null, jsonb_build_object('code', 'M5PROMO', 'name', 'M5 promo', 'discount_type', 'fixed', 'discount_value', 20,
  'starts_at', now() - interval '1 hour', 'ends_at', now() + interval '30 days', 'budget_limit', 500, 'per_user_limit', 5));
select api.set_promotion_status((select id from public.promotions where code = 'M5PROMO'), 'active', 'Launch for the follow-up tests');
reset role;

-- ---------------------------------------------------------------------------
-- Cancellation fee collected on the next ride
-- ---------------------------------------------------------------------------
select pg_temp.ride(:p1, :u1, 'late_cancel') as trip_cx \gset
select is((select cancellation_fee from public.trips where id = :'trip_cx'), 30::numeric, 'a late cancellation carries the fee');
set local role authenticated;
select pg_temp.as_user(:p1, 'aal1');
select is((api.passenger_wallet() ->> 'outstanding_fee')::numeric, 30::numeric, 'the passenger sees the fee they owe');
select pg_temp.as_user(:u1, 'aal1');
select throws_ok($$select api.passenger_wallet()$$, 'P0001', 'ROLE_NOT_ALLOWED', 'only passengers have a passenger wallet');
reset role;

select pg_temp.ride(:p1, :u1) as trip_fee \gset
select is((select fee_collected from public.payments where trip_id = :'trip_fee'), 30::numeric, 'the next ride collects the 30 owed');
select is((select amount - fee_collected from public.payments where trip_id = :'trip_fee'), (select final_fare from public.trips where id = :'trip_fee'), 'on top of the fare itself');
select is((select b.balance from public.ledger_account_balances b join public.ledger_accounts a on a.id = b.account_id where a.code = 'passenger:' || :p1 || ':wallet'), 0::numeric, 'the passenger debt is cleared');
select is((private.verify_ledger_balances() -> 'drift'), '[]'::jsonb, 'the ledger still verifies after collecting the fee');
select is((select sum(e.debit) - sum(e.credit) from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id where t.trip_id = :'trip_fee'), 0::numeric, 'the completion posting balances');
select pg_temp.ride(:p1, :u1) as trip_after \gset
select is((select fee_collected from public.payments where trip_id = :'trip_after'), 0::numeric, 'and the fee is only collected once');
set local role authenticated;
select pg_temp.as_user(:p1, 'aal1');
select is((api.passenger_wallet() ->> 'outstanding_fee')::numeric, 0::numeric, 'nothing is owed any more');
reset role;

-- ---------------------------------------------------------------------------
-- Online time rollup (a fixed day long ago, so nothing else interferes)
-- ---------------------------------------------------------------------------
insert into public.driver_status_events (driver_id, kind, old_status, new_status, actor_type, created_at) values
  (:d1, 'availability', 'offline', 'online', 'system', '2020-06-01 04:00:00+00'),
  (:d1, 'availability', 'online', 'on_trip', 'system', '2020-06-01 04:20:00+00'),
  (:d1, 'availability', 'on_trip', 'offline', 'system', '2020-06-01 04:50:00+00');
select private.rollup_online('15m', '2020-06-01 04:00:00+00', '2020-06-01 05:15:00+00');
select is((select online_s from public.kpi_online where grain = '15m' and bucket_start = '2020-06-01 04:00:00+00'), 900::bigint, 'a full quarter-hour online');
select is((select online_s from public.kpi_online where grain = '15m' and bucket_start = '2020-06-01 04:15:00+00'), 300::bigint, 'five minutes online before going on a trip');
select is((select on_trip_s from public.kpi_online where grain = '15m' and bucket_start = '2020-06-01 04:15:00+00'), 600::bigint, 'and ten minutes on the trip in the same slot');
select is((select on_trip_s from public.kpi_online where grain = '15m' and bucket_start = '2020-06-01 04:30:00+00'), 900::bigint, 'a full quarter-hour on a trip');
select is((select on_trip_s from public.kpi_online where grain = '15m' and bucket_start = '2020-06-01 04:45:00+00'), 300::bigint, 'the trip ends mid-slot');
select is((select online_s + on_trip_s from public.kpi_online where grain = '15m' and bucket_start = '2020-06-01 05:00:00+00'), 0::bigint, 'nothing after going offline');
select is((select drivers from public.kpi_online where grain = '15m' and bucket_start = '2020-06-01 04:00:00+00'), 1, 'one driver was active');
select private.rollup_online('day', '2020-06-01 00:00:00+06', '2020-06-02 00:00:00+06');
select is((select online_s from public.kpi_online where grain = 'day' and bucket_start = '2020-05-31 18:00:00+00'), 1200::bigint, 'the day adds up: 20 minutes online');
select is((select on_trip_s from public.kpi_online where grain = 'day' and bucket_start = '2020-05-31 18:00:00+00'), 1800::bigint, 'and 30 minutes on trips');
select md5(string_agg(k::text, '' order by k::text)) as online_before from (select grain, bucket_start, online_s, on_trip_s, drivers from public.kpi_online where bucket_start < '2021-01-01') k \gset
select private.rollup_online('15m', '2020-06-01 04:00:00+00', '2020-06-01 05:15:00+00');
select private.rollup_online('day', '2020-06-01 00:00:00+06', '2020-06-02 00:00:00+06');
select is((select md5(string_agg(k::text, '' order by k::text)) from (select grain, bucket_start, online_s, on_trip_s, drivers from public.kpi_online where bucket_start < '2021-01-01') k), :'online_before',
  'recomputing changes nothing');
set local role authenticated;
select pg_temp.as_user(:sa);
select is(jsonb_typeof(api.intraday_supply()), 'array', 'the dashboard can read the supply series');
select pg_temp.as_user(:p1, 'aal1');
select throws_ok($$select api.intraday_supply()$$, 'P0001', 'FORBIDDEN', 'but a passenger cannot');
select is((select count(*)::int from public.kpi_online), 0, 'nor the table directly');
reset role;

-- ---------------------------------------------------------------------------
-- Feature flag: promo_codes
-- ---------------------------------------------------------------------------
update public.feature_flags set enabled = false where key = 'promo_codes';
select throws_ok(format($$select pg_temp.ride(%L, %L, 'completed', 'M5PROMO')$$, :p2, :u1), 'P0001', 'PROMO_INVALID', 'with promo_codes off no code can be applied');
update public.feature_flags set enabled = true where key = 'promo_codes';
select pg_temp.ride(:p2, :u1, 'completed', 'M5PROMO') as trip_promo \gset
select is((select discount_amount from public.trip_fare_breakdowns where trip_id = :'trip_promo'), 20::numeric, 'with it on the promotion applies');

-- ---------------------------------------------------------------------------
-- Feature flag: pickup_pin
-- ---------------------------------------------------------------------------
update public.feature_flags set enabled = true, rules = '{}' where key = 'pickup_pin';
select pg_temp.ride(:p2, :u1, 'arrived') as trip_pin \gset
select request_id as req_pin, start_pin as real_pin from public.trips where id = :'trip_pin' \gset
select case when :'real_pin' = '0000' then '1111' else '0000' end as wrong_pin \gset
set local role authenticated;
select pg_temp.as_user(:p2, 'aal1');
select is((api.get_ride_pin(:'req_pin') ->> 'required')::boolean, true, 'the passenger is told a PIN is required');
select is((api.get_ride_pin(:'req_pin') ->> 'pin'), :'real_pin', 'and sees it');
select pg_temp.as_user(:p1, 'aal1');
select throws_ok(format($$select api.get_ride_pin(%L)$$, :'req_pin'), 'P0001', 'NOT_FOUND', 'another passenger cannot read it');
select pg_temp.as_user(:u1, 'aal1');
select throws_ok(format($$select api.get_ride_pin(%L)$$, :'req_pin'), 'P0001', 'ROLE_NOT_ALLOWED', 'nor can the driver');
select is((api.driver_trip_start(:'trip_pin') ->> 'pin_error'), 'PIN_REQUIRED', 'starting without the PIN is refused');
select is((api.driver_trip_start(:'trip_pin', :'wrong_pin') ->> 'pin_error'), 'INVALID_PIN', 'a wrong PIN is refused');
select is((api.driver_trip_start(:'trip_pin', :'wrong_pin') ->> 'attempts_left')::int, 2, 'and the attempts are counted');
select api.driver_trip_start(:'trip_pin', :'wrong_pin');
select api.driver_trip_start(:'trip_pin', :'wrong_pin');
select is((api.driver_trip_start(:'trip_pin', :'real_pin') ->> 'pin_error'), 'PIN_LOCKED', 'five wrong guesses lock it, even for the right PIN');
select is((select status::text from public.trips where id = :'trip_pin'), 'arrived', 'the trip has not started');
select pg_temp.as_user(:p2, 'aal1');
select is((api.get_ride_pin(:'req_pin') ->> 'locked')::boolean, true, 'the passenger sees that it is locked');
select is((api.renew_ride_pin(:'req_pin') ->> 'locked')::boolean, false, 'renewing unlocks it');
reset role;
select start_pin as new_pin from public.trips where id = :'trip_pin' \gset
set local role authenticated;
select pg_temp.as_user(:u1, 'aal1');
select is((api.driver_trip_start(:'trip_pin', :'new_pin') ->> 'status'), 'in_progress', 'the right PIN starts the trip');
select is((api.driver_trip_start(:'trip_pin') ->> 'status'), 'in_progress', 'starting again is harmless');
reset role;
update public.feature_flags set enabled = false where key = 'pickup_pin';

-- ---------------------------------------------------------------------------
-- Notification outbox: an SOS on the trip in progress
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(:sa);
select api.register_device('android', 'device-token-for-the-super-admin-0001');
select throws_ok($$select api.register_device('android', 'short')$$, 'P0001', 'VALIDATION_FAILED', 'a device token must look like one');
select throws_ok($$select api.register_device('toaster', 'device-token-for-the-super-admin-0001')$$, 'P0001', 'VALIDATION_FAILED', 'and the platform must be known');
select pg_temp.as_user(:p2, 'aal1');
select (api.trigger_sos(:'trip_pin', 'Driver is taking a strange route') ->> 'id') as sos_id \gset
select api.trigger_sos(:'trip_pin');
reset role;
select is((select count(*)::int from public.notification_outbox where dedupe_key = 'sos:' || :'sos_id' and recipient_id = :sa), 3, 'the super admin gets an email, an SMS and a push');
select is((select count(*)::int from public.notification_outbox where dedupe_key = 'sos:' || :'sos_id' and recipient_id = :support), 1, 'the admin with no phone and no device gets only an email');
select is((select channel from public.notification_outbox where dedupe_key = 'sos:' || :'sos_id' and recipient_id = :support), 'email', 'which one');
select is((select to_address from public.notification_outbox where dedupe_key = 'sos:' || :'sos_id' and recipient_id = :sa and channel = 'sms'), '+8801700000051', 'the SMS goes to the phone on the profile');
select is((select count(*)::int from public.notification_outbox where dedupe_key = 'sos:' || :'sos_id' and recipient_id = :sa and channel = 'push' and to_address is null), 1, 'push has no address; devices are looked up at delivery');
select is((select count(*)::int from public.notification_outbox where dedupe_key = 'sos:' || :'sos_id' and recipient_id = :p2), 0, 'the passenger is not alerted');
select private.enqueue_notification('email', :sa, 'Duplicate', 'again', null, 'sos:' || :'sos_id');
select is((select count(*)::int from public.notification_outbox where dedupe_key = 'sos:' || :'sos_id' and recipient_id = :sa and channel = 'email'), 1, 'the same alert is never queued twice');

set local role authenticated;
select pg_temp.as_user(:sa);
select throws_ok($$select api.claim_notifications(10)$$, '42501', null, 'an admin cannot claim messages for delivery');
select throws_ok($$select api.finish_notification(gen_random_uuid(), true)$$, '42501', null, 'nor report a delivery');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temp table claimed as select jsonb_array_elements(api.claim_notifications(100)) as m;
select ok((select count(*) from claimed where m ->> 'subject' = 'SOS #' || (select incident_no from public.safety_incidents where id = :'sos_id')) >= 4, 'the worker claims the SOS messages');
select ok((select count(*) from claimed c where m ->> 'channel' = 'push' and m -> 'tokens' ? 'device-token-for-the-super-admin-0001') = 1, 'the push message carries the recipient''s device token');
select is((select min(attempts) from public.notification_outbox where dedupe_key = 'sos:' || :'sos_id'), 1, 'claiming counts an attempt');
select is((select status from public.notification_outbox where dedupe_key = 'sos:' || :'sos_id' and recipient_id = :sa and channel = 'sms'), 'sending', 'and marks the message as in flight');
select is(jsonb_array_length(api.claim_notifications(100)), 0, 'a second worker claims nothing that is already in flight');
select api.finish_notification((select id from public.notification_outbox where dedupe_key = 'sos:' || :'sos_id' and recipient_id = :sa and channel = 'email'), true);
select is((select status from public.notification_outbox where dedupe_key = 'sos:' || :'sos_id' and recipient_id = :sa and channel = 'email'), 'sent', 'a delivered message is marked sent');
select api.finish_notification((select id from public.notification_outbox where dedupe_key = 'sos:' || :'sos_id' and recipient_id = :sa and channel = 'sms'), false, 'gateway timeout');
select is((select status from public.notification_outbox where dedupe_key = 'sos:' || :'sos_id' and recipient_id = :sa and channel = 'sms'), 'queued', 'a failed delivery goes back in the queue');
select ok((select next_attempt_at > now() from public.notification_outbox where dedupe_key = 'sos:' || :'sos_id' and recipient_id = :sa and channel = 'sms'), 'after a back-off');
select is((select last_error from public.notification_outbox where dedupe_key = 'sos:' || :'sos_id' and recipient_id = :sa and channel = 'sms'), 'gateway timeout', 'with the reason recorded');
update public.notification_outbox set attempts = 5 where dedupe_key = 'sos:' || :'sos_id' and recipient_id = :sa and channel = 'sms';
select api.finish_notification((select id from public.notification_outbox where dedupe_key = 'sos:' || :'sos_id' and recipient_id = :sa and channel = 'sms'), false, 'still down');
select is((select status from public.notification_outbox where dedupe_key = 'sos:' || :'sos_id' and recipient_id = :sa and channel = 'sms'), 'failed', 'after five attempts it is given up on');
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select pg_temp.as_user(:sa);
select ok((select (c ->> 'count')::int >= 1 from jsonb_array_elements(api.outbox_overview() -> 'counts') c where c ->> 'channel' = 'sms' and c ->> 'status' = 'failed'), 'the delivery overview shows the failure');
select is((select count(*)::int from jsonb_array_elements(api.outbox_overview() -> 'recent_failures') f where f ->> 'error' = 'still down'), 1, 'with its reason');
select pg_temp.as_user(:p2, 'aal1');
select throws_ok($$select api.outbox_overview()$$, 'P0001', 'FORBIDDEN', 'passengers cannot read the overview');
select is((select count(*)::int from public.notification_outbox), 0, 'nor the outbox table');
select api.register_device('ios', 'device-token-of-a-passenger-phone-0002');
select api.unregister_device('device-token-of-a-passenger-phone-0002');
reset role;
select is((select count(*)::int from public.push_devices where token = 'device-token-of-a-passenger-phone-0002'), 0, 'a device can be unregistered');

select private.raise_alert('m5:critical', 'critical', 'M5 critical alert', '{"a":1}', 'dashboard.view');
select private.raise_alert('m5:critical', 'critical', 'M5 critical alert', '{"a":2}', 'dashboard.view');
select is((select count(*)::int from public.notification_outbox where subject = 'M5 critical alert' and recipient_id = :sa and channel = 'email'), 1, 'a critical alert is also emailed, once');
select private.raise_alert('m5:warning', 'warning', 'M5 warning alert', '{}', 'dashboard.view');
select is((select count(*)::int from public.notification_outbox where subject = 'M5 warning alert'), 0, 'a warning stays in the app');

-- ---------------------------------------------------------------------------
-- SOS evidence
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(:p2, 'aal1');
select (api.start_evidence_upload(:'sos_id', 'image/png') ->> 'path') as ev_path \gset
select ok(:'ev_path' ~ ('^' || :'sos_id' || '/[0-9a-f-]{36}\.png$'), 'the reporter gets a reserved path under the incident');
select throws_ok(format($$select api.start_evidence_upload(%L, 'text/html')$$, :'sos_id'), 'P0001', 'VALIDATION_FAILED', 'only photos, PDFs, audio and video are accepted');
select is(private.can_upload_incident_evidence(:'ev_path'), true, 'storage lets the reporter upload to that path');
select is(private.can_upload_incident_evidence('not-a-path.png'), false, 'but not to a malformed path');
select is(private.can_upload_incident_evidence(:'sos_id' || '/' || gen_random_uuid() || '.exe'), false, 'nor an executable');
select throws_ok(format($$select api.complete_evidence_upload(%L, %L, 'image/png', 100, %L)$$, :'sos_id', :'ev_path', repeat('a', 64)), 'P0001', 'VALIDATION_FAILED', 'completing before the file exists is refused');
select pg_temp.as_user(:p1, 'aal1');
select throws_ok(format($$select api.start_evidence_upload(%L, 'image/png')$$, :'sos_id'), 'P0001', 'NOT_FOUND', 'another passenger cannot attach evidence');
select is(private.can_upload_incident_evidence(:'ev_path'), false, 'and storage refuses them too');
select pg_temp.as_user(:sa);
select is(private.can_upload_incident_evidence(:'ev_path'), true, 'a safety manager may upload to the incident');
reset role;
insert into storage.objects (bucket_id, name) values ('safety-evidence', :'ev_path');
set local role authenticated;
select pg_temp.as_user(:p2, 'aal1');
select is((api.complete_evidence_upload(:'sos_id', :'ev_path', 'image/png', 2048, repeat('a', 64), 'Photo of the vehicle')) is not null, true, 'completing after the upload records the evidence');
select throws_ok(format($$select api.complete_evidence_upload(%L, %L, 'image/png', 2048, %L)$$, :'sos_id', :'ev_path', repeat('a', 64)), '23505', null, 'the same file cannot be recorded twice');
select throws_ok(format($$select api.list_evidence(%L)$$, :'sos_id'), 'P0001', 'FORBIDDEN', 'the reporter cannot list the incident''s evidence');
select pg_temp.as_user(:support);
select is(jsonb_array_length(api.list_evidence(:'sos_id')), 1, 'the safety team can list it');
select throws_ok(format($$select api.open_evidence(%L)$$, (select id from public.safety_evidence where incident_id = :'sos_id')), 'P0001', 'FORBIDDEN', 'opening needs safety.view_evidence, which support lacks');
select pg_temp.as_user(:sa);
select is((api.open_evidence((select id from public.safety_evidence where incident_id = :'sos_id')) ->> 'path'), :'ev_path', 'a holder of safety.view_evidence gets the path');
reset role;
select is((select count(*)::int from public.pii_access_logs where field like 'safety_evidence:%' and admin_id = :sa), 1, 'and the access is logged');
select is((select count(*)::int from public.safety_incident_events where incident_id = :'sos_id' and note like 'Evidence added%'), 1, 'the timeline notes the new file');
select throws_ok($$update public.safety_evidence set description = 'edited'$$, 'P0001', 'APPEND_ONLY', 'evidence records cannot be edited');
update public.safety_incidents set status = 'closed' where id = :'sos_id';
set local role authenticated;
select pg_temp.as_user(:p2, 'aal1');
select throws_ok(format($$select api.start_evidence_upload(%L, 'image/png')$$, :'sos_id'), 'P0001', 'INVALID_STATE_TRANSITION', 'a closed incident takes no more files');
reset role;

select * from finish();
rollback;
