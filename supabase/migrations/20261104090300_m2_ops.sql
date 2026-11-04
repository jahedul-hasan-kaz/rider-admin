-- M2 operations: dispatch tick, admin views and interventions, realtime authorisation,
-- M1 patches and grants. Spec: docs/spec/04-business-logic.md §4.3–4.4, docs/spec/06-admin-ui.md §5.3, 5.11, 5.12.

-- ---------------------------------------------------------------------------
-- M1 patches: a driver leaving the pool also withdraws their pending offer.
-- SKIP LOCKED + no request lock keeps the lock order (request -> offer -> trip -> driver) deadlock-free;
-- the dispatch tick re-offers the request within seconds.
-- ---------------------------------------------------------------------------
create function private.withdraw_driver_offers(p_driver_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o record;
begin
  for o in
    update public.dispatch_offers set response = 'withdrawn', responded_at = now(), rejection_reason = p_reason
    where id in (select id from public.dispatch_offers where driver_id = p_driver_id and response = 'pending' for update skip locked)
    returning id, request_id
  loop
    perform private.broadcast('driver:' || p_driver_id, 'offer_withdrawn', jsonb_build_object('offer_id', o.id, 'request_id', o.request_id));
  end loop;
end $$;

create or replace function private.take_driver_offline(p_driver public.driver_profiles, p_reason text, p_actor public.actor_type) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_driver.availability = 'online' then
    update public.driver_profiles set availability = 'offline' where id = p_driver.id;
    perform private.log_driver_event(p_driver.id, 'availability', 'online', 'offline', p_reason, p_actor);
  end if;
  perform private.withdraw_driver_offers(p_driver.id, p_reason);
end $$;

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
  if not p_online then
    perform private.withdraw_driver_offers(v_driver.id, 'driver went offline');
  end if;
  perform private.notify_ops('driver', v_driver.id, v_target::text);
  return jsonb_build_object('availability', v_target);
end $$;

-- ---------------------------------------------------------------------------
-- Dispatch tick (every 5 s): expire offers, expire requests, retry unmatched requests.
-- Idempotent and safe to run concurrently: it works request by request under the request lock.
-- ---------------------------------------------------------------------------
create function private.dispatch_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.ride_requests;
  o record;
  v_offers integer := 0;
  v_expired integer := 0;
  v_retried integer := 0;
begin
  -- 1. Offers nobody answered in time -> expired -> next driver.
  for r in
    select rq.* from public.ride_requests rq
    where rq.status = 'searching'
      and exists (select 1 from public.dispatch_offers d where d.request_id = rq.id and d.response = 'pending' and d.expires_at <= now())
    order by rq.requested_at limit 200
    for update of rq skip locked
  loop
    for o in
      update public.dispatch_offers set response = 'expired', responded_at = now()
      where request_id = r.id and response = 'pending' and expires_at <= now()
      returning id, driver_id
    loop
      perform private.broadcast('driver:' || o.driver_id, 'offer_withdrawn', jsonb_build_object('offer_id', o.id, 'request_id', r.id, 'reason', 'expired'));
      v_offers := v_offers + 1;
    end loop;
    perform private.dispatch_next(r.id);
  end loop;

  -- 2. Requests past their time limit.
  for r in
    select rq.* from public.ride_requests rq
    where rq.status = 'searching' and rq.expires_at <= now()
    order by rq.requested_at limit 200
    for update of rq skip locked
  loop
    perform private.close_request_no_driver(r, 'No driver accepted in time');
    v_expired := v_expired + 1;
  end loop;

  -- 3. Searching requests with no live offer (nobody was in range, or the driver left): try again.
  for r in
    select rq.* from public.ride_requests rq
    where rq.status = 'searching' and rq.expires_at > now()
      and not exists (select 1 from public.dispatch_offers d where d.request_id = rq.id and d.response = 'pending')
    order by rq.requested_at limit 200
    for update of rq skip locked
  loop
    perform private.dispatch_next(r.id);
    v_retried := v_retried + 1;
  end loop;

  return jsonb_build_object('offers_expired', v_offers, 'requests_expired', v_expired, 'retried', v_retried);
end $$;

select cron.schedule('dispatch-tick', '5 seconds', 'select private.dispatch_tick()');

-- ---------------------------------------------------------------------------
-- Realtime: who may listen to which private channel (docs/spec/05-api.md §2.6)
-- ---------------------------------------------------------------------------
create function private.can_receive_topic(p_topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_topic = 'ops:live' then private.has_permission('dispatch.view')
    when p_topic like 'driver:%' then p_topic = 'driver:' || coalesce(private.my_driver_id()::text, '-')
    when p_topic like 'ride:%' then
      exists (select 1 from public.ride_requests r where r.id::text = substr(p_topic, 6) and r.passenger_id = auth.uid())
      or exists (select 1 from public.trips t where t.request_id::text = substr(p_topic, 6) and t.driver_id = private.my_driver_id())
    else false end;
$$;

create policy realtime_receive on realtime.messages for select to authenticated
  using (extension = 'broadcast' and (select private.can_receive_topic((select realtime.topic()))));

-- ---------------------------------------------------------------------------
-- Admin: live operations snapshot (polled every 5 s; avoids per-update fan-out)
-- ---------------------------------------------------------------------------
create function api.ops_live_snapshot() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_median numeric;
  v_p90 numeric;
  v_requested integer;
  v_matched integer;
begin
  perform private.require_permission('dispatch.view');

  select percentile_cont(0.5) within group (order by extract(epoch from matched_at - requested_at)),
         percentile_cont(0.9) within group (order by extract(epoch from matched_at - requested_at)),
         count(*) filter (where matched_at is not null), count(*)
  into v_median, v_p90, v_matched, v_requested
  from public.ride_requests where requested_at > now() - interval '15 minutes';

  return jsonb_build_object(
    'generated_at', now(),
    'metrics', jsonb_build_object(
      'online_drivers', (select count(*) from public.driver_profiles where availability = 'online'),
      'on_trip_drivers', (select count(*) from public.driver_profiles where availability = 'on_trip'),
      'searching', (select count(*) from public.ride_requests where status = 'searching'),
      'active_trips', (select count(*) from public.trips where status in ('driver_assigned', 'driver_arriving', 'arrived', 'in_progress')),
      'requests_15m', v_requested, 'matched_15m', v_matched,
      'median_match_s', round(v_median), 'p90_match_s', round(v_p90),
      'no_driver_1h', (select count(*) from public.ride_requests where status = 'no_driver_found' and closed_at > now() - interval '1 hour')),
    'drivers', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', p.full_name, 'availability', d.availability,
        'lat', extensions.st_y(l.location::extensions.geometry), 'lng', extensions.st_x(l.location::extensions.geometry),
        'heading', l.heading, 'age_s', round(extract(epoch from now() - l.updated_at))))
      from (select * from public.driver_live_locations where updated_at > now() - interval '10 minutes' limit 2000) l
      join public.driver_profiles d on d.id = l.driver_id and d.availability <> 'offline'
      join public.profiles p on p.id = d.user_id), '[]'),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'passenger', split_part(p.full_name, ' ', 1),
        'lat', extensions.st_y(r.pickup_point::extensions.geometry), 'lng', extensions.st_x(r.pickup_point::extensions.geometry),
        'pickup_label', r.pickup_label, 'requested_at', r.requested_at, 'round', r.dispatch_round,
        'offers', (select count(*) from public.dispatch_offers o where o.request_id = r.id),
        'category', c.name) order by r.requested_at)
      from public.ride_requests r join public.profiles p on p.id = r.passenger_id
      join public.vehicle_categories c on c.id = r.category_id
      where r.status = 'searching'), '[]'),
    'trips', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status, 'request_id', t.request_id,
        'driver', dp.full_name, 'passenger', split_part(pp.full_name, ' ', 1), 'started_at', t.started_at,
        'pickup', jsonb_build_object('lat', extensions.st_y(r.pickup_point::extensions.geometry), 'lng', extensions.st_x(r.pickup_point::extensions.geometry)),
        'destination', jsonb_build_object('lat', extensions.st_y(r.destination_point::extensions.geometry), 'lng', extensions.st_x(r.destination_point::extensions.geometry)))
        order by t.accepted_at desc)
      from public.trips t join public.ride_requests r on r.id = t.request_id
      join public.driver_profiles d on d.id = t.driver_id join public.profiles dp on dp.id = d.user_id
      join public.profiles pp on pp.id = t.passenger_id
      where t.status in ('driver_assigned', 'driver_arriving', 'arrived', 'in_progress')
      limit 500), '[]'),
    'exceptions', jsonb_build_object(
      'fare_review', (select count(*) from public.trips where fare_review_required and created_at > now() - interval '24 hours'),
      'stuck_searching', (select count(*) from public.ride_requests where status = 'searching' and requested_at < now() - interval '90 seconds')));
