-- Ride lifecycle: quotes, requests, dispatch, offers, trips, cancellations, completion.
-- Spec: docs/spec/04-business-logic.md §3–7. Every command is one transaction.

-- ---------------------------------------------------------------------------
-- Realtime helpers: broadcasts must never break the business transaction
-- ---------------------------------------------------------------------------
create function private.broadcast(p_topic text, p_event text, p_payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(p_payload, p_event, p_topic, true);
exception when others then
  null; -- a realtime hiccup must not roll back a ride
end $$;

create function private.log_request_event(
  p_request_id uuid, p_from public.ride_request_status, p_to public.ride_request_status,
  p_actor_type public.actor_type, p_reason text, p_data jsonb default '{}'
) returns void
language sql security definer set search_path = '' as $$
  insert into public.ride_request_events (request_id, from_status, to_status, actor_id, actor_type, reason, event_data)
  values (p_request_id, p_from, p_to, auth.uid(), p_actor_type, p_reason, coalesce(p_data, '{}'));
$$;

create function private.notify_ops(p_kind text, p_id uuid, p_status text) returns void
language sql security definer set search_path = '' as $$
  select private.broadcast('ops:live', 'changed', jsonb_build_object('kind', p_kind, 'id', p_id, 'status', p_status));
$$;

-- ---------------------------------------------------------------------------
-- Quotes
-- ---------------------------------------------------------------------------
create function api.create_quote(
  p_category_id uuid,
  p_pickup_lat double precision, p_pickup_lng double precision, p_pickup_label text,
  p_destination_lat double precision, p_destination_lng double precision, p_destination_label text,
  p_distance_m integer, p_duration_s integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_pickup extensions.geography;
  v_dest extensions.geography;
  v_zone public.service_zones;
  v_rule public.fare_rules;
  v_surge numeric;
  v_breakdown jsonb;
  v_id uuid;
  v_expires timestamptz := now() + make_interval(secs => coalesce((private.setting('quote.ttl_s'))::int, 300));
  v_stale int := coalesce((private.setting('location.stale_after_s'))::int, 120);
  v_speed numeric := coalesce((private.setting('dispatch.avg_speed_kmh'))::numeric, 25);
  v_nearby integer;
  v_nearest numeric;
begin
  perform private.require_role('passenger');
  if not exists (select 1 from public.vehicle_categories where id = p_category_id and active) then
    perform private.raise_error('NOT_FOUND', '{"field":"category_id"}');
  end if;
  v_pickup := private.point(p_pickup_lat, p_pickup_lng);
  v_dest := private.point(p_destination_lat, p_destination_lng);
  if p_distance_m is null or p_distance_m < 100 or p_distance_m > 300000 or p_duration_s is null or p_duration_s < 30 or p_duration_s > 86400 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"route","message":"The trip is too short or too long."}]}');
  end if;

  v_zone := private.zone_at(v_pickup);
  if v_zone.id is null then
    perform private.raise_error('OUT_OF_SERVICE_AREA');
  end if;
  v_rule := private.live_fare_rule(p_category_id, v_zone.id);
  if v_rule.id is null then
    perform private.raise_error('PRICING_UNAVAILABLE');
  end if;

  v_surge := least(v_zone.manual_surge_multiplier, v_rule.max_surge_multiplier);
  v_breakdown := private.compute_fare(private.rule_snapshot(v_rule), p_distance_m, p_duration_s, 0, v_surge);

  insert into public.fare_quotes (passenger_id, category_id, zone_id, fare_rule_id, pickup_point, pickup_label,
    destination_point, destination_label, estimated_distance_m, estimated_duration_s, surge_multiplier, breakdown,
    estimated_fare, pricing_rule_snapshot, expires_at)
  values (auth.uid(), p_category_id, v_zone.id, v_rule.id, v_pickup, left(btrim(p_pickup_label), 200),
    v_dest, left(btrim(p_destination_label), 200), p_distance_m, p_duration_s, v_surge, v_breakdown,
    (v_breakdown ->> 'total_amount')::numeric, private.rule_snapshot(v_rule), v_expires)
  returning id into v_id;

  -- Availability and pickup ETA for the passenger's decision.
  with near as materialized (
    select l.driver_id, extensions.st_distance(l.location, v_pickup) as dist
    from public.driver_live_locations l
    where l.updated_at > now() - make_interval(secs => v_stale) and extensions.st_dwithin(l.location, v_pickup, 5000)
  )
  select count(*), min(n.dist) into v_nearby, v_nearest
  from near n
  join public.driver_profiles d on d.id = n.driver_id
  join public.vehicles v on v.id = d.current_vehicle_id and v.status = 'active' and v.category_id = p_category_id
  where d.availability = 'online' and d.onboarding_status = 'approved';

  return jsonb_build_object(
    'id', v_id, 'category_id', p_category_id, 'zone', jsonb_build_object('id', v_zone.id, 'name', v_zone.name),
    'estimated_fare', (v_breakdown ->> 'total_amount')::numeric, 'currency', 'BDT',
    'breakdown', v_breakdown, 'surge_multiplier', v_surge,
    'distance_m', p_distance_m, 'duration_s', p_duration_s, 'expires_at', v_expires,
    'available_drivers', v_nearby,
    'pickup_eta_s', case when v_nearest is null then null else round(v_nearest / (v_speed / 3.6))::int end);
end $$;

