-- M1 supply onboarding: business rules as RPCs (one transaction each).
-- Spec: docs/spec/04-business-logic.md §1–2, docs/spec/05-api.md §2.1–2.4, §3.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create function private.vehicle_document_types() returns public.document_type[]
language sql immutable set search_path = '' as $$
  select array['vehicle_registration', 'fitness_certificate', 'tax_token', 'insurance', 'route_permit']::public.document_type[];
$$;

create function private.required_documents(p_scope text) returns public.document_type[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array(select jsonb_array_elements_text(private.setting('onboarding.required_documents') -> p_scope)
                        )::public.document_type[], '{}');
$$;

-- The current (latest uploaded, not superseded) document per type.
create function private.current_documents(p_driver_id uuid, p_vehicle_id uuid)
returns setof public.driver_documents
language sql stable security definer set search_path = '' as $$
  select d.* from public.driver_documents d
  where d.driver_id = p_driver_id
    and d.vehicle_id is not distinct from p_vehicle_id
    and d.uploaded_at is not null
    and d.superseded_at is null;
$$;

-- Readiness of required documents for a driver (p_vehicle_id null) or a vehicle.
-- state per type: missing | pending | approved | rejected | expired
create function private.document_checklist(p_driver_id uuid, p_vehicle_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'document_type', t,
    'document_id', d.id,
    'state', case
      when d.id is null then 'missing'
      when d.review_status = 'approved' and d.expires_at is not null and d.expires_at < current_date then 'expired'
      else d.review_status::text end,
    'expires_at', d.expires_at,
    'rejection_reason', d.rejection_reason
  ) order by t), '[]')
  from unnest(private.required_documents(case when p_vehicle_id is null then 'driver' else 'vehicle' end)) t
  left join lateral (
    select * from private.current_documents(p_driver_id, p_vehicle_id) c where c.document_type = t
  ) d on true;
$$;

create function private.checklist_complete(p_checklist jsonb, p_states text[]) returns boolean
language sql immutable set search_path = '' as $$
  select not exists (select 1 from jsonb_array_elements(p_checklist) e where (e ->> 'state') <> all (p_states));
$$;

create function private.log_driver_event(
  p_driver_id uuid, p_kind text, p_old text, p_new text, p_reason text, p_actor public.actor_type,
  p_location extensions.geography default null
) returns void
language sql security definer set search_path = '' as $$
  insert into public.driver_status_events (driver_id, kind, old_status, new_status, reason, location, actor_id, actor_type)
  values (p_driver_id, p_kind, p_old, p_new, p_reason, p_location, auth.uid(), p_actor);
$$;

create function private.point(p_lat double precision, p_lng double precision) returns extensions.geography
language plpgsql immutable set search_path = '' as $$
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"location","message":"Invalid coordinates."}]}');
  end if;
  return extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
end $$;

create function private.zone_at(p_point extensions.geography) returns public.service_zones
language sql stable security definer set search_path = '' as $$
  select z.* from public.service_zones z
  where z.active and extensions.st_covers(z.boundary, p_point)
  order by z.area_km2 limit 1;
$$;

create function private.normalize_plate(p_value text) returns text
language sql immutable set search_path = '' as $$
  select upper(regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g'));
$$;

-- ---------------------------------------------------------------------------
-- Profiles: own profile (any role), onboarding promotions
-- ---------------------------------------------------------------------------
create function api.get_my_profile() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  select jsonb_build_object(
    'id', p.id, 'role', p.role, 'status', p.status, 'full_name', p.full_name, 'email', p.email,
    'phone', p.phone, 'preferred_language', p.preferred_language, 'version', p.version,
    'driver', (select jsonb_build_object('id', d.id, 'onboarding_status', d.onboarding_status, 'availability', d.availability)
               from public.driver_profiles d where d.user_id = p.id)
  ) into v
  from public.profiles p where p.id = auth.uid() and p.deleted_at is null;
  if v is null then
    perform private.raise_error('NOT_FOUND');
  end if;
  return v;
end $$;

create function api.onboard_passenger(p_full_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_role('user');
  if p_full_name is null or length(btrim(p_full_name)) not between 1 and 120 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"full_name","message":"Enter your name."}]}');
  end if;
  update public.profiles set full_name = btrim(p_full_name) where id = auth.uid();
  perform private.promote_user_role(auth.uid(), 'passenger');
  return api.get_my_profile();
end $$;

create function api.onboard_driver(p_full_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver_id uuid;
begin
  perform private.require_role('user');
  if p_full_name is null or length(btrim(p_full_name)) not between 1 and 120 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"full_name","message":"Enter your name."}]}');
  end if;
  update public.profiles set full_name = btrim(p_full_name) where id = auth.uid();
  perform private.promote_user_role(auth.uid(), 'driver');
  insert into public.driver_profiles (user_id) values (auth.uid()) returning id into v_driver_id;
  perform private.log_driver_event(v_driver_id, 'onboarding', null, 'draft', 'Application started', 'driver');
  return api.get_my_profile();
end $$;

-- ---------------------------------------------------------------------------
-- Reference data for apps
-- ---------------------------------------------------------------------------
create function api.check_zone(p_lat double precision, p_lng double precision) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_zone public.service_zones;
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  v_zone := private.zone_at(private.point(p_lat, p_lng));
  return jsonb_build_object(
    'in_service_area', v_zone.id is not null,
    'zone', case when v_zone.id is null then null else jsonb_build_object('id', v_zone.id, 'name', v_zone.name) end
  );
end $$;

create function api.list_active_categories(p_lat double precision default null, p_lng double precision default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  if p_lat is not null and private.zone_at(private.point(p_lat, p_lng)) is null then
    perform private.raise_error('OUT_OF_SERVICE_AREA');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'code', c.code, 'name', c.name, 'name_bn', c.name_bn, 'description', c.description,
      'passenger_capacity', c.passenger_capacity, 'icon', c.icon
    ) order by c.sort_order, c.name)
    from public.vehicle_categories c where c.active
  ), '[]');
end $$;

-- ---------------------------------------------------------------------------
-- Driver self-service onboarding
-- ---------------------------------------------------------------------------
create function private.my_driver() returns public.driver_profiles
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.driver_profiles;
begin
  perform private.require_role('driver');
  select * into v from public.driver_profiles where user_id = auth.uid();
  if not found then
    perform private.raise_error('NOT_FOUND', '{"reason":"driver profile missing"}');
  end if;
  return v;
end $$;

create function private.driver_state_json(p_driver_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'driver_id', d.id,
    'onboarding_status', d.onboarding_status,
    'availability', d.availability,
    'rejected_reason', d.rejected_reason,
    'suspended_reason', d.suspended_reason,
    'licence_number_masked', d.licence_number_masked,
    'licence_expiry', d.licence_expiry,
    'current_vehicle_id', d.current_vehicle_id,
    'submitted_at', d.submitted_at,
    'approved_at', d.approved_at,
    'documents', private.document_checklist(d.id, null),
    'vehicles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'category', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name),
        'make', v.make, 'model', v.model, 'color', v.color, 'registration_number', v.registration_number,
        'year', v.year, 'status', v.status, 'suspended_reason', v.suspended_reason, 'version', v.version,
        'documents', private.document_checklist(d.id, v.id)
      ) order by v.created_at)
      from public.vehicles v join public.vehicle_categories c on c.id = v.category_id
      where v.driver_id = d.id and v.status <> 'inactive'
    ), '[]')
  )
  from public.driver_profiles d where d.id = p_driver_id;
$$;

create function api.driver_onboarding_state() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_driver public.driver_profiles := private.my_driver();
  v_state jsonb := private.driver_state_json(v_driver.id);
  v_missing text[];
begin
  select coalesce(array_agg(e ->> 'document_type'), '{}') into v_missing
  from jsonb_array_elements(v_state -> 'documents') e
  where e ->> 'state' in ('missing', 'rejected', 'expired');

  return v_state || jsonb_build_object(
    'missing_documents', to_jsonb(v_missing),
    'has_vehicle', jsonb_array_length(v_state -> 'vehicles') > 0,
    'can_submit', v_driver.onboarding_status in ('draft', 'rejected')
                  and cardinality(v_missing) = 0
                  and jsonb_array_length(v_state -> 'vehicles') > 0
  );
