-- M1 scheduled jobs: document expiry and stale online drivers.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

\set u '''00000000-0000-0000-0000-00000000f101'''

insert into auth.users (id, email) values (:u, 'jobs.driver@test.local');
select private.promote_user_role(:u, 'driver');

insert into public.driver_profiles (id, user_id, onboarding_status, approved_at)
values ('00000000-0000-0000-0000-00000000f201', :u, 'approved', now());
insert into public.vehicles (id, driver_id, category_id, make, model, color, registration_number, year, status)
values ('00000000-0000-0000-0000-00000000f301', '00000000-0000-0000-0000-00000000f201',
        (select id from public.vehicle_categories where code = 'bike'), 'Yamaha', 'FZ', 'Blue', 'JOBS-TEST-1', 2023, 'active');
update public.driver_profiles set current_vehicle_id = '00000000-0000-0000-0000-00000000f301', availability = 'online'
where id = '00000000-0000-0000-0000-00000000f201';

insert into public.driver_documents (driver_id, vehicle_id, document_type, storage_path, content_type, uploaded_at, review_status, expires_at)
select '00000000-0000-0000-0000-00000000f201',
       case when t in ('vehicle_registration','fitness_certificate','tax_token','insurance') then '00000000-0000-0000-0000-00000000f301'::uuid end,
       t::public.document_type, 'drivers/jobs/' || t || '.jpg', 'image/jpeg', now(), 'approved',
       case when t = 'insurance' then current_date - 1 else current_date + 200 end
from unnest(array['profile_photo','national_id','driving_licence','vehicle_registration','fitness_certificate','tax_token','insurance']) t;

insert into public.driver_live_locations (driver_id, location, recorded_at, updated_at)
values ('00000000-0000-0000-0000-00000000f201', private.point(23.8, 90.4), now() - interval '10 minutes', now() - interval '10 minutes');

-- Stale location job
select is(private.offline_stale_drivers() >= 1, true, 'stale online drivers are found');
select is((select availability::text from public.driver_profiles where id = '00000000-0000-0000-0000-00000000f201'), 'offline',
  'a driver without a recent location goes offline');
select ok(exists (select 1 from public.driver_status_events
                  where driver_id = '00000000-0000-0000-0000-00000000f201' and reason = 'LOCATION_STALE'),
  'the stale-location change is recorded');

-- Document expiry job
select ok((private.process_document_expiry() ->> 'expired')::int >= 1, 'expired documents are marked expired');
select is((select review_status::text from public.driver_documents where storage_path = 'drivers/jobs/insurance.jpg'), 'expired',
  'the expired insurance is marked expired');
select is((select onboarding_status::text from public.driver_profiles where id = '00000000-0000-0000-0000-00000000f201'), 'suspended',
  'a driver with an expired required document is suspended');
select is((select suspended_reason from public.driver_profiles where id = '00000000-0000-0000-0000-00000000f201'), 'DOCUMENT_EXPIRED',
  'the suspension reason is recorded');

select * from finish();
rollback;
