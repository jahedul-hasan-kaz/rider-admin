-- Benchmark: the dispatch candidate query with 10,000 online drivers (spec budget: <= 20 ms).
-- Everything runs in one transaction that is rolled back; nothing persists.
--   docker exec -i supabase_db_rider-admin psql -U postgres -v ON_ERROR_STOP=1 -f - < tests/load/bench-candidates.sql
begin;
set local session_replication_role = replica; -- bulk synthetic rows: skip FK/trigger overhead

with ids as (select i, md5('bench-u-' || i)::uuid as uid from generate_series(1, 10000) i)
insert into public.profiles (id, role, status, full_name)
select uid, 'driver', 'active', 'Bench ' || i from ids;

with ids as (select i, md5('bench-u-' || i)::uuid as uid, md5('bench-d-' || i)::uuid as did, md5('bench-v-' || i)::uuid as vid from generate_series(1, 10000) i)
insert into public.driver_profiles (id, user_id, onboarding_status, availability, current_vehicle_id, acceptance_rate_30d, approved_at)
select did, uid, 'approved', 'online', vid, random(), now() from ids;

with ids as (select i, md5('bench-d-' || i)::uuid as did, md5('bench-v-' || i)::uuid as vid from generate_series(1, 10000) i)
insert into public.vehicles (id, driver_id, category_id, make, model, color, registration_number, year, status)
select vid, did, (select id from public.vehicle_categories where code = 'bike'), 'Honda', 'CB', 'Red', 'B-' || i, 2022, 'active' from ids;

with ids as (select i, md5('bench-d-' || i)::uuid as did from generate_series(1, 10000) i)
insert into public.driver_live_locations (driver_id, location, recorded_at, updated_at)
select did, extensions.st_setsrid(extensions.st_makepoint(90.30 + random() * 0.2, 23.70 + random() * 0.2), 4326)::extensions.geography, now(), now() from ids;

analyze public.driver_profiles, public.vehicles, public.driver_live_locations;
set local session_replication_role = origin;

\echo --- shipped candidate query, 1.5 km ring ---
explain (analyze, buffers, costs off)
with pt as (select extensions.st_setsrid(extensions.st_makepoint(90.40, 23.80), 4326)::extensions.geography as g),
near as materialized (
  select l.driver_id, extensions.st_distance(l.location, pt.g) as dist
  from public.driver_live_locations l, pt
  where l.updated_at > now() - interval '120 seconds' and extensions.st_dwithin(l.location, pt.g, 1500)
)
select d.id, n.dist
from near n
join public.driver_profiles d on d.id = n.driver_id
join public.profiles pr on pr.id = d.user_id and pr.status = 'active'
join public.vehicles v on v.id = d.current_vehicle_id and v.status = 'active' and v.category_id = (select id from public.vehicle_categories where code = 'bike')
where d.availability = 'online' and d.onboarding_status = 'approved'
  and not exists (select 1 from public.dispatch_offers o where o.driver_id = d.id and o.response = 'pending')
order by n.dist, d.acceptance_rate_30d desc nulls last
limit 1;

\echo --- 5 km ring ---
explain (analyze, buffers, costs off)
with pt as (select extensions.st_setsrid(extensions.st_makepoint(90.40, 23.80), 4326)::extensions.geography as g),
near as materialized (
  select l.driver_id, extensions.st_distance(l.location, pt.g) as dist
  from public.driver_live_locations l, pt
  where l.updated_at > now() - interval '120 seconds' and extensions.st_dwithin(l.location, pt.g, 5000)
)
select d.id, n.dist
from near n
join public.driver_profiles d on d.id = n.driver_id
join public.profiles pr on pr.id = d.user_id and pr.status = 'active'
join public.vehicles v on v.id = d.current_vehicle_id and v.status = 'active' and v.category_id = (select id from public.vehicle_categories where code = 'bike')
where d.availability = 'online' and d.onboarding_status = 'approved'
  and not exists (select 1 from public.dispatch_offers o where o.driver_id = d.id and o.response = 'pending')
order by n.dist, d.acceptance_rate_30d desc nulls last
limit 1;
rollback;