end $$;

create function api.driver_update_details(p_licence_number text, p_licence_expiry date, p_home_zone_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver public.driver_profiles := private.my_driver();
  v_number text := upper(btrim(p_licence_number));
begin
  if v_driver.onboarding_status not in ('draft', 'rejected') then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', v_driver.onboarding_status));
  end if;
  if v_number is not null and v_number !~ '^[A-Z0-9-]{5,30}$' then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"licence_number","message":"Enter the number as printed on the licence."}]}');
  end if;
  if p_licence_expiry is not null and p_licence_expiry <= current_date then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"licence_expiry","message":"The licence has expired."}]}');
  end if;
  if p_home_zone_id is not null and not exists (select 1 from public.service_zones where id = p_home_zone_id and active) then
    perform private.raise_error('NOT_FOUND', '{"field":"home_zone_id"}');
  end if;

  update public.driver_profiles set
    licence_number_enc = coalesce(private.encrypt_pii(v_number), licence_number_enc),
    licence_number_masked = coalesce(private.mask_tail(v_number, 3), licence_number_masked),
    licence_expiry = coalesce(p_licence_expiry, licence_expiry),
    home_zone_id = coalesce(p_home_zone_id, home_zone_id)
  where id = v_driver.id;
  return api.driver_onboarding_state();
end $$;

create function api.driver_add_vehicle(
  p_category_id uuid, p_make text, p_model text, p_color text, p_registration_number text, p_year integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver public.driver_profiles := private.my_driver();
  v_plate text := private.normalize_plate(p_registration_number);
  v_id uuid;
begin
  if v_driver.onboarding_status = 'suspended' then
    perform private.raise_error('ACCOUNT_SUSPENDED');
  end if;
  if (select count(*) from public.vehicles where driver_id = v_driver.id and status <> 'inactive') >= 3 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"vehicle","message":"A driver can register up to 3 vehicles."}]}');
  end if;
  if not exists (select 1 from public.vehicle_categories where id = p_category_id and active) then
    perform private.raise_error('NOT_FOUND', '{"field":"category_id"}');
  end if;
  if p_year is null or p_year < 1990 or p_year > extract(year from now())::int + 1 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"year","message":"Enter a valid model year."}]}');
  end if;
  if exists (select 1 from public.vehicles where registration_number = v_plate and status <> 'inactive') then
    perform private.raise_error('ALREADY_EXISTS', '{"field":"registration_number"}');
  end if;

  insert into public.vehicles (driver_id, category_id, make, model, color, registration_number, year)
  values (v_driver.id, p_category_id, btrim(p_make), btrim(p_model), btrim(p_color), v_plate, p_year)
  returning id into v_id;
  return jsonb_build_object('vehicle_id', v_id, 'state', api.driver_onboarding_state());
end $$;

-- Editing a verified vehicle's details sends it back to review (spec 05 §2.4).
create function api.driver_update_vehicle(
  p_vehicle_id uuid, p_category_id uuid, p_make text, p_model text, p_color text,
  p_registration_number text, p_year integer, p_expected_version integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver public.driver_profiles := private.my_driver();
  v_vehicle public.vehicles;
  v_plate text := private.normalize_plate(p_registration_number);
begin
  select * into v_vehicle from public.vehicles where id = p_vehicle_id and driver_id = v_driver.id for update;
  if not found or v_vehicle.status = 'inactive' then
    perform private.raise_error('NOT_FOUND');
  end if;
  if v_vehicle.version <> p_expected_version then
    perform private.raise_error('STALE_VERSION');
  end if;
  if v_vehicle.status = 'suspended' then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"status":"suspended"}');
  end if;
  if v_driver.current_vehicle_id = p_vehicle_id and v_driver.availability <> 'offline' then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"go offline first"}');
  end if;
  if not exists (select 1 from public.vehicle_categories where id = p_category_id and active) then
    perform private.raise_error('NOT_FOUND', '{"field":"category_id"}');
  end if;
  if exists (select 1 from public.vehicles where registration_number = v_plate and status <> 'inactive' and id <> p_vehicle_id) then
    perform private.raise_error('ALREADY_EXISTS', '{"field":"registration_number"}');
  end if;

  update public.vehicles set
    category_id = p_category_id, make = btrim(p_make), model = btrim(p_model), color = btrim(p_color),
    registration_number = v_plate, year = p_year,
    status = 'pending', verified_at = null, verified_by = null
  where id = p_vehicle_id;
  return api.driver_onboarding_state();
end $$;

-- Step 1 of an upload: reserve a document record and its fixed storage path.
create function api.driver_create_document(
  p_document_type public.document_type, p_vehicle_id uuid, p_content_type text, p_size_bytes integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver public.driver_profiles := private.my_driver();
  v_is_vehicle_doc boolean := p_document_type = any (private.vehicle_document_types());
  v_id uuid := gen_random_uuid();
  v_ext text;
  v_path text;
begin
  if v_driver.onboarding_status = 'suspended' and v_driver.suspended_reason <> 'DOCUMENT_EXPIRED' then
    perform private.raise_error('ACCOUNT_SUSPENDED');
  end if;
  v_ext := case p_content_type
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'application/pdf' then 'pdf' end;
  if v_ext is null then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"content_type","message":"Upload a JPEG, PNG, WebP or PDF."}]}');
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > (private.setting('documents.max_upload_bytes'))::int then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"size","message":"The file must be 10 MB or smaller."}]}');
  end if;
  if v_is_vehicle_doc and not exists (
    select 1 from public.vehicles where id = p_vehicle_id and driver_id = v_driver.id and status <> 'inactive'
  ) then
    perform private.raise_error('NOT_FOUND', '{"field":"vehicle_id"}');
  end if;
  if not v_is_vehicle_doc and p_vehicle_id is not null then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"vehicle_id","message":"This document belongs to the driver, not a vehicle."}]}');
  end if;
  -- Abuse guard: reserved-but-never-uploaded records.
  if (select count(*) from public.driver_documents
      where driver_id = v_driver.id and uploaded_at is null and created_at > now() - interval '1 hour') >= 20 then
    perform private.raise_error('RATE_LIMITED');
  end if;

  v_path := format('drivers/%s/%s.%s', v_driver.id, v_id, v_ext);
  insert into public.driver_documents (id, driver_id, vehicle_id, document_type, storage_path, content_type, size_bytes)
  values (v_id, v_driver.id, case when v_is_vehicle_doc then p_vehicle_id end, p_document_type, v_path, p_content_type, p_size_bytes);

  return jsonb_build_object('document_id', v_id, 'storage_path', v_path);
end $$;

-- Step 2: the server verified the stored object (type by magic bytes, hash).
create function api.driver_complete_document(
  p_document_id uuid, p_sha256 text, p_size_bytes integer, p_document_number text, p_issued_at date, p_expires_at date
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver public.driver_profiles := private.my_driver();
  v_doc public.driver_documents;
  v_number text := upper(btrim(p_document_number));
begin
  select * into v_doc from public.driver_documents where id = p_document_id and driver_id = v_driver.id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if v_doc.uploaded_at is not null then
    return api.driver_onboarding_state(); -- idempotent
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'driver-documents' and name = v_doc.storage_path) then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"file","message":"Upload the file before completing."}]}');
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"sha256","message":"Invalid checksum."}]}');
  end if;
  if p_expires_at is not null and p_expires_at <= current_date then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"expires_at","message":"This document has expired."}]}');
  end if;
  if p_issued_at is not null and p_issued_at > current_date then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"issued_at","message":"Issue date is in the future."}]}');
  end if;
  if v_number is not null and length(v_number) not between 3 and 40 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"document_number","message":"Enter the number as printed."}]}');
  end if;

  -- The new upload supersedes the previous current document of the same type.
  update public.driver_documents set superseded_at = now()
  where driver_id = v_driver.id and vehicle_id is not distinct from v_doc.vehicle_id
    and document_type = v_doc.document_type and uploaded_at is not null and superseded_at is null;

  update public.driver_documents set
    uploaded_at = now(),
    file_sha256 = p_sha256,
    size_bytes = p_size_bytes,
    document_number_masked = private.mask_tail(v_number, 3),
    issued_at = p_issued_at,
    expires_at = p_expires_at,
    supersedes_id = (select id from public.driver_documents
                     where driver_id = v_driver.id and vehicle_id is not distinct from v_doc.vehicle_id
                       and document_type = v_doc.document_type and superseded_at is not null and id <> v_doc.id
                     order by superseded_at desc limit 1)
  where id = v_doc.id;

  -- The licence number is kept encrypted on the driver profile, masked elsewhere.
  if v_doc.document_type = 'driving_licence' and v_number is not null then
    update public.driver_profiles set
      licence_number_enc = private.encrypt_pii(v_number),
      licence_number_masked = private.mask_tail(v_number, 3),
      licence_expiry = coalesce(p_expires_at, licence_expiry)
    where id = v_driver.id;
  end if;

  return api.driver_onboarding_state();
