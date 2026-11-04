-- M2 pricing & ride lifecycle: schema, settings, RLS.
-- Spec: docs/spec/03-database.md §4.3–4.5, docs/spec/04-business-logic.md §3–7.
-- Payments, ledger and earnings arrive with M3; completion here freezes the fare breakdown only.

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.fare_rule_status as enum ('draft', 'scheduled', 'active', 'retired');
-- completed / cancelled_by_driver are mirrored from the trip so one open request per passenger is enforceable.
create type public.ride_request_status as enum (
  'requested', 'searching', 'matched', 'no_driver_found',
  'cancelled_by_passenger', 'cancelled_by_driver', 'cancelled_by_admin', 'failed', 'completed'
);
create type public.trip_status as enum (
  'driver_assigned', 'driver_arriving', 'arrived', 'in_progress', 'completed',
  'cancelled_by_passenger', 'cancelled_by_driver', 'cancelled_by_admin', 'failed'
);
create type public.offer_response as enum ('pending', 'accepted', 'rejected', 'expired', 'withdrawn');
create type public.payment_method as enum ('cash', 'bkash', 'nagad', 'card');

-- ---------------------------------------------------------------------------
-- Operational settings used by dispatch, quotes and cancellations
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('dispatch.offer_timeout_s', '15', 'Seconds a driver has to answer an offer.'),
  ('dispatch.search_radius_m', '[1500, 3000, 5000]', 'Search radii tried in order when looking for a driver.'),
  ('dispatch.request_ttl_s', '180', 'Seconds before an unmatched request expires.'),
  ('dispatch.avg_speed_kmh', '25', 'Average speed used for pickup ETA estimates.'),
  ('quote.ttl_s', '300', 'Seconds a fare quote stays valid.'),
  ('cancellation.free_window_s', '120', 'Passenger can cancel free within this time of assignment.'),
  ('cancellation.no_show_wait_min', '5', 'Minutes a driver waits at pickup before a no-show fee applies.'),
  ('trips.arrival_radius_m', '150', 'Driver must be this close to pickup to mark arrived.'),
  ('trips.fare_variance_pct', '30', 'Final fare above the estimate by more than this % is flagged for review.'),
  ('trips.road_factor', '1.35', 'Straight-line to road distance factor for fallbacks.'),
  ('payments.enabled_methods', '["cash"]', 'Payment methods passengers can choose.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- fare_rules: versioned, immutable once published
-- ---------------------------------------------------------------------------
create table public.fare_rules (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.vehicle_categories (id),
  zone_id uuid references public.service_zones (id),
  rule_version integer not null,
  status public.fare_rule_status not null default 'draft',
  base_fare numeric(12, 2) not null,
  per_km numeric(12, 2) not null,
  per_minute numeric(12, 2) not null,
  minimum_fare numeric(12, 2) not null,
  booking_fee numeric(12, 2) not null default 0,
  waiting_per_minute numeric(12, 2) not null default 0,
  free_waiting_minutes integer not null default 3,
  cancellation_fee numeric(12, 2) not null default 0,
  platform_commission_pct numeric(6, 4) not null,
  max_surge_multiplier numeric(4, 2) not null default 1.00,
  commissionable_components text[] not null default array['base', 'distance', 'time', 'waiting', 'surge'],
  effective_from timestamptz,
  effective_to timestamptz,
  published_by uuid references public.profiles (id),
  published_at timestamptz,
  change_note text,
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  constraint chk_fare_amounts check (
    base_fare >= 0 and per_km >= 0 and per_minute >= 0 and minimum_fare >= 0 and booking_fee >= 0
    and waiting_per_minute >= 0 and cancellation_fee >= 0
  ),
  constraint chk_fare_commission check (platform_commission_pct between 0 and 0.5),
  constraint chk_fare_surge check (max_surge_multiplier between 1 and 3),
  constraint chk_fare_waiting check (free_waiting_minutes between 0 and 60),
  constraint chk_fare_components check (commissionable_components <@ array['base', 'distance', 'time', 'waiting', 'surge']),
  constraint chk_fare_window check (effective_to is null or effective_from is null or effective_to > effective_from),
  constraint chk_fare_published check (status = 'draft' or effective_from is not null)
);

create unique index uq_fare_rules_version on public.fare_rules
  (category_id, coalesce(zone_id, '00000000-0000-0000-0000-000000000000'::uuid), rule_version);
create index idx_fare_rules_lookup on public.fare_rules (category_id, zone_id, effective_from)
  where status in ('scheduled', 'active');

-- Two rules can never be live for the same slot and window.
alter table public.fare_rules add constraint ex_fare_rules_no_overlap exclude using gist (
  category_id with =,
  (coalesce(zone_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
  tstzrange(effective_from, effective_to) with &&
) where (status in ('scheduled', 'active') and deleted_at is null);

-- Published rules are immutable except retirement and ending the window.
create function private.fare_rules_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status <> 'draft' then
    if (to_jsonb(new) - array['status', 'effective_to', 'updated_at', 'updated_by', 'version'])
       is distinct from (to_jsonb(old) - array['status', 'effective_to', 'updated_at', 'updated_by', 'version']) then
      perform private.raise_error('IMMUTABLE_ROW', '{"table":"fare_rules"}');
    end if;
    if new.status = 'draft' then
      perform private.raise_error('IMMUTABLE_ROW', '{"table":"fare_rules"}');
    end if;
  end if;
  return new;
end $$;

create trigger trg_fare_rules_immutable before update on public.fare_rules
  for each row execute function private.fare_rules_immutable();
create trigger trg_fare_rules_stamp before insert or update on public.fare_rules
  for each row execute function private.stamp_row();
create trigger trg_fare_rules_no_delete before delete on public.fare_rules
  for each row execute function private.forbid_delete();
create trigger trg_fare_rules_change_log after insert or update or delete on public.fare_rules
  for each row execute function audit.log_change();

-- ---------------------------------------------------------------------------
-- fare_quotes: what the passenger was shown (rule snapshot included)
-- ---------------------------------------------------------------------------
create table public.fare_quotes (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references public.profiles (id),
  category_id uuid not null references public.vehicle_categories (id),
  zone_id uuid not null references public.service_zones (id),
  fare_rule_id uuid not null references public.fare_rules (id),
  pickup_point extensions.geography(Point, 4326) not null,
  pickup_label text,
  destination_point extensions.geography(Point, 4326) not null,
  destination_label text,
  estimated_distance_m integer not null,
  estimated_duration_s integer not null,
  surge_multiplier numeric(4, 2) not null,
  breakdown jsonb not null,
  estimated_fare numeric(12, 2) not null,
  pricing_rule_snapshot jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint chk_quote_distance check (estimated_distance_m between 100 and 300000),
  constraint chk_quote_duration check (estimated_duration_s between 30 and 86400),
  constraint chk_quote_labels check (length(coalesce(pickup_label, '')) <= 200 and length(coalesce(destination_label, '')) <= 200)
);

create index idx_fare_quotes_passenger on public.fare_quotes (passenger_id, created_at desc);

-- ---------------------------------------------------------------------------
-- ride_requests + events
-- ---------------------------------------------------------------------------
create table public.ride_requests (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references public.profiles (id),
  quote_id uuid not null unique references public.fare_quotes (id),
  category_id uuid not null references public.vehicle_categories (id),
  zone_id uuid not null references public.service_zones (id),
  pickup_point extensions.geography(Point, 4326) not null,
  pickup_label text,
  pickup_note text,
  destination_point extensions.geography(Point, 4326) not null,
  destination_label text,
  estimated_distance_m integer not null,
  estimated_duration_s integer not null,
  estimated_fare numeric(12, 2) not null,
  quoted_rule_id uuid not null references public.fare_rules (id),
  payment_method public.payment_method not null default 'cash',
  status public.ride_request_status not null default 'searching',
  dispatch_round integer not null default 0,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  matched_at timestamptz,
  closed_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  constraint chk_request_note check (length(coalesce(pickup_note, '')) <= 300),
  constraint chk_request_cancel check (status not in ('cancelled_by_passenger', 'cancelled_by_admin') or cancel_reason is not null)
);

-- One open request per passenger: the DB, not the app, prevents duplicates.
create unique index uq_ride_requests_open_per_passenger on public.ride_requests (passenger_id)
  where status in ('requested', 'searching', 'matched');
create index idx_ride_requests_status on public.ride_requests (status, requested_at)
  where status in ('requested', 'searching');
create index idx_ride_requests_passenger on public.ride_requests (passenger_id, requested_at desc);
create index idx_ride_requests_requested on public.ride_requests (requested_at desc, id desc);
create index idx_ride_requests_pickup on public.ride_requests using gist (pickup_point);

create table public.ride_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.ride_requests (id),
  from_status public.ride_request_status,
  to_status public.ride_request_status not null,
  actor_id uuid references public.profiles (id),
  actor_type public.actor_type not null,
  reason text,
  event_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index idx_ride_request_events_request on public.ride_request_events (request_id, id);

-- ---------------------------------------------------------------------------
-- dispatch_offers
-- ---------------------------------------------------------------------------
create table public.dispatch_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.ride_requests (id),
  driver_id uuid not null references public.driver_profiles (id),
  round integer not null,
  rank integer not null,
  pickup_distance_m integer not null,
  pickup_eta_s integer not null,
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  response public.offer_response not null default 'pending',
  responded_at timestamptz,
  rejection_reason text,
  constraint uq_dispatch_offers_driver_per_request unique (request_id, driver_id)
);

-- Sequential dispatch: one live offer per request and per driver.
create unique index uq_dispatch_offers_one_pending_per_request on public.dispatch_offers (request_id) where response = 'pending';
create unique index uq_dispatch_offers_one_pending_per_driver on public.dispatch_offers (driver_id) where response = 'pending';
create index idx_dispatch_offers_expiry on public.dispatch_offers (expires_at) where response = 'pending';
create index idx_dispatch_offers_request on public.dispatch_offers (request_id, rank);

-- An answered offer is final.
create function private.dispatch_offers_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.response <> 'pending' then
    perform private.raise_error('IMMUTABLE_ROW', '{"table":"dispatch_offers"}');
  end if;
  return new;
end $$;
create trigger trg_dispatch_offers_guard before update on public.dispatch_offers
  for each row execute function private.dispatch_offers_guard();
create trigger trg_dispatch_offers_no_delete before delete on public.dispatch_offers
  for each row execute function private.forbid_delete();

-- ---------------------------------------------------------------------------
-- trips (one per request: atomic assignment)
-- ---------------------------------------------------------------------------
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.ride_requests (id),
  passenger_id uuid not null references public.profiles (id),
  driver_id uuid not null references public.driver_profiles (id),
  vehicle_id uuid not null references public.vehicles (id),
  status public.trip_status not null default 'driver_assigned',
  accepted_at timestamptz not null default now(),
  arriving_at timestamptz,
  arrived_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  actual_distance_m integer,
  actual_duration_s integer,
  waiting_s integer,
  final_fare numeric(12, 2),
  currency char(3) not null default 'BDT',
  payment_method public.payment_method not null default 'cash',
  cancellation_reason text,
  cancelled_by_actor public.actor_type,
  cancellation_fee numeric(12, 2) not null default 0,
  start_point extensions.geography(Point, 4326),
  end_point extensions.geography(Point, 4326),
  fare_rule_id uuid not null references public.fare_rules (id),
  pricing_rule_snapshot jsonb not null,
  accepted_pickup_eta_s integer,
  distance_source text,
  fare_review_required boolean not null default false,
  share_token_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  constraint chk_trips_currency check (currency ~ '^[A-Z]{3}$'),
  constraint chk_trips_fee check (cancellation_fee >= 0),
  constraint chk_trips_distance_source check (distance_source is null or distance_source in ('trail', 'fallback')),
  constraint chk_trips_cancel_reason check (status not in ('cancelled_by_driver', 'cancelled_by_admin', 'failed') or cancellation_reason is not null)
);

-- A driver can't be on two active trips.
create unique index uq_trips_one_active_per_driver on public.trips (driver_id)
  where status in ('driver_assigned', 'driver_arriving', 'arrived', 'in_progress');
create index idx_trips_status on public.trips (status, created_at desc);
create index idx_trips_passenger on public.trips (passenger_id, created_at desc);
create index idx_trips_driver on public.trips (driver_id, created_at desc);
create index idx_trips_created on public.trips (created_at desc, id desc);
create index idx_trips_review on public.trips (created_at desc) where fare_review_required;

-- Only private.transition_trip may change a trip's status.
create function private.trips_status_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('app.trip_transition', true), '') <> 'on' then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"status changes go through transition_trip"}');
  end if;
  if old.final_fare is not null and new.final_fare is distinct from old.final_fare then
    perform private.raise_error('IMMUTABLE_ROW', '{"table":"trips","column":"final_fare"}');
  end if;
  return new;