end $$;

-- ---------------------------------------------------------------------------
-- Admin: requests
-- ---------------------------------------------------------------------------
create function private.request_row_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'status', r.status, 'requested_at', r.requested_at, 'closed_at', r.closed_at, 'matched_at', r.matched_at,
    'wait_s', round(extract(epoch from coalesce(r.matched_at, r.closed_at, now()) - r.requested_at)),
    'passenger', jsonb_build_object('id', p.id, 'name', p.full_name),
    'category', c.name, 'zone', z.name, 'pickup_label', r.pickup_label, 'destination_label', r.destination_label,
    'estimated_fare', r.estimated_fare, 'payment_method', r.payment_method, 'dispatch_round', r.dispatch_round,
    'offers_sent', (select count(*) from public.dispatch_offers o where o.request_id = r.id),
    'cancel_reason', r.cancel_reason,
    'trip_id', (select t.id from public.trips t where t.request_id = r.id),
    'trip_status', (select t.status from public.trips t where t.request_id = r.id))
  from public.ride_requests r
  join public.profiles p on p.id = r.passenger_id
  join public.vehicle_categories c on c.id = r.category_id
  join public.service_zones z on z.id = r.zone_id
  where r.id = p_id;
$$;

create function api.list_ride_requests(
  p_status text default null, p_search text default null, p_limit integer default 50, p_cursor text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_search text := nullif(btrim(p_search), '');
  v_ts timestamptz;
  v_id uuid;
  v_rows jsonb;
begin
  perform private.require_permission('trips.view');
  if p_status is not null and p_status not in ('searching', 'matched', 'no_driver_found', 'cancelled_by_passenger',
      'cancelled_by_driver', 'cancelled_by_admin', 'failed', 'completed') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"status","message":"Unknown status."}]}');
  end if;
  if p_cursor is not null then
    v_ts := split_part(p_cursor, '|', 1)::timestamptz;
    v_id := split_part(p_cursor, '|', 2)::uuid;
  end if;
  select coalesce(jsonb_agg(private.request_row_json(x.id) order by x.requested_at desc, x.id desc), '[]') into v_rows
  from (select r.id, r.requested_at from public.ride_requests r join public.profiles p on p.id = r.passenger_id
        where (p_status is null or r.status::text = p_status)
          and (v_search is null or p.full_name ilike '%' || v_search || '%' or r.id::text like lower(v_search) || '%')
          and (v_ts is null or (r.requested_at, r.id) < (v_ts, v_id))
        order by r.requested_at desc, r.id desc limit v_limit + 1) x;
  return jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(r), '[]') from (select r from jsonb_array_elements(v_rows) with ordinality e(r, n) where n <= v_limit order by n) t),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit
      then (v_rows -> (v_limit - 1) ->> 'requested_at') || '|' || (v_rows -> (v_limit - 1) ->> 'id') end);