end $$;

create function api.driver_submit_application() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver public.driver_profiles := private.my_driver();
  v_state jsonb;
begin
  select * into v_driver from public.driver_profiles where id = v_driver.id for update;
  v_state := api.driver_onboarding_state();
  if v_driver.onboarding_status not in ('draft', 'rejected') then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', v_driver.onboarding_status));
  end if;
  if not (v_state ->> 'can_submit')::boolean then
    perform private.raise_error('VALIDATION_FAILED', jsonb_build_object(
      'fields', jsonb_build_array(jsonb_build_object('path', 'documents', 'message', 'Upload every required document and add a vehicle.')),
      'missing_documents', v_state -> 'missing_documents',
      'has_vehicle', v_state -> 'has_vehicle'));
  end if;

  update public.driver_profiles
  set onboarding_status = 'submitted', submitted_at = now(), rejected_reason = null
  where id = v_driver.id;
  perform private.log_driver_event(v_driver.id, 'onboarding', v_driver.onboarding_status::text, 'submitted', null, 'driver');
  return api.driver_onboarding_state();
end $$;

-- Going online: approved driver, active profile, active current vehicle in an
-- active category, location inside an active service zone (spec 04 §2).
create function api.driver_set_availability(
  p_online boolean, p_lat double precision, p_lng double precision, p_accuracy_m numeric default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver public.driver_profiles := private.my_driver();
  v_point extensions.geography;
  v_vehicle public.vehicles;
  v_target public.driver_availability := case when p_online then 'online' else 'offline' end;
begin
  select * into v_driver from public.driver_profiles where id = v_driver.id for update;

  if v_driver.availability = 'on_trip' then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"availability":"on_trip"}');
  end if;

  if p_online then
    if v_driver.onboarding_status <> 'approved' then
      perform private.raise_error('DRIVER_NOT_APPROVED', jsonb_build_object('onboarding_status', v_driver.onboarding_status));
    end if;
    select * into v_vehicle from public.vehicles where id = v_driver.current_vehicle_id;
    if v_vehicle.id is null or v_vehicle.status <> 'active'
       or not exists (select 1 from public.vehicle_categories where id = v_vehicle.category_id and active) then
      perform private.raise_error('VEHICLE_NOT_ACTIVE');
    end if;
    v_point := private.point(p_lat, p_lng);
    if private.zone_at(v_point) is null then
      perform private.raise_error('OUT_OF_SERVICE_AREA');
    end if;
    insert into public.driver_live_locations (driver_id, location, accuracy_m, recorded_at, updated_at)
    values (v_driver.id, v_point, p_accuracy_m, now(), now())
    on conflict (driver_id) do update set location = excluded.location, accuracy_m = excluded.accuracy_m,
      recorded_at = excluded.recorded_at, updated_at = now();
  end if;

  if v_driver.availability <> v_target then
    update public.driver_profiles set availability = v_target where id = v_driver.id;
    perform private.log_driver_event(v_driver.id, 'availability', v_driver.availability::text, v_target::text,
      null, 'driver', v_point);
  end if;
  return jsonb_build_object('availability', v_target);
end $$;

-- Latest position while online (trip points arrive with M2).
create function api.driver_update_location(
  p_lat double precision, p_lng double precision, p_heading numeric, p_speed_mps numeric,
  p_accuracy_m numeric, p_recorded_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver_id uuid := (private.my_driver()).id;
  v_point extensions.geography := private.point(p_lat, p_lng);
  v_recorded timestamptz := least(coalesce(p_recorded_at, now()), now());
begin
  if v_recorded < now() - interval '5 minutes' then
    perform private.raise_error('LOCATION_STALE');
  end if;
  insert into public.driver_live_locations (driver_id, location, heading, speed_mps, accuracy_m, recorded_at, updated_at)
  values (v_driver_id, v_point, p_heading, p_speed_mps, p_accuracy_m, v_recorded, now())
  on conflict (driver_id) do update set
    location = excluded.location, heading = excluded.heading, speed_mps = excluded.speed_mps,
    accuracy_m = excluded.accuracy_m, recorded_at = excluded.recorded_at, updated_at = now()
  where public.driver_live_locations.recorded_at <= excluded.recorded_at; -- ignore out-of-order points
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Admin: vehicle categories (categories.manage)
-- ---------------------------------------------------------------------------
create function api.list_vehicle_categories() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    perform private.raise_error('FORBIDDEN');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'code', c.code, 'name', c.name, 'name_bn', c.name_bn, 'description', c.description,
      'passenger_capacity', c.passenger_capacity, 'icon', c.icon, 'sort_order', c.sort_order,
      'active', c.active, 'version', c.version,
      'vehicle_count', (select count(*) from public.vehicles v where v.category_id = c.id and v.status = 'active')
    ) order by c.sort_order, c.name)
    from public.vehicle_categories c
  ), '[]');
end $$;

create function api.save_vehicle_category(
  p_id uuid, p_code text, p_name text, p_name_bn text, p_description text,
  p_passenger_capacity integer, p_icon text, p_active boolean, p_expected_version integer
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_before public.vehicle_categories;
  v_id uuid;
begin
  perform private.require_permission('categories.manage');
  if p_id is null then
    if exists (select 1 from public.vehicle_categories where code = p_code) then
      perform private.raise_error('ALREADY_EXISTS', '{"field":"code"}');
    end if;
    insert into public.vehicle_categories (code, name, name_bn, description, passenger_capacity, icon, active, sort_order)
    values (p_code, btrim(p_name), nullif(btrim(p_name_bn), ''), nullif(btrim(p_description), ''), p_passenger_capacity,
            p_icon, coalesce(p_active, true), coalesce((select max(sort_order) + 10 from public.vehicle_categories), 10))
    returning id into v_id;
    perform private.log_admin_action('category.create', 'vehicle_category', v_id, null,
      jsonb_build_object('code', p_code, 'name', p_name), null);
    return v_id;
  end if;

  select * into v_before from public.vehicle_categories where id = p_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if v_before.version <> p_expected_version then
    perform private.raise_error('STALE_VERSION');
  end if;
  update public.vehicle_categories set
    name = btrim(p_name), name_bn = nullif(btrim(p_name_bn), ''), description = nullif(btrim(p_description), ''),
    passenger_capacity = p_passenger_capacity, icon = p_icon, active = coalesce(p_active, active)
  where id = p_id;
  perform private.log_admin_action('category.update', 'vehicle_category', p_id,
    jsonb_build_object('name', v_before.name, 'active', v_before.active, 'capacity', v_before.passenger_capacity),
    jsonb_build_object('name', p_name, 'active', p_active, 'capacity', p_passenger_capacity), null);
  return p_id;
end $$;

create function api.reorder_vehicle_categories(p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission('categories.manage');
  update public.vehicle_categories c set sort_order = o.n * 10
  from unnest(p_ids) with ordinality o(id, n)
  where c.id = o.id and c.sort_order <> o.n * 10;
  perform private.log_admin_action('category.reorder', 'vehicle_category', null, null, to_jsonb(p_ids), null);
end $$;

-- ---------------------------------------------------------------------------
-- Admin: service zones (zones.view / zones.manage)
-- ---------------------------------------------------------------------------
create function api.list_zones() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('zones.view');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', z.id, 'code', z.code, 'name', z.name, 'active', z.active, 'area_km2', z.area_km2,
      'timezone', z.timezone, 'manual_surge_multiplier', z.manual_surge_multiplier, 'version', z.version,
      'updated_at', z.updated_at,
      'boundary', extensions.st_asgeojson(z.boundary, 6)::jsonb,
      'online_drivers', (select count(*) from public.driver_live_locations l
                         join public.driver_profiles d on d.id = l.driver_id and d.availability <> 'offline'
                         where extensions.st_covers(z.boundary, l.location))
    ) order by z.active desc, z.name)
    from public.service_zones z
  ), '[]');