-- ---------------------------------------------------------------------------
-- Dispatch
-- ---------------------------------------------------------------------------
create function private.withdraw_pending_offers(p_request_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o public.dispatch_offers;
begin
  for o in select * from public.dispatch_offers where request_id = p_request_id and response = 'pending' for update loop
    update public.dispatch_offers set response = 'withdrawn', responded_at = now(), rejection_reason = p_reason where id = o.id;
    perform private.broadcast('driver:' || o.driver_id, 'offer_withdrawn', jsonb_build_object('offer_id', o.id, 'request_id', p_request_id));
  end loop;
end $$;

create function private.close_request_no_driver(p_request public.ride_requests, p_reason text, p_actor public.actor_type default 'system')
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.withdraw_pending_offers(p_request.id, 'request closed');
  update public.ride_requests set status = 'no_driver_found', closed_at = now(), cancel_reason = p_reason where id = p_request.id;
  perform private.log_request_event(p_request.id, p_request.status, 'no_driver_found', p_actor, p_reason);
  perform private.broadcast('ride:' || p_request.id, 'status_changed',
    jsonb_build_object('request_id', p_request.id, 'status', 'no_driver_found'));
  perform private.notify_ops('request', p_request.id, 'no_driver_found');
end $$;

-- Sends the request to the best eligible driver, widening the radius when nobody is in range.
create function private.dispatch_next(p_request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.ride_requests;
  v_radii jsonb := coalesce(private.setting('dispatch.search_radius_m'), '[1500,3000,5000]');
  v_levels integer := jsonb_array_length(coalesce(private.setting('dispatch.search_radius_m'), '[1500,3000,5000]'));
  v_stale integer := coalesce((private.setting('location.stale_after_s'))::int, 120);
  v_timeout integer := coalesce((private.setting('dispatch.offer_timeout_s'))::int, 15);
  v_speed numeric := coalesce((private.setting('dispatch.avg_speed_kmh'))::numeric, 25);
  v_round integer;
  v_driver uuid;
  v_dist numeric;
  v_offer uuid;
  v_rank integer;
  v_expires timestamptz;
begin
  select * into r from public.ride_requests where id = p_request_id for update;
  if not found or r.status <> 'searching' then
    return;
  end if;
  if r.expires_at <= now() then
    perform private.close_request_no_driver(r, 'No driver accepted in time');
    return;
  end if;
  if exists (select 1 from public.dispatch_offers where request_id = r.id and response = 'pending') then
    return;
  end if;

  v_round := r.dispatch_round;
  loop
    -- Spatial filter first (GiST), materialised: left to itself the planner scans every driver
    -- profile (49 ms at 10k drivers); geo-first is 8-14 ms (tests/load/bench-candidates.sql).
    with near as materialized (
      select l.driver_id, extensions.st_distance(l.location, r.pickup_point) as dist
      from public.driver_live_locations l
      where l.updated_at > now() - make_interval(secs => v_stale)
        and extensions.st_dwithin(l.location, r.pickup_point, (v_radii ->> v_round)::numeric)
    )
    select d.id, n.dist into v_driver, v_dist
    from near n
    join public.driver_profiles d on d.id = n.driver_id
    join public.profiles p on p.id = d.user_id and p.status = 'active'
    join public.vehicles v on v.id = d.current_vehicle_id and v.status = 'active' and v.category_id = r.category_id
    where d.availability = 'online' and d.onboarding_status = 'approved'
      and not exists (select 1 from public.dispatch_offers o where o.request_id = r.id and o.driver_id = d.id)
      and not exists (select 1 from public.dispatch_offers o where o.driver_id = d.id and o.response = 'pending')
    order by n.dist, d.acceptance_rate_30d desc nulls last
    limit 1
    for update of d skip locked;

    exit when v_driver is not null;
    if v_round >= v_levels - 1 then
      perform private.close_request_no_driver(r, 'No available driver nearby');
      return;
    end if;
    v_round := v_round + 1;
  end loop;

  if v_round <> r.dispatch_round then
    update public.ride_requests set dispatch_round = v_round where id = r.id;
  end if;
  select coalesce(max(rank), 0) + 1 into v_rank from public.dispatch_offers where request_id = r.id;
  v_expires := least(now() + make_interval(secs => v_timeout), r.expires_at);

  insert into public.dispatch_offers (request_id, driver_id, round, rank, pickup_distance_m, pickup_eta_s, expires_at)
  values (r.id, v_driver, v_round, v_rank, round(v_dist)::int, round(v_dist / (v_speed / 3.6))::int, v_expires)
  returning id into v_offer;

  perform private.broadcast('driver:' || v_driver, 'offer_created',
    jsonb_build_object('offer_id', v_offer, 'request_id', r.id, 'expires_at', v_expires));
  perform private.notify_ops('request', r.id, 'searching');
end $$;

-- ---------------------------------------------------------------------------
-- Ride requests (passenger)
-- ---------------------------------------------------------------------------
create function api.create_ride_request(p_quote_id uuid, p_payment_method public.payment_method, p_pickup_note text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  q public.fare_quotes;
  v_id uuid;
  v_ttl integer := coalesce((private.setting('dispatch.request_ttl_s'))::int, 180);
begin
  perform private.require_role('passenger');
  select * into q from public.fare_quotes where id = p_quote_id and passenger_id = auth.uid();
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if q.expires_at <= now() then
    perform private.raise_error('QUOTE_EXPIRED');
  end if;
  if not (coalesce(private.setting('payments.enabled_methods'), '["cash"]') ? p_payment_method::text) then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"payment_method","message":"This payment method is not available yet."}]}');
  end if;
  if exists (select 1 from public.ride_requests where quote_id = p_quote_id) then
    perform private.raise_error('QUOTE_EXPIRED', '{"reason":"quote already used"}');
  end if;
  -- Re-check the zone: it may have been switched off since the quote.
  if private.zone_at(q.pickup_point) is null then
    perform private.raise_error('OUT_OF_SERVICE_AREA');
  end if;

  begin
    insert into public.ride_requests (passenger_id, quote_id, category_id, zone_id, pickup_point, pickup_label, pickup_note,
      destination_point, destination_label, estimated_distance_m, estimated_duration_s, estimated_fare, quoted_rule_id,
      payment_method, status, expires_at)
    values (auth.uid(), q.id, q.category_id, q.zone_id, q.pickup_point, q.pickup_label, left(btrim(p_pickup_note), 300),
      q.destination_point, q.destination_label, q.estimated_distance_m, q.estimated_duration_s, q.estimated_fare, q.fare_rule_id,
      p_payment_method, 'searching', now() + make_interval(secs => v_ttl))
    returning id into v_id;
  exception when unique_violation then
    perform private.raise_error('ACTIVE_REQUEST_EXISTS');
  end;

  perform private.log_request_event(v_id, null, 'searching', 'passenger', null);
  perform private.dispatch_next(v_id);
  perform private.notify_ops('request', v_id, 'searching');
  return api.get_ride(v_id);