end $$;

create function api.get_ride_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.ride_requests;
  v jsonb;
  v_coords boolean := private.has_permission('trips.view_location');
begin
  perform private.require_permission('trips.view');
  v := private.request_row_json(p_request_id);
  if v is null then
    perform private.raise_error('NOT_FOUND');
  end if;
  select * into r from public.ride_requests where id = p_request_id;
  if v_coords then
    insert into public.pii_access_logs (admin_id, subject_profile_id, field, reason)
    values (auth.uid(), r.passenger_id, 'request_points:' || r.id, 'Request review');
  end if;
  return v || jsonb_build_object(
    'pickup', case when v_coords then jsonb_build_object('lat', extensions.st_y(r.pickup_point::extensions.geometry), 'lng', extensions.st_x(r.pickup_point::extensions.geometry)) end,
    'destination', case when v_coords then jsonb_build_object('lat', extensions.st_y(r.destination_point::extensions.geometry), 'lng', extensions.st_x(r.destination_point::extensions.geometry)) end,
    'estimated_distance_m', r.estimated_distance_m, 'estimated_duration_s', r.estimated_duration_s,
    'pickup_note', r.pickup_note, 'expires_at', r.expires_at, 'version', r.version,
    'quote', (select jsonb_build_object('breakdown', q.breakdown, 'surge_multiplier', q.surge_multiplier,
        'rule_version', (q.pricing_rule_snapshot ->> 'rule_version')::int, 'expires_at', q.expires_at) from public.fare_quotes q where q.id = r.quote_id),
    'offers', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'rank', o.rank, 'round', o.round, 'driver_id', o.driver_id,
        'driver_name', dp.full_name, 'pickup_distance_m', o.pickup_distance_m, 'pickup_eta_s', o.pickup_eta_s, 'offered_at', o.offered_at,
        'responded_at', o.responded_at, 'response', o.response, 'reason', o.rejection_reason,
        'response_s', round(extract(epoch from o.responded_at - o.offered_at))) order by o.rank)
      from public.dispatch_offers o join public.driver_profiles d on d.id = o.driver_id join public.profiles dp on dp.id = d.user_id
      where o.request_id = r.id), '[]'),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'from_status', e.from_status, 'to_status', e.to_status,
        'actor_type', e.actor_type, 'actor_name', a.full_name, 'reason', e.reason, 'created_at', e.created_at) order by e.id)
      from public.ride_request_events e left join public.profiles a on a.id = e.actor_id where e.request_id = r.id), '[]'));
