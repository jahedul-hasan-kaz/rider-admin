-- Automatic demand-based surge (behind the `auto_surge` feature flag; manual zone surge keeps working).
-- Every minute, for each active zone and vehicle category: demand = requests still searching or made in the last
-- 5 minutes; supply = idle online drivers with a fresh location in the zone. Pressure above the target ratio raises the
-- multiplier, a step at a time (so prices never jump), and it falls back the same way. The quote freezes the multiplier,
-- so the passenger sees and pays exactly what the quote showed.

insert into public.app_settings (key, value, description, schema) values
  ('surge.auto_target_ratio', '1', 'Requests per idle driver at which surge starts to rise.',
   '{"group":"Dispatch","type":"number","min":0.2,"max":10,"default":1}'),
  ('surge.auto_sensitivity', '0.25', 'How much the multiplier rises for each extra request per idle driver above the target.',
   '{"group":"Dispatch","type":"number","min":0.05,"max":2,"default":0.25}'),
  ('surge.auto_step', '0.1', 'Largest change in the multiplier per minute (up or down).',
   '{"group":"Dispatch","type":"number","min":0.05,"max":0.5,"default":0.1}')
on conflict (key) do nothing;

create table public.zone_surge_state (
  zone_id uuid not null references public.service_zones (id),
  category_id uuid not null references public.vehicle_categories (id),
  multiplier numeric(4, 2) not null default 1.00 check (multiplier between 1 and 3),
  demand integer not null default 0,
  supply integer not null default 0,
  computed_at timestamptz not null default now(),
  primary key (zone_id, category_id)
);
alter table public.zone_surge_state enable row level security;
alter table public.zone_surge_state force row level security;
revoke all on public.zone_surge_state from public, anon, authenticated;
grant select on public.zone_surge_state to authenticated;
create policy zone_surge_read on public.zone_surge_state for select to authenticated
  using ((select private.has_permission('dashboard.view') or private.has_permission('fares.view') or private.has_permission('zones.view')));

create function private.recompute_surge() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  z record;
  v_target numeric := coalesce((private.setting('surge.auto_target_ratio'))::numeric, 1);
  v_sens numeric := coalesce((private.setting('surge.auto_sensitivity'))::numeric, 0.25);
  v_step numeric := coalesce((private.setting('surge.auto_step'))::numeric, 0.1);
  v_prev numeric;
  v_demand integer;
  v_supply integer;
  v_goal numeric;
  v_next numeric;
  n integer := 0;
begin
  for z in select zn.id as zone_id, zn.boundary, c.id as category_id from public.service_zones zn cross join public.vehicle_categories c where zn.active and c.active loop
    select count(*) into v_demand from public.ride_requests r
    where r.zone_id = z.zone_id and r.category_id = z.category_id and (r.status in ('requested', 'searching') or r.requested_at > now() - interval '5 minutes');
    select count(*) into v_supply from public.driver_live_locations l
      join public.driver_profiles d on d.id = l.driver_id join public.vehicles v on v.id = d.current_vehicle_id
    where d.availability = 'online' and l.updated_at > now() - interval '120 seconds' and v.category_id = z.category_id
      and extensions.st_intersects(z.boundary::extensions.geometry, l.location::extensions.geometry);
    select multiplier into v_prev from public.zone_surge_state where zone_id = z.zone_id and category_id = z.category_id;
    v_prev := coalesce(v_prev, 1);

    if private.flag_enabled('auto_surge', z.zone_id, z.category_id, null) then
      v_goal := 1 + greatest(v_demand::numeric / greatest(v_supply, 1) - v_target, 0) * v_sens;
    else
      v_goal := 1;
    end if;
    v_goal := least(greatest(v_goal, 1), 3);
    v_next := round(least(greatest(v_goal, v_prev - v_step), v_prev + v_step), 2);

    insert into public.zone_surge_state (zone_id, category_id, multiplier, demand, supply, computed_at)
    values (z.zone_id, z.category_id, v_next, v_demand, v_supply, now())
    on conflict (zone_id, category_id) do update set multiplier = excluded.multiplier, demand = excluded.demand, supply = excluded.supply, computed_at = excluded.computed_at;
    n := n + 1;
  end loop;
  return n;
end $$;
select cron.schedule('recompute-surge', '* * * * *', 'select private.recompute_surge()');

-- The automatic multiplier a quote should use right now (1 when the flag is off, the data is stale, or there is none).
create function private.auto_surge(p_zone uuid, p_category uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select multiplier from public.zone_surge_state
                   where zone_id = p_zone and category_id = p_category and computed_at > now() - interval '5 minutes'
                     and private.flag_enabled('auto_surge', p_zone, p_category, null)), 1);
$$;

create function api.surge_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_any_permission(array['dashboard.view', 'fares.view', 'zones.view']) then
    perform private.raise_error('FORBIDDEN');
  end if;
  return jsonb_build_object(
    'enabled', (select enabled from public.feature_flags where key = 'auto_surge'),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('zone', zn.name, 'category', c.name, 'auto', s.multiplier, 'manual', zn.manual_surge_multiplier,
        'effective', greatest(s.multiplier, zn.manual_surge_multiplier), 'demand', s.demand, 'supply', s.supply, 'computed_at', s.computed_at) order by zn.name, c.name), '[]')
      from public.zone_surge_state s join public.service_zones zn on zn.id = s.zone_id join public.vehicle_categories c on c.id = s.category_id where zn.active));
end $$;

-- Quotes use the automatic multiplier too.
create or replace function api.create_quote(
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

  -- The higher of the manual zone surge and the automatic one, never above the rule's cap.
  v_surge := least(greatest(v_zone.manual_surge_multiplier, private.auto_surge(v_zone.id, p_category_id)), v_rule.max_surge_multiplier);
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

revoke execute on all functions in schema api from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.has_permission(text), private.is_admin(), private.has_aal2(), private.current_app_role(),
  private.can_upload_driver_document(text), private.my_driver_id(), private.my_trip_ids(), private.can_receive_topic(text),
  private.can_upload_incident_evidence(text)
to authenticated;
grant execute on function private.custom_access_token_hook(jsonb) to supabase_auth_admin;
do $$
declare
  f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api'
           and p.proname not in ('claim_notifications', 'finish_notification', 'claim_storage_purges', 'finish_storage_purge') loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
