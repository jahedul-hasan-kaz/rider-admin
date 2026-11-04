-- M3: ledger, settlement, cash, reconciliation, refunds (maker-checker), payouts, promotions, ratings, support, safety.
begin;
create extension if not exists pgtap with schema extensions;
select plan(149);

\set inviter '''00000000-0000-0000-0000-00000003a000'''
\set sa      '''00000000-0000-0000-0000-00000003a001'''
\set sa2     '''00000000-0000-0000-0000-00000003a002'''
\set sa3     '''00000000-0000-0000-0000-00000003a003'''
\set support '''00000000-0000-0000-0000-00000003a004'''
\set finance '''00000000-0000-0000-0000-00000003a005'''
\set analyst '''00000000-0000-0000-0000-00000003a006'''
\set p1  '''00000000-0000-0000-0000-00000003b001'''
\set p2  '''00000000-0000-0000-0000-00000003b002'''
\set p3  '''00000000-0000-0000-0000-00000003b003'''
\set u1  '''00000000-0000-0000-0000-00000003c001'''
\set u2  '''00000000-0000-0000-0000-00000003c002'''
\set d1  '''00000000-0000-0000-0000-00000003d001'''
\set d2  '''00000000-0000-0000-0000-00000003d002'''

update public.driver_profiles set availability = 'offline' where availability <> 'offline';

insert into auth.users (id, email) values (:inviter, 'inv.m3@test.local');
insert into public.admin_invitations (email, full_name, template_ids, reason, invited_by)
select e.email, e.name, array(select id from public.permission_templates where code = e.tpl), 'fixture', :inviter
from (values ('sa.m3@test.local', 'Super A', 'super_admin'), ('sa2.m3@test.local', 'Super B', 'super_admin'), ('sa3.m3@test.local', 'Super C', 'super_admin'),
             ('support.m3@test.local', 'Support M3', 'support'), ('finance.m3@test.local', 'Finance M3', 'finance'),
             ('analyst.m3@test.local', 'Analyst M3', 'analyst')) e(email, name, tpl);
insert into auth.users (id, email) values
  (:sa, 'sa.m3@test.local'), (:sa2, 'sa2.m3@test.local'), (:sa3, 'sa3.m3@test.local'), (:support, 'support.m3@test.local'),
  (:finance, 'finance.m3@test.local'), (:analyst, 'analyst.m3@test.local'),
  (:p1, 'p1.m3@test.local'), (:p2, 'p2.m3@test.local'), (:p3, 'p3.m3@test.local'),
  (:u1, 'u1.m3@test.local'), (:u2, 'u2.m3@test.local');
select private.promote_user_role(x, 'passenger') from unnest(array[:p1::uuid, :p2::uuid, :p3::uuid]) x;
update public.profiles set full_name = 'Pax One' where id = :p1;
update public.profiles set full_name = 'Pax Two' where id = :p2;

select id as bike from public.vehicle_categories where code = 'bike' \gset
insert into public.service_zones (id, code, name, boundary, area_km2, active)
values ('00000000-0000-0000-0000-00000003e001', 'm3_zone', 'M3 Zone',
  extensions.st_multi(extensions.st_geomfromtext('POLYGON((90.35 23.75,90.45 23.75,90.45 23.85,90.35 23.85,90.35 23.75))', 4326))::extensions.geography,
  110, true);

create function pg_temp.mk_driver(p_user uuid, p_drv uuid, p_veh uuid, p_plate text, p_lat double precision, p_lng double precision, p_online boolean) returns void
language plpgsql as $$
begin
  perform private.promote_user_role(p_user, 'driver');
  insert into public.driver_profiles (id, user_id, onboarding_status, approved_at) values (p_drv, p_user, 'approved', now());
  insert into public.vehicles (id, driver_id, category_id, make, model, color, registration_number, year, status)
  values (p_veh, p_drv, (select id from public.vehicle_categories where code = 'bike'), 'Honda', 'CB', 'Red', p_plate, 2022, 'active');
  update public.driver_profiles set current_vehicle_id = p_veh, availability = (case when p_online then 'online' else 'offline' end)::public.driver_availability where id = p_drv;
  insert into public.driver_live_locations (driver_id, location, recorded_at, updated_at) values (p_drv, private.point(p_lat, p_lng), now(), now());
end $$;
select pg_temp.mk_driver(:u1, :d1, '00000000-0000-0000-0000-00000003f101', 'M3-DRV-1', 23.801, 90.401, true);
select pg_temp.mk_driver(:u2, :d2, '00000000-0000-0000-0000-00000003f102', 'M3-DRV-2', 23.790, 90.390, false);

create function pg_temp.as_user(p_id uuid, p_aal text default 'aal2') returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

-- Drives a ride through the API (security definer so fixture timestamps can be adjusted).
create function pg_temp.finish_trip(p_trip uuid, p_drv_user uuid) returns void
language plpgsql security definer as $$
begin
  perform pg_temp.as_user(p_drv_user, 'aal1');
  perform api.driver_update_locations((select jsonb_agg(jsonb_build_object('lat', 23.801 + i * 0.003, 'lng', 90.401 + i * 0.003,
    'speed', 23, 'accuracy', 10, 'recorded_at', now() - make_interval(secs => 160 - i * 20))) from generate_series(0, 7) i));
  update public.trips set started_at = now() - interval '10 minutes', arrived_at = now() - interval '14 minutes' where id = p_trip;
  perform api.complete_trip(p_trip);