end $$;

-- Saves a zone from GeoJSON (Polygon or MultiPolygon, WGS84). Returns overlaps
-- so the editor can warn; overlapping zones are allowed (the smallest wins).
create function api.save_zone(
  p_id uuid, p_code text, p_name text, p_geojson jsonb, p_active boolean, p_expected_version integer, p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_geom extensions.geometry;
  v_area numeric;
  v_before public.service_zones;
  v_id uuid;
  v_overlaps jsonb;
begin
  perform private.require_permission('zones.manage');
  v_reason := private.require_reason(p_reason);

  if p_name is null or length(btrim(p_name)) not between 1 and 80 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"name","message":"Enter a name."}]}');
  end if;
  if p_geojson is null or p_geojson ->> 'type' not in ('Polygon', 'MultiPolygon') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"boundary","message":"Draw or upload a polygon."}]}');
  end if;
  begin
    v_geom := extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson(p_geojson::text), 4326));
  exception when others then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"boundary","message":"The boundary is not valid GeoJSON."}]}');
  end;
  if not extensions.st_isvalid(v_geom) then
    perform private.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array(jsonb_build_object(
      'path', 'boundary', 'message', 'The boundary crosses itself: ' || extensions.st_isvalidreason(v_geom)))));
  end if;
  v_area := round((extensions.st_area(v_geom::extensions.geography) / 1e6)::numeric, 3);
  if v_area < 0.01 or v_area > 5000 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"boundary","message":"A zone must be between 0.01 and 5,000 km²."}]}');
  end if;

  if p_id is null then
    if p_code is null or p_code !~ '^[a-z][a-z0-9_]{1,40}$' then
      perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"code","message":"Use lowercase letters, digits and underscores."}]}');
    end if;
    if exists (select 1 from public.service_zones where code = p_code) then
      perform private.raise_error('ALREADY_EXISTS', '{"field":"code"}');
    end if;
    insert into public.service_zones (code, name, boundary, area_km2, active)
    values (p_code, btrim(p_name), v_geom::extensions.geography, v_area, coalesce(p_active, false))
    returning id into v_id;
    perform private.log_admin_action('zone.create', 'service_zone', v_id, null,
      jsonb_build_object('code', p_code, 'name', p_name, 'area_km2', v_area, 'active', coalesce(p_active, false)), v_reason);
  else
    select * into v_before from public.service_zones where id = p_id for update;
    if not found then
      perform private.raise_error('NOT_FOUND');
    end if;
    if v_before.version <> p_expected_version then
      perform private.raise_error('STALE_VERSION');
    end if;
    update public.service_zones set name = btrim(p_name), boundary = v_geom::extensions.geography, area_km2 = v_area,
      active = coalesce(p_active, active)
    where id = p_id;
    v_id := p_id;
    perform private.log_admin_action('zone.update', 'service_zone', v_id,
      jsonb_build_object('name', v_before.name, 'area_km2', v_before.area_km2, 'active', v_before.active,
                         'boundary', extensions.st_asgeojson(v_before.boundary, 6)::jsonb),
      jsonb_build_object('name', p_name, 'area_km2', v_area, 'active', coalesce(p_active, v_before.active),
                         'boundary', extensions.st_asgeojson(v_geom, 6)::jsonb),
      v_reason);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name)), '[]') into v_overlaps
  from public.service_zones z
  where z.id <> v_id and extensions.st_intersects(z.boundary, v_geom::extensions.geography);

  return jsonb_build_object('id', v_id, 'area_km2', v_area, 'overlaps', v_overlaps);
end $$;

-- ---------------------------------------------------------------------------
-- Admin: drivers
-- ---------------------------------------------------------------------------
create function private.driver_row_json(p_driver_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', d.id,
    'user_id', p.id,
    'full_name', p.full_name,
    'phone_masked', private.mask_phone(p.phone),
    'email_masked', private.mask_email(p.email),
    'account_status', p.status,
    'onboarding_status', d.onboarding_status,
    'availability', d.availability,
    'rating_avg', d.rating_avg,
    'acceptance_rate_30d', d.acceptance_rate_30d,
    'cancellation_rate_30d', d.cancellation_rate_30d,
    'submitted_at', d.submitted_at,
    'approved_at', d.approved_at,
    'created_at', d.created_at,
    'zone', (select jsonb_build_object('id', z.id, 'name', z.name) from public.service_zones z where z.id = d.home_zone_id),
    'vehicle', (select jsonb_build_object('id', v.id, 'registration_number', v.registration_number, 'category', c.name, 'status', v.status)
                from public.vehicles v join public.vehicle_categories c on c.id = v.category_id
                where v.id = d.current_vehicle_id)
  )
  from public.driver_profiles d join public.profiles p on p.id = d.user_id
  where d.id = p_driver_id;
$$;

-- Keyset pagination on (created_at desc, id desc); cursor = "<iso>|<uuid>".
create function api.list_drivers(
  p_tab text default 'all', p_search text default null, p_limit integer default 50, p_cursor text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_search text := nullif(btrim(p_search), '');
  v_digits text := nullif(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '');
  v_cursor_ts timestamptz;
  v_cursor_id uuid;
  v_rows jsonb;
begin
  perform private.require_permission('drivers.view');
  if p_tab not in ('all', 'applications', 'approved', 'suspended', 'rejected', 'draft') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"tab","message":"Unknown tab."}]}');
  end if;
  if p_cursor is not null then
    v_cursor_ts := split_part(p_cursor, '|', 1)::timestamptz;
    v_cursor_id := split_part(p_cursor, '|', 2)::uuid;
  end if;

  select coalesce(jsonb_agg(private.driver_row_json(x.id) order by x.created_at desc, x.id desc), '[]') into v_rows
  from (
    select d.id, d.created_at
    from public.driver_profiles d
    join public.profiles p on p.id = d.user_id
    left join public.vehicles v on v.id = d.current_vehicle_id
    where (p_tab = 'all'
        or (p_tab = 'applications' and d.onboarding_status in ('submitted', 'under_review'))
        or (p_tab = 'approved' and d.onboarding_status = 'approved')
        or (p_tab = 'suspended' and d.onboarding_status = 'suspended')
        or (p_tab = 'rejected' and d.onboarding_status = 'rejected')
        or (p_tab = 'draft' and d.onboarding_status = 'draft'))
      and (v_search is null
        or p.full_name ilike '%' || v_search || '%'
        or (v_digits is not null and length(v_digits) >= 3 and right(p.phone, length(v_digits)) = v_digits)
        or v.registration_number ilike '%' || upper(v_search) || '%')
      and (v_cursor_ts is null or (d.created_at, d.id) < (v_cursor_ts, v_cursor_id))
    order by d.created_at desc, d.id desc
    limit v_limit + 1
  ) x;

  return jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(r), '[]') from (
      select r from jsonb_array_elements(v_rows) with ordinality e(r, n) where n <= v_limit order by n) t),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit
      then (v_rows -> (v_limit - 1) ->> 'created_at') || '|' || (v_rows -> (v_limit - 1) ->> 'id') end,
    'counts', (select jsonb_build_object(
      'applications', count(*) filter (where onboarding_status in ('submitted', 'under_review')),
      'approved', count(*) filter (where onboarding_status = 'approved'),
      'suspended', count(*) filter (where onboarding_status = 'suspended'),
      'online', count(*) filter (where availability <> 'offline'))
      from public.driver_profiles)
  );
