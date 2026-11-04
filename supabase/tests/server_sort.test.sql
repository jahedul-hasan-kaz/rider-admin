-- Server-side sorting with keyset pagination: sorted pages, cursor walks without gaps or overlap in both
-- directions, unknown sort keys rejected, and the default (null) order unchanged.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

\set inviter '''00000000-0000-0000-0000-0000000a5000'''
\set sa      '''00000000-0000-0000-0000-0000000a5001'''
\set du      '''00000000-0000-0000-0000-0000000a5d01'''
\set drv     '''00000000-0000-0000-0000-0000000a5d02'''
\set veh     '''00000000-0000-0000-0000-0000000a5d03'''
\set zone    '''00000000-0000-0000-0000-0000000a5e01'''

insert into auth.users (id, email) values (:inviter, 'inv.sort@test.local');
insert into public.admin_invitations (email, full_name, template_ids, reason, invited_by)
select 'sa.sort@test.local', 'Super Sort', array(select id from public.permission_templates where code = 'super_admin'), 'fixture', :inviter;
insert into auth.users (id, email) values (:sa, 'sa.sort@test.local'), (:du, 'drv.sort@test.local');

-- Five passengers whose names do not follow their creation order.
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000a5b0' || i)::uuid, 'p' || i || '.sort@test.local' from generate_series(1, 5) i;
select private.promote_user_role(('00000000-0000-0000-0000-0000000a5b0' || i)::uuid, 'passenger') from generate_series(1, 5) i;
update public.profiles p set full_name = 'SortPax ' || n.name
from (values (1, 'Delta'), (2, 'Alpha'), (3, 'Echo'), (4, 'Charlie'), (5, 'Bravo')) n(i, name)
where p.id = ('00000000-0000-0000-0000-0000000a5b0' || n.i)::uuid;

insert into public.service_zones (id, code, name, boundary, area_km2, active)
values (:zone, 'sort_zone', 'Sort Zone',
  extensions.st_multi(extensions.st_geomfromtext('POLYGON((80.35 12.55,80.45 12.55,80.45 12.65,80.35 12.65,80.35 12.55))', 4326))::extensions.geography, 100, true);
select private.promote_user_role(:du, 'driver');
insert into public.driver_profiles (id, user_id, onboarding_status, approved_at) values (:drv, :du, 'approved', now());
insert into public.vehicles (id, driver_id, category_id, make, model, color, registration_number, year, status)
values (:veh, :drv, (select id from public.vehicle_categories where code = 'bike'), 'Honda', 'CB', 'Red', 'SORT-1', 2022, 'active');

-- One finished trip and one payment per passenger. Quote and fare-rule references are not needed by the lists,
-- so foreign-key triggers are skipped for these direct fixture rows only.
set local session_replication_role = replica;
insert into public.ride_requests (id, passenger_id, quote_id, category_id, zone_id, pickup_point, destination_point,
  estimated_distance_m, estimated_duration_s, estimated_fare, quoted_rule_id, expires_at, status)
select ('00000000-0000-0000-0000-0000000a5c0' || i)::uuid, ('00000000-0000-0000-0000-0000000a5b0' || i)::uuid, gen_random_uuid(),
  (select id from public.vehicle_categories where code = 'bike'), :zone, private.point(12.6, 80.4), private.point(12.62, 80.42),
  5000, 1200, 100, gen_random_uuid(), now(), 'completed'
from generate_series(1, 5) i;
insert into public.trips (id, request_id, passenger_id, driver_id, vehicle_id, fare_rule_id, pricing_rule_snapshot, final_fare, status, created_at)
select ('00000000-0000-0000-0000-0000000a5f0' || i)::uuid, ('00000000-0000-0000-0000-0000000a5c0' || i)::uuid,
  ('00000000-0000-0000-0000-0000000a5b0' || i)::uuid, :drv, :veh, gen_random_uuid(), '{}',
  (array[120, null, 300, 80, 200])[i], 'completed', now() - make_interval(mins => i)