end $$;

create function pg_temp.ride(p_pax uuid, p_drv_user uuid, p_promo text default null, p_finish boolean default true, p_stop_after_accept boolean default false) returns uuid
language plpgsql security definer as $$
declare
  v_quote uuid;
  v_req uuid;
  v_trip uuid;
begin
  perform pg_temp.as_user(p_pax, 'aal1');
  v_quote := (api.create_quote((select id from public.vehicle_categories where code = 'bike'), 23.805, 90.405, 'Gulshan', 23.82, 90.42, 'Banani', 5000, 1200) ->> 'id')::uuid;
  v_req := (api.create_ride_request(v_quote, 'cash', null) ->> 'id')::uuid;
  if p_promo is not null then
    perform api.apply_promo(v_req, p_promo);
  end if;
  perform pg_temp.as_user(p_drv_user, 'aal1');
  v_trip := (api.accept_offer((api.driver_current_offer() ->> 'offer_id')::uuid) ->> 'id')::uuid;
  if p_stop_after_accept then
    return v_trip;
  end if;
  perform api.driver_trip_arriving(v_trip);
  perform api.driver_trip_arrived(v_trip, true);
  perform api.driver_trip_start(v_trip);
  if p_finish then
    perform pg_temp.finish_trip(v_trip, p_drv_user);
  end if;
  return v_trip;
end $$;

-- A published fare rule (commission 15%, no booking fee).
set local role authenticated;
select pg_temp.as_user(:sa);
select (api.save_fare_draft(null, :'bike', '00000000-0000-0000-0000-00000003e001',
  '{"base_fare":40,"per_km":20,"per_minute":2,"minimum_fare":60,"booking_fee":0,"waiting_per_minute":2,"free_waiting_minutes":3,"cancellation_fee":30,"platform_commission_pct":0.15,"max_surge_multiplier":1.5}',
  'M3 rates', null)) as rule1 \gset
select api.publish_fare_rule(:'rule1', null, 'Go live for the money tests');
reset role;

-- ---------------------------------------------------------------------------
-- Settlement of a cash trip
-- ---------------------------------------------------------------------------
-- Baselines: the database may hold data from earlier runs, so platform-wide figures are compared as deltas.
select coalesce((select b.balance from public.ledger_account_balances b join public.ledger_accounts a on a.id = b.account_id where a.code = 'platform:commission_revenue'), 0) as comm0 \gset
select coalesce((select b.balance from public.ledger_account_balances b join public.ledger_accounts a on a.id = b.account_id where a.code = 'platform:promo_expense'), 0) as promo0 \gset
select coalesce((select b.balance from public.ledger_account_balances b join public.ledger_accounts a on a.id = b.account_id where a.code = 'platform:payouts_clearing'), 0) as clearing0 \gset
select pg_temp.ride(:p1, :u1) as trip_a \gset
select is((select status::text from public.trips where id = :'trip_a'), 'completed', 'ride A completed');
select is((select count(*)::int from public.payments where trip_id = :'trip_a'), 1, 'one payment is created at completion');
select is((select status::text from public.payments where trip_id = :'trip_a'), 'pending', 'a cash payment stays pending until the driver confirms');
select is((select amount from public.payments where trip_id = :'trip_a'), (select final_fare from public.trips where id = :'trip_a'), 'payment amount equals the final fare');
select is((select count(*)::int from public.driver_earnings where trip_id = :'trip_a'), 1, 'one earning row per trip');
select is((select net_earning + commission_amount from public.driver_earnings where trip_id = :'trip_a'), (select gross_fare from public.driver_earnings where trip_id = :'trip_a'),
  'earning + commission = fare before discount (no booking fee)');
select is((select count(*)::int from public.ledger_transactions where kind = 'trip_completion' and trip_id = :'trip_a'), 1, 'one ledger transaction per completed trip');
select is((select sum(debit) - sum(credit) from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id where t.trip_id = :'trip_a'), 0::numeric, 'the posting balances');
select is((select b.balance from public.ledger_account_balances b join public.ledger_accounts a on a.id = b.account_id where a.code = 'driver:' || :d1 || ':wallet'),
  (select net_earning - (select amount from public.payments where trip_id = :'trip_a') from public.driver_earnings where trip_id = :'trip_a'),
  'driver wallet = earning minus the cash held (negative: the driver owes the platform)');
select is((select b.balance from public.ledger_account_balances b join public.ledger_accounts a on a.id = b.account_id where a.code = 'platform:commission_revenue'),
  (select commission_amount + :'comm0'::numeric from public.driver_earnings where trip_id = :'trip_a'), 'commission revenue grows by the trip commission');
select is(private.post_transaction('trip_completion', :'trip_a', null, 'again',
  jsonb_build_array(jsonb_build_object('account_id', private.platform_account('cash_on_hand'), 'debit', 1), jsonb_build_object('account_id', private.platform_account('cash_on_hand'), 'credit', 1))),
  (select id from public.ledger_transactions where kind = 'trip_completion' and reference = :'trip_a'), 'posting the same (kind, reference) twice returns the original');