end $$;

create function api.get_driver(p_driver_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  perform private.require_permission('drivers.view');
  v := private.driver_row_json(p_driver_id);
  if v is null then
    perform private.raise_error('NOT_FOUND');
  end if;
  return v || private.driver_state_json(p_driver_id) || jsonb_build_object(
    'version', (select version from public.driver_profiles where id = p_driver_id),
    'home_zone_id', (select home_zone_id from public.driver_profiles where id = p_driver_id),
    'live_location', case when private.has_permission('dispatch.view') then (
      select jsonb_build_object('lat', extensions.st_y(l.location::extensions.geometry),
                                'lng', extensions.st_x(l.location::extensions.geometry), 'updated_at', l.updated_at)
      from public.driver_live_locations l where l.driver_id = p_driver_id) end,
    'document_history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', dd.id, 'document_type', dd.document_type, 'vehicle_id', dd.vehicle_id, 'review_status', dd.review_status,
        'uploaded_at', dd.uploaded_at, 'reviewed_at', dd.reviewed_at, 'rejection_reason', dd.rejection_reason,
        'expires_at', dd.expires_at, 'issued_at', dd.issued_at, 'document_number_masked', dd.document_number_masked,
        'content_type', dd.content_type, 'superseded_at', dd.superseded_at, 'version', dd.version
      ) order by dd.uploaded_at desc)
      from public.driver_documents dd where dd.driver_id = p_driver_id and dd.uploaded_at is not null
    ), '[]'),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'old_status', e.old_status, 'new_status', e.new_status, 'reason', e.reason,
        'actor_type', e.actor_type, 'actor_name', a.full_name, 'created_at', e.created_at
      ) order by e.id desc)
      from (select * from public.driver_status_events where driver_id = p_driver_id order by id desc limit 50) e
      left join public.profiles a on a.id = e.actor_id
    ), '[]')
  );
end $$;

create function private.lock_driver(p_driver_id uuid) returns public.driver_profiles
language plpgsql security definer set search_path = '' as $$
declare
  v public.driver_profiles;
begin
  select * into v from public.driver_profiles where id = p_driver_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  return v;
end $$;

create function api.review_driver_document(p_document_id uuid, p_decision text, p_reason text, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_doc public.driver_documents;
  v_driver public.driver_profiles;
  v_reason text;
begin
  perform private.require_permission('documents.review');
  if p_decision not in ('approve', 'reject') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"decision","message":"Approve or reject."}]}');
  end if;
  -- A rejection always needs a reason; an approval note is optional.
  v_reason := case when p_decision = 'reject' then private.require_reason(p_reason) else nullif(btrim(p_reason), '') end;

  select * into v_doc from public.driver_documents where id = p_document_id for update;
  if not found or v_doc.uploaded_at is null then
    perform private.raise_error('NOT_FOUND');
  end if;
  if v_doc.version <> p_expected_version then
    perform private.raise_error('STALE_VERSION');
  end if;
  if v_doc.superseded_at is not null or v_doc.review_status <> 'pending' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('review_status', v_doc.review_status));
  end if;
  if p_decision = 'approve' and v_doc.expires_at is not null and v_doc.expires_at <= current_date then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"expires_at","message":"This document has expired."}]}');
  end if;

  update public.driver_documents set
    review_status = case when p_decision = 'approve' then 'approved'::public.review_status else 'rejected' end,
    rejection_reason = case when p_decision = 'reject' then v_reason end,
    reviewer_id = auth.uid(), reviewed_at = now()
  where id = p_document_id;

  -- The first review of a submitted application moves it under review.
  v_driver := private.lock_driver(v_doc.driver_id);
  if v_driver.onboarding_status = 'submitted' then
    update public.driver_profiles set onboarding_status = 'under_review' where id = v_driver.id;
    perform private.log_driver_event(v_driver.id, 'onboarding', 'submitted', 'under_review', null, 'admin');
  end if;

  perform private.log_admin_action('document.' || p_decision, 'driver_document', p_document_id,
    jsonb_build_object('review_status', v_doc.review_status),
    jsonb_build_object('review_status', case when p_decision = 'approve' then 'approved' else 'rejected' end,
                       'document_type', v_doc.document_type, 'driver_id', v_doc.driver_id),
    v_reason);
  return private.document_checklist(v_doc.driver_id, v_doc.vehicle_id);
end $$;

-- Readiness for approval: every required driver document approved and current,
-- and at least one vehicle active (its own documents approved when verified).
create function private.driver_approval_blockers(p_driver_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(b), '[]') from (
    select jsonb_build_object('type', 'document', 'document_type', e ->> 'document_type', 'state', e ->> 'state') as b
    from jsonb_array_elements(private.document_checklist(p_driver_id, null)) e
    where e ->> 'state' <> 'approved'
    union all
    select jsonb_build_object('type', 'vehicle', 'state', 'no_active_vehicle')
    where not exists (select 1 from public.vehicles v where v.driver_id = p_driver_id and v.status = 'active')
  ) x;
$$;

create function api.approve_driver(p_driver_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver public.driver_profiles;
  v_blockers jsonb;
  v_vehicle uuid;
begin
  perform private.require_permission('drivers.approve');
  v_driver := private.lock_driver(p_driver_id);
  if v_driver.onboarding_status not in ('submitted', 'under_review') then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('onboarding_status', v_driver.onboarding_status));
  end if;
  v_blockers := private.driver_approval_blockers(p_driver_id);
  if jsonb_array_length(v_blockers) > 0 then
    perform private.raise_error('VALIDATION_FAILED', jsonb_build_object(
      'fields', jsonb_build_array(jsonb_build_object('path', 'documents', 'message', 'Resolve every blocker before approving.')),
      'blockers', v_blockers));
  end if;

  v_vehicle := coalesce(
    (select id from public.vehicles where id = v_driver.current_vehicle_id and status = 'active'),
    (select id from public.vehicles where driver_id = p_driver_id and status = 'active' order by verified_at limit 1));

  update public.driver_profiles set onboarding_status = 'approved', approved_at = now(), approved_by = auth.uid(),
    rejected_reason = null, current_vehicle_id = v_vehicle
  where id = p_driver_id;
  perform private.log_driver_event(p_driver_id, 'onboarding', v_driver.onboarding_status::text, 'approved',
    nullif(btrim(p_reason), ''), 'admin');
  perform private.log_admin_action('driver.approve', 'driver', p_driver_id,
    jsonb_build_object('onboarding_status', v_driver.onboarding_status), jsonb_build_object('onboarding_status', 'approved'),
    nullif(btrim(p_reason), ''));
  return api.get_driver(p_driver_id);
end $$;

create function api.reject_driver(p_driver_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver public.driver_profiles;
  v_reason text;
begin
  perform private.require_permission('drivers.approve');
  v_reason := private.require_reason(p_reason);
  v_driver := private.lock_driver(p_driver_id);
  if v_driver.onboarding_status not in ('submitted', 'under_review') then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('onboarding_status', v_driver.onboarding_status));
  end if;
  update public.driver_profiles set onboarding_status = 'rejected', rejected_reason = v_reason where id = p_driver_id;
  perform private.log_driver_event(p_driver_id, 'onboarding', v_driver.onboarding_status::text, 'rejected', v_reason, 'admin');
  perform private.log_admin_action('driver.reject', 'driver', p_driver_id,
    jsonb_build_object('onboarding_status', v_driver.onboarding_status), jsonb_build_object('onboarding_status', 'rejected'), v_reason);
  return api.get_driver(p_driver_id);
end $$;

create function private.take_driver_offline(p_driver public.driver_profiles, p_reason text, p_actor public.actor_type) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_driver.availability = 'online' then
    update public.driver_profiles set availability = 'offline' where id = p_driver.id;
    perform private.log_driver_event(p_driver.id, 'availability', 'online', 'offline', p_reason, p_actor);
  end if;
end $$;