end $$;

create function api.redispatch_request(p_request_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.ride_requests;
  v_reason text;
begin
  perform private.require_permission('dispatch.intervene');
  v_reason := private.require_reason(p_reason);
  select * into r from public.ride_requests where id = p_request_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if r.status <> 'searching' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', r.status));
  end if;
  perform private.withdraw_pending_offers(r.id, 'admin re-dispatch');
  perform private.log_request_event(r.id, 'searching', 'searching', 'admin', v_reason, '{"action":"redispatch"}');
  perform private.dispatch_next(r.id);
  perform private.log_admin_action('request.redispatch', 'ride_request', r.id, null, null, v_reason);
  return api.get_ride_request(r.id);
end $$;

create function api.expire_request(p_request_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.ride_requests;
  v_reason text;
begin
  perform private.require_permission('dispatch.intervene');
  v_reason := private.require_reason(p_reason);
  select * into r from public.ride_requests where id = p_request_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if r.status <> 'searching' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', r.status));
  end if;
  perform private.close_request_no_driver(r, v_reason, 'admin');
  perform private.log_admin_action('request.expire', 'ride_request', r.id, jsonb_build_object('status', 'searching'),
    jsonb_build_object('status', 'no_driver_found'), v_reason);
  return api.get_ride_request(r.id);
end $$;

-- ---------------------------------------------------------------------------
-- Admin: trips
-- ---------------------------------------------------------------------------
create function private.trip_row_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id, 'request_id', t.request_id, 'status', t.status, 'created_at', t.created_at, 'accepted_at', t.accepted_at,
    'started_at', t.started_at, 'completed_at', t.completed_at, 'cancelled_at', t.cancelled_at,
    'passenger', jsonb_build_object('id', pp.id, 'name', pp.full_name),
    'driver', jsonb_build_object('id', d.id, 'user_id', dp.id, 'name', dp.full_name),
    'vehicle', jsonb_build_object('id', v.id, 'registration_number', v.registration_number, 'category', c.name),
    'zone', z.name, 'estimated_fare', r.estimated_fare, 'final_fare', t.final_fare, 'currency', t.currency,
    'distance_m', t.actual_distance_m, 'duration_s', t.actual_duration_s, 'payment_method', t.payment_method,
    'cancellation_fee', t.cancellation_fee, 'cancellation_reason', t.cancellation_reason, 'cancelled_by', t.cancelled_by_actor,
    'distance_source', t.distance_source, 'fare_review_required', t.fare_review_required,
    'pickup_label', r.pickup_label, 'destination_label', r.destination_label)
  from public.trips t
  join public.ride_requests r on r.id = t.request_id
  join public.profiles pp on pp.id = t.passenger_id
  join public.driver_profiles d on d.id = t.driver_id
  join public.profiles dp on dp.id = d.user_id
  join public.vehicles v on v.id = t.vehicle_id
  join public.vehicle_categories c on c.id = v.category_id
  join public.service_zones z on z.id = r.zone_id
  where t.id = p_id;
$$;

create function api.list_trips(
  p_status text default null, p_search text default null, p_flagged boolean default false,
  p_limit integer default 50, p_cursor text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_search text := nullif(btrim(p_search), '');
  v_ts timestamptz;
  v_id uuid;
  v_rows jsonb;
begin
  perform private.require_permission('trips.view');
  if p_status is not null and p_status not in ('active', 'cancelled', 'driver_assigned', 'driver_arriving', 'arrived', 'in_progress', 'completed',
      'cancelled_by_passenger', 'cancelled_by_driver', 'cancelled_by_admin', 'failed') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"status","message":"Unknown status."}]}');
  end if;
  if p_cursor is not null then
    v_ts := split_part(p_cursor, '|', 1)::timestamptz;
    v_id := split_part(p_cursor, '|', 2)::uuid;
  end if;
  select coalesce(jsonb_agg(private.trip_row_json(x.id) order by x.created_at desc, x.id desc), '[]') into v_rows
  from (select t.id, t.created_at from public.trips t
        join public.profiles pp on pp.id = t.passenger_id
        join public.driver_profiles d on d.id = t.driver_id join public.profiles dp on dp.id = d.user_id
        join public.vehicles v on v.id = t.vehicle_id
        where (p_status is null
               or (p_status = 'active' and t.status in ('driver_assigned', 'driver_arriving', 'arrived', 'in_progress'))
               or (p_status = 'cancelled' and t.status in ('cancelled_by_passenger', 'cancelled_by_driver', 'cancelled_by_admin', 'failed'))
               or t.status::text = p_status)
          and (not coalesce(p_flagged, false) or t.fare_review_required)
          and (v_search is null or pp.full_name ilike '%' || v_search || '%' or dp.full_name ilike '%' || v_search || '%'
               or v.registration_number ilike '%' || upper(v_search) || '%' or t.id::text like lower(v_search) || '%')
          and (v_ts is null or (t.created_at, t.id) < (v_ts, v_id))
        order by t.created_at desc, t.id desc limit v_limit + 1) x;
  return jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(r), '[]') from (select r from jsonb_array_elements(v_rows) with ordinality e(r, n) where n <= v_limit order by n) t),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit
      then (v_rows -> (v_limit - 1) ->> 'created_at') || '|' || (v_rows -> (v_limit - 1) ->> 'id') end,
    'counts', (select jsonb_build_object(
      'active', count(*) filter (where status in ('driver_assigned', 'driver_arriving', 'arrived', 'in_progress')),
      'flagged', count(*) filter (where fare_review_required and created_at > now() - interval '7 days'))
      from public.trips));