from generate_series(1, 5) i;
insert into public.payments (id, trip_id, passenger_id, driver_id, method, amount, status)
select ('00000000-0000-0000-0000-0000000a5a0' || i)::uuid, ('00000000-0000-0000-0000-0000000a5f0' || i)::uuid,
  ('00000000-0000-0000-0000-0000000a5b0' || i)::uuid, :drv, 'cash', (array[200, 50, 200, 300, 100])[i], 'succeeded'
from generate_series(1, 5) i;
set local session_replication_role = origin;

create function pg_temp.as_user(p_id uuid, p_aal text default 'aal2') returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

-- Walks every page (two rows each) of one list and returns the row ids in the order served.
create function pg_temp.walk(p_list text, p_sort text) returns text[]
language plpgsql as $$
declare
  v_cursor text;
  v_page jsonb;
  v_ids text[] := '{}';
  v_guard integer := 0;
begin
  loop
    v_page := case p_list
      when 'passengers' then api.list_passengers(p_search => 'SortPax', p_limit => 2, p_cursor => v_cursor, p_sort => p_sort)
      when 'trips' then api.list_trips(p_search => 'SortPax', p_limit => 2, p_cursor => v_cursor, p_sort => p_sort)
      when 'payments' then api.list_payments(p_search => 'SortPax', p_limit => 2, p_cursor => v_cursor, p_sort => p_sort)
    end;
    v_ids := v_ids || array(select r ->> 'id' from jsonb_array_elements(v_page -> 'rows') with ordinality e(r, n) order by n);
    v_cursor := v_page ->> 'next_cursor';
    v_guard := v_guard + 1;
    exit when v_cursor is null or v_guard > 10;
  end loop;
  return v_ids;
end $$;

-- Expected orders, computed directly from the tables (ties broken by id in the same direction).
create function pg_temp.pax(p_order text) returns text[] language sql as $$
  select case p_order
    when 'name' then array(select id::text from public.profiles where full_name like 'SortPax %' order by full_name, id)
    when '-name' then array(select id::text from public.profiles where full_name like 'SortPax %' order by full_name desc, id desc)
    else array(select id::text from public.profiles where full_name like 'SortPax %' order by created_at desc, id desc) end;
$$;
create function pg_temp.trips(p_order text) returns text[] language sql as $$
  select case p_order
    when 'fare' then array(select t.id::text from public.trips t where t.driver_id = '00000000-0000-0000-0000-0000000a5d02' order by coalesce(t.final_fare, 0), t.id)
    when '-fare' then array(select t.id::text from public.trips t where t.driver_id = '00000000-0000-0000-0000-0000000a5d02' order by coalesce(t.final_fare, 0) desc, t.id desc)
    else array(select t.id::text from public.trips t where t.driver_id = '00000000-0000-0000-0000-0000000a5d02' order by t.created_at desc, t.id desc) end;
$$;
create function pg_temp.payments(p_order text) returns text[] language sql as $$
  select case p_order
    when 'amount' then array(select p.id::text from public.payments p where p.driver_id = '00000000-0000-0000-0000-0000000a5d02' order by p.amount, p.id)
    when '-amount' then array(select p.id::text from public.payments p where p.driver_id = '00000000-0000-0000-0000-0000000a5d02' order by p.amount desc, p.id desc)
    else array(select p.id::text from public.payments p where p.driver_id = '00000000-0000-0000-0000-0000000a5d02' order by p.created_at desc, p.id desc) end;
$$;

set local role authenticated;
select pg_temp.as_user(:sa);

-- Passengers
select is((select array_agg(r ->> 'full_name') from jsonb_array_elements(api.list_passengers(p_search => 'SortPax', p_limit => 2, p_sort => 'full_name') -> 'rows') r),
  array['SortPax Alpha', 'SortPax Bravo'], 'passengers: the first page is sorted by name');