create function api.suspend_driver(p_driver_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver public.driver_profiles;
  v_reason text;
begin
  perform private.require_permission('drivers.suspend');
  v_reason := private.require_reason(p_reason);
  v_driver := private.lock_driver(p_driver_id);
  if v_driver.onboarding_status <> 'approved' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('onboarding_status', v_driver.onboarding_status));
  end if;
  -- Suspending mid-trip needs the trip-resolution permission (safety override).
  if v_driver.availability = 'on_trip' and not private.has_permission('trips.resolve') then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"availability":"on_trip"}');
  end if;
  perform private.take_driver_offline(v_driver, 'Suspended', 'admin');
  update public.driver_profiles set onboarding_status = 'suspended', suspended_reason = v_reason, availability = 'offline'
  where id = p_driver_id;
  perform private.log_driver_event(p_driver_id, 'onboarding', 'approved', 'suspended', v_reason, 'admin');
  perform private.log_admin_action('driver.suspend', 'driver', p_driver_id,
    jsonb_build_object('onboarding_status', 'approved'), jsonb_build_object('onboarding_status', 'suspended'), v_reason);
  return api.get_driver(p_driver_id);
end $$;

create function api.reactivate_driver(p_driver_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver public.driver_profiles;
  v_reason text;
  v_blockers jsonb;
begin
  perform private.require_permission('drivers.suspend');
  v_reason := private.require_reason(p_reason);
  v_driver := private.lock_driver(p_driver_id);
  if v_driver.onboarding_status <> 'suspended' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('onboarding_status', v_driver.onboarding_status));
  end if;
  v_blockers := private.driver_approval_blockers(p_driver_id);
  if jsonb_array_length(v_blockers) > 0 then
    perform private.raise_error('VALIDATION_FAILED', jsonb_build_object(
      'fields', jsonb_build_array(jsonb_build_object('path', 'documents', 'message', 'Resolve every blocker before reactivating.')),
      'blockers', v_blockers));
  end if;
  update public.driver_profiles set onboarding_status = 'approved', suspended_reason = null where id = p_driver_id;
  perform private.log_driver_event(p_driver_id, 'onboarding', 'suspended', 'approved', v_reason, 'admin');
  perform private.log_admin_action('driver.reactivate', 'driver', p_driver_id,
    jsonb_build_object('onboarding_status', 'suspended'), jsonb_build_object('onboarding_status', 'approved'), v_reason);
  return api.get_driver(p_driver_id);
end $$;

create function api.force_driver_offline(p_driver_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver public.driver_profiles;
  v_reason text;
begin
  perform private.require_permission('dispatch.intervene');
  v_reason := private.require_reason(p_reason);
  v_driver := private.lock_driver(p_driver_id);
  if v_driver.availability <> 'online' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('availability', v_driver.availability));
  end if;
  perform private.take_driver_offline(v_driver, v_reason, 'admin');
  perform private.log_admin_action('driver.force_offline', 'driver', p_driver_id,
    jsonb_build_object('availability', 'online'), jsonb_build_object('availability', 'offline'), v_reason);
  return api.get_driver(p_driver_id);
end $$;

create function api.update_driver(p_driver_id uuid, p_home_zone_id uuid, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver public.driver_profiles;
begin
  perform private.require_permission('drivers.update');
  v_driver := private.lock_driver(p_driver_id);
  if v_driver.version <> p_expected_version then
    perform private.raise_error('STALE_VERSION');
  end if;
  if p_home_zone_id is not null and not exists (select 1 from public.service_zones where id = p_home_zone_id) then
    perform private.raise_error('NOT_FOUND', '{"field":"home_zone_id"}');
  end if;
  update public.driver_profiles set home_zone_id = p_home_zone_id where id = p_driver_id;
  perform private.log_admin_action('driver.update', 'driver', p_driver_id,
    jsonb_build_object('home_zone_id', v_driver.home_zone_id), jsonb_build_object('home_zone_id', p_home_zone_id), null);
  return api.get_driver(p_driver_id);
end $$;

-- ---------------------------------------------------------------------------
-- Admin: document queue and audited file access
-- ---------------------------------------------------------------------------
create function api.list_document_queue(p_queue text, p_limit integer default 50, p_cursor text default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_warn integer := coalesce((private.setting('documents.expiry_warning_days'))::int, 30);
  v_cursor_ts timestamptz;
  v_cursor_id uuid;
  v_rows jsonb;
begin
  perform private.require_permission('documents.view');
  if p_queue not in ('pending', 'expiring', 'expired', 'rejected') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"queue","message":"Unknown queue."}]}');
  end if;
  if p_cursor is not null then
    v_cursor_ts := split_part(p_cursor, '|', 1)::timestamptz;
    v_cursor_id := split_part(p_cursor, '|', 2)::uuid;
  end if;

  -- Pending is oldest-first (SLA); the others newest-first. sort_key is the keyset.
  select coalesce(jsonb_agg(r order by n), '[]') into v_rows from (
    select row_number() over () as n, jsonb_build_object(
      'id', d.id, 'driver_id', d.driver_id, 'driver_name', p.full_name, 'document_type', d.document_type,
      'vehicle', case when v.id is null then null else jsonb_build_object('id', v.id, 'registration_number', v.registration_number) end,
      'review_status', d.review_status, 'uploaded_at', d.uploaded_at, 'expires_at', d.expires_at,
      'rejection_reason', d.rejection_reason, 'onboarding_status', dp.onboarding_status,
      'sort_key', s.sort_key
    ) as r
    from public.driver_documents d
    cross join lateral (select case p_queue
      when 'pending' then d.uploaded_at
      when 'expiring' then d.expires_at::timestamptz
      when 'expired' then d.expires_at::timestamptz
      else d.reviewed_at end as sort_key) s
    join public.driver_profiles dp on dp.id = d.driver_id
    join public.profiles p on p.id = dp.user_id
    left join public.vehicles v on v.id = d.vehicle_id
    where d.uploaded_at is not null and d.superseded_at is null
      and case p_queue
        when 'pending' then d.review_status = 'pending'
        when 'expiring' then d.review_status = 'approved' and d.expires_at between current_date and current_date + v_warn
        when 'expired' then d.review_status = 'expired'
                             or (d.review_status = 'approved' and d.expires_at < current_date)
        else d.review_status = 'rejected' end
      and (v_cursor_ts is null or case when p_queue in ('pending', 'expiring')
             then (s.sort_key, d.id) > (v_cursor_ts, v_cursor_id)
             else (s.sort_key, d.id) < (v_cursor_ts, v_cursor_id) end)
    order by case when p_queue in ('pending', 'expiring') then s.sort_key end asc,
             case when p_queue not in ('pending', 'expiring') then s.sort_key end desc,
             d.id
    limit v_limit + 1
  ) x;

  return jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(r - 'sort_key'), '[]') from (
      select r from jsonb_array_elements(v_rows) with ordinality e(r, n) where n <= v_limit order by n) t),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit
      then (v_rows -> (v_limit - 1) ->> 'sort_key') || '|' || (v_rows -> (v_limit - 1) ->> 'id') end,
    'counts', (select jsonb_build_object(
      'pending', count(*) filter (where review_status = 'pending'),
      'expiring', count(*) filter (where review_status = 'approved' and expires_at between current_date and current_date + v_warn),
      'expired', count(*) filter (where review_status = 'expired' or (review_status = 'approved' and expires_at < current_date)))
      from public.driver_documents where uploaded_at is not null and superseded_at is null)
  );
end $$;

-- Logs the view, then returns the path; the server signs a 60-second URL.
create function api.open_driver_document(p_document_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_doc public.driver_documents;
  v_user uuid;
begin
  perform private.require_permission('documents.view');
  select * into v_doc from public.driver_documents where id = p_document_id and uploaded_at is not null;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  select user_id into v_user from public.driver_profiles where id = v_doc.driver_id;
  insert into public.pii_access_logs (admin_id, subject_profile_id, field, reason)
  values (auth.uid(), v_user, 'document:' || p_document_id, 'Document review');
  return jsonb_build_object('storage_path', v_doc.storage_path, 'content_type', v_doc.content_type);
end $$;

-- ---------------------------------------------------------------------------
-- Admin: vehicles
-- ---------------------------------------------------------------------------
create function private.vehicle_json(p_vehicle_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', v.id, 'registration_number', v.registration_number, 'make', v.make, 'model', v.model, 'color', v.color,
    'year', v.year, 'status', v.status, 'suspended_reason', v.suspended_reason, 'verified_at', v.verified_at,
    'created_at', v.created_at, 'version', v.version,
    'category', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name),
    'driver', jsonb_build_object('id', d.id, 'full_name', p.full_name, 'onboarding_status', d.onboarding_status),
    'is_current', d.current_vehicle_id = v.id
  )
  from public.vehicles v
  join public.vehicle_categories c on c.id = v.category_id
  join public.driver_profiles d on d.id = v.driver_id
  join public.profiles p on p.id = d.user_id
  where v.id = p_vehicle_id;
