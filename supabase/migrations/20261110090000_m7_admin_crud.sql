-- Staff can create, edit and remove operational records (passengers, drivers, documents, vehicles, ride requests, trips,
-- alerts, payments, refunds) without breaking the system's guarantees:
--   * "Create on behalf" runs the same validated function the passenger or driver would call, acting as that person for
--     this one call, and the admin is written to the audit log. Nothing skips the state machines, pricing or the ledger.
--   * "Delete" never erases history: accounts are deactivated (restorable, then anonymised), vehicles retired, documents
--     withdrawn, requests and trips cancelled, alerts resolved, money corrected by refunds, adjustments or reversals.
--   * Every change needs a permission and a reason, and is audited.

-- ---------------------------------------------------------------------------
-- Permissions (the super admin template receives new permissions automatically)
-- ---------------------------------------------------------------------------
with catalogue (sort_order, code, module, description, is_high_impact, templates) as (
  values
    (34,  'passengers.create', 'Passengers', 'Create passenger accounts', true, array['operations','support']),
    (35,  'passengers.delete', 'Passengers', 'Delete passenger accounts (deactivated now, anonymised after the grace period)', true, array['operations']),
    (45,  'drivers.create',    'Drivers',    'Create driver accounts', true, array['operations']),
    (46,  'drivers.delete',    'Drivers',    'Delete driver accounts (deactivated now, anonymised after the grace period)', true, array['operations']),
    (52,  'documents.manage',  'Documents',  'Upload documents for a driver, correct dates, withdraw documents', true, array['operations']),
    (105, 'trips.create',      'Trips',      'Book a ride for a passenger and assign a driver by hand', true, array['operations','support']),
    (185, 'alerts.manage',     'Alerts',     'Raise manual alerts and resolve alerts', false, array['operations','safety'])
),
inserted as (
  insert into public.permissions (code, module, description, is_high_impact, sort_order)
  select code, module, description, is_high_impact, sort_order from catalogue
  on conflict (code) do nothing
  returning code
)
insert into public.permission_template_items (template_id, permission_code)
select t.id, c.code
from catalogue c cross join lateral unnest(c.templates) tpl
join public.permission_templates t on t.code = tpl
where c.code in (select code from inserted);

alter table public.ride_requests add column booked_by uuid references public.profiles (id);
alter table public.driver_documents add column withdrawn_at timestamptz, add column withdrawn_by uuid references public.profiles (id),
  add column withdrawn_reason text check (length(withdrawn_reason) <= 1000);

-- ---------------------------------------------------------------------------
-- Acting as a passenger or driver for one call
-- ---------------------------------------------------------------------------
-- Sets the request identity to the given user (transaction-local) and returns the caller's identity to restore. A
-- failure aborts the whole statement, so the identity can never leak into later work.
create function private.act_as(p_user uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_prev text := coalesce(current_setting('request.jwt.claims', true), '');
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  return v_prev;
end $$;

create function private.restore_identity(p_prev text) returns void
language sql security definer set search_path = '' as $$
  select set_config('request.jwt.claims', p_prev, true);
$$;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
-- Step 2 of "new passenger / new driver": the server has created the sign-in identity, this gives it its role.
create function api.admin_setup_account(p_user_id uuid, p_role text, p_full_name text, p_phone text, p_home_zone_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.require_reason(p_reason);
  v_profile public.profiles;
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g'), '');
  v_driver uuid;
begin
  if p_role not in ('passenger', 'driver') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"role","message":"Choose passenger or driver."}]}');
  end if;
  perform private.require_permission(case when p_role = 'driver' then 'drivers.create' else 'passengers.create' end);
  if p_full_name is null or length(btrim(p_full_name)) not between 2 and 100 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"full_name","message":"Enter a name of 2 to 100 characters."}]}');
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{10,15}$' then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"phone","message":"Enter a phone number like +8801712345678."}]}');
  end if;
  if v_phone is not null and exists (select 1 from public.profiles where phone = v_phone and id <> p_user_id) then
    perform private.raise_error('ALREADY_EXISTS', '{"fields":[{"path":"phone","message":"Another account uses this phone number."}]}');
  end if;
  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if v_profile.role <> 'user' then
    perform private.raise_error('ALREADY_EXISTS', '{"fields":[{"path":"email","message":"This email already belongs to an account."}]}');
  end if;

  update public.profiles set full_name = btrim(p_full_name), phone = v_phone where id = p_user_id;
  perform private.promote_user_role(p_user_id, p_role::public.app_role);
  if p_role = 'driver' then
    if p_home_zone_id is not null and not exists (select 1 from public.service_zones where id = p_home_zone_id) then
      perform private.raise_error('NOT_FOUND', '{"field":"home_zone_id"}');
    end if;
    insert into public.driver_profiles (user_id, onboarding_status, home_zone_id)
    values (p_user_id, 'draft', p_home_zone_id)
    on conflict (user_id) do nothing
    returning id into v_driver;
  end if;
  perform private.log_admin_action(p_role || '.create', 'profile', p_user_id, null,
    jsonb_build_object('role', p_role, 'full_name', btrim(p_full_name), 'phone', private.mask_phone(v_phone)), v_reason);
  return jsonb_build_object('user_id', p_user_id, 'role', p_role, 'driver_id', v_driver);