end $$;
create trigger trg_trips_status_guard before update on public.trips
  for each row execute function private.trips_status_guard();
create trigger trg_trips_stamp before insert or update on public.trips
  for each row execute function private.stamp_row();
create trigger trg_trips_no_delete before delete on public.trips
  for each row execute function private.forbid_delete();
create trigger trg_trips_change_log after insert or update or delete on public.trips
  for each row execute function audit.log_change();

create trigger trg_ride_requests_stamp before insert or update on public.ride_requests
  for each row execute function private.stamp_row();
create trigger trg_ride_requests_no_delete before delete on public.ride_requests
  for each row execute function private.forbid_delete();
create trigger trg_ride_requests_change_log after insert or update or delete on public.ride_requests
  for each row execute function audit.log_change();
create trigger trg_ride_request_events_append_only before update or delete on public.ride_request_events
  for each row execute function private.forbid_update_delete();

create table public.trip_status_events (
  id bigint generated always as identity primary key,
  trip_id uuid not null references public.trips (id),
  from_status public.trip_status,
  to_status public.trip_status not null,
  actor_id uuid references public.profiles (id),
  actor_type public.actor_type not null,
  reason text,
  event_data jsonb not null default '{}',
  location extensions.geography(Point, 4326),
  created_at timestamptz not null default now()
);
create index idx_trip_status_events_trip on public.trip_status_events (trip_id, id);
create trigger trg_trip_status_events_append_only before update or delete on public.trip_status_events
  for each row execute function private.forbid_update_delete();