end $$;

create function api.get_trip(p_trip_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
  r public.ride_requests;
  v jsonb;
  v_coords boolean := private.has_permission('trips.view_location');
  v_trail jsonb;
begin
  perform private.require_permission('trips.view');
  v := private.trip_row_json(p_trip_id);
  if v is null then
    perform private.raise_error('NOT_FOUND');
  end if;
  select * into t from public.trips where id = p_trip_id;
  select * into r from public.ride_requests where id = t.request_id;

  if v_coords then
    -- Route trails are sensitive: reveal only with the permission, and log it (spec 03 §5).
    insert into public.pii_access_logs (admin_id, subject_profile_id, field, reason)
    values (auth.uid(), t.passenger_id, 'trip_route:' || t.id, 'Trip review');
    select coalesce(jsonb_agg(jsonb_build_array(round(extensions.st_x(p.location::extensions.geometry)::numeric, 6),
                                                round(extensions.st_y(p.location::extensions.geometry)::numeric, 6)) order by p.recorded_at), '[]')
    into v_trail
    from (select location, recorded_at from public.trip_location_points where trip_id = t.id order by recorded_at limit 3000) p;
  end if;

  return v || jsonb_build_object(
    'version', t.version, 'waiting_s', t.waiting_s, 'accepted_pickup_eta_s', t.accepted_pickup_eta_s,
    'pickup', case when v_coords then jsonb_build_object('lat', extensions.st_y(r.pickup_point::extensions.geometry), 'lng', extensions.st_x(r.pickup_point::extensions.geometry)) end,
    'destination', case when v_coords then jsonb_build_object('lat', extensions.st_y(r.destination_point::extensions.geometry), 'lng', extensions.st_x(r.destination_point::extensions.geometry)) end,
    'trail', v_trail,
    'estimated_distance_m', r.estimated_distance_m, 'estimated_duration_s', r.estimated_duration_s,
    'rule_version', (t.pricing_rule_snapshot ->> 'rule_version')::int,
    'breakdown', (select to_jsonb(b) - 'id' - 'trip_id' - 'pricing_rule_snapshot' from public.trip_fare_breakdowns b where b.trip_id = t.id),
    'quote', (select q.breakdown from public.fare_quotes q where q.id = r.quote_id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'from_status', e.from_status, 'to_status', e.to_status,
        'actor_type', e.actor_type, 'actor_name', a.full_name, 'reason', e.reason, 'event_data', e.event_data, 'created_at', e.created_at) order by e.id)
      from public.trip_status_events e left join public.profiles a on a.id = e.actor_id where e.trip_id = t.id), '[]'),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'author', a.full_name, 'created_at', n.created_at) order by n.created_at desc)
      from public.trip_notes n join public.profiles a on a.id = n.author_id where n.trip_id = t.id), '[]'));