end $$;

-- Ride state for the passenger: request, trip, driver and vehicle summary.
create function api.get_ride(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  select jsonb_build_object(
    'id', r.id, 'status', r.status, 'category_id', r.category_id,
    'pickup', jsonb_build_object('label', r.pickup_label, 'lat', extensions.st_y(r.pickup_point::extensions.geometry),
                                 'lng', extensions.st_x(r.pickup_point::extensions.geometry)),
    'destination', jsonb_build_object('label', r.destination_label, 'lat', extensions.st_y(r.destination_point::extensions.geometry),
                                      'lng', extensions.st_x(r.destination_point::extensions.geometry)),
    'estimated_fare', r.estimated_fare, 'currency', 'BDT', 'payment_method', r.payment_method,
    'requested_at', r.requested_at, 'expires_at', r.expires_at, 'cancel_reason', r.cancel_reason,
    'trip', (select jsonb_build_object(
        'id', t.id, 'status', t.status, 'accepted_at', t.accepted_at, 'arrived_at', t.arrived_at, 'started_at', t.started_at,
        'completed_at', t.completed_at, 'final_fare', t.final_fare, 'cancellation_fee', t.cancellation_fee,
        'cancellation_reason', t.cancellation_reason, 'pickup_eta_s', t.accepted_pickup_eta_s,
        'driver', jsonb_build_object(
          'name', dp.full_name, 'phone_masked', private.mask_phone(dp.phone), 'rating_avg', d.rating_avg, 'rating_count', d.rating_count,
          'vehicle', jsonb_build_object('registration_number', v.registration_number, 'make', v.make, 'model', v.model, 'color', v.color),
          'location', case when t.status in ('driver_assigned', 'driver_arriving', 'arrived', 'in_progress') then (
              select jsonb_build_object('lat', extensions.st_y(l.location::extensions.geometry),
                                        'lng', extensions.st_x(l.location::extensions.geometry),
                                        'heading', l.heading, 'updated_at', l.updated_at)
              from public.driver_live_locations l where l.driver_id = d.id) end))
      from public.trips t
      join public.driver_profiles d on d.id = t.driver_id
      join public.profiles dp on dp.id = d.user_id
      join public.vehicles v on v.id = t.vehicle_id
      where t.request_id = r.id)
  ) into v
  from public.ride_requests r
  where r.id = p_request_id and (r.passenger_id = auth.uid() or private.has_permission('trips.view'));
  if v is null then
    perform private.raise_error('NOT_FOUND');
  end if;
  return v;
end $$;

create function api.list_my_rides(p_limit integer default 20, p_cursor text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_ts timestamptz;
  v_id uuid;
  v_rows jsonb;
begin
  perform private.require_role('passenger');
  if p_cursor is not null then
    v_ts := split_part(p_cursor, '|', 1)::timestamptz;
    v_id := split_part(p_cursor, '|', 2)::uuid;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'status', r.status, 'requested_at', r.requested_at, 'pickup_label', r.pickup_label,
    'destination_label', r.destination_label, 'estimated_fare', r.estimated_fare,
    'final_fare', (select t.final_fare from public.trips t where t.request_id = r.id),
    'trip_status', (select t.status from public.trips t where t.request_id = r.id)
  ) order by r.requested_at desc, r.id desc), '[]') into v_rows
  from (select * from public.ride_requests where passenger_id = auth.uid()
        and (v_ts is null or (requested_at, id) < (v_ts, v_id))
        order by requested_at desc, id desc limit v_limit + 1) r;
  return jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(x), '[]') from (select x from jsonb_array_elements(v_rows) with ordinality e(x, n) where n <= v_limit order by n) t),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit
      then (v_rows -> (v_limit - 1) ->> 'requested_at') || '|' || (v_rows -> (v_limit - 1) ->> 'id') end);
end $$;