end $$;

-- Name and phone for a passenger or driver (the email is the sign-in identity and is changed by the server).
create function api.admin_update_contact(p_profile_id uuid, p_full_name text, p_phone text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.require_reason(p_reason);
  v_profile public.profiles;
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g'), '');
begin
  select * into v_profile from public.profiles where id = p_profile_id and role in ('passenger', 'driver') for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  perform private.require_permission(case when v_profile.role = 'driver' then 'drivers.update' else 'passengers.update' end);
  if p_full_name is null or length(btrim(p_full_name)) not between 2 and 100 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"full_name","message":"Enter a name of 2 to 100 characters."}]}');
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{10,15}$' then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"phone","message":"Enter a phone number like +8801712345678."}]}');
  end if;
  if v_phone is not null and exists (select 1 from public.profiles where phone = v_phone and id <> p_profile_id) then
    perform private.raise_error('ALREADY_EXISTS', '{"fields":[{"path":"phone","message":"Another account uses this phone number."}]}');
  end if;
  -- An empty phone keeps the current one (staff only ever see it masked).
  v_phone := coalesce(v_phone, v_profile.phone);
  update public.profiles set full_name = btrim(p_full_name), phone = v_phone where id = p_profile_id;
  perform private.log_admin_action(v_profile.role || '.update_contact', 'profile', p_profile_id,
    jsonb_build_object('full_name', v_profile.full_name, 'phone', private.mask_phone(v_profile.phone)),
    jsonb_build_object('full_name', btrim(p_full_name), 'phone', private.mask_phone(v_phone)), v_reason);
  return jsonb_build_object('id', p_profile_id);
end $$;

-- Staff-initiated deletion: the same path as the person's own request (deactivated now, restorable during the grace
-- period, anonymised afterwards; money and safety records are kept).
create function api.admin_delete_account(p_user_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.require_reason(p_reason);
  v_profile public.profiles;
  v_driver uuid;
  v_balance numeric;
  v_due timestamptz := now() + make_interval(days => coalesce((private.setting('privacy.anonymise_after_days'))::int, 30));
begin
  select * into v_profile from public.profiles where id = p_user_id and role in ('passenger', 'driver') for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  perform private.require_permission(case when v_profile.role = 'driver' then 'drivers.delete' else 'passengers.delete' end);
  select id into v_driver from public.driver_profiles where user_id = p_user_id;
  if exists (select 1 from public.trips t where (t.passenger_id = p_user_id or t.driver_id = v_driver)
             and t.status in ('driver_assigned', 'driver_arriving', 'arrived', 'in_progress'))
     or exists (select 1 from public.ride_requests r where r.passenger_id = p_user_id and r.status in ('requested', 'searching', 'matched')) then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"the account has a ride in progress"}');
  end if;
  select coalesce(b.balance, 0) into v_balance from public.ledger_accounts a left join public.ledger_account_balances b on b.account_id = a.id
  where a.code = case when v_profile.role = 'driver' then 'driver:' || coalesce(v_driver::text, '-') || ':wallet' else 'passenger:' || p_user_id || ':wallet' end;
  if coalesce(v_balance, 0) < 0 then
    perform private.raise_error('ACCOUNT_HAS_DUES', jsonb_build_object('amount', -v_balance));
  end if;
  if v_driver is not null and exists (select 1 from public.payouts where driver_id = v_driver and status in ('pending', 'approved')) then
    perform private.raise_error('ACCOUNT_HAS_DUES', '{"reason":"a payout is still being processed"}');
  end if;

  insert into public.account_deletion_requests (user_id, role, reason, anonymise_after)
  values (p_user_id, v_profile.role, left('By staff: ' || v_reason, 500), v_due)
  on conflict (user_id) where status = 'pending' do nothing;
  update public.profiles set status = 'deactivated', deleted_at = now(), deleted_by = auth.uid(), delete_reason = left(v_reason, 500) where id = p_user_id;
  update public.driver_profiles set availability = 'offline' where user_id = p_user_id and availability = 'online';
  perform private.withdraw_driver_offers(v_driver, 'account deleted') where v_driver is not null;
  delete from public.push_devices where user_id = p_user_id;
  update auth.users set banned_until = 'infinity' where id = p_user_id;
  perform private.log_admin_action(v_profile.role || '.delete', 'profile', p_user_id, jsonb_build_object('status', v_profile.status),
    jsonb_build_object('status', 'deactivated', 'anonymise_after', v_due), v_reason);
  return jsonb_build_object('status', 'deactivated', 'anonymise_after', v_due);