end $$;

create function api.admin_cancel_trip(p_trip_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  t public.trips;
begin
  perform private.require_permission('trips.cancel');
  v_reason := private.require_reason(p_reason);
  t := private.lock_trip(p_trip_id);
  if t.id is null then
    perform private.raise_error('NOT_FOUND');
  end if;
  perform private.transition_trip(p_trip_id, 'cancelled_by_admin', 'admin', v_reason);
  perform private.log_admin_action('trip.cancel', 'trip', p_trip_id, jsonb_build_object('status', t.status),
    jsonb_build_object('status', 'cancelled_by_admin'), v_reason);
  return api.get_trip(p_trip_id);
end $$;

-- Marks a trip failed (driver vanished, unrecoverable). The record is kept; corrections are adjustments (M3).
create function api.resolve_trip_failed(p_trip_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  t public.trips;
begin
  perform private.require_permission('trips.resolve');
  v_reason := private.require_reason(p_reason);
  t := private.lock_trip(p_trip_id);
  if t.id is null then
    perform private.raise_error('NOT_FOUND');
  end if;
  perform private.transition_trip(p_trip_id, 'failed', 'admin', v_reason);
  perform private.log_admin_action('trip.resolve_failed', 'trip', p_trip_id, jsonb_build_object('status', t.status),
    jsonb_build_object('status', 'failed'), v_reason);
  return api.get_trip(p_trip_id);
end $$;

create function api.add_trip_note(p_trip_id uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission('trips.note');
  if p_body is null or length(btrim(p_body)) not between 1 and 4000 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"body","message":"Write a note of up to 4,000 characters."}]}');
  end if;
  if not exists (select 1 from public.trips where id = p_trip_id) then
    perform private.raise_error('NOT_FOUND');
  end if;
  insert into public.trip_notes (trip_id, author_id, body) values (p_trip_id, auth.uid(), btrim(p_body));
  perform private.log_admin_action('trip.note', 'trip', p_trip_id, null, null, null);
end $$;

-- ---------------------------------------------------------------------------
-- Grants (re-applied: functions are not executable by default)
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema api from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.has_permission(text), private.is_admin(), private.has_aal2(), private.current_app_role(),
  private.can_upload_driver_document(text), private.my_driver_id(), private.my_trip_ids(), private.can_receive_topic(text)
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