-- Ledger integrity
select throws_ok($$select private.post_transaction('test', 'unbalanced-1', null, 'x', jsonb_build_array(
    jsonb_build_object('account_id', private.platform_account('cash_on_hand'), 'debit', 10), jsonb_build_object('account_id', private.platform_account('adjustments'), 'credit', 9)))$$,
  'P0001', 'LEDGER_UNBALANCED', 'an unbalanced posting is rejected');
select throws_ok($$update public.ledger_entries set debit = debit + 1 where id = (select min(id) from public.ledger_entries)$$, 'P0001', 'APPEND_ONLY', 'ledger entries cannot be edited');
select throws_ok($$delete from public.ledger_transactions$$, 'P0001', 'APPEND_ONLY', 'ledger transactions cannot be deleted');
select throws_ok($$delete from public.ledger_accounts where code = 'platform:cash_on_hand'$$, 'P0001', 'DELETE_FORBIDDEN', 'ledger accounts cannot be deleted');
set constraints trg_ledger_entries_balanced immediate;
select throws_ok($$insert into public.ledger_transactions (kind, reference, memo) values ('rogue', 'rogue-1', 'x');
  insert into public.ledger_entries (transaction_id, account_id, debit) values ((select id from public.ledger_transactions where reference = 'rogue-1'), private.platform_account('cash_on_hand'), 5)$$,
  'P0001', 'LEDGER_UNBALANCED', 'a direct insert that does not balance is stopped by the constraint trigger');
set constraints trg_ledger_entries_balanced deferred;
select is((private.verify_ledger_balances() -> 'drift'), '[]'::jsonb, 'nightly verification finds no drift');
select is((select ok from public.ledger_verification_runs order by id desc limit 1), true, 'the verification run is recorded as ok');
update public.ledger_account_balances set balance = balance + 5 where account_id = private.platform_account('commission_revenue');
select is(jsonb_array_length(private.verify_ledger_balances() -> 'drift'), 1, 'verification detects a silent edit of a stored balance');
update public.ledger_account_balances set balance = balance - 5 where account_id = private.platform_account('commission_revenue');
select is((private.verify_ledger_balances() -> 'drift'), '[]'::jsonb, 'and is clean again once restored');

-- ---------------------------------------------------------------------------
-- Cash confirmation, deposits, reconciliation
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(:u2, 'aal1');
select throws_ok(format($$select api.confirm_cash_collected(%L)$$, :'trip_a'), 'P0001', 'NOT_FOUND', 'another driver cannot confirm this trip');
select pg_temp.as_user(:p1, 'aal1');
select throws_ok(format($$select api.confirm_cash_collected(%L)$$, :'trip_a'), 'P0001', 'ROLE_NOT_ALLOWED', 'a passenger cannot confirm cash');
select pg_temp.as_user(:u1, 'aal1');
select is((api.confirm_cash_collected(:'trip_a') ->> 'status'), 'succeeded', 'the driver confirms the cash');
select is((api.confirm_cash_collected(:'trip_a') ->> 'status'), 'succeeded', 'confirming twice is harmless');
reset role;
select is((select count(*)::int from public.payment_events where payment_id = (select id from public.payments where trip_id = :'trip_a')), 2, 'status history is kept');
select is((select count(*)::int from public.support_tickets where trip_id = :'trip_a'), 0, 'an exact collection raises no ticket');

set local role authenticated;
select pg_temp.as_user(:support);
select throws_ok(format($$select api.record_cash_deposit(%L, 100, 'office', 'R-1')$$, :d1), 'P0001', 'FORBIDDEN', 'support cannot record a deposit');
select pg_temp.as_user(:sa);
select throws_ok(format($$select api.record_cash_deposit(%L, 0, 'office', 'R-1')$$, :d1), 'P0001', 'VALIDATION_FAILED', 'a deposit must be above zero');
select is((select count(*)::int from jsonb_array_elements(api.list_driver_dues()) x where x ->> 'driver_id' = :d1), 1, 'the driver with cash dues is listed');
select (api.record_cash_deposit(:d1, 100, 'office', 'R-100') ->> 'wallet_balance')::numeric as bal_after_deposit \gset
select is(:'bal_after_deposit'::numeric, (select net_earning - amount + 100 from public.driver_earnings e join public.payments p on p.trip_id = e.trip_id where e.trip_id = :'trip_a'), 'a deposit raises the driver wallet');
select pg_temp.as_user(:analyst);
select throws_ok(format($$select api.reconcile_payments(array[%L::uuid])$$, (select id from public.payments where trip_id = :'trip_a')), 'P0001', 'FORBIDDEN', 'an analyst cannot reconcile');
select pg_temp.as_user(:sa);
select is((api.reconcile_payments(array[(select id from public.payments where trip_id = :'trip_a')], 'Daily close') ->> 'payment_count')::int, 1, 'a confirmed payment is reconciled');
select throws_ok(format($$select api.reconcile_payments(array[%L::uuid])$$, (select id from public.payments where trip_id = :'trip_a')), 'P0001', 'VALIDATION_FAILED', 'it cannot be reconciled twice');
select is((select reconciled_at is not null from public.payments where trip_id = :'trip_a'), true, 'the payment is no longer waiting for reconciliation');
select is((api.get_trip_finance(:'trip_a') -> 'ledger_lines')::jsonb is not null, true, 'trip finance shows the ledger lines to ledger viewers');
select pg_temp.as_user(:support);
select is((api.get_trip_finance(:'trip_a') -> 'ledger_lines'), 'null'::jsonb, 'but not to support');
reset role;