end $$;

-- ---------------------------------------------------------------------------
-- Vehicles
-- ---------------------------------------------------------------------------
create function api.admin_save_vehicle(
  p_id uuid, p_driver_id uuid, p_category_id uuid, p_make text, p_model text, p_color text, p_registration_number text,
  p_year integer, p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.require_reason(p_reason);
  v_plate text := private.normalize_plate(p_registration_number);
  v_before public.vehicles;
  v_driver public.driver_profiles;
  v_id uuid := p_id;
begin
  perform private.require_permission('vehicles.manage');
  if not exists (select 1 from public.vehicle_categories where id = p_category_id and active) then
    perform private.raise_error('NOT_FOUND', '{"field":"category_id"}');
  end if;
  if p_year is null or p_year < 1990 or p_year > extract(year from now())::int + 1 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"year","message":"Enter a valid model year."}]}');
  end if;
  if length(coalesce(btrim(p_make), '')) not between 1 and 40 or length(coalesce(btrim(p_model), '')) not between 1 and 40
     or length(coalesce(btrim(p_color), '')) not between 1 and 30 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"make","message":"Enter the make, model and colour."}]}');
  end if;
  if v_plate is null or length(v_plate) < 3 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"registration_number","message":"Enter the registration number."}]}');
  end if;
  if exists (select 1 from public.vehicles where registration_number = v_plate and status <> 'inactive' and id is distinct from p_id) then
    perform private.raise_error('ALREADY_EXISTS', '{"fields":[{"path":"registration_number","message":"Another active vehicle has this registration number."}]}');
  end if;

  if p_id is null then
    select * into v_driver from public.driver_profiles where id = p_driver_id;
    if not found then
      perform private.raise_error('NOT_FOUND', '{"field":"driver_id"}');
    end if;
    if (select count(*) from public.vehicles where driver_id = v_driver.id and status <> 'inactive') >= 3 then
      perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"driver_id","message":"A driver can have up to 3 vehicles."}]}');
    end if;
    insert into public.vehicles (driver_id, category_id, make, model, color, registration_number, year)
    values (v_driver.id, p_category_id, btrim(p_make), btrim(p_model), btrim(p_color), v_plate, p_year)
    returning id into v_id;
    perform private.log_admin_action('vehicle.create', 'vehicle', v_id, null,
      jsonb_build_object('driver_id', v_driver.id, 'registration_number', v_plate), v_reason);
  else
    select * into v_before from public.vehicles where id = p_id for update;
    if not found or v_before.status = 'inactive' then
      perform private.raise_error('NOT_FOUND');
    end if;
    -- A vehicle in use keeps its category: a change would alter which requests it may serve mid-shift.
    if v_before.category_id <> p_category_id and exists (
      select 1 from public.driver_profiles where current_vehicle_id = p_id and availability <> 'offline') then
      perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"the driver is online with this vehicle"}');
    end if;
    update public.vehicles set category_id = p_category_id, make = btrim(p_make), model = btrim(p_model), color = btrim(p_color),
      registration_number = v_plate, year = p_year
    where id = p_id;
    perform private.log_admin_action('vehicle.update', 'vehicle', p_id,
      jsonb_build_object('category_id', v_before.category_id, 'make', v_before.make, 'model', v_before.model, 'color', v_before.color,
                         'registration_number', v_before.registration_number, 'year', v_before.year),
      jsonb_build_object('category_id', p_category_id, 'make', btrim(p_make), 'model', btrim(p_model), 'color', btrim(p_color),
                         'registration_number', v_plate, 'year', p_year), v_reason);
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- Retire (the "delete" for a vehicle): it leaves service, its history stays.
create function api.admin_retire_vehicle(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.require_reason(p_reason);
  v public.vehicles;
begin
  perform private.require_permission('vehicles.manage');
  select * into v from public.vehicles where id = p_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if v.status = 'inactive' then
    return jsonb_build_object('id', p_id, 'status', 'inactive');
  end if;
  if exists (select 1 from public.driver_profiles where current_vehicle_id = p_id and availability <> 'offline') then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"the driver is online with this vehicle; take them offline first"}');
  end if;
  update public.driver_profiles set current_vehicle_id = null where current_vehicle_id = p_id;
  update public.vehicles set status = 'inactive' where id = p_id;
  perform private.log_admin_action('vehicle.retire', 'vehicle', p_id, jsonb_build_object('status', v.status),
    jsonb_build_object('status', 'inactive'), v_reason);
  return jsonb_build_object('id', p_id, 'status', 'inactive');