-- ---------------------------------------------------------------------------
-- Driver offers
-- ---------------------------------------------------------------------------
create function private.offer_json(p_offer_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'offer_id', o.id, 'request_id', r.id, 'expires_at', o.expires_at, 'pickup_distance_m', o.pickup_distance_m,
    'pickup_eta_s', o.pickup_eta_s,
    'pickup', jsonb_build_object('label', r.pickup_label, 'note', r.pickup_note, 'lat', extensions.st_y(r.pickup_point::extensions.geometry),
                                 'lng', extensions.st_x(r.pickup_point::extensions.geometry)),
    'destination', jsonb_build_object('label', r.destination_label, 'lat', extensions.st_y(r.destination_point::extensions.geometry),
                                      'lng', extensions.st_x(r.destination_point::extensions.geometry)),
    'distance_m', r.estimated_distance_m, 'duration_s', r.estimated_duration_s,
    'estimated_fare', r.estimated_fare, 'currency', 'BDT', 'payment_method', r.payment_method,
    'estimated_driver_earning', (select (q.breakdown ->> 'driver_earning')::numeric from public.fare_quotes q where q.id = r.quote_id),
    'passenger_first_name', split_part(p.full_name, ' ', 1))
  from public.dispatch_offers o
  join public.ride_requests r on r.id = o.request_id
  join public.profiles p on p.id = r.passenger_id
  where o.id = p_offer_id;
$$;

create function api.driver_current_offer() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_offer uuid;
begin
  perform private.require_role('driver');
  select o.id into v_offer from public.dispatch_offers o
  where o.driver_id = private.my_driver_id() and o.response = 'pending' and o.expires_at > now();
  return case when v_offer is null then null else private.offer_json(v_offer) end;
end $$;

-- ---------------------------------------------------------------------------
-- Trip state machine: the single place trip status changes
-- ---------------------------------------------------------------------------
create function private.trip_transition_allowed(p_from public.trip_status, p_to public.trip_status) returns boolean
language sql immutable set search_path = '' as $$
  select case p_from
    when 'driver_assigned' then p_to in ('driver_arriving', 'arrived', 'cancelled_by_passenger', 'cancelled_by_driver', 'cancelled_by_admin', 'failed')
    when 'driver_arriving' then p_to in ('arrived', 'cancelled_by_passenger', 'cancelled_by_driver', 'cancelled_by_admin', 'failed')
    when 'arrived' then p_to in ('in_progress', 'cancelled_by_passenger', 'cancelled_by_driver', 'cancelled_by_admin', 'failed')
    -- Once the ride has started only completion or an admin/system exit is possible (docs/spec/04 §5).
    when 'in_progress' then p_to in ('completed', 'cancelled_by_admin', 'failed')
    else false end;
$$;

-- Lock order everywhere: request, then offers, then trip, then driver. One order = no deadlocks.
create function private.lock_trip(p_trip_id uuid) returns public.trips
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
  v_request uuid;
begin
  select request_id into v_request from public.trips where id = p_trip_id;
  if v_request is null then
    perform private.raise_error('NOT_FOUND');
  end if;
  perform 1 from public.ride_requests where id = v_request for update;
  select * into t from public.trips where id = p_trip_id for update;
  return t;
end $$;

create function private.transition_trip(
  p_trip_id uuid, p_to public.trip_status, p_actor public.actor_type, p_reason text, p_data jsonb default '{}',
  p_location extensions.geography default null
) returns public.trips
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
  v_request_status public.ride_request_status;
  v_driver public.driver_profiles;
begin
  t := private.lock_trip(p_trip_id);
  if not private.trip_transition_allowed(t.status, p_to) then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('from', t.status, 'to', p_to));
  end if;

  perform set_config('app.trip_transition', 'on', true);
  update public.trips set
    status = p_to,
    arriving_at = case when p_to = 'driver_arriving' then now() else arriving_at end,
    arrived_at = case when p_to = 'arrived' then now() else arrived_at end,
    started_at = case when p_to = 'in_progress' then now() else started_at end,
    completed_at = case when p_to = 'completed' then now() else completed_at end,
    cancelled_at = case when p_to in ('cancelled_by_passenger', 'cancelled_by_driver', 'cancelled_by_admin', 'failed') then now() else cancelled_at end,
    cancellation_reason = case when p_to in ('cancelled_by_passenger', 'cancelled_by_driver', 'cancelled_by_admin', 'failed') then p_reason else cancellation_reason end,
    cancelled_by_actor = case when p_to in ('cancelled_by_passenger', 'cancelled_by_driver', 'cancelled_by_admin', 'failed') then p_actor else cancelled_by_actor end,
    start_point = case when p_to = 'in_progress' then coalesce(p_location, start_point) else start_point end,
    end_point = case when p_to = 'completed' then coalesce(p_location, end_point) else end_point end
  where id = p_trip_id
  returning * into t;
  perform set_config('app.trip_transition', 'off', true);

  insert into public.trip_status_events (trip_id, from_status, to_status, actor_id, actor_type, reason, event_data, location)
  values (p_trip_id, (select e.to_status from public.trip_status_events e where e.trip_id = p_trip_id order by e.id desc limit 1),
          p_to, auth.uid(), p_actor, p_reason, coalesce(p_data, '{}'), p_location);

  -- Mirror the outcome on the request so a passenger can ride again.
  if p_to in ('completed', 'cancelled_by_passenger', 'cancelled_by_driver', 'cancelled_by_admin', 'failed') then
    v_request_status := (case p_to
      when 'completed' then 'completed' when 'cancelled_by_passenger' then 'cancelled_by_passenger'
      when 'cancelled_by_driver' then 'cancelled_by_driver' when 'cancelled_by_admin' then 'cancelled_by_admin' else 'failed' end)::public.ride_request_status;
    update public.ride_requests set status = v_request_status, closed_at = now(),
      cancel_reason = case when p_to = 'completed' then cancel_reason else p_reason end
    where id = t.request_id;
    perform private.log_request_event(t.request_id, 'matched', v_request_status, p_actor, p_reason);

    -- Free the driver (they stay online only if still eligible).
    select * into v_driver from public.driver_profiles where id = t.driver_id for update;
    if v_driver.availability = 'on_trip' then
      update public.driver_profiles
      set availability = (case when v_driver.onboarding_status = 'approved' then 'online' else 'offline' end)::public.driver_availability
      where id = v_driver.id;
      perform private.log_driver_event(v_driver.id, 'availability', 'on_trip',
        case when v_driver.onboarding_status = 'approved' then 'online' else 'offline' end, 'Trip ended', p_actor);
    end if;
  end if;

  perform private.broadcast('ride:' || t.request_id, 'status_changed',
    jsonb_build_object('request_id', t.request_id, 'trip_id', t.id, 'trip_status', p_to, 'final_fare', t.final_fare));
  perform private.broadcast('driver:' || t.driver_id, 'trip_status_changed',
    jsonb_build_object('trip_id', t.id, 'trip_status', p_to));
  perform private.notify_ops('trip', t.id, p_to::text);
  return t;