-- ---------------------------------------------------------------------------
-- Refunds (maker-checker, dual approval)
-- ---------------------------------------------------------------------------
select id as pay_a from public.payments where trip_id = :'trip_a' \gset
set local role authenticated;
select pg_temp.as_user(:support);
select throws_ok(format($$select api.request_refund(%L, 5, 'no')$$, :'pay_a'), 'P0001', 'VALIDATION_FAILED', 'a refund needs a real reason');
select throws_ok(format($$select api.request_refund(%L, 100000, 'Customer was overcharged')$$, :'pay_a'), 'P0001', 'VALIDATION_FAILED', 'a refund cannot exceed the payment');
select (api.request_refund(:'pay_a', 20, 'Customer was overcharged by 20') ->> 'id') as refund1 \gset
select throws_ok(format($$select api.review_refund(%L, true)$$, :'refund1'), 'P0001', 'FORBIDDEN', 'support cannot approve refunds');
select pg_temp.as_user(:finance);
select is((api.review_refund(:'refund1', false, 'Not supported by the evidence') ->> 'status'), 'rejected', 'finance can reject with a reason');
select pg_temp.as_user(:sa);
select (api.request_refund(:'pay_a', 20, 'Customer was overcharged by 20') ->> 'id') as refund2 \gset
select throws_ok(format($$select api.review_refund(%L, true)$$, :'refund2'), 'P0001', 'SELF_APPROVAL', 'the requester cannot approve their own refund');
select pg_temp.as_user(:sa2);
select is((api.review_refund(:'refund2', true) ->> 'status'), 'processed', 'a different admin approves: below the threshold one approval is enough');
select throws_ok(format($$select api.review_refund(%L, true)$$, :'refund2'), 'P0001', 'INVALID_STATE_TRANSITION', 'a processed refund cannot be approved again');
reset role;
select is((select refunded_amount from public.payments where id = :'pay_a'), 20::numeric, 'the payment shows the refunded amount');
select is((select status::text from public.payments where id = :'pay_a'), 'partially_refunded', 'and becomes partially refunded');
select is((select b.balance from public.ledger_account_balances b join public.ledger_accounts a on a.id = b.account_id where a.code = 'passenger:' || :p1 || ':wallet'), 20::numeric, 'the passenger wallet is credited');

-- Dual approval above the threshold
update public.app_settings set value = '30' where key = 'finance.dual_approval_threshold';
set local role authenticated;
select pg_temp.as_user(:sa);
select (api.request_refund(:'pay_a', 40, 'Goodwill after a long wait') ->> 'id') as refund3 \gset
select pg_temp.as_user(:sa2);
select is((api.review_refund(:'refund3', true) ->> 'status'), 'awaiting_second_approval', 'a large refund needs a second approver after the first');
select throws_ok(format($$select api.review_refund(%L, true)$$, :'refund3'), 'P0001', 'SELF_APPROVAL', 'the first approver cannot also be the second');
select pg_temp.as_user(:sa3);
select is((api.review_refund(:'refund3', true) ->> 'status'), 'processed', 'a second, distinct approver processes it');
reset role;
select is((select refunded_amount from public.payments where id = :'pay_a'), 60::numeric, 'refunds accumulate on the payment');
update public.app_settings set value = '5000' where key = 'finance.dual_approval_threshold';
select throws_ok($$update public.refunds_adjustments set approved_by = requested_by$$, '23514', null, 'the database itself forbids self approval');

-- Adjustments and reversals
set local role authenticated;
select pg_temp.as_user(:sa);
select (api.request_adjustment((select id from public.ledger_accounts where code = 'driver:' || :d1 || ':wallet'), 'credit', 1000, 'Incentive for the launch week') ->> 'id') as adj1 \gset
select pg_temp.as_user(:support);
select throws_ok(format($$select api.review_refund(%L, true)$$, :'adj1'), 'P0001', 'FORBIDDEN', 'support cannot approve ledger adjustments');
select pg_temp.as_user(:sa2);
select is((api.review_refund(:'adj1', true) ->> 'status'), 'processed', 'a ledger adjustment is approved by a different admin');
reset role;
select is((select b.balance from public.ledger_account_balances b join public.ledger_accounts a on a.id = b.account_id where a.code = 'driver:' || :d1 || ':wallet'),
  (select net_earning - amount + 100 + 1000 from public.driver_earnings e join public.payments p on p.trip_id = e.trip_id where e.trip_id = :'trip_a'), 'the adjustment credited the driver wallet');