end $$;

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------
-- Upload on a driver's behalf: reserve (step 1) and complete (step 2) through the driver's own functions, so the type,
-- size, path and supersede rules are identical. The file itself is uploaded and checked by the server between the two.
create function api.admin_create_document(p_driver_id uuid, p_document_type public.document_type, p_vehicle_id uuid,
  p_content_type text, p_size_bytes integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_prev text;
  v_result jsonb;
begin
  perform private.require_permission('documents.manage');
  select user_id into v_user from public.driver_profiles where id = p_driver_id;
  if not found then
    perform private.raise_error('NOT_FOUND', '{"field":"driver_id"}');
  end if;
  v_prev := private.act_as(v_user);
  v_result := api.driver_create_document(p_document_type, p_vehicle_id, p_content_type, p_size_bytes);
  perform private.restore_identity(v_prev);
  return v_result;
end $$;

create function api.admin_complete_document(p_document_id uuid, p_sha256 text, p_size_bytes integer, p_document_number text,
  p_issued_at date, p_expires_at date, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.require_reason(p_reason);
  v_user uuid;
  v_prev text;
begin
  perform private.require_permission('documents.manage');
  select d.user_id into v_user from public.driver_documents x join public.driver_profiles d on d.id = x.driver_id where x.id = p_document_id;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  v_prev := private.act_as(v_user);
  perform api.driver_complete_document(p_document_id, p_sha256, p_size_bytes, p_document_number, p_issued_at, p_expires_at);
  perform private.restore_identity(v_prev);
  perform private.log_admin_action('document.upload', 'driver_document', p_document_id, null,
    jsonb_build_object('issued_at', p_issued_at, 'expires_at', p_expires_at), v_reason);
  return jsonb_build_object('id', p_document_id);
end $$;

-- Correct the dates printed on a document (for example a typo at upload).
create function api.admin_update_document(p_id uuid, p_issued_at date, p_expires_at date, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.require_reason(p_reason);
  d public.driver_documents;
begin
  perform private.require_permission('documents.manage');
  select * into d from public.driver_documents where id = p_id for update;
  if not found or d.withdrawn_at is not null then
    perform private.raise_error('NOT_FOUND');
  end if;
  if p_issued_at is not null and p_issued_at > current_date then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"issued_at","message":"Issue date is in the future."}]}');
  end if;
  if p_issued_at is not null and p_expires_at is not null and p_expires_at <= p_issued_at then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"expires_at","message":"Expiry must be after the issue date."}]}');
  end if;
  update public.driver_documents set issued_at = p_issued_at, expires_at = p_expires_at, updated_at = now() where id = p_id;
  perform private.log_admin_action('document.update', 'driver_document', p_id,
    jsonb_build_object('issued_at', d.issued_at, 'expires_at', d.expires_at),
    jsonb_build_object('issued_at', p_issued_at, 'expires_at', p_expires_at), v_reason);
  return jsonb_build_object('id', p_id);