-- ---------------------------------------------------------------------------
-- trip_location_points: partitioned monthly (sensitive location trail)
-- ---------------------------------------------------------------------------
create table public.trip_location_points (
  id bigint generated always as identity,
  trip_id uuid not null,
  actor_type public.actor_type not null default 'driver',
  location extensions.geography(Point, 4326) not null,
  accuracy_m numeric(7, 2),
  speed_mps numeric(6, 2),
  recorded_at timestamptz not null,
  primary key (id, recorded_at)
) partition by range (recorded_at);

create table public.trip_location_points_default partition of public.trip_location_points default;
create index idx_trip_location_points_trip on public.trip_location_points (trip_id, recorded_at);

create function private.ensure_trip_point_partitions(p_months_ahead integer default 3) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', now())::date;
  v_end date;
  v_name text;
begin
  for i in 0 .. p_months_ahead loop
    v_end := (v_month + interval '1 month')::date;
    v_name := 'trip_location_points_' || to_char(v_month, 'YYYY_MM');
    if to_regclass('public.' || v_name) is null then
      execute format('create table public.%I partition of public.trip_location_points for values from (%L) to (%L)', v_name, v_month, v_end);
    end if;
    v_month := v_end;
  end loop;
end $$;

select private.ensure_trip_point_partitions(3);
select cron.schedule('ensure-trip-point-partitions', '20 0 * * *', 'select private.ensure_trip_point_partitions(3)');