select id as adjtx from public.ledger_transactions where kind = 'adjustment' and reference = :'adj1' \gset
set local role authenticated;
select pg_temp.as_user(:sa);
select (api.request_reversal(:'adjtx', 'The adjustment was posted to the wrong driver') ->> 'id') as rev1 \gset
select throws_ok(format($$select api.request_reversal(%L, 'Duplicate request for the same posting')$$, :'adjtx'), 'P0001', 'INVALID_STATE_TRANSITION', 'only one reversal can be open for a transaction');
select pg_temp.as_user(:sa2);
select is((api.review_refund(:'rev1', true) ->> 'status'), 'processed', 'the reversal is approved and posted');
reset role;
select is((select b.balance from public.ledger_account_balances b join public.ledger_accounts a on a.id = b.account_id where a.code = 'driver:' || :d1 || ':wallet'),
  (select net_earning - amount + 100 from public.driver_earnings e join public.payments p on p.trip_id = e.trip_id where e.trip_id = :'trip_a'), 'the reversal restores the wallet');
select is((select reverses_id from public.ledger_transactions where kind = 'reversal' and reverses_id = :'adjtx'), :'adjtx'::uuid, 'the reversal points at the original, which stays untouched');
select throws_ok(format($$select private.reverse_transaction(%L, 'again', 'x')$$, :'adjtx'), 'P0001', 'INVALID_STATE_TRANSITION', 'a transaction cannot be reversed twice');
select throws_ok(format($$select private.reverse_transaction((select id from public.ledger_transactions where kind = 'reversal' and reverses_id = %L), 'meta', 'x')$$, :'adjtx'), 'P0001', 'INVALID_STATE_TRANSITION', 'a reversal cannot be reversed');
select is((private.verify_ledger_balances() -> 'drift'), '[]'::jsonb, 'the ledger still verifies after refunds, adjustments and reversals');

-- ---------------------------------------------------------------------------
-- Payouts
-- ---------------------------------------------------------------------------
update public.app_settings set value = '50' where key = 'payouts.minimum_amount';
set local role authenticated;
select pg_temp.as_user(:u1, 'aal1');
select throws_ok($$select api.driver_set_payout_account('cheque', 'Driver One', '01711111111')$$, 'P0001', 'VALIDATION_FAILED', 'only supported payout methods are accepted');
select throws_ok($$select api.driver_set_payout_account('bkash', 'Driver One', '12')$$, 'P0001', 'VALIDATION_FAILED', 'the account number is validated');
select is((api.driver_set_payout_account('bkash', 'Driver One', '01711111234') -> 'payout_account' ->> 'masked'), '••••••234', 'the payout account is stored masked for display');
select throws_ok($$select api.create_payout_batch()$$, 'P0001', 'FORBIDDEN', 'a driver cannot create payouts');
select pg_temp.as_user(:sa);
select throws_ok($$select api.create_payout_batch('Weekly')$$, 'P0001', 'NOTHING_TO_PAY', 'no batch while the account is unverified');
select is((select count(*)::int from jsonb_array_elements(api.list_payout_accounts('pending')) x where x ->> 'driver_id' = :d1), 1, 'the pending account shows up for review');
select api.review_payout_account((select x ->> 'id' from jsonb_array_elements(api.list_payout_accounts('pending')) x where x ->> 'driver_id' = :d1)::uuid, true);
reset role;
select is((select count(*)::int from information_schema.column_privileges where table_name = 'driver_payout_accounts' and column_name = 'account_ref_enc' and grantee = 'authenticated'), 0, 'nobody can read the account number column directly');
set local role authenticated;
select pg_temp.as_user(:sa);
select (api.create_payout_batch('Weekly') ->> 'id') as batch1 \gset
select is((select amount from public.payouts where batch_id = :'batch1'::uuid and driver_id = :d1),
  (select net_earning - amount + 100 from public.driver_earnings e join public.payments p on p.trip_id = e.trip_id where e.trip_id = :'trip_a'), 'the payout equals the wallet balance');
select throws_ok(format($$select api.approve_payout_batch(%L)$$, :'batch1'), 'P0001', 'SELF_APPROVAL', 'the batch creator cannot approve it');
select pg_temp.as_user(:support);
select throws_ok(format($$select api.approve_payout_batch(%L)$$, :'batch1'), 'P0001', 'FORBIDDEN', 'support cannot approve payouts');
select pg_temp.as_user(:sa2);
select is((api.approve_payout_batch(:'batch1') ->> 'status'), 'approved', 'a different admin approves the batch');
reset role;
select is((select b.balance from public.ledger_account_balances b join public.ledger_accounts a on a.id = b.account_id where a.code = 'driver:' || :d1 || ':wallet'), 0::numeric, 'approval moves the funds out of the wallet');
select is((select payout_status::text from public.driver_earnings where trip_id = :'trip_a'), 'in_payout', 'the earning is marked in payout');
set local role authenticated;
select pg_temp.as_user(:sa2);
select throws_ok(format($$select api.mark_payout_paid(%L, '')$$, (select id from public.payouts where batch_id = :'batch1'::uuid and driver_id = :d1)), 'P0001', 'VALIDATION_FAILED', 'a transfer reference is required');
select is((api.mark_payout_paid((select id from public.payouts where batch_id = :'batch1'::uuid and driver_id = :d1), 'BKASH-TRX-77') ->> 'status'), 'paid', 'marking paid completes the batch');
reset role;
select is((select b.balance from public.ledger_account_balances b join public.ledger_accounts a on a.id = b.account_id where a.code = 'platform:payouts_clearing'), :'clearing0'::numeric, 'payouts clearing is empty once paid');
select is((select payout_status::text from public.driver_earnings where trip_id = :'trip_a'), 'paid', 'the earning is marked paid');