end $$;

-- Withdraw (the "delete" for a document): it no longer counts for the driver; the file and the review trail stay.
create function api.admin_withdraw_document(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.require_reason(p_reason);
  d public.driver_documents;
begin
  perform private.require_permission('documents.manage');
  select * into d from public.driver_documents where id = p_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if d.withdrawn_at is not null then
    return jsonb_build_object('id', p_id, 'withdrawn', true);
  end if;
  update public.driver_documents set withdrawn_at = now(), withdrawn_by = auth.uid(), withdrawn_reason = v_reason,
    superseded_at = coalesce(superseded_at, now()), updated_at = now()
  where id = p_id;
  perform private.log_admin_action('document.withdraw', 'driver_document', p_id,
    jsonb_build_object('review_status', d.review_status), jsonb_build_object('withdrawn', true), v_reason);
  return jsonb_build_object('id', p_id, 'withdrawn', true);
end $$;

-- ---------------------------------------------------------------------------
-- Ride requests and trips
-- ---------------------------------------------------------------------------
-- Book a ride for a passenger (phone booking): the quote and request are made exactly as the passenger's app would.
create function api.admin_book_ride(
  p_passenger_id uuid, p_category_id uuid,
  p_pickup_lat double precision, p_pickup_lng double precision, p_pickup_label text,
  p_destination_lat double precision, p_destination_lng double precision, p_destination_label text,
  p_distance_m integer, p_duration_s integer, p_payment_method public.payment_method, p_pickup_note text, p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.require_reason(p_reason);
  v_prev text;
  v_quote jsonb;
  v_ride jsonb;
  v_request uuid;
begin
  perform private.require_permission('trips.create');
  if not exists (select 1 from public.profiles where id = p_passenger_id and role = 'passenger' and status = 'active' and deleted_at is null) then
    perform private.raise_error('NOT_FOUND', '{"field":"passenger_id"}');
  end if;
  v_prev := private.act_as(p_passenger_id);
  v_quote := api.create_quote(p_category_id, p_pickup_lat, p_pickup_lng, p_pickup_label, p_destination_lat, p_destination_lng,
    p_destination_label, p_distance_m, p_duration_s);
  v_ride := api.create_ride_request((v_quote ->> 'id')::uuid, p_payment_method, p_pickup_note);
  perform private.restore_identity(v_prev);
  v_request := (v_ride ->> 'id')::uuid;
  update public.ride_requests set booked_by = auth.uid() where id = v_request;
  perform private.log_admin_action('request.book', 'ride_request', v_request, null,
    jsonb_build_object('passenger_id', p_passenger_id, 'estimated_fare', v_quote -> 'estimated_fare'), v_reason);
  return jsonb_build_object('id', v_request, 'estimated_fare', v_quote -> 'estimated_fare', 'status', v_ride ->> 'status');
end $$;

-- Change the pickup note while the request is still looking for a driver.
create function api.admin_update_request(p_request_id uuid, p_pickup_note text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.require_reason(p_reason);
  r public.ride_requests;
begin
  perform private.require_permission('dispatch.intervene');
  select * into r from public.ride_requests where id = p_request_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if r.status not in ('requested', 'searching') then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', r.status));
  end if;
  if length(coalesce(p_pickup_note, '')) > 200 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"pickup_note","message":"Keep the note under 200 characters."}]}');
  end if;
  update public.ride_requests set pickup_note = nullif(btrim(p_pickup_note), '') where id = r.id;
  perform private.log_admin_action('request.update', 'ride_request', r.id, jsonb_build_object('pickup_note', r.pickup_note),
    jsonb_build_object('pickup_note', nullif(btrim(p_pickup_note), '')), v_reason);
  return api.get_ride_request(r.id);
end $$;

