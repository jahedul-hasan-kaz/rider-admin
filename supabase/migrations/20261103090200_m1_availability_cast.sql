-- Explicit enum cast for the availability target (db lint 42804).
create or replace function api.driver_set_availability(
  p_online boolean, p_lat double precision, p_lng double precision, p_accuracy_m numeric default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver public.driver_profiles := private.my_driver();
  v_point extensions.geography;
  v_vehicle public.vehicles;
  v_target public.driver_availability := (case when p_online then 'online' else 'offline' end)::public.driver_availability;
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