end $$;

-- ---------------------------------------------------------------------------
-- Accept / reject: atomic assignment
-- ---------------------------------------------------------------------------
create function api.accept_offer(p_offer_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver public.driver_profiles := private.my_driver();
  o public.dispatch_offers;
  r public.ride_requests;
  q public.fare_quotes;
  v_trip public.trips;
  v_request_id uuid;
begin
  -- Locks serialise competing accepts, expiry ticks and cancellations: request first, then the offer.
  select request_id into v_request_id from public.dispatch_offers where id = p_offer_id and driver_id = v_driver.id;
  if not found then
    perform private.raise_error('OFFER_NO_LONGER_AVAILABLE');
  end if;
  select * into r from public.ride_requests where id = v_request_id for update;
  select * into o from public.dispatch_offers where id = p_offer_id for update;
  if o.response = 'accepted' then
    -- A retry of the same accept returns the same trip instead of an error.
    select * into v_trip from public.trips where request_id = o.request_id and driver_id = v_driver.id;
    if found then
      return api.get_driver_trip(v_trip.id);
    end if;
  end if;
  if o.response <> 'pending' or o.expires_at <= now() then
    perform private.raise_error('OFFER_NO_LONGER_AVAILABLE');
  end if;

  if r.status <> 'searching' then
    perform private.raise_error('OFFER_NO_LONGER_AVAILABLE');
  end if;

  select * into v_driver from public.driver_profiles where id = v_driver.id for update;
  if v_driver.availability <> 'online' or v_driver.onboarding_status <> 'approved' then
    perform private.raise_error('OFFER_NO_LONGER_AVAILABLE');
  end if;
  if not exists (select 1 from public.vehicles where id = v_driver.current_vehicle_id and status = 'active') then
    perform private.raise_error('VEHICLE_NOT_ACTIVE');
  end if;

  select * into q from public.fare_quotes where id = r.quote_id;
  insert into public.trips (request_id, passenger_id, driver_id, vehicle_id, status, payment_method, fare_rule_id,
    pricing_rule_snapshot, accepted_pickup_eta_s)
  values (r.id, r.passenger_id, v_driver.id, v_driver.current_vehicle_id, 'driver_assigned', r.payment_method,
    q.fare_rule_id, q.pricing_rule_snapshot, o.pickup_eta_s)
  returning * into v_trip;

  update public.dispatch_offers set response = 'accepted', responded_at = now() where id = o.id;
  update public.ride_requests set status = 'matched', matched_at = now() where id = r.id;
  update public.driver_profiles set availability = 'on_trip' where id = v_driver.id;

  perform private.log_request_event(r.id, 'searching', 'matched', 'driver', null, jsonb_build_object('driver_id', v_driver.id, 'offer_id', o.id));
  insert into public.trip_status_events (trip_id, from_status, to_status, actor_id, actor_type, reason)
  values (v_trip.id, null, 'driver_assigned', auth.uid(), 'driver', null);
  perform private.log_driver_event(v_driver.id, 'availability', 'online', 'on_trip', 'Accepted a ride', 'driver');

  perform private.broadcast('ride:' || r.id, 'status_changed',
    jsonb_build_object('request_id', r.id, 'trip_id', v_trip.id, 'trip_status', 'driver_assigned', 'status', 'matched'));
  perform private.notify_ops('trip', v_trip.id, 'driver_assigned');
  return api.get_driver_trip(v_trip.id);
end $$;

create function api.reject_offer(p_offer_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver_id uuid := (private.my_driver()).id;
  o public.dispatch_offers;
  v_request_id uuid;
begin
  select request_id into v_request_id from public.dispatch_offers where id = p_offer_id and driver_id = v_driver_id;
  if not found then
    perform private.raise_error('OFFER_NO_LONGER_AVAILABLE');
  end if;
  perform 1 from public.ride_requests where id = v_request_id for update;
  select * into o from public.dispatch_offers where id = p_offer_id for update;
  if o.response <> 'pending' then
    perform private.raise_error('OFFER_NO_LONGER_AVAILABLE');
  end if;
  update public.dispatch_offers set response = 'rejected', responded_at = now(), rejection_reason = left(btrim(p_reason), 200) where id = o.id;
  perform private.dispatch_next(o.request_id);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Driver trip views and actions
-- ---------------------------------------------------------------------------
create function api.get_driver_trip(p_trip_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  perform private.require_role('driver');
  select jsonb_build_object(
    'id', t.id, 'request_id', t.request_id, 'status', t.status, 'accepted_at', t.accepted_at, 'arrived_at', t.arrived_at,
    'started_at', t.started_at, 'completed_at', t.completed_at, 'final_fare', t.final_fare,
    'estimated_fare', r.estimated_fare, 'currency', 'BDT', 'payment_method', t.payment_method,
    'cancellation_reason', t.cancellation_reason,
    'pickup', jsonb_build_object('label', r.pickup_label, 'note', r.pickup_note, 'lat', extensions.st_y(r.pickup_point::extensions.geometry),
                                 'lng', extensions.st_x(r.pickup_point::extensions.geometry)),
    'destination', jsonb_build_object('label', r.destination_label, 'lat', extensions.st_y(r.destination_point::extensions.geometry),
                                      'lng', extensions.st_x(r.destination_point::extensions.geometry)),
    'passenger', jsonb_build_object('first_name', split_part(p.full_name, ' ', 1), 'phone_masked', private.mask_phone(p.phone)),
    'breakdown', (select to_jsonb(b) - 'id' - 'trip_id' - 'pricing_rule_snapshot' from public.trip_fare_breakdowns b where b.trip_id = t.id))
  into v
  from public.trips t
  join public.ride_requests r on r.id = t.request_id
  join public.profiles p on p.id = t.passenger_id
  where t.id = p_trip_id and t.driver_id = private.my_driver_id();
  if v is null then
    perform private.raise_error('NOT_FOUND');
  end if;
  return v;
end $$;

create function api.driver_current_trip() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_trip uuid;
begin
  perform private.require_role('driver');
  select t.id into v_trip from public.trips t
  where t.driver_id = private.my_driver_id() and t.status in ('driver_assigned', 'driver_arriving', 'arrived', 'in_progress');
  return case when v_trip is null then null else api.get_driver_trip(v_trip) end;
end $$;

create function private.driver_trip(p_trip_id uuid) returns public.trips
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.trips;
begin
  perform private.require_role('driver');
  select * into t from public.trips where id = p_trip_id and driver_id = private.my_driver_id();
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  return t;
end $$;

create function api.driver_trip_arriving(p_trip_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips := private.driver_trip(p_trip_id);
begin
  if t.status = 'driver_arriving' then
    return api.get_driver_trip(p_trip_id); -- idempotent
  end if;
  perform private.transition_trip(p_trip_id, 'driver_arriving', 'driver', null);
  return api.get_driver_trip(p_trip_id);
end $$;

-- Marks arrival when within the arrival radius, or with an override that is logged and shown to admins.
create function api.driver_trip_arrived(p_trip_id uuid, p_override boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips := private.driver_trip(p_trip_id);
  r public.ride_requests;
  v_loc extensions.geography;
  v_dist numeric;
  v_radius numeric := coalesce((private.setting('trips.arrival_radius_m'))::numeric, 150);
  v_far boolean;
begin
  if t.status = 'arrived' then
    return api.get_driver_trip(p_trip_id);
  end if;
  select * into r from public.ride_requests where id = t.request_id;
  select location into v_loc from public.driver_live_locations where driver_id = t.driver_id;
  v_dist := case when v_loc is null then null else extensions.st_distance(v_loc, r.pickup_point) end;
  v_far := v_dist is null or v_dist > v_radius;
  if v_far and not coalesce(p_override, false) then
    perform private.raise_error('TOO_FAR_FROM_PICKUP', jsonb_build_object('distance_m', round(v_dist), 'radius_m', v_radius));
  end if;
  perform private.transition_trip(p_trip_id, 'arrived', 'driver', null,
    jsonb_build_object('distance_to_pickup_m', round(v_dist), 'override', v_far), v_loc);
  return api.get_driver_trip(p_trip_id);
end $$;

create function api.driver_trip_start(p_trip_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips := private.driver_trip(p_trip_id);
  v_loc extensions.geography;
begin
  if t.status = 'in_progress' then
    return api.get_driver_trip(p_trip_id);
  end if;
  select location into v_loc from public.driver_live_locations where driver_id = t.driver_id;
  perform private.transition_trip(p_trip_id, 'in_progress', 'driver', null, '{}', v_loc);
  return api.get_driver_trip(p_trip_id);
end $$;

-- ---------------------------------------------------------------------------
-- Cancellation (docs/spec/04-business-logic.md §7)
-- ---------------------------------------------------------------------------
create function private.passenger_cancel_fee(p_trip public.trips) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  v_free integer := coalesce((private.setting('cancellation.free_window_s'))::int, 120);
  v_fee numeric := coalesce((p_trip.pricing_rule_snapshot ->> 'cancellation_fee')::numeric, 0);
  v_late_after interval := make_interval(secs => greatest(2 * coalesce(p_trip.accepted_pickup_eta_s, 0), 600));
begin
  if p_trip.status = 'in_progress' then
    return 0;
  end if;
  if now() - p_trip.accepted_at <= make_interval(secs => v_free) then
    return 0;
  end if;
  -- A driver who hasn't arrived and is far later than promised: the passenger owes nothing.
  if p_trip.status in ('driver_assigned', 'driver_arriving') and now() - p_trip.accepted_at > v_late_after then
    return 0;
  end if;
  return v_fee;
end $$;

create function api.cancel_preview(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.ride_requests;
  t public.trips;
begin
  perform private.require_role('passenger');
  select * into r from public.ride_requests where id = p_request_id and passenger_id = auth.uid();
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  select * into t from public.trips where request_id = r.id;
  if not found then
    return jsonb_build_object('can_cancel', r.status = 'searching', 'fee', 0, 'currency', 'BDT');
  end if;
  return jsonb_build_object('can_cancel', t.status in ('driver_assigned', 'driver_arriving', 'arrived'),
                            'fee', private.passenger_cancel_fee(t), 'currency', 'BDT');
end $$;

create function api.cancel_ride(p_request_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.ride_requests;
  t public.trips;
  v_fee numeric;
begin
  perform private.require_role('passenger');
  select * into r from public.ride_requests where id = p_request_id and passenger_id = auth.uid() for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if r.status in ('cancelled_by_passenger', 'cancelled_by_driver', 'cancelled_by_admin', 'no_driver_found', 'failed', 'completed') then
    if r.status = 'cancelled_by_passenger' then
      return api.get_ride(p_request_id); -- idempotent
    end if;
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', r.status));
  end if;

  if r.status = 'searching' then
    perform private.withdraw_pending_offers(r.id, 'passenger cancelled');
    update public.ride_requests set status = 'cancelled_by_passenger', closed_at = now(), cancel_reason = coalesce(nullif(btrim(p_reason), ''), 'Cancelled by passenger')
    where id = r.id;
    perform private.log_request_event(r.id, 'searching', 'cancelled_by_passenger', 'passenger', p_reason);
    perform private.broadcast('ride:' || r.id, 'status_changed', jsonb_build_object('request_id', r.id, 'status', 'cancelled_by_passenger'));
    perform private.notify_ops('request', r.id, 'cancelled_by_passenger');
    return api.get_ride(r.id);
  end if;

  select * into t from public.trips where request_id = r.id for update;
  if t.status = 'in_progress' then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"the ride has started"}');
  end if;
  v_fee := private.passenger_cancel_fee(t);
  perform private.transition_trip(t.id, 'cancelled_by_passenger', 'passenger',
    coalesce(nullif(btrim(p_reason), ''), 'Cancelled by passenger'), jsonb_build_object('fee', v_fee));
  update public.trips set cancellation_fee = v_fee where id = t.id;
  return api.get_ride(r.id);
end $$;

create function api.driver_trip_cancel(p_trip_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips := private.driver_trip(p_trip_id);
begin
  if t.status = 'cancelled_by_driver' then
    return api.get_driver_trip(p_trip_id);
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"reason","message":"Tell us why you are cancelling."}]}');
  end if;
  perform private.transition_trip(p_trip_id, 'cancelled_by_driver', 'driver', left(btrim(p_reason), 300));
  return api.get_driver_trip(p_trip_id);
end $$;

-- ---------------------------------------------------------------------------
-- Completion: final fare computed from the trip's own rule snapshot
-- ---------------------------------------------------------------------------
create function api.complete_trip(p_trip_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips := private.driver_trip(p_trip_id);
  r public.ride_requests;
  v_loc extensions.geography;
  v_points integer;
  v_trail_m numeric;
  v_distance integer;
  v_source text;
  v_duration integer;
  v_waiting integer;
  v_surge numeric;
  v_b jsonb;
  v_review boolean;
  v_variance numeric := coalesce((private.setting('trips.fare_variance_pct'))::numeric, 30);
  v_factor numeric := coalesce((private.setting('trips.road_factor'))::numeric, 1.35);
begin
  if t.status = 'completed' then
    return api.get_driver_trip(p_trip_id); -- idempotent
  end if;
  t := private.lock_trip(p_trip_id);
  if t.status <> 'in_progress' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('from', t.status, 'to', 'completed'));
  end if;
  select * into r from public.ride_requests where id = t.request_id;
  select location into v_loc from public.driver_live_locations where driver_id = t.driver_id;

  -- Distance from the recorded trail; implausible points (poor accuracy, > 120 km/h) are dropped.
  with pts as (
    select location, recorded_at,
           lag(location) over (order by recorded_at, id) as prev_location,
           lag(recorded_at) over (order by recorded_at, id) as prev_at
    from public.trip_location_points
    where trip_id = t.id and (accuracy_m is null or accuracy_m <= 50)
  ), legs as (
    select extensions.st_distance(location, prev_location) as d,
           greatest(extract(epoch from recorded_at - prev_at), 0.001) as s
    from pts where prev_location is not null
  )
  select (select count(*) from public.trip_location_points where trip_id = t.id),
         coalesce(sum(d) filter (where d / s <= 33.3), 0)
  into v_points, v_trail_m from legs;

  if v_points >= 3 and v_trail_m >= 50 then
    v_distance := round(v_trail_m)::int;
    v_source := 'trail';
  else
    v_distance := round(coalesce(extensions.st_distance(coalesce(t.start_point, r.pickup_point), coalesce(v_loc, r.destination_point)) * v_factor,
                                 r.estimated_distance_m))::int;
    v_source := 'fallback';
  end if;
  v_distance := greatest(v_distance, 100);
  v_duration := greatest(round(extract(epoch from now() - t.started_at))::int, 30);
  v_waiting := greatest(round(extract(epoch from t.started_at - coalesce(t.arrived_at, t.started_at)))::int, 0);
  v_surge := coalesce((select (q.breakdown ->> 'surge_multiplier')::numeric from public.fare_quotes q where q.id = r.quote_id), 1);

  v_b := private.compute_fare(t.pricing_rule_snapshot, v_distance, v_duration, v_waiting, v_surge);
  v_review := (v_b ->> 'total_amount')::numeric > r.estimated_fare * (1 + v_variance / 100) or v_source = 'fallback';

  perform private.transition_trip(p_trip_id, 'completed', 'driver', null,
    jsonb_build_object('distance_source', v_source, 'trail_points', v_points), v_loc);

  insert into public.trip_fare_breakdowns (trip_id, base_amount, distance_amount, time_amount, surge_amount, waiting_amount,
    minimum_adjustment, rounding_amount, booking_fee, discount_amount, total_amount, commissionable_amount,
    platform_commission, driver_earning, commission_pct, distance_m, duration_s, pricing_rule_snapshot)
  values (p_trip_id, (v_b ->> 'base_amount')::numeric, (v_b ->> 'distance_amount')::numeric, (v_b ->> 'time_amount')::numeric,
    (v_b ->> 'surge_amount')::numeric, (v_b ->> 'waiting_amount')::numeric, (v_b ->> 'minimum_adjustment')::numeric,
    (v_b ->> 'rounding_amount')::numeric, (v_b ->> 'booking_fee')::numeric, (v_b ->> 'discount_amount')::numeric,
    (v_b ->> 'total_amount')::numeric, (v_b ->> 'commissionable_amount')::numeric, (v_b ->> 'platform_commission')::numeric,
    (v_b ->> 'driver_earning')::numeric, (v_b ->> 'commission_pct')::numeric, v_distance, v_duration, t.pricing_rule_snapshot);

  update public.trips set final_fare = (v_b ->> 'total_amount')::numeric, actual_distance_m = v_distance,
    actual_duration_s = v_duration, waiting_s = v_waiting, distance_source = v_source, fare_review_required = v_review
  where id = p_trip_id;

  return api.get_driver_trip(p_trip_id);
end $$;

-- Passenger receipt for a finished trip.
create function api.get_receipt(p_trip_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  perform private.require_role('passenger');
  select jsonb_build_object(
    'trip_id', t.id, 'status', t.status, 'completed_at', t.completed_at, 'currency', t.currency,
    'estimated_fare', r.estimated_fare, 'final_fare', t.final_fare, 'payment_method', t.payment_method,
    'distance_m', t.actual_distance_m, 'duration_s', t.actual_duration_s,
    'pickup_label', r.pickup_label, 'destination_label', r.destination_label,
    'breakdown', (select jsonb_build_object(
        'base', b.base_amount, 'distance', b.distance_amount, 'time', b.time_amount, 'surge', b.surge_amount,
        'waiting', b.waiting_amount, 'minimum_adjustment', b.minimum_adjustment, 'rounding', b.rounding_amount,
        'booking_fee', b.booking_fee, 'discount', b.discount_amount, 'total', b.total_amount)
      from public.trip_fare_breakdowns b where b.trip_id = t.id))
  into v
  from public.trips t join public.ride_requests r on r.id = t.request_id
  where t.id = p_trip_id and t.passenger_id = auth.uid() and t.status = 'completed';
  if v is null then
    perform private.raise_error('NOT_FOUND');
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Location ingest: live position + trip trail (replaces the M1 single-point RPC)
-- ---------------------------------------------------------------------------
create function api.driver_update_locations(p_points jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver_id uuid := (private.my_driver()).id;
  v_trip public.trips;
  p jsonb;
  v_latest jsonb;
  v_latest_at timestamptz;
  v_at timestamptz;
  v_prev timestamptz;
  v_loc extensions.geography;
  v_count integer := 0;
begin
  if jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) not between 1 and 20 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"points","message":"Send 1 to 20 points."}]}');
  end if;
  select * into v_trip from public.trips where driver_id = v_driver_id and status = 'in_progress';

  for p in select * from jsonb_array_elements(p_points) loop
    v_loc := private.point((p ->> 'lat')::double precision, (p ->> 'lng')::double precision);
    v_at := least((p ->> 'recorded_at')::timestamptz, now());
    if v_at < now() - interval '5 minutes' then
      continue; -- too old to trust
    end if;
    v_count := v_count + 1;
    if v_latest_at is null or v_at >= v_latest_at then
      v_latest := p;
      v_latest_at := v_at;
    end if;
    if v_trip.id is not null then
      insert into public.trip_location_points (trip_id, actor_type, location, accuracy_m, speed_mps, recorded_at)
      values (v_trip.id, 'driver', v_loc, (p ->> 'accuracy')::numeric, (p ->> 'speed')::numeric, v_at);
    end if;
  end loop;
  if v_count = 0 then
    perform private.raise_error('LOCATION_STALE');
  end if;

  select updated_at into v_prev from public.driver_live_locations where driver_id = v_driver_id;
  insert into public.driver_live_locations (driver_id, location, heading, speed_mps, accuracy_m, recorded_at, updated_at)
  values (v_driver_id, private.point((v_latest ->> 'lat')::double precision, (v_latest ->> 'lng')::double precision),
          (v_latest ->> 'heading')::numeric, (v_latest ->> 'speed')::numeric, (v_latest ->> 'accuracy')::numeric, v_latest_at, now())
  on conflict (driver_id) do update set location = excluded.location, heading = excluded.heading, speed_mps = excluded.speed_mps,
    accuracy_m = excluded.accuracy_m, recorded_at = excluded.recorded_at, updated_at = now()
  where public.driver_live_locations.recorded_at <= excluded.recorded_at;

  -- Passenger follows the driver during an active trip (throttled to one broadcast per 3 s).
  select * into v_trip from public.trips where driver_id = v_driver_id and status in ('driver_assigned', 'driver_arriving', 'arrived', 'in_progress');
  if v_trip.id is not null and (v_prev is null or v_prev < now() - interval '3 seconds') then
    perform private.broadcast('ride:' || v_trip.request_id, 'driver_location',
      jsonb_build_object('lat', (v_latest ->> 'lat')::double precision, 'lng', (v_latest ->> 'lng')::double precision,
                         'heading', (v_latest ->> 'heading')::numeric, 'at', v_latest_at));
  end if;
  return jsonb_build_object('accepted', v_count);
end $$;