-- Cancel (the "delete" for a request): searching requests close as cancelled by admin; matched ones cancel their trip.
create function api.admin_cancel_request(p_request_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.require_reason(p_reason);
  r public.ride_requests;
  v_trip uuid;
begin
  perform private.require_permission('trips.cancel');
  select * into r from public.ride_requests where id = p_request_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if r.status = 'matched' then
    select id into v_trip from public.trips where request_id = r.id;
    perform api.admin_cancel_trip(v_trip, v_reason);
    return api.get_ride_request(r.id);
  end if;
  if r.status not in ('requested', 'searching') then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', r.status));
  end if;
  perform private.withdraw_pending_offers(r.id, 'admin cancelled');
  update public.ride_requests set status = 'cancelled_by_admin', closed_at = now(), cancel_reason = left(v_reason, 300) where id = r.id;
  perform private.log_request_event(r.id, r.status, 'cancelled_by_admin', 'admin', v_reason);
  perform private.broadcast('ride:' || r.id, 'status_changed', jsonb_build_object('request_id', r.id, 'status', 'cancelled_by_admin'));
  perform private.notify_ops('request', r.id, 'cancelled_by_admin');
  perform private.log_admin_action('request.cancel', 'ride_request', r.id, jsonb_build_object('status', r.status),
    jsonb_build_object('status', 'cancelled_by_admin'), v_reason);
  return api.get_ride_request(r.id);
end $$;

-- Create a trip by hand: offer the request to one chosen driver and accept it as that driver. The driver must be
-- online, approved and free with an active vehicle of the requested type, exactly as for automatic dispatch.
create function api.admin_assign_driver(p_request_id uuid, p_driver_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.require_reason(p_reason);
  r public.ride_requests;
  d public.driver_profiles;
  v_offer uuid;
  v_existing public.dispatch_offers;
  v_dist integer;
  v_prev text;
  v_trip jsonb;
begin
  perform private.require_permission('trips.create');
  perform private.require_permission('dispatch.intervene');
  select * into r from public.ride_requests where id = p_request_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if r.status <> 'searching' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', r.status));
  end if;
  select * into d from public.driver_profiles where id = p_driver_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND', '{"field":"driver_id"}');
  end if;
  if d.onboarding_status <> 'approved' or d.availability <> 'online'
     or not exists (select 1 from public.profiles where id = d.user_id and status = 'active')
     or not exists (select 1 from public.vehicles where id = d.current_vehicle_id and status = 'active' and category_id = r.category_id) then
    perform private.raise_error('VALIDATION_FAILED',
      '{"fields":[{"path":"driver_id","message":"The driver must be approved, online and free, with an active vehicle of this type."}]}');
  end if;
  -- One offer per driver per request: automatic dispatch may already have offered it to this driver.
  select * into v_existing from public.dispatch_offers where request_id = r.id and driver_id = d.id;
  if found and v_existing.response <> 'pending' then
    perform private.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array(jsonb_build_object('path', 'driver_id',
      'message', 'This driver already ' || case v_existing.response when 'rejected' then 'declined' else 'missed' end || ' this request. Choose another driver.'))));
  end if;
  if found then
    update public.dispatch_offers set expires_at = greatest(expires_at, now() + interval '1 minute') where id = v_existing.id;
    v_offer := v_existing.id;
  else
  perform private.withdraw_pending_offers(r.id, 'admin assigned a driver');
  perform private.withdraw_driver_offers(d.id, 'admin assigned another ride');
  select coalesce(round(extensions.st_distance(l.location, r.pickup_point))::int, 0) into v_dist
  from public.driver_live_locations l where l.driver_id = d.id;
  v_dist := coalesce(v_dist, 0);
  insert into public.dispatch_offers (request_id, driver_id, round, rank, pickup_distance_m, pickup_eta_s, expires_at)
  values (r.id, d.id, r.dispatch_round, (select coalesce(max(rank), 0) + 1 from public.dispatch_offers where request_id = r.id),
    v_dist, round(v_dist / (coalesce((private.setting('dispatch.avg_speed_kmh'))::numeric, 25) / 3.6))::int, now() + interval '1 minute')
  returning id into v_offer;
  end if;

  v_prev := private.act_as(d.user_id);
  v_trip := api.accept_offer(v_offer);
  perform private.restore_identity(v_prev);
  perform private.log_admin_action('trip.assign', 'trip', (v_trip ->> 'id')::uuid, null,
    jsonb_build_object('request_id', r.id, 'driver_id', d.id), v_reason);
  return api.get_trip((v_trip ->> 'id')::uuid);