-- a failed payout returns the money
select private.post_transaction('incentive', 'fixture-incentive', null, 'fixture', jsonb_build_array(
  jsonb_build_object('account_id', private.platform_account('incentive_expense'), 'debit', 300),
  jsonb_build_object('account_id', private.wallet_account('driver', :d1), 'credit', 300)));
set local role authenticated;
select pg_temp.as_user(:sa);
select (api.create_payout_batch('Second') ->> 'id') as batch2 \gset
select pg_temp.as_user(:sa2);
select api.approve_payout_batch(:'batch2');
select pg_temp.as_user(:sa3);
select is((api.fail_payout((select id from public.payouts where batch_id = :'batch2'::uuid and driver_id = :d1), 'The wallet number was invalid') -> 'counts' ->> 'failed')::int, 1, 'a failed payout is recorded with its reason');
reset role;
select is((select b.balance from public.ledger_account_balances b join public.ledger_accounts a on a.id = b.account_id where a.code = 'driver:' || :d1 || ':wallet'), 300::numeric, 'the funds return to the wallet by reversal');
select is((select status::text from public.payout_batches where id = :'batch2'::uuid), 'failed', 'the batch is failed when every payout failed');
select is((private.verify_ledger_balances() -> 'drift'), '[]'::jsonb, 'the ledger verifies after payouts');

-- ---------------------------------------------------------------------------
-- Promotions
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(:support);
select throws_ok($$select api.save_promotion(null, '{"code":"WELCOME","name":"Welcome","discount_type":"fixed","discount_value":20}')$$, 'P0001', 'FORBIDDEN', 'support cannot manage promotions');
select pg_temp.as_user(:sa);
select throws_ok($$select api.save_promotion(null, '{"code":"x","name":"Bad"}')$$, 'P0001', 'VALIDATION_FAILED', 'an invalid promotion is rejected');
select throws_ok($$select api.save_promotion(null, '{"code":"WELCOME","name":"Welcome","discount_type":"fixed","discount_value":20,"hacker":1}')$$, 'P0001', 'VALIDATION_FAILED', 'unknown fields are rejected');
select (api.save_promotion(null, jsonb_build_object('code', 'welcome', 'name', 'Welcome 20', 'discount_type', 'fixed', 'discount_value', 20,
  'starts_at', now() - interval '1 hour', 'ends_at', now() + interval '30 days', 'budget_limit', 30, 'per_user_limit', 1)) ->> 'id') as promo1 \gset
select is((api.get_promotion(:'promo1') ->> 'code'), 'WELCOME', 'the code is stored upper-case');
select throws_ok(format($$select api.set_promotion_status(%L, 'active', 'ok')$$, :'promo1'), 'P0001', 'VALIDATION_FAILED', 'a status change needs a reason');
select is((api.set_promotion_status(:'promo1', 'active', 'Launch the welcome offer') ->> 'status'), 'active', 'the promotion goes live');
reset role;

select pg_temp.ride(:p2, :u1, 'WELCOME', false) as trip_b \gset
select is((select budget_spent from public.promotions where id = :'promo1'), 20::numeric, 'the budget is reserved when the code is applied');
select is((select status from public.promotion_redemptions where promotion_id = :'promo1'), 'reserved', 'the redemption is reserved');

-- SOS while the trip is in progress
set local role authenticated;
select pg_temp.as_user(:p3, 'aal1');
select throws_ok(format($$select api.trigger_sos(%L)$$, :'trip_b'), 'P0001', 'NOT_FOUND', 'only the trip participants can trigger SOS');
select pg_temp.as_user(:p2, 'aal1');
select (api.trigger_sos(:'trip_b', 'The driver is taking a strange route') ->> 'id') as sos1 \gset
select is((api.trigger_sos(:'trip_b') ->> 'repeat')::boolean, true, 'pressing SOS again returns the same incident');
select pg_temp.as_user(:sa);
select is((api.get_incident(:'sos1') ->> 'severity'), 'critical', 'an SOS is a critical incident');
select is((api.get_incident(:'sos1') -> 'location') is not null, true, 'it carries the latest location for authorised admins');
select is((select count(*)::int from jsonb_array_elements(api.list_incidents('open') -> 'rows') r where r ->> 'id' = :'sos1' and r ->> 'status' = 'reported'), 1, 'it appears unacknowledged in the safety queue');
select throws_ok(format($$select api.advance_incident(%L, 'resolved', 'Skipping steps is not allowed')$$, :'sos1'), 'P0001', 'INVALID_STATE_TRANSITION', 'incidents follow the workflow');
select throws_ok(format($$select api.advance_incident(%L, 'acknowledged', 'x')$$, :'sos1'), 'P0001', 'VALIDATION_FAILED', 'every transition needs a note');
select is((api.advance_incident(:'sos1', 'acknowledged', 'Calling the driver now') ->> 'status'), 'acknowledged', 'the incident is acknowledged');
select is((api.get_incident(:'sos1') ->> 'seconds_to_acknowledge') is not null, true, 'time to acknowledge is measured');
select pg_temp.as_user(:analyst);
select throws_ok(format($$select api.get_incident(%L)$$, :'sos1'), 'P0001', 'FORBIDDEN', 'an analyst cannot read incidents');
select is((select private.can_receive_topic('ops:safety')), false, 'an analyst cannot subscribe to the safety channel');
select pg_temp.as_user(:sa);
select is((select private.can_receive_topic('ops:safety')), true, 'safety viewers can subscribe');
select pg_temp.as_user(:p2, 'aal1');
select is((select private.can_receive_topic('ops:safety')), false, 'passengers cannot');
reset role;
select is((select count(*)::int from public.safety_incident_events where incident_id = :'sos1'::uuid), 2, 'incident history is kept');
select pg_temp.finish_trip(:'trip_b', :u1);