$$;

create function api.list_vehicles(
  p_status text default null, p_search text default null, p_limit integer default 50, p_cursor text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_search text := nullif(btrim(p_search), '');
  v_cursor_ts timestamptz;
  v_cursor_id uuid;
  v_rows jsonb;
begin
  perform private.require_permission('vehicles.view');
  if p_status is not null and p_status not in ('pending', 'active', 'inactive', 'suspended') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"status","message":"Unknown status."}]}');
  end if;
  if p_cursor is not null then
    v_cursor_ts := split_part(p_cursor, '|', 1)::timestamptz;
    v_cursor_id := split_part(p_cursor, '|', 2)::uuid;
  end if;

  select coalesce(jsonb_agg(private.vehicle_json(x.id) order by x.created_at desc, x.id desc), '[]') into v_rows
  from (
    select v.id, v.created_at from public.vehicles v
    join public.driver_profiles d on d.id = v.driver_id
    join public.profiles p on p.id = d.user_id
    where (p_status is null or v.status::text = p_status)
      and (v_search is null or v.registration_number ilike '%' || upper(v_search) || '%'
           or p.full_name ilike '%' || v_search || '%' or (v.make || ' ' || v.model) ilike '%' || v_search || '%')
      and (v_cursor_ts is null or (v.created_at, v.id) < (v_cursor_ts, v_cursor_id))
    order by v.created_at desc, v.id desc
    limit v_limit + 1
  ) x;

  return jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(r), '[]') from (
      select r from jsonb_array_elements(v_rows) with ordinality e(r, n) where n <= v_limit order by n) t),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit
      then (v_rows -> (v_limit - 1) ->> 'created_at') || '|' || (v_rows -> (v_limit - 1) ->> 'id') end
  );
end $$;

create function api.get_vehicle(p_vehicle_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  perform private.require_permission('vehicles.view');
  v := private.vehicle_json(p_vehicle_id);
  if v is null then
    perform private.raise_error('NOT_FOUND');
  end if;
  return v || jsonb_build_object(
    'documents', private.document_checklist((v -> 'driver' ->> 'id')::uuid, p_vehicle_id));
end $$;

-- Verify or reinstate: every required vehicle document approved and current.
create function api.verify_vehicle(p_vehicle_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_vehicle public.vehicles;
  v_checklist jsonb;
  v_driver public.driver_profiles;
begin
  perform private.require_permission('vehicles.verify');
  select * into v_vehicle from public.vehicles where id = p_vehicle_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if v_vehicle.status = 'active' then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"status":"active"}');
  end if;
  if v_vehicle.status = 'suspended' then
    perform private.require_reason(p_reason);
  end if;
  if not exists (select 1 from public.vehicle_categories where id = v_vehicle.category_id and active) then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"category","message":"The vehicle category is inactive."}]}');
  end if;
  v_checklist := private.document_checklist(v_vehicle.driver_id, p_vehicle_id);
  if not private.checklist_complete(v_checklist, array['approved']) then
    perform private.raise_error('VALIDATION_FAILED', jsonb_build_object(
      'fields', jsonb_build_array(jsonb_build_object('path', 'documents', 'message', 'Approve every vehicle document first.')),
      'blockers', v_checklist));
  end if;

  update public.vehicles set status = 'active', verified_at = now(), verified_by = auth.uid(), suspended_reason = null
  where id = p_vehicle_id;

  v_driver := private.lock_driver(v_vehicle.driver_id);
  if v_driver.current_vehicle_id is null then
    update public.driver_profiles set current_vehicle_id = p_vehicle_id where id = v_driver.id;
  end if;

  perform private.log_admin_action('vehicle.verify', 'vehicle', p_vehicle_id,
    jsonb_build_object('status', v_vehicle.status), jsonb_build_object('status', 'active'), nullif(btrim(p_reason), ''));
  return api.get_vehicle(p_vehicle_id);
end $$;

create function api.suspend_vehicle(p_vehicle_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_vehicle public.vehicles;
  v_reason text;
  v_driver public.driver_profiles;
begin
  perform private.require_permission('vehicles.verify');
  v_reason := private.require_reason(p_reason);
  select * into v_vehicle from public.vehicles where id = p_vehicle_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if v_vehicle.status <> 'active' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', v_vehicle.status));
  end if;
  update public.vehicles set status = 'suspended', suspended_reason = v_reason where id = p_vehicle_id;

  v_driver := private.lock_driver(v_vehicle.driver_id);
  if v_driver.current_vehicle_id = p_vehicle_id then
    perform private.take_driver_offline(v_driver, 'Vehicle suspended', 'admin');
  end if;
  perform private.log_admin_action('vehicle.suspend', 'vehicle', p_vehicle_id,
    jsonb_build_object('status', 'active'), jsonb_build_object('status', 'suspended'), v_reason);
  return api.get_vehicle(p_vehicle_id);
end $$;

create function api.set_current_vehicle(p_driver_id uuid, p_vehicle_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver public.driver_profiles;
begin
  perform private.require_permission('vehicles.manage');
  v_driver := private.lock_driver(p_driver_id);
  if v_driver.availability <> 'offline' then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"driver must be offline"}');
  end if;
  if not exists (select 1 from public.vehicles where id = p_vehicle_id and driver_id = p_driver_id and status = 'active') then
    perform private.raise_error('VEHICLE_NOT_ACTIVE');
  end if;
  update public.driver_profiles set current_vehicle_id = p_vehicle_id where id = p_driver_id;
  perform private.log_admin_action('driver.set_current_vehicle', 'driver', p_driver_id,
    jsonb_build_object('current_vehicle_id', v_driver.current_vehicle_id), jsonb_build_object('current_vehicle_id', p_vehicle_id),
    nullif(btrim(p_reason), ''));
  return api.get_driver(p_driver_id);
end $$;

-- ---------------------------------------------------------------------------
-- Admin: passengers (and not-yet-onboarded users)
-- ---------------------------------------------------------------------------
create function private.passenger_json(p_profile_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'role', p.role, 'status', p.status,
    'phone_masked', private.mask_phone(p.phone), 'email_masked', private.mask_email(p.email),
    'has_phone', p.phone is not null, 'has_email', p.email is not null,
    'preferred_language', p.preferred_language, 'suspended_reason', p.suspended_reason,
    'created_at', p.created_at, 'last_seen_at', p.last_seen_at, 'version', p.version
  )
  from public.profiles p where p.id = p_profile_id and p.role in ('passenger', 'user') and p.deleted_at is null;
$$;

create function api.list_passengers(
  p_status text default null, p_search text default null, p_limit integer default 50, p_cursor text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_search text := nullif(btrim(p_search), '');
  v_digits text := nullif(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '');
  v_cursor_ts timestamptz;
  v_cursor_id uuid;
  v_rows jsonb;
begin
  perform private.require_permission('passengers.view');
  if p_status is not null and p_status not in ('active', 'suspended', 'deactivated') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"status","message":"Unknown status."}]}');
  end if;
  if p_cursor is not null then
    v_cursor_ts := split_part(p_cursor, '|', 1)::timestamptz;
    v_cursor_id := split_part(p_cursor, '|', 2)::uuid;
  end if;

  select coalesce(jsonb_agg(private.passenger_json(x.id) order by x.created_at desc, x.id desc), '[]') into v_rows
  from (
    select p.id, p.created_at from public.profiles p
    where p.role in ('passenger', 'user') and p.deleted_at is null
      and (p_status is null or p.status::text = p_status)
      and (v_search is null or p.full_name ilike '%' || v_search || '%'
           or (v_digits is not null and length(v_digits) >= 3 and right(p.phone, length(v_digits)) = v_digits))
      and (v_cursor_ts is null or (p.created_at, p.id) < (v_cursor_ts, v_cursor_id))
    order by p.created_at desc, p.id desc
    limit v_limit + 1
  ) x;

  return jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(r), '[]') from (
      select r from jsonb_array_elements(v_rows) with ordinality e(r, n) where n <= v_limit order by n) t),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit
      then (v_rows -> (v_limit - 1) ->> 'created_at') || '|' || (v_rows -> (v_limit - 1) ->> 'id') end
  );