end $$;

-- ---------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------
create function api.admin_create_alert(p_severity text, p_title text, p_detail text, p_audience text default 'dashboard.view')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform private.require_permission('alerts.manage');
  if p_severity not in ('info', 'warning', 'critical') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"severity","message":"Choose a severity."}]}');
  end if;
  if p_title is null or length(btrim(p_title)) not between 5 and 200 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"title","message":"Write a title of 5 to 200 characters."}]}');
  end if;
  if length(coalesce(p_detail, '')) > 2000 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"detail","message":"Keep the details under 2000 characters."}]}');
  end if;
  if not exists (select 1 from public.permissions where code = coalesce(p_audience, 'dashboard.view')) then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"audience","message":"Choose who should see the alert."}]}');
  end if;
  insert into public.ops_alerts (alert_key, severity, title, detail, audience)
  values ('manual:' || gen_random_uuid(), p_severity, btrim(p_title),
    jsonb_build_object('manual', true, 'note', nullif(btrim(p_detail), ''), 'raised_by', auth.uid()), coalesce(p_audience, 'dashboard.view'))
  returning id into v_id;
  perform private.log_admin_action('alert.create', 'ops_alert', v_id, null, jsonb_build_object('severity', p_severity, 'title', btrim(p_title)), null);
  return jsonb_build_object('id', v_id);
end $$;

-- Resolve (the "delete" for an alert). An automatic alert whose condition still holds will be raised again.
create function api.resolve_alert(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := private.require_reason(p_note);
  a public.ops_alerts;
begin
  perform private.require_permission('alerts.manage');
  select * into a from public.ops_alerts where id = p_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if a.status = 'resolved' then
    return;
  end if;
  update public.ops_alerts set status = 'resolved', resolved_at = now(),
    acknowledged_by = coalesce(acknowledged_by, auth.uid()), acknowledged_at = coalesce(acknowledged_at, now()), ack_note = coalesce(ack_note, v_note)
  where id = p_id;
  perform private.log_admin_action('alert.resolve', 'ops_alert', p_id, jsonb_build_object('status', 'open'), jsonb_build_object('status', 'resolved'), v_note);
end $$;

-- ---------------------------------------------------------------------------
-- Payments and refunds
-- ---------------------------------------------------------------------------
-- Record that the driver collected the cash (when the driver could not confirm it in the app).
create function api.admin_confirm_cash(p_trip_id uuid, p_amount numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.require_reason(p_reason);
  v_user uuid;
  v_prev text;
  v_result jsonb;
begin
  perform private.require_permission('payments.reconcile');
  select d.user_id into v_user from public.trips t join public.driver_profiles d on d.id = t.driver_id where t.id = p_trip_id;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  v_prev := private.act_as(v_user);
  v_result := api.confirm_cash_collected(p_trip_id, p_amount);
  perform private.restore_identity(v_prev);
  perform private.log_admin_action('payment.confirm_cash', 'trip', p_trip_id, null, jsonb_build_object('amount', p_amount), v_reason);
  return v_result;
end $$;

-- Correct the amount or reason of a refund or adjustment you requested, while it still waits for approval.
create function api.update_refund_request(p_id uuid, p_amount numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.require_reason(p_reason);
  x public.refunds_adjustments;
  v_paid numeric;
begin
  select * into x from public.refunds_adjustments where id = p_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  perform private.require_permission(case when x.kind = 'refund' then 'refunds.request' else 'ledger.adjust_request' end);
  if x.requested_by <> auth.uid() then
    perform private.raise_error('FORBIDDEN', '{"reason":"only the person who made the request can change it"}');
  end if;
  if x.status <> 'requested' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', x.status));
  end if;
  if x.kind = 'reversal' and p_amount <> x.amount then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"amount","message":"A reversal is always for the full amount."}]}');
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"amount","message":"Enter an amount above zero."}]}');
  end if;
  if x.kind = 'refund' then
    select p.amount - coalesce((select sum(r.amount) from public.refunds_adjustments r where r.payment_id = p.id and r.kind = 'refund'
                                and r.status in ('requested', 'awaiting_second_approval', 'processed') and r.id <> x.id), 0)
      into v_paid from public.payments p where p.id = x.payment_id;
    if p_amount > v_paid then
      perform private.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array(jsonb_build_object('path', 'amount',
        'message', 'The refund cannot exceed what is left to refund (' || v_paid || ').'))));
    end if;
  end if;
  update public.refunds_adjustments set amount = p_amount, reason = v_reason where id = p_id;
  perform private.log_admin_action(x.kind || '.update', 'refund_adjustment', p_id, jsonb_build_object('amount', x.amount, 'reason', x.reason),
    jsonb_build_object('amount', p_amount, 'reason', v_reason), v_reason);
  return jsonb_build_object('id', p_id, 'amount', p_amount);