-- Promotion applied at completion
select is((select discount_amount from public.trip_fare_breakdowns where trip_id = :'trip_b'), 20::numeric, 'the discount is applied in the frozen breakdown');
select is((select status from public.promotion_redemptions where promotion_id = :'promo1'), 'applied', 'the redemption is applied');
select is((select (total_amount + discount_amount) from public.trip_fare_breakdowns where trip_id = :'trip_b'), (select gross_fare from public.driver_earnings where trip_id = :'trip_b'), 'the driver is paid on the full fare');
select is((select b.balance from public.ledger_account_balances b join public.ledger_accounts a on a.id = b.account_id where a.code = 'platform:promo_expense'), :'promo0'::numeric + 20, 'the platform carries the promo cost');
select is((select budget_spent from public.promotions where id = :'promo1'), 20::numeric, 'the budget spent equals the applied discount');
select throws_ok(format($$select pg_temp.ride(%L, %L, 'WELCOME', false)$$, :p3, :u1), 'P0001', 'PROMO_INVALID', 'a promotion stops when its budget would be exceeded');
reset role;
select is((private.verify_ledger_balances() -> 'drift'), '[]'::jsonb, 'the ledger verifies after a promotional trip');

-- Budget and limits
select throws_ok(format($$select pg_temp.ride(%L, %L, 'WELCOME', false)$$, :p2, :u1), 'P0001', 'PROMO_INVALID', 'the per-user limit is enforced');
select is((select count(*)::int from public.promotion_redemptions where promotion_id = :'promo1' and status <> 'released'), 1, 'only the first redemption counted');

-- Cash mismatch raises a ticket
set local role authenticated;
select pg_temp.as_user(:u1, 'aal1');
select api.confirm_cash_collected(:'trip_b', 100);
reset role;
select is((select count(*)::int from public.support_tickets where category = 'payment' and channel = 'system' and requester_id = :u1), 1, 'a cash mismatch opens a payment ticket automatically');

-- ---------------------------------------------------------------------------
-- Ratings
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(:p3, 'aal1');
select throws_ok(format($$select api.rate_trip(%L, 5)$$, :'trip_b'), 'P0001', 'NOT_FOUND', 'only participants can rate');
select pg_temp.as_user(:p2, 'aal1');
select throws_ok(format($$select api.rate_trip(%L, 9)$$, :'trip_b'), 'P0001', 'VALIDATION_FAILED', 'scores run from 1 to 5');
select is((api.rate_trip(:'trip_b', 4, 'Good ride') ->> 'score')::int, 4, 'the passenger rates the driver');
select throws_ok(format($$select api.rate_trip(%L, 5)$$, :'trip_b'), 'P0001', 'ALREADY_EXISTS', 'a trip can be rated once per person');
reset role;
select is((select rating_avg from public.driver_profiles where id = :d1), 4.00::numeric, 'the driver rating is updated');
set local role authenticated;
select pg_temp.as_user(:u1, 'aal1');
select is((api.rate_trip(:'trip_b', 5) ->> 'score')::int, 5, 'the driver rates the passenger');
select pg_temp.as_user(:p1, 'aal1');
select api.rate_trip(:'trip_a', 1, 'Rude and rushed');
reset role;
select is((select count(*)::int from public.support_tickets where subject like 'Low rating%' and requester_id = :p1), 1, 'a harsh rating with a comment opens a low-priority ticket');
update public.trips set completed_at = now() - interval '9 days' where id = :'trip_a';
select is((select rating_avg from public.driver_profiles where id = :d1), 2.50::numeric, 'the average covers both ratings');
set local role authenticated;
select pg_temp.as_user(:support);
select id as rate_low from public.ratings where score = 1 \gset
select api.hide_rating(:'rate_low', 'Abusive language in the comment');
reset role;
select is((select rating_avg from public.driver_profiles where id = :d1), 4.00::numeric, 'hiding a rating recomputes the average');
set local role authenticated;
select pg_temp.as_user(:analyst);
select throws_ok(format($$select api.hide_rating(%L, 'Not my job to hide')$$, :'rate_low'), 'P0001', 'FORBIDDEN', 'an analyst cannot moderate ratings');
reset role;