select ok(api.list_passengers(p_search => 'SortPax', p_limit => 2, p_sort => 'full_name') ->> 'next_cursor' is not null, 'passengers: a sorted page returns a cursor');
select is(pg_temp.walk('passengers', 'full_name'), pg_temp.pax('name'), 'passengers: ascending pages have no gaps or overlap');
select is(pg_temp.walk('passengers', '-full_name'), pg_temp.pax('-name'), 'passengers: descending pages have no gaps or overlap');
select is(pg_temp.walk('passengers', null), pg_temp.pax('default'), 'passengers: no sort keeps the newest-first order');
select is(pg_temp.walk('passengers', '-created_at'), pg_temp.pax('default'), 'passengers: -created_at is the default order');
select is(cardinality(pg_temp.walk('passengers', 'last_seen_at')), 5, 'passengers: a nullable key still walks every row');
select throws_ok($$select api.list_passengers(p_sort => 'phone')$$, 'P0001', 'VALIDATION_FAILED', 'passengers: an unknown sort key is rejected');
select throws_ok($$select api.list_passengers(p_sort => '--full_name')$$, 'P0001', 'VALIDATION_FAILED', 'passengers: a malformed sort is rejected');

-- Trips
select is((select array_agg(r ->> 'id') from jsonb_array_elements(api.list_trips(p_search => 'SortPax', p_limit => 2, p_sort => '-fare') -> 'rows') r),
  (pg_temp.trips('-fare'))[1:2], 'trips: the first page is sorted by fare, highest first');
select is(pg_temp.walk('trips', 'fare'), pg_temp.trips('fare'), 'trips: ascending pages have no gaps or overlap');
select is(pg_temp.walk('trips', '-fare'), pg_temp.trips('-fare'), 'trips: descending pages have no gaps or overlap');
select is(pg_temp.walk('trips', null), pg_temp.trips('default'), 'trips: no sort keeps the newest-first order');
select is(cardinality(pg_temp.walk('trips', 'passenger_name')), 5, 'trips: a text key walks every row');
select throws_ok($$select api.list_trips(p_sort => 'pickup')$$, 'P0001', 'VALIDATION_FAILED', 'trips: an unknown sort key is rejected');

-- Payments (ties on amount are broken by id)
select is((select array_agg((r ->> 'amount')::numeric) from jsonb_array_elements(api.list_payments(p_search => 'SortPax', p_limit => 2, p_sort => 'amount') -> 'rows') r),
  array[50, 100]::numeric[], 'payments: the first page is sorted by amount');
select is(pg_temp.walk('payments', 'amount'), pg_temp.payments('amount'), 'payments: ascending pages have no gaps or overlap, ties included');
select is(pg_temp.walk('payments', '-amount'), pg_temp.payments('-amount'), 'payments: descending pages have no gaps or overlap, ties included');
select is(pg_temp.walk('payments', null), pg_temp.payments('default'), 'payments: no sort keeps the newest-first order');
select throws_ok($$select api.list_payments(p_sort => 'trip_id')$$, 'P0001', 'VALIDATION_FAILED', 'payments: an unknown sort key is rejected');

-- Cursors
select throws_ok($$select api.list_payments(p_cursor => 'not-a-cursor', p_sort => 'amount')$$, 'P0001', 'VALIDATION_FAILED', 'a garbled cursor is rejected');
select is(cardinality(array(select jsonb_array_elements(api.list_passengers(p_search => 'SortPax',
  p_cursor => (select to_jsonb(created_at) #>> '{}' || '|' || id from public.profiles where full_name like 'SortPax %' order by created_at desc, id desc limit 1)) -> 'rows'))),
  4, 'a legacy "<ts>|<id>" cursor is still accepted for the default order');

-- Other lists accept the parameter too
select lives_ok($$select api.list_tickets(p_sort => '-priority'), api.list_incidents(p_sort => 'severity'), api.list_ratings(p_sort => 'score'),
  api.list_ride_requests(p_sort => 'estimated_fare'), api.list_drivers(p_sort => 'rating'), api.list_vehicles(p_sort => 'registration_number'),
  api.list_document_queue('pending', p_sort => 'driver_name'), api.list_ledger_transactions(p_sort => '-amount')$$, 'every list accepts its sort keys');
select throws_ok($$select api.list_ledger_transactions(p_sort => 'memo')$$, 'P0001', 'VALIDATION_FAILED', 'ledger: an unknown sort key is rejected');

select * from finish();
rollback;