end $$;

create function api.get_passenger(p_profile_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  perform private.require_permission('passengers.view');
  v := private.passenger_json(p_profile_id);
  if v is null then
    perform private.raise_error('NOT_FOUND');
  end if;
  return v || jsonb_build_object('status_events', coalesce((
    select jsonb_agg(jsonb_build_object('old_status', e.old_status, 'new_status', e.new_status, 'reason', e.reason,
                                        'actor_name', a.full_name, 'created_at', e.created_at) order by e.id desc)
    from public.account_status_events e left join public.profiles a on a.id = e.actor_id
    where e.profile_id = p_profile_id), '[]'));
end $$;

create function api.update_passenger(p_profile_id uuid, p_full_name text, p_preferred_language text, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_before public.profiles;
begin
  perform private.require_permission('passengers.update');
  select * into v_before from public.profiles where id = p_profile_id and role in ('passenger', 'user') for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if v_before.version <> p_expected_version then
    perform private.raise_error('STALE_VERSION');
  end if;
  if p_full_name is null or length(btrim(p_full_name)) not between 1 and 120 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"full_name","message":"Enter a name."}]}');
  end if;
  if p_preferred_language not in ('en', 'bn') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"preferred_language","message":"Choose English or Bangla."}]}');
  end if;
  update public.profiles set full_name = btrim(p_full_name), preferred_language = p_preferred_language where id = p_profile_id;
  perform private.log_admin_action('passenger.update', 'profile', p_profile_id,
    jsonb_build_object('full_name', v_before.full_name, 'preferred_language', v_before.preferred_language),
    jsonb_build_object('full_name', btrim(p_full_name), 'preferred_language', p_preferred_language), null);
  return api.get_passenger(p_profile_id);
end $$;

create function api.set_passenger_status(p_profile_id uuid, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_before public.profiles;
  v_reason text;
begin
  perform private.require_permission('passengers.suspend');
  v_reason := private.require_reason(p_reason);
  if p_status not in ('active', 'suspended') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"status","message":"Suspend or reactivate."}]}');
  end if;
  select * into v_before from public.profiles where id = p_profile_id and role in ('passenger', 'user') for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if v_before.status::text = p_status or v_before.status = 'deactivated' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', v_before.status));
  end if;
  update public.profiles set status = p_status::public.account_status,
    suspended_reason = case when p_status = 'suspended' then v_reason end
  where id = p_profile_id;
  insert into public.account_status_events (profile_id, old_status, new_status, reason, actor_id, actor_type)
  values (p_profile_id, v_before.status, p_status::public.account_status, v_reason, auth.uid(), 'admin');
  perform private.log_admin_action('passenger.' || case when p_status = 'suspended' then 'suspend' else 'reactivate' end,
    'profile', p_profile_id, jsonb_build_object('status', v_before.status), jsonb_build_object('status', p_status), v_reason);
  return api.get_passenger(p_profile_id);
end $$;

-- ---------------------------------------------------------------------------
-- Audited PII reveal (docs/spec/02-roles-permissions.md: *.view_pii)
-- ---------------------------------------------------------------------------
create function api.reveal_pii(p_profile_id uuid, p_field text, p_reason text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles;
  v_reason text;
  v_value text;
begin
  v_reason := private.require_reason(p_reason);
  select * into v_profile from public.profiles where id = p_profile_id and deleted_at is null;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if v_profile.role = 'driver' then
    perform private.require_permission('drivers.view_pii');
  elsif v_profile.role in ('passenger', 'user') then
    perform private.require_permission('passengers.view_pii');
  else
    perform private.raise_error('FORBIDDEN');
  end if;

  v_value := case p_field
    when 'phone' then v_profile.phone
    when 'email' then v_profile.email::text
    when 'licence_number' then (select private.decrypt_pii(licence_number_enc) from public.driver_profiles where user_id = p_profile_id)
  end;
  if p_field not in ('phone', 'email', 'licence_number') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"field","message":"Unknown field."}]}');
  end if;

  insert into public.pii_access_logs (admin_id, subject_profile_id, field, reason)
  values (auth.uid(), p_profile_id, p_field, v_reason);
  return v_value;
end $$;

-- ---------------------------------------------------------------------------
-- Jobs: document expiry (daily) and stale online drivers (every 30 s)
-- ---------------------------------------------------------------------------
create function private.process_document_expiry() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_expired integer;
  v_suspended integer := 0;
  v_expiring integer;
  v_driver public.driver_profiles;
  v_admin uuid;
begin
  update public.driver_documents set review_status = 'expired'
  where review_status = 'approved' and superseded_at is null and expires_at < current_date;
  get diagnostics v_expired = row_count;

  -- Approved drivers whose own or current vehicle's required document expired.
  for v_driver in
    select d.* from public.driver_profiles d
    where d.onboarding_status = 'approved' and (
      exists (select 1 from jsonb_array_elements(private.document_checklist(d.id, null)) e where e ->> 'state' = 'expired')
      or (d.current_vehicle_id is not null and exists (
        select 1 from jsonb_array_elements(private.document_checklist(d.id, d.current_vehicle_id)) e where e ->> 'state' = 'expired')))
    for update
  loop
    perform private.take_driver_offline(v_driver, 'DOCUMENT_EXPIRED', 'system');
    update public.driver_profiles set onboarding_status = 'suspended', suspended_reason = 'DOCUMENT_EXPIRED',
      availability = 'offline' where id = v_driver.id;
    perform private.log_driver_event(v_driver.id, 'onboarding', 'approved', 'suspended', 'DOCUMENT_EXPIRED', 'system');
    v_suspended := v_suspended + 1;
  end loop;

  select count(*) into v_expiring from public.driver_documents
  where review_status = 'approved' and superseded_at is null
    and expires_at between current_date and current_date + coalesce((private.setting('documents.expiry_warning_days'))::int, 30);

  if v_expired + v_suspended + v_expiring > 0 then
    for v_admin in select p.id from public.profiles p where private.admin_holds(p.id, 'documents.review') loop
      perform private.notify(v_admin, 'documents.expiry', 'Driver documents need attention',
        format('%s expired, %s expiring soon, %s drivers suspended.', v_expired, v_expiring, v_suspended),
        '/documents?queue=expiring');
    end loop;
  end if;
  return jsonb_build_object('expired', v_expired, 'expiring', v_expiring, 'suspended', v_suspended);
end $$;

create function private.offline_stale_drivers() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_driver public.driver_profiles;
  v_count integer := 0;
begin
  for v_driver in
    select d.* from public.driver_profiles d
    left join public.driver_live_locations l on l.driver_id = d.id
    where d.availability = 'online'
      and (l.updated_at is null or l.updated_at < now() - make_interval(secs => coalesce((private.setting('location.stale_after_s'))::int, 120)))
    for update of d skip locked
  loop
    perform private.take_driver_offline(v_driver, 'LOCATION_STALE', 'system');
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

select cron.schedule('document-expiry', '0 0 * * *', 'select private.process_document_expiry()'); -- 06:00 Asia/Dhaka
select cron.schedule('offline-stale-drivers', '30 seconds', 'select private.offline_stale_drivers()');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema api from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

grant execute on function
  private.has_permission(text), private.is_admin(), private.has_aal2(), private.current_app_role(),
  private.can_upload_driver_document(text), private.my_driver_id()
to authenticated;
grant execute on function private.custom_access_token_hook(jsonb) to supabase_auth_admin;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api'
  loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