-- ---------------------------------------------------------------------------
-- Support tickets
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(:p1, 'aal1');
select throws_ok($$select api.create_ticket(null, 'bogus', 'Hello there', 'Body')$$, 'P0001', 'VALIDATION_FAILED', 'tickets need a valid category');
select (api.create_ticket(:'trip_a', 'payment', 'I was charged twice', 'Please check my last trip.') ->> 'id') as tk1 \gset
select is((api.get_my_ticket(:'tk1') ->> 'status'), 'open', 'a new ticket is open');
select pg_temp.as_user(:p2, 'aal1');
select throws_ok(format($$select api.get_my_ticket(%L)$$, :'tk1'), 'P0001', 'NOT_FOUND', 'users cannot read each other''s tickets');
select throws_ok(format($$select api.create_ticket(%L, 'trip', 'Not my trip', 'x')$$, :'trip_a'), 'P0001', 'NOT_FOUND', 'a ticket can only reference your own trip');
select pg_temp.as_user(:support);
select is((api.get_ticket(:'tk1') ->> 'sla_breached')::boolean, false, 'a fresh ticket is inside its SLA');
select api.reply_ticket(:'tk1', 'Checking with finance.', true);
select is((api.get_ticket(:'tk1') ->> 'first_response_at') is null, true, 'an internal note is not a first response');
select is((api.reply_ticket(:'tk1', 'We are on it.', false) ->> 'status'), 'in_progress', 'a public reply moves the ticket to in progress');
select pg_temp.as_user(:p1, 'aal1');
select is(jsonb_array_length(api.get_my_ticket(:'tk1') -> 'messages'), 2, 'the user sees the question and the public reply, never internal notes');
select pg_temp.as_user(:analyst);
select throws_ok(format($$select api.reply_ticket(%L, 'Let me help', false)$$, :'tk1'), 'P0001', 'FORBIDDEN', 'an analyst cannot reply');
select pg_temp.as_user(:sa);
select throws_ok(format($$select api.set_ticket_status(%L, 'closed')$$, :'tk1'), 'P0001', 'INVALID_STATE_TRANSITION', 'only a resolved ticket can be closed');
select is((api.set_ticket_status(:'tk1', 'resolved', 'Refund issued') ->> 'status'), 'resolved', 'the ticket is resolved');
reset role;
update public.support_tickets set resolved_at = now() - interval '8 days' where id = :'tk1';
select private.ticket_housekeeping();
select is((select status::text from public.support_tickets where id = :'tk1'), 'closed', 'resolved tickets close automatically after the grace period');
update public.support_tickets set status = 'open', sla_due_at = now() - interval '1 hour', first_response_at = null where subject like 'Low rating%' and requester_id = :p1;
select private.ticket_housekeeping();
select is((select count(*)::int from public.notifications where kind = 'ticket_sla' and recipient_id in (:sa, :sa2, :sa3)), 3, 'an SLA breach notifies the people who can assign tickets (once)');
select private.ticket_housekeeping();
select is((select count(*)::int from public.notifications where kind = 'ticket_sla' and recipient_id in (:sa, :sa2, :sa3)), 3, 'and is not repeated');

-- ---------------------------------------------------------------------------
-- Direct access is closed
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(:p1, 'aal1');
select is((select count(*)::int from public.ledger_entries), 0, 'passengers see no ledger rows');
select is((select count(*)::int from public.payments), 0, 'nor payments through the table (only through the API)');
select throws_ok($$select account_ref_enc from public.driver_payout_accounts$$, '42501', null, 'payout account numbers are not selectable');
select throws_ok($$insert into public.ledger_transactions (kind, reference) values ('x', 'y')$$, '42501', null, 'clients cannot write the ledger');
select throws_ok($$update public.payments set amount = 1$$, '42501', null, 'clients cannot edit payments');
select pg_temp.as_user(:sa);
select is((select count(*)::int > 0 from public.ledger_entries), true, 'a ledger viewer can read entries');
reset role;

-- ---------------------------------------------------------------------------
-- Cancellation fee
-- ---------------------------------------------------------------------------
select pg_temp.ride(:p3, :u1, null, false, true) as trip_d \gset
update public.trips set accepted_at = now() - interval '5 minutes', accepted_pickup_eta_s = 600 where id = :'trip_d';
set local role authenticated;
select pg_temp.as_user(:p3, 'aal1');
select api.cancel_ride((select request_id from public.trips where id = :'trip_d'), 'Changed my mind');
reset role;
select is((select cancellation_fee from public.trips where id = :'trip_d'), 30::numeric, 'a late cancellation carries the rule''s fee');
select is((select count(*)::int from public.ledger_transactions where kind = 'cancellation_fee' and trip_id = :'trip_d'), 1, 'the fee is posted to the ledger');
select is((select b.balance from public.ledger_account_balances b join public.ledger_accounts a on a.id = b.account_id where a.code = 'passenger:' || :p3 || ':wallet'), -30::numeric, 'the passenger owes the fee (a receivable)');
select is((select sum(e.credit) from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id join public.ledger_transactions t on t.id = e.transaction_id
           where t.kind = 'cancellation_fee' and t.trip_id = :'trip_d' and a.code = 'driver:' || :d1 || ':wallet'), 25.50::numeric, 'the driver receives the fee minus 15% commission');
select is((private.verify_ledger_balances() -> 'drift'), '[]'::jsonb, 'the ledger verifies after a cancellation fee');

select * from finish();
rollback;
