-- Staging demo data: staff with different permissions, passengers, drivers at every onboarding stage, zones, fares,
-- ~90 rides over the last ~11 days, money (cash, refunds, incentives, payouts), support, safety and alerts.
-- Run by the app at start when SEED_DEMO_DATA=true (src/server/services/seed-demo.ts), phase by phase so no single
-- call is long. Callable only with the service key. Every phase runs once (private.demo_seed_log).
--
-- Rides and money go through the same functions the apps and staff use (acting as each person for one call), so the
-- ledger, KPIs, payouts and audit trail are consistent. Ride history is then moved back in time.

create table private.demo_seed_log (
  phase text not null,
  batch integer not null default 0,
  done_at timestamptz not null default now(),
  result jsonb,
  primary key (phase, batch)
);

create table private.demo_seed_ids (
  kind text not null,
  key text not null,
  id uuid not null,
  extra jsonb not null default '{}',
  primary key (kind, key)
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function private.demo_as(p_user uuid, p_aal text default 'aal1') returns void
language sql security definer set search_path = '' as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

create function private.demo_id(p_kind text, p_key text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from private.demo_seed_ids where kind = p_kind and key = p_key;
$$;

create function private.demo_user(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.profiles where lower(email::text) = lower(p_email);
$$;

-- Moves one ride (request, offers, quote, trip, events, payment, earnings, ledger, rating) back in time.
create function private.demo_shift_ride(p_request uuid, p_by interval) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_trip uuid;
  v_quote uuid;
  t record;
  v_cols text;
begin
  select quote_id into v_quote from public.ride_requests where id = p_request;
  select id into v_trip from public.trips where request_id = p_request;
  -- Run the deferred checks (ledger balance) now: a table with pending checks cannot have its triggers paused.
  set constraints all immediate;
  for t in
    select * from (values
      ('ride_requests', format('id = %L', p_request)),
      ('ride_request_events', format('request_id = %L', p_request)),
      ('dispatch_offers', format('request_id = %L', p_request)),
      ('fare_quotes', format('id = %L', v_quote)),
      ('trips', format('id = %L', v_trip)),
      ('trip_status_events', format('trip_id = %L', v_trip)),
      ('trip_fare_breakdowns', format('trip_id = %L', v_trip)),
      ('payments', format('trip_id = %L', v_trip)),
      ('driver_earnings', format('trip_id = %L', v_trip)),
      ('ratings', format('trip_id = %L', v_trip)),
      ('ledger_transactions', format('trip_id = %L', v_trip)),
      ('ledger_entries', format('transaction_id in (select id from public.ledger_transactions where trip_id = %L)', v_trip)),
      ('promotion_redemptions', format('request_id = %L', p_request))
    ) x(tbl, cond)
  loop
    if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t.tbl) then
      continue;
    end if;
    select string_agg(format('%1$I = %1$I - %2$L::interval', column_name, p_by), ', ') into v_cols
    from information_schema.columns
    where table_schema = 'public' and table_name = t.tbl and data_type = 'timestamp with time zone';
    if v_cols is null then
      continue;
    end if;
    -- History is rewritten only here, for demo rows: the append-only and stamping triggers are paused for this update.
    execute format('alter table public.%I disable trigger user', t.tbl);
    execute format('update public.%I set %s where %s', t.tbl, v_cols, t.cond);
    execute format('alter table public.%I enable trigger user', t.tbl);
  end loop;
  set constraints all deferred;
end $$;

-- A random point inside a zone's bounding box (zones here are rectangles).
create function private.demo_point_in(p_zone uuid) returns double precision[]
language sql volatile security definer set search_path = '' as $$
  select array[
    extensions.st_ymin(b) + (extensions.st_ymax(b) - extensions.st_ymin(b)) * (0.15 + random() * 0.7),
    extensions.st_xmin(b) + (extensions.st_xmax(b) - extensions.st_xmin(b)) * (0.15 + random() * 0.7)]
  from (select extensions.st_envelope(boundary::extensions.geometry) as b from public.service_zones where id = p_zone) z;
$$;

-- Puts one driver online at a point and every other demo driver offline, so dispatch offers the ride to that driver.
create function private.demo_only_driver(p_driver uuid, p_lat double precision, p_lng double precision) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.driver_profiles set availability = 'offline'
  where availability = 'online' and id in (select id from private.demo_seed_ids where kind = 'driver');
  update public.driver_profiles set availability = 'online' where id = p_driver;
  insert into public.driver_live_locations (driver_id, location, recorded_at, updated_at)
  values (p_driver, private.point(p_lat, p_lng), now(), now())
  on conflict (driver_id) do update set location = excluded.location, recorded_at = excluded.recorded_at, updated_at = excluded.updated_at;
end $$;

-- ---------------------------------------------------------------------------
-- The people
-- ---------------------------------------------------------------------------
create function private.demo_people() returns jsonb
language sql immutable set search_path = '' as $$
  select '{
    "staff": [
      {"email": "ops@yopmail.com",             "name": "Ops Manager",        "templates": ["operations"]},
      {"email": "support@yopmail.com",         "name": "Support Agent",      "templates": ["support"]},
      {"email": "finance@yopmail.com",         "name": "Finance Officer",    "templates": ["finance"]},
      {"email": "finance.checker@yopmail.com", "name": "Finance Checker",    "templates": ["finance"]},
      {"email": "safety@yopmail.com",          "name": "Safety Reviewer",    "templates": ["safety"]},
      {"email": "analyst@yopmail.com",         "name": "Data Analyst",       "templates": ["analyst"]},
      {"email": "support.lead@yopmail.com",    "name": "Support Lead",       "templates": ["support"],
       "grant": ["refunds.approve", "support.assign", "passengers.view_pii"]},
      {"email": "ops.trainee@yopmail.com",     "name": "Ops Trainee",        "templates": ["operations"],
       "deny": ["drivers.approve", "dispatch.intervene", "trips.cancel", "drivers.delete"]},
      {"email": "multi@yopmail.com",           "name": "Ops and Finance",    "templates": ["operations", "finance"]}
    ],
    "passengers": [
      {"email": "nusrat@yopmail.com",  "name": "Nusrat Jahan"},
      {"email": "farhana@yopmail.com", "name": "Farhana Akter"},
      {"email": "arif@yopmail.com",    "name": "Arif Hossain"},
      {"email": "rakib@yopmail.com",   "name": "Rakib Hasan"},
      {"email": "tanjila@yopmail.com", "name": "Tanjila Islam"},
      {"email": "shuvo@yopmail.com",   "name": "Shuvo Ahmed"},
      {"email": "mitu@yopmail.com",    "name": "Mitu Rahman"},
      {"email": "sadia@yopmail.com",   "name": "Sadia Chowdhury"},
      {"email": "tahmid@yopmail.com",  "name": "Tahmid Karim"},
      {"email": "ayesha@yopmail.com",  "name": "Ayesha Siddiqua"},
      {"email": "zubair@yopmail.com",  "name": "Zubair Alam"},
      {"email": "customer@yopmail.com","name": "Demo Passenger"}
    ],
    "drivers": [
      {"email": "rider@yopmail.com",         "name": "Demo Driver",    "status": "approved",     "category": "bike", "zone": "dhaka_gulshan"},
      {"email": "kamal.driver@yopmail.com",  "name": "Kamal Uddin",    "status": "approved",     "category": "bike", "zone": "dhaka_gulshan"},
      {"email": "jamal.driver@yopmail.com",  "name": "Jamal Mia",      "status": "approved",     "category": "bike", "zone": "dhaka_dhanmondi"},
      {"email": "rafiq.driver@yopmail.com",  "name": "Rafiqul Islam",  "status": "approved",     "category": "bike", "zone": "dhaka_mirpur"},
      {"email": "sohel.driver@yopmail.com",  "name": "Sohel Rana",     "status": "approved",     "category": "car",  "zone": "dhaka_gulshan"},
      {"email": "masud.driver@yopmail.com",  "name": "Masud Parvez",   "status": "approved",     "category": "car",  "zone": "dhaka_uttara"},
      {"email": "anis.driver@yopmail.com",   "name": "Anisur Rahman",  "status": "approved",     "category": "cng",  "zone": "dhaka_motijheel"},
      {"email": "habib.driver@yopmail.com",  "name": "Habibur Rahman", "status": "approved",     "category": "cng",  "zone": "dhaka_dhanmondi", "expiring": true},
      {"email": "tanvir.driver@yopmail.com", "name": "Tanvir Hasan",   "status": "submitted",    "category": "bike", "zone": "dhaka_uttara"},
      {"email": "imran.driver@yopmail.com",  "name": "Imran Kabir",    "status": "under_review", "category": "car",  "zone": "dhaka_mirpur"},
      {"email": "sabbir.driver@yopmail.com", "name": "Sabbir Ahmed",   "status": "draft",        "category": "bike", "zone": "dhaka_mirpur"},
      {"email": "nayeem.driver@yopmail.com", "name": "Nayeem Hossain", "status": "rejected",     "category": "bike", "zone": "dhaka_dhanmondi"},
      {"email": "faruk.driver@yopmail.com",  "name": "Faruk Ahmed",    "status": "suspended",    "category": "cng",  "zone": "dhaka_motijheel"}
    ]
  }'::jsonb;
$$;

-- ---------------------------------------------------------------------------
-- Phases
-- ---------------------------------------------------------------------------
-- plan: invitations for staff (so their sign-in identities become admins), then the list of people to create.
create function private.demo_phase_plan() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s jsonb;
begin
  for s in select jsonb_array_elements(private.demo_people() -> 'staff') loop
    if not exists (select 1 from public.profiles where lower(email::text) = s ->> 'email')
       and not exists (select 1 from public.admin_invitations where email = (s ->> 'email')::extensions.citext and status = 'pending') then
      insert into public.admin_invitations (email, full_name, template_ids, reason, invited_by)
      values (s ->> 'email', s ->> 'name',
        array(select id from public.permission_templates where code in (select jsonb_array_elements_text(s -> 'templates'))),
        'Staging demo account', private.demo_user('admin@yopmail.com'));
    end if;
  end loop;
  return private.demo_people();
end $$;

-- setup: roles, vehicle types, zones, fares, drivers with vehicles and documents, payout accounts, promotions, overrides.
create function private.demo_phase_setup(p_arg jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sa uuid := private.demo_user('admin@yopmail.com');
  v_sha text := coalesce(p_arg ->> 'file_sha256', repeat('0', 64));
  p jsonb;
  v_user uuid;
  v_driver uuid;
  v_vehicle uuid;
  v_zone uuid;
  v_cat uuid;
  v_status text;
  v_rule uuid;
  v_doc uuid;
  v_type public.document_type;
  v_paths text[] := '{}'::text[];
  n integer := 0;
  z record;
  c record;
  v_override text;
begin
  if v_sa is null then
    perform private.raise_error('NOT_FOUND', '{"reason":"admin@yopmail.com must exist first"}');
  end if;

  -- Staff: no forced password change for demo accounts; custom grants and denials.
  update public.admin_profiles set must_change_password = false
  where id in (select id from public.profiles where lower(email::text) in (select jsonb_array_elements(private.demo_people() -> 'staff') ->> 'email'));
  perform private.demo_as(v_sa, 'aal2');
  for p in select jsonb_array_elements(private.demo_people() -> 'staff') loop
    v_user := private.demo_user(p ->> 'email');
    continue when v_user is null;
    for v_override in select jsonb_array_elements_text(coalesce(p -> 'grant', '[]')) loop
      if not exists (select 1 from public.admin_permission_overrides where admin_id = v_user and permission_code = v_override and revoked_at is null) then
        perform api.set_permission_override(v_user, v_override, 'grant', 'Demo: lead responsibilities');
      end if;
    end loop;
    for v_override in select jsonb_array_elements_text(coalesce(p -> 'deny', '[]')) loop
      if not exists (select 1 from public.admin_permission_overrides where admin_id = v_user and permission_code = v_override and revoked_at is null) then
        perform api.set_permission_override(v_user, v_override, 'deny', 'Demo: trainee, not yet signed off');
      end if;
    end loop;
  end loop;

  -- Vehicle types.
  insert into public.vehicle_categories (code, name, name_bn, description, passenger_capacity, icon, sort_order) values
    ('car', 'Car', 'কার', 'Air-conditioned car for up to four passengers.', 4, 'car', 20),
    ('cng', 'CNG', 'সিএনজি', 'Auto-rickshaw for up to three passengers.', 3, 'car', 30)
  on conflict (code) do nothing;
  for c in select id, code from public.vehicle_categories where code in ('bike', 'car', 'cng') loop
    insert into private.demo_seed_ids (kind, key, id) values ('category', c.code, c.id) on conflict do nothing;
  end loop;

  -- Zones in Dhaka (rectangles keep the demo simple).
  for z in select * from (values
    ('dhaka_gulshan',   'Gulshan & Banani', 23.770, 90.395, 23.805, 90.425, 1.20),
    ('dhaka_dhanmondi', 'Dhanmondi',        23.730, 90.360, 23.760, 90.390, 1.00),
    ('dhaka_uttara',    'Uttara',           23.855, 90.380, 23.890, 90.410, 1.00),
    ('dhaka_mirpur',    'Mirpur',           23.795, 90.345, 23.830, 90.375, 1.00),
    ('dhaka_motijheel', 'Motijheel',        23.715, 90.405, 23.740, 90.430, 1.00)
  ) x(code, name, lat1, lng1, lat2, lng2, surge) loop
    insert into public.service_zones (code, name, boundary, area_km2, active, manual_surge_multiplier)
    values (z.code, z.name,
      extensions.st_multi(extensions.st_makeenvelope(z.lng1, z.lat1, z.lng2, z.lat2, 4326))::extensions.geography,
      round((extensions.st_area(extensions.st_makeenvelope(z.lng1, z.lat1, z.lng2, z.lat2, 4326)::extensions.geography) / 1e6)::numeric, 2),
      true, z.surge)
    on conflict (code) do nothing;
    insert into private.demo_seed_ids (kind, key, id) select 'zone', z.code, id from public.service_zones where code = z.code on conflict do nothing;
  end loop;

  -- Fares: one live rule per zone and vehicle type.
  for z in select key, id from private.demo_seed_ids where kind = 'zone' loop
    for c in select key, id from private.demo_seed_ids where kind = 'category' loop
      continue when exists (select 1 from public.fare_rules where zone_id = z.id and category_id = c.id and status = 'active');
      v_rule := api.save_fare_draft(null, c.id, z.id, case c.key
        when 'bike' then '{"base_fare":25,"per_km":12,"per_minute":1,"minimum_fare":50,"booking_fee":0,"waiting_per_minute":2,"free_waiting_minutes":3,"cancellation_fee":30,"platform_commission_pct":0.15,"max_surge_multiplier":1.5}'
        when 'car'  then '{"base_fare":60,"per_km":30,"per_minute":3,"minimum_fare":150,"booking_fee":10,"waiting_per_minute":4,"free_waiting_minutes":3,"cancellation_fee":50,"platform_commission_pct":0.20,"max_surge_multiplier":2}'
        else             '{"base_fare":40,"per_km":20,"per_minute":2,"minimum_fare":90,"booking_fee":5,"waiting_per_minute":3,"free_waiting_minutes":3,"cancellation_fee":40,"platform_commission_pct":0.18,"max_surge_multiplier":1.5}'
        end::jsonb, 'Demo launch rates', null);
      perform api.publish_fare_rule(v_rule, null, 'Demo launch rates');
    end loop;
  end loop;

  -- Passengers.
  for p in select jsonb_array_elements(private.demo_people() -> 'passengers') loop
    v_user := private.demo_user(p ->> 'email');
    continue when v_user is null;
    n := n + 1;
    update public.profiles set full_name = p ->> 'name',
      phone = coalesce(phone, case when not exists (select 1 from public.profiles where phone = '+88017110' || lpad(n::text, 5, '0'))
                                   then '+88017110' || lpad(n::text, 5, '0') end)
    where id = v_user;
    if (select role from public.profiles where id = v_user) = 'user' then
      perform private.promote_user_role(v_user, 'passenger');
    end if;
    insert into private.demo_seed_ids (kind, key, id) values ('passenger', p ->> 'email', v_user) on conflict do nothing;
  end loop;

  -- Drivers, vehicles and documents.
  n := 0;
  for p in select jsonb_array_elements(private.demo_people() -> 'drivers') loop
    v_user := private.demo_user(p ->> 'email');
    continue when v_user is null;
    n := n + 1;
    v_status := p ->> 'status';
    v_zone := private.demo_id('zone', p ->> 'zone');
    v_cat := private.demo_id('category', p ->> 'category');
    update public.profiles set full_name = p ->> 'name',
      phone = coalesce(phone, case when not exists (select 1 from public.profiles where phone = '+88018110' || lpad(n::text, 5, '0'))
                                   then '+88018110' || lpad(n::text, 5, '0') end)
    where id = v_user;
    if (select role from public.profiles where id = v_user) = 'user' then
      perform private.promote_user_role(v_user, 'driver');
    end if;
    select id into v_driver from public.driver_profiles where user_id = v_user;
    if v_driver is null then
      insert into public.driver_profiles (user_id, onboarding_status, home_zone_id) values (v_user, 'draft', v_zone) returning id into v_driver;
    end if;
    insert into private.demo_seed_ids (kind, key, id, extra) values ('driver', p ->> 'email', v_driver,
      jsonb_build_object('user_id', v_user, 'category', p ->> 'category', 'zone', p ->> 'zone', 'status', v_status))
    on conflict do nothing;
    continue when v_status = 'draft';

    select id into v_vehicle from public.vehicles where driver_id = v_driver and status <> 'inactive' limit 1;
    if v_vehicle is null then
      insert into public.vehicles (driver_id, category_id, make, model, color, registration_number, year, status, verified_at, verified_by)
      values (v_driver, v_cat,
        case p ->> 'category' when 'bike' then 'Honda' when 'car' then 'Toyota' else 'Bajaj' end,
        case p ->> 'category' when 'bike' then (array['CB Shine', 'Livo', 'Hornet'])[1 + n % 3] when 'car' then (array['Axio', 'Premio', 'Allion'])[1 + n % 3] else 'RE CNG' end,
        (array['Red', 'Black', 'Blue', 'White', 'Green', 'Silver'])[1 + n % 6],
        'DHAKA-METRO-' || case p ->> 'category' when 'bike' then 'HA' when 'car' then 'GA' else 'THA' end || '-' || lpad((11 + n * 7)::text, 2, '0') || '-' || lpad((1000 + n * 137)::text, 4, '0'),
        2016 + n % 8,
        case when v_status in ('approved', 'suspended') then 'active' else 'pending' end::public.vehicle_status,
        case when v_status in ('approved', 'suspended') then now() - interval '20 days' end,
        case when v_status in ('approved', 'suspended') then v_sa end)
      returning id into v_vehicle;
    end if;

    for v_type in select unnest(array['profile_photo', 'national_id', 'driving_licence', 'vehicle_registration', 'fitness_certificate', 'tax_token', 'insurance']::public.document_type[]
                  || case when p ->> 'category' = 'cng' then array['route_permit']::public.document_type[] else '{}'::public.document_type[] end) loop
      continue when exists (select 1 from public.driver_documents where driver_id = v_driver and document_type = v_type and superseded_at is null);
      v_doc := gen_random_uuid();
      insert into public.driver_documents (id, driver_id, vehicle_id, document_type, storage_path, content_type, size_bytes, file_sha256,
        document_number_masked, issued_at, expires_at, uploaded_at, review_status, reviewer_id, reviewed_at, rejection_reason)
      values (v_doc, v_driver, case when v_type = any (private.vehicle_document_types()) then v_vehicle end, v_type,
        format('drivers/%s/%s.png', v_driver, v_doc), 'image/png', 68, v_sha,
        case when v_type in ('national_id', 'driving_licence', 'vehicle_registration') then '••••' || lpad((1000 + n * 37)::text, 4, '0') end,
        case when v_type <> 'profile_photo' then current_date - 400 end,
        case when v_type in ('driving_licence', 'fitness_certificate', 'tax_token', 'insurance', 'route_permit')
             then case when coalesce((p ->> 'expiring')::boolean, false) and v_type = 'insurance' then current_date + 10 else current_date + 300 end end,
        now() - interval '21 days',
        case
          when v_status in ('approved', 'suspended') then 'approved'
          when v_status = 'rejected' and v_type = 'driving_licence' then 'rejected'
          when v_status = 'rejected' then 'approved'
          when v_status = 'under_review' and v_type in ('profile_photo', 'national_id') then 'approved'
          else 'pending' end::public.review_status,
        case when v_status not in ('submitted') then v_sa end,
        case when v_status not in ('submitted') then now() - interval '20 days' end,
        case when v_status = 'rejected' and v_type = 'driving_licence' then 'The licence photo is blurred. Please upload a clear photo of both sides.' end);
      v_paths := v_paths || format('drivers/%s/%s.png', v_driver, v_doc);
    end loop;

    update public.driver_profiles set
      onboarding_status = case v_status when 'approved' then 'approved' when 'suspended' then 'suspended' when 'rejected' then 'rejected'
                                        when 'under_review' then 'under_review' else 'submitted' end::public.driver_onboarding_status,
      submitted_at = coalesce(submitted_at, now() - interval '22 days'),
      approved_at = case when v_status in ('approved', 'suspended') then coalesce(approved_at, now() - interval '20 days') end,
      rejected_reason = case when v_status = 'rejected' then 'Driving licence could not be verified.' end,
      suspended_reason = case when v_status = 'suspended' then 'Repeated late cancellations reported by passengers.' end,
      current_vehicle_id = case when v_status in ('approved', 'suspended') then v_vehicle end,
      home_zone_id = coalesce(home_zone_id, v_zone),
      availability = 'offline'
    where id = v_driver;

    -- Payout accounts for approved drivers (bKash / Nagad), reviewed.
    if v_status = 'approved' and not exists (select 1 from public.driver_payout_accounts where driver_id = v_driver) then
      perform private.demo_as(v_user);
      perform api.driver_set_payout_account(case when n % 2 = 0 then 'bkash' else 'nagad' end, p ->> 'name', '0171' || lpad((2000000 + n * 1311)::text, 7, '0'));
      perform private.demo_as(v_sa, 'aal2');
      perform api.review_payout_account((select id from public.driver_payout_accounts where driver_id = v_driver order by created_at desc limit 1), true, 'Name matches the NID');
    end if;
  end loop;

  -- Promotions.
  perform private.demo_as(v_sa, 'aal2');
  if not exists (select 1 from public.promotions where code = 'WELCOME50') then
    perform api.save_promotion(null, jsonb_build_object('code', 'WELCOME50', 'name', 'Welcome offer', 'description', '50 Tk off your ride',
      'discount_type', 'fixed', 'discount_value', 50, 'starts_at', now() - interval '20 days', 'ends_at', now() + interval '40 days',
      'budget_limit', 20000, 'per_user_limit', 3));
    perform api.set_promotion_status((select id from public.promotions where code = 'WELCOME50'), 'active', 'Launch campaign');
    perform api.save_promotion(null, jsonb_build_object('code', 'FRIDAY20', 'name', 'Friday 20% off', 'discount_type', 'percent',
      'discount_value', 20, 'max_discount', 60, 'starts_at', now() - interval '15 days', 'ends_at', now() + interval '60 days',
      'budget_limit', 15000, 'per_user_limit', 5));
    perform api.set_promotion_status((select id from public.promotions where code = 'FRIDAY20'), 'active', 'Weekend demand');
    perform api.save_promotion(null, jsonb_build_object('code', 'EID100', 'name', 'Eid special', 'discount_type', 'fixed',
      'discount_value', 100, 'starts_at', now() - interval '60 days', 'ends_at', now() + interval '1 day', 'budget_limit', 10000, 'per_user_limit', 1));
    perform api.set_promotion_status((select id from public.promotions where code = 'EID100'), 'ended', 'Campaign over');
    perform api.save_promotion(null, jsonb_build_object('code', 'BOISHAKH', 'name', 'Pohela Boishakh (draft)', 'discount_type', 'percent',
      'discount_value', 15, 'max_discount', 80, 'starts_at', now() + interval '30 days', 'ends_at', now() + interval '33 days', 'budget_limit', 25000, 'per_user_limit', 2));
  end if;

  return jsonb_build_object('documents', to_jsonb(v_paths));
end $$;

-- rides: one batch of historical rides (15 per batch). Completed, cancelled by either side or staff, and no driver found.
create function private.demo_phase_rides(p_batch integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ops uuid := private.demo_user('ops@yopmail.com');
  v_total integer := 90;
  v_cat text;
  v_pax uuid;
  d record;
  pick double precision[];
  dest double precision[];
  v_quote uuid;
  v_req uuid;
  v_trip uuid;
  v_kind integer;
  v_done integer := 0;
  v_paxes uuid[];
  v_zones uuid[];
begin
  select array_agg(id order by key) into v_paxes from private.demo_seed_ids where kind = 'passenger';
  select array_agg(id order by key) into v_zones from private.demo_seed_ids where kind = 'zone';
  for i in p_batch * 15 .. p_batch * 15 + 14 loop
    v_cat := case when i % 5 in (0, 1, 2) then 'bike' when i % 5 = 3 then 'car' else 'cng' end;
    select s.id, (s.extra ->> 'user_id')::uuid as user_id, private.demo_id('zone', s.extra ->> 'zone') as zone_id into d
    from private.demo_seed_ids s
    where s.kind = 'driver' and s.extra ->> 'status' = 'approved' and s.extra ->> 'category' = v_cat
    order by md5(s.key || i) limit 1;
    v_pax := v_paxes[1 + (i * 7) % array_length(v_paxes, 1)];
    continue when v_pax = private.demo_user('zubair@yopmail.com') and i > 60; -- keeps him free of dues for the deletion demo
    pick := private.demo_point_in(d.zone_id);
    dest := private.demo_point_in(case when i % 4 = 0 then v_zones[1 + i % array_length(v_zones, 1)] else d.zone_id end);
    v_kind := i % 20;

    if v_kind = 7 then
      -- Nobody available: dispatch finds no driver.
      update public.driver_profiles set availability = 'offline' where availability = 'online' and id in (select id from private.demo_seed_ids where kind = 'driver');
    else
      perform private.demo_only_driver(d.id, pick[1] + 0.002, pick[2] + 0.002);
    end if;

    perform private.demo_as(v_pax);
    v_quote := (api.create_quote(private.demo_id('category', v_cat), pick[1], pick[2],
      (array['Home', 'Office', 'Gulshan 1 Circle', 'Banani 11', 'Dhanmondi 27', 'Bashundhara City', 'Jamuna Future Park', 'Shahbag', 'Airport', 'Farmgate'])[1 + i % 10],
      dest[1], dest[2],
      (array['Office', 'Home', 'Uttara Sector 7', 'Mirpur 10', 'New Market', 'Motijheel', 'Karwan Bazar', 'Badda', 'Mohakhali', 'Gulshan 2'])[1 + (i * 3) % 10],
      round(extensions.st_distance(private.point(pick[1], pick[2]), private.point(dest[1], dest[2])) * 1.3)::int + 400,
      round(extensions.st_distance(private.point(pick[1], pick[2]), private.point(dest[1], dest[2])) * 1.3 / 6)::int + 240) ->> 'id')::uuid;
    v_req := (api.create_ride_request(v_quote, 'cash', case when i % 6 = 0 then 'Near the main gate' end) ->> 'id')::uuid;
    if i % 9 = 0 and v_kind not in (7, 3) then
      begin
        perform api.apply_promo(v_req, case when i % 2 = 0 then 'WELCOME50' else 'FRIDAY20' end);
      exception when others then null; -- per-user limits reached: ride without a promotion
      end;
    end if;

    if v_kind = 3 then
      perform api.cancel_ride(v_req, 'Found another way to get there');
    elsif v_kind <> 7 and (select status from public.ride_requests where id = v_req) = 'searching' then
      perform private.demo_as(d.user_id);
      v_trip := (api.accept_offer((api.driver_current_offer() ->> 'offer_id')::uuid) ->> 'id')::uuid;
      if v_kind = 11 then
        perform api.driver_trip_cancel(v_trip, 'Passenger not reachable on phone');
      elsif v_kind = 15 then
        perform private.demo_as(v_pax);
        perform api.cancel_ride(v_req, 'Driver was too far away');
      elsif v_kind = 19 then
        perform private.demo_as(v_ops, 'aal2');
        perform api.admin_cancel_trip(v_trip, 'Passenger called support: booked by mistake');
      else
        perform api.driver_trip_arriving(v_trip);
        perform api.driver_trip_arrived(v_trip, true);
        perform api.driver_trip_start(v_trip);
        perform api.driver_update_locations((select jsonb_agg(jsonb_build_object(
          'lat', pick[1] + (dest[1] - pick[1]) * k / 7.0, 'lng', pick[2] + (dest[2] - pick[2]) * k / 7.0,
          'speed', 22, 'accuracy', 8, 'recorded_at', now() - make_interval(secs => 160 - k * 20))) from generate_series(0, 7) k));
        update public.trips set started_at = now() - interval '12 minutes', arrived_at = now() - interval '15 minutes' where id = v_trip;
        perform api.complete_trip(v_trip);
        -- A fully discounted ride has nothing to collect; a few stay unconfirmed for the reconciliation pages.
        if i % 8 <> 5 and exists (select 1 from public.payments where trip_id = v_trip and status = 'pending') then
          perform api.confirm_cash_collected(v_trip);
        end if;
        if i % 5 <> 4 then
          perform private.demo_as(v_pax);
          perform api.rate_trip(v_trip, (array[5, 5, 4, 5, 3, 5, 4, 2, 5, 5])[1 + i % 10],
            (array['Very polite driver', null, 'Smooth ride', null, 'Took a longer route', 'On time', null, 'Driver was rude and drove too fast', null, 'Great service'])[1 + i % 10]);
        end if;
        if i % 3 = 0 then
          perform private.demo_as(d.user_id);
          perform api.rate_trip(v_trip, (array[5, 4, 5])[1 + i % 3], null);
        end if;
      end if;
    end if;

    -- Spread the history over the last ~11 days, oldest first.
    perform private.demo_shift_ride(v_req, make_interval(hours => (v_total - i) * 3, mins => (i * 17) % 60));
    v_done := v_done + 1;
  end loop;
  update public.driver_profiles set availability = 'offline' where availability = 'online' and id in (select id from private.demo_seed_ids where kind = 'driver');
  return jsonb_build_object('rides', v_done);
end $$;

-- live: what is happening right now: drivers online on the map, a trip in progress (with an SOS), a driver on the way.
create function private.demo_phase_live() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d record;
  pick double precision[];
  dest double precision[];
  v_quote uuid;
  v_trip uuid;
  k integer := 0;
  v_out jsonb := '{}'::jsonb;
begin
  for d in select s.key, s.id, (s.extra ->> 'user_id')::uuid as user_id, private.demo_id('zone', s.extra ->> 'zone') as zone_id,
                  private.demo_id('category', s.extra ->> 'category') as cat
           from private.demo_seed_ids s where s.kind = 'driver' and s.extra ->> 'status' = 'approved' order by s.key loop
    k := k + 1;
    pick := private.demo_point_in(d.zone_id);
    if d.key in ('kamal.driver@yopmail.com', 'sohel.driver@yopmail.com') then
      perform private.demo_only_driver(d.id, pick[1] + 0.003, pick[2] + 0.003);
      dest := private.demo_point_in(d.zone_id);
      perform private.demo_as(private.demo_user(case when d.key like 'kamal%' then 'nusrat@yopmail.com' else 'farhana@yopmail.com' end));
      v_quote := (api.create_quote(d.cat, pick[1], pick[2], 'Gulshan 1 Circle', dest[1], dest[2], 'Banani 11', 3200, 900) ->> 'id')::uuid;
      perform api.create_ride_request(v_quote, 'cash', null);
      perform private.demo_as(d.user_id);
      v_trip := (api.accept_offer((api.driver_current_offer() ->> 'offer_id')::uuid) ->> 'id')::uuid;
      perform api.driver_trip_arriving(v_trip);
      if d.key like 'kamal%' then
        perform api.driver_trip_arrived(v_trip, true);
        perform api.driver_trip_start(v_trip);
        perform api.driver_update_location(pick[1] + 0.001, pick[2] + 0.001, 45, 6, 8, now());
        -- The passenger feels unsafe and presses SOS.
        perform private.demo_as(private.demo_user('nusrat@yopmail.com'));
        perform api.trigger_sos(v_trip, 'The driver is taking an unfamiliar road and not answering.');
        v_out := v_out || jsonb_build_object('in_progress', v_trip);
      else
        v_out := v_out || jsonb_build_object('arriving', v_trip);
      end if;
    end if;
  end loop;
  -- Everyone else approved goes online at a spot in their zone (the apps are not running, so they go stale in a few minutes).
  for d in select s.id, private.demo_id('zone', s.extra ->> 'zone') as zone_id from private.demo_seed_ids s
           join public.driver_profiles p on p.id = s.id
           where s.kind = 'driver' and s.extra ->> 'status' = 'approved' and p.availability = 'offline' loop
    pick := private.demo_point_in(d.zone_id);
    update public.driver_profiles set availability = 'online' where id = d.id;
    insert into public.driver_live_locations (driver_id, location, recorded_at, updated_at) values (d.id, private.point(pick[1], pick[2]), now(), now())
    on conflict (driver_id) do update set location = excluded.location, recorded_at = excluded.recorded_at, updated_at = excluded.updated_at;
  end loop;
  return v_out;
end $$;

-- money: cash deposits, refunds (approved, rejected, waiting), incentives and a penalty, payout batch (paid and pending).
create function private.demo_phase_money() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_support uuid := private.demo_user('support@yopmail.com');
  v_fin uuid := private.demo_user('finance@yopmail.com');
  v_chk uuid := private.demo_user('finance.checker@yopmail.com');
  v_lead uuid := private.demo_user('support.lead@yopmail.com');
  p record;
  d record;
  r jsonb;
  n integer := 0;
  v_batch uuid;
  v_warn text[] := '{}'::text[];
begin
  -- Drivers deposit part of the cash they collected.
  perform private.demo_as(v_fin, 'aal2');
  for d in select s.id from private.demo_seed_ids s where s.kind = 'driver' and s.extra ->> 'status' = 'approved' order by s.key limit 4 loop
    begin
      perform api.record_cash_deposit(d.id, 150 + n * 40, case when n % 2 = 0 then 'bkash' else 'office' end, 'TRX' || upper(substr(md5(d.id::text), 1, 8)), 'Weekly cash deposit');
    exception when others then v_warn := v_warn || ('deposit: ' || sqlerrm);
    end;
    n := n + 1;
  end loop;

  -- Refunds on completed rides.
  n := 0;
  for p in select pay.id, pay.amount from public.payments pay join public.trips t on t.id = pay.trip_id
           where t.passenger_id in (select id from private.demo_seed_ids where kind = 'passenger') and pay.status = 'succeeded'
           order by pay.created_at desc limit 4 loop
    n := n + 1;
    perform private.demo_as(case when n = 4 then v_lead else v_support end, 'aal2');
    r := api.request_refund(p.id, least(40, p.amount), (array['Driver took a longer route', 'Charged waiting time wrongly', 'Ride ended early by mistake', 'Passenger was overcharged for the toll'])[n]);
    if n in (1, 2) then
      perform private.demo_as(v_fin, 'aal2');
      perform api.review_refund((r ->> 'id')::uuid, true, 'Checked the route trail');
    elsif n = 3 then
      perform private.demo_as(v_fin, 'aal2');
      perform api.review_refund((r ->> 'id')::uuid, false, 'The route was the fastest at that time');
    end if; -- the fourth waits for a finance approver
  end loop;

  -- Weekly incentives for drivers (maker: finance, checker: finance checker), and a penalty waiting for approval.
  n := 0;
  for d in select s.id, s.key from private.demo_seed_ids s where s.kind = 'driver' and s.extra ->> 'status' = 'approved' order by s.key loop
    n := n + 1;
    perform private.demo_as(v_fin, 'aal2');
    begin
      r := api.request_adjustment((select id from public.ledger_accounts where code = 'driver:' || d.id || ':wallet'),
        'credit', 600 + n * 50, 'Weekly incentive: 25+ rides completed');
      if n <> 3 then
        perform private.demo_as(v_chk, 'aal2');
        perform api.review_refund((r ->> 'id')::uuid, true, 'Ride count verified');
      end if;
    exception when others then v_warn := v_warn || ('incentive: ' || sqlerrm);
    end;
  end loop;

  -- Payout batch: finance creates, the checker approves, some are paid.
  begin
    perform private.demo_as(v_fin, 'aal2');
    v_batch := (api.create_payout_batch('Weekly payout') ->> 'id')::uuid;
    perform private.demo_as(v_chk, 'aal2');
    perform api.approve_payout_batch(v_batch);
    n := 0;
    for p in select id from public.payouts where batch_id = v_batch order by id loop
      n := n + 1;
      continue when n % 3 = 0; -- left approved, waiting to be paid
      perform api.mark_payout_paid(p.id, 'BKASH-' || upper(substr(md5(p.id::text), 1, 10)));
    end loop;
  exception when others then v_warn := v_warn || ('payouts: ' || sqlerrm);
  end;
  return jsonb_build_object('warnings', to_jsonb(v_warn));
end $$;

-- care: support tickets in every state, the safety queue, account requests, alerts and saved views.
create function private.demo_phase_care() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sa uuid := private.demo_user('admin@yopmail.com');
  v_ops uuid := private.demo_user('ops@yopmail.com');
  v_support uuid := private.demo_user('support@yopmail.com');
  v_safety uuid := private.demo_user('safety@yopmail.com');
  t record;
  v_ticket uuid;
  n integer := 0;
  v_warn text[] := '{}'::text[];
begin
  for t in select * from (values
    ('arif@yopmail.com',          'payment',   'Charged twice for one ride',                    'I see two charges for my ride yesterday evening.', 'in_progress'),
    ('rakib@yopmail.com',         'trip',      'Driver asked for extra money',                  'The driver asked for 50 Tk more than the app showed.', 'open'),
    ('tanjila@yopmail.com',       'account',   'Cannot change my phone number',                 'I got a new SIM, how do I update my number?', 'resolved'),
    ('shuvo@yopmail.com',         'trip',      'Left my umbrella in the car',                   'Black umbrella, ride from Banani to Gulshan 2.', 'pending_user'),
    ('mitu@yopmail.com',          'driver',    'Driver was very helpful',                       'Please thank the driver, he helped with my bags.', 'closed'),
    ('kamal.driver@yopmail.com',  'payment',   'Incentive not received',                        'I completed 30 rides last week but no incentive yet.', 'open'),
    ('jamal.driver@yopmail.com',  'account',   'App logs me out every hour',                    'Since the last update I have to sign in again often.', 'in_progress'),
    ('sadia@yopmail.com',         'safety',    'Driver was using his phone while driving',      'It made me feel unsafe.', 'open')
  ) x(email, category, subject, body, target) loop
    n := n + 1;
    continue when exists (select 1 from public.support_tickets where subject = t.subject);
    begin
      perform private.demo_as(private.demo_user(t.email));
      v_ticket := (api.create_ticket(null, t.category, t.subject, t.body) ->> 'id')::uuid;
      perform private.demo_as(v_support, 'aal2');
      if t.target <> 'open' then
        perform api.reply_ticket(v_ticket, 'Thanks for reaching out. We are looking into this and will update you shortly.');
        perform api.reply_ticket(v_ticket, 'Checked trip logs; route looks normal.', true);
      end if;
      if t.target in ('resolved', 'closed') then
        perform api.set_ticket_status(v_ticket, 'resolved', 'Explained the steps in the app');
      end if;
      if t.target in ('closed', 'pending_user') then
        perform api.set_ticket_status(v_ticket, t.target, null);
      end if;
      if t.target = 'in_progress' then
        perform private.demo_as(v_ops, 'aal2');
        perform api.assign_ticket(v_ticket, v_support);
      end if;
    exception when others then v_warn := v_warn || ('ticket: ' || sqlerrm);
    end;
  end loop;

  -- The SOS from the live trip: the safety reviewer acknowledges it and starts investigating.
  begin
    perform private.demo_as(v_safety, 'aal2');
    perform api.advance_incident(i.id, 'acknowledged', 'Called the passenger, she is safe and staying on the line.')
    from public.safety_incidents i where i.status = 'reported' order by i.created_at desc limit 1;
    perform api.advance_incident(i.id, 'investigating', 'Requested the driver''s statement and the route trail.')
    from public.safety_incidents i where i.status = 'acknowledged' order by i.created_at desc limit 1;
  exception when others then v_warn := v_warn || ('incident: ' || sqlerrm);
  end;

  -- Hide an abusive rating comment.
  begin
    perform private.demo_as(v_sa, 'aal2');
    perform api.hide_rating(r.id, 'Contains abusive language') from public.ratings r where r.comment like 'Driver was rude%' and r.hidden_at is null limit 1;
  exception when others then v_warn := v_warn || ('rating: ' || sqlerrm);
  end;

  -- A passenger suspended for abuse, and one who asked to delete their account (restorable from Privacy).
  begin
    perform private.demo_as(v_ops, 'aal2');
    perform api.set_passenger_status(private.demo_user('tahmid@yopmail.com'), 'suspended', 'Abusive behaviour towards drivers (3 reports)');
  exception when others then v_warn := v_warn || ('suspend: ' || sqlerrm);
  end;
  begin
    perform private.demo_as(private.demo_user('zubair@yopmail.com'));
    perform api.request_account_deletion('Moving abroad, no longer need the app');
  exception when others then v_warn := v_warn || ('deletion: ' || sqlerrm);
  end;

  -- A manual alert, saved views for the team.
  begin
    perform private.demo_as(v_ops, 'aal2');
    perform api.admin_create_alert('warning', 'Road works on Airport Road until Friday', 'Expect slower pickups in Uttara and Banani.', 'dashboard.view');
    perform api.save_view('trips', 'Cancelled this week', 'status=cancelled_by_passenger', true);
    perform api.save_view('drivers', 'Applications to review', 'tab=applications', true);
    perform private.demo_as(v_support, 'aal2');
    perform api.save_view('support', 'Open payment tickets', 'status=open&q=payment', false);
  exception when others then v_warn := v_warn || ('views: ' || sqlerrm);
  end;
  return jsonb_build_object('warnings', to_jsonb(v_warn));
end $$;

-- finish: dashboards and alerts computed from the new history.
create function private.demo_phase_finish() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.rollup_kpi('15m', now() - interval '15 days', now());
  perform private.rollup_kpi('day', now() - interval '15 days', now());
  perform private.rollup_online('15m', now() - interval '15 days', now());
  perform private.rollup_online('day', now() - interval '15 days', now());
  perform private.recompute_surge();
  perform private.evaluate_alerts();
  return '{}'::jsonb;
end $$;

-- ---------------------------------------------------------------------------
-- Entry point (service role only)
-- ---------------------------------------------------------------------------
create function api.demo_seed(p_phase text, p_batch integer default 0, p_arg jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_claims text := coalesce(current_setting('request.jwt.claims', true), '');
begin
  perform private.require_service_role();
  if p_phase = 'status' then
    return jsonb_build_object('done', coalesce((select jsonb_agg(phase || ':' || batch) from private.demo_seed_log), '[]'));
  end if;
  if p_phase <> 'plan' and exists (select 1 from private.demo_seed_log where phase = p_phase and batch = coalesce(p_batch, 0)) then
    return jsonb_build_object('skipped', true);
  end if;
  v_result := case p_phase
    when 'plan' then private.demo_phase_plan()
    when 'setup' then private.demo_phase_setup(p_arg)
    when 'rides' then private.demo_phase_rides(coalesce(p_batch, 0))
    when 'live' then private.demo_phase_live()
    when 'money' then private.demo_phase_money()
    when 'care' then private.demo_phase_care()
    when 'finish' then private.demo_phase_finish()
  end;
  if v_result is null then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"phase","message":"Unknown phase."}]}');
  end if;
  -- Deferred checks (ledger balance) must run here, as the owner: at commit they would run as the API role.
  set constraints all immediate;
  perform set_config('request.jwt.claims', v_claims, true);
  if p_phase <> 'plan' then
    insert into private.demo_seed_log (phase, batch, result) values (p_phase, coalesce(p_batch, 0), v_result);
  end if;
  return v_result;
end $$;

revoke execute on function api.demo_seed(text, integer, jsonb) from public, anon, authenticated;
grant execute on function api.demo_seed(text, integer, jsonb) to service_role;
revoke execute on function private.demo_as(uuid, text), private.demo_id(text, text), private.demo_user(text),
  private.demo_shift_ride(uuid, interval), private.demo_point_in(uuid), private.demo_only_driver(uuid, double precision, double precision),
  private.demo_people(), private.demo_phase_plan(), private.demo_phase_setup(jsonb), private.demo_phase_rides(integer),
  private.demo_phase_live(), private.demo_phase_money(), private.demo_phase_care(), private.demo_phase_finish()
from public, anon, authenticated;
revoke all on private.demo_seed_log, private.demo_seed_ids from public, anon, authenticated;