create trigger trg_trip_location_points_append_only before update or delete on public.trip_location_points
  for each row execute function private.forbid_update_delete();

create table public.trip_notes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id),
  author_id uuid not null references public.profiles (id),
  body text not null,
  created_at timestamptz not null default now(),
  constraint chk_trip_notes_body check (length(btrim(body)) between 1 and 4000)
);
create index idx_trip_notes_trip on public.trip_notes (trip_id, created_at);
create trigger trg_trip_notes_append_only before update or delete on public.trip_notes
  for each row execute function private.forbid_update_delete();

-- Frozen at completion: corrections are adjustments (M3), never edits.
create table public.trip_fare_breakdowns (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique references public.trips (id),
  base_amount numeric(12, 2) not null,
  distance_amount numeric(12, 2) not null,
  time_amount numeric(12, 2) not null,
  surge_amount numeric(12, 2) not null,
  waiting_amount numeric(12, 2) not null,
  minimum_adjustment numeric(12, 2) not null default 0,
  rounding_amount numeric(12, 2) not null default 0,
  booking_fee numeric(12, 2) not null,
  discount_amount numeric(12, 2) not null default 0,
  cancellation_amount numeric(12, 2) not null default 0,
  tax_amount numeric(12, 2) not null default 0,
  total_amount numeric(12, 2) not null,
  commissionable_amount numeric(12, 2) not null,
  platform_commission numeric(12, 2) not null,
  driver_earning numeric(12, 2) not null,
  commission_pct numeric(6, 4) not null,
  distance_m integer not null,
  duration_s integer not null,
  pricing_rule_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  constraint chk_breakdown_total check (
    total_amount = base_amount + distance_amount + time_amount + surge_amount + waiting_amount
      + minimum_adjustment + rounding_amount + booking_fee + cancellation_amount + tax_amount - discount_amount
  )
);
create trigger trg_trip_fare_breakdowns_append_only before update or delete on public.trip_fare_breakdowns
  for each row execute function private.forbid_update_delete();