end $$;

-- ---------------------------------------------------------------------------
-- Pickers for the forms (small, permission-checked lists)
-- ---------------------------------------------------------------------------
create function api.admin_pick_people(p_role text, p_query text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  q text := '%' || replace(replace(btrim(coalesce(p_query, '')), '%', ''), '_', '') || '%';
begin
  if p_role = 'passenger' then
    perform private.require_permission('passengers.view');
    return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'phone', private.mask_phone(p.phone)) order by p.full_name), '[]')
      from (select * from public.profiles where role = 'passenger' and status = 'active' and deleted_at is null
              and (full_name ilike q or email::text ilike q or phone like q) order by full_name limit 20) p);
  elsif p_role = 'driver' then
    perform private.require_permission('drivers.view');
    return (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', p.full_name, 'phone', private.mask_phone(p.phone),
        'availability', d.availability, 'status', d.onboarding_status,
        'vehicle', (select v.registration_number || ' · ' || c.name from public.vehicles v join public.vehicle_categories c on c.id = v.category_id where v.id = d.current_vehicle_id),
        'category_id', (select v.category_id from public.vehicles v where v.id = d.current_vehicle_id)) order by p.full_name), '[]')
      from (select * from public.driver_profiles) d join public.profiles p on p.id = d.user_id
      where p.deleted_at is null and (p.full_name ilike q or p.email::text ilike q or p.phone like q)
      limit 20);
  end if;
  perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"role","message":"Unknown list."}]}');
end $$;

-- ---------------------------------------------------------------------------
-- Fix: a vehicle whose driver has no current vehicle reported is_current = null (the vehicle page failed to load).
-- ---------------------------------------------------------------------------
create or replace function private.vehicle_json(p_vehicle_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', v.id, 'registration_number', v.registration_number, 'make', v.make, 'model', v.model, 'color', v.color,
    'year', v.year, 'status', v.status, 'suspended_reason', v.suspended_reason, 'verified_at', v.verified_at,
    'created_at', v.created_at, 'version', v.version,
    'category', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name),
    'driver', jsonb_build_object('id', d.id, 'full_name', p.full_name, 'onboarding_status', d.onboarding_status),
    'is_current', coalesce(d.current_vehicle_id = v.id, false)
  )
  from public.vehicles v
  join public.vehicle_categories c on c.id = v.category_id
  join public.driver_profiles d on d.id = v.driver_id
  join public.profiles p on p.id = d.user_id
  where v.id = p_vehicle_id;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function private.act_as(uuid), private.restore_identity(text) from public, anon, authenticated;
revoke execute on all functions in schema api from public, anon;
grant execute on function
  api.admin_setup_account(uuid, text, text, text, uuid, text), api.admin_update_contact(uuid, text, text, text),
  api.admin_delete_account(uuid, text), api.admin_save_vehicle(uuid, uuid, uuid, text, text, text, text, integer, text),
  api.admin_retire_vehicle(uuid, text), api.admin_create_document(uuid, public.document_type, uuid, text, integer),
  api.admin_complete_document(uuid, text, integer, text, date, date, text), api.admin_update_document(uuid, date, date, text),
  api.admin_withdraw_document(uuid, text),
  api.admin_book_ride(uuid, uuid, double precision, double precision, text, double precision, double precision, text, integer, integer, public.payment_method, text, text),
  api.admin_update_request(uuid, text, text), api.admin_cancel_request(uuid, text), api.admin_assign_driver(uuid, uuid, text),
  api.admin_create_alert(text, text, text, text), api.resolve_alert(uuid, text), api.admin_confirm_cash(uuid, numeric, text),
  api.update_refund_request(uuid, numeric, text), api.admin_pick_people(text, text)
to authenticated;