-- ---------------------------------------------------------------------------
-- Privileges and RLS: reads only; every write is an api.* RPC
-- ---------------------------------------------------------------------------
revoke all on table
  public.fare_rules, public.fare_quotes, public.ride_requests, public.ride_request_events, public.dispatch_offers,
  public.trips, public.trip_status_events, public.trip_location_points, public.trip_notes, public.trip_fare_breakdowns
from anon, authenticated;

grant select on table
  public.fare_rules, public.fare_quotes, public.ride_requests, public.ride_request_events, public.dispatch_offers,
  public.trip_status_events, public.trip_location_points, public.trip_notes, public.trip_fare_breakdowns
to authenticated;
-- share_token_hash is never readable by clients.
grant select (id, request_id, passenger_id, driver_id, vehicle_id, status, accepted_at, arriving_at, arrived_at, started_at,
              completed_at, cancelled_at, actual_distance_m, actual_duration_s, waiting_s, final_fare, currency, payment_method,
              cancellation_reason, cancelled_by_actor, cancellation_fee, start_point, end_point, fare_rule_id,
              accepted_pickup_eta_s, distance_source, fare_review_required, created_at, updated_at, version)
  on public.trips to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['fare_rules', 'fare_quotes', 'ride_requests', 'ride_request_events', 'dispatch_offers',
                           'trips', 'trip_status_events', 'trip_location_points', 'trip_notes', 'trip_fare_breakdowns'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

create function private.my_trip_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select t.id from public.trips t
  where t.passenger_id = auth.uid() or t.driver_id = (select d.id from public.driver_profiles d where d.user_id = auth.uid());
$$;

create policy fare_rules_select on public.fare_rules for select to authenticated
  using (deleted_at is null and (select private.has_permission('fares.view')));
create policy fare_quotes_select on public.fare_quotes for select to authenticated
  using (passenger_id = (select auth.uid()) or (select private.has_permission('trips.view')));
create policy ride_requests_select on public.ride_requests for select to authenticated
  using (passenger_id = (select auth.uid()) or (select private.has_permission('trips.view')));
create policy ride_request_events_select on public.ride_request_events for select to authenticated
  using ((select private.has_permission('trips.view'))
         or request_id in (select r.id from public.ride_requests r where r.passenger_id = (select auth.uid())));
create policy dispatch_offers_select on public.dispatch_offers for select to authenticated
  using (driver_id = (select private.my_driver_id()) or (select private.has_permission('dispatch.view')));
create policy trips_select on public.trips for select to authenticated
  using (passenger_id = (select auth.uid()) or driver_id = (select private.my_driver_id())
         or (select private.has_permission('trips.view')));
create policy trip_status_events_select on public.trip_status_events for select to authenticated
  using ((select private.has_permission('trips.view')) or trip_id in (select private.my_trip_ids()));
create policy trip_location_points_select on public.trip_location_points for select to authenticated
  using ((select private.has_permission('trips.view_location')));
create policy trip_notes_select on public.trip_notes for select to authenticated
  using ((select private.has_permission('trips.view')));
create policy trip_fare_breakdowns_select on public.trip_fare_breakdowns for select to authenticated
  using ((select private.has_permission('trips.view')) or trip_id in (select private.my_trip_ids()));

grant execute on function private.my_trip_ids() to authenticated;
