-- M4 · KPI rollups, dashboard and analytics (docs/spec/03 §4.7, 06 §5.2 and §5.20, blueprint §7).
--
-- Attribution rules (so nothing is counted twice and every number can be re-derived):
--   * Funnel metrics (requests, matched, started, completed requests, cancellations, match time) belong to the
--     bucket in which the request was made (a cohort view).
--   * Money and ride metrics (completed trips, gross bookings, revenue, discounts, contribution, earnings,
--     distance, active drivers) belong to the bucket in which the trip completed.
--   * Rollups are recomputed from the source tables, never incremented: running a rollup twice gives the same rows.
--   * Days are Asia/Dhaka calendar days.

create table public.kpi_rollups (
  grain text not null check (grain in ('15m', 'day')),
  bucket_start timestamptz not null,
  zone_id uuid not null references public.service_zones (id),
  category_id uuid not null references public.vehicle_categories (id),
  requests integer not null default 0,
  matched integer not null default 0,
  started integer not null default 0,
  completed_requests integer not null default 0,
  cancelled_passenger integer not null default 0,
  cancelled_driver integer not null default 0,
  cancelled_admin integer not null default 0,
  no_driver integer not null default 0,
  failed_requests integer not null default 0,
  match_p50_s numeric(10, 1),
  match_p90_s numeric(10, 1),
  completed_trips integer not null default 0,
  gross_bookings numeric(14, 2) not null default 0,
  platform_revenue numeric(14, 2) not null default 0,
  discounts numeric(14, 2) not null default 0,
  contribution numeric(14, 2) not null default 0,
  driver_earnings numeric(14, 2) not null default 0,
  distance_m bigint not null default 0,
  duration_s bigint not null default 0,
  active_drivers integer not null default 0,
  flagged_fares integer not null default 0,
  computed_at timestamptz not null default now(),
  primary key (grain, bucket_start, zone_id, category_id)
);
create index idx_kpi_rollups_zone on public.kpi_rollups (grain, zone_id, bucket_start);

alter table public.kpi_rollups enable row level security;
alter table public.kpi_rollups force row level security;
revoke all on public.kpi_rollups from public, anon, authenticated;
grant select on public.kpi_rollups to authenticated;
create policy kpi_rollups_read on public.kpi_rollups for select to authenticated
  using ((select private.has_permission('analytics.view')) or (select private.has_permission('dashboard.view')));

create function private.kpi_bucket(p_grain text, p_ts timestamptz) returns timestamptz
language sql stable set search_path = '' as $$
  select case when p_grain = '15m'
    then to_timestamp(floor(extract(epoch from p_ts) / 900) * 900)
    else (date_trunc('day', p_ts at time zone 'Asia/Dhaka')) at time zone 'Asia/Dhaka' end;
$$;

-- Recomputes every bucket that starts in [bucket(p_from), p_to). Idempotent.
create function private.rollup_kpi(p_grain text, p_from timestamptz, p_to timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_from timestamptz := private.kpi_bucket(p_grain, p_from);
  v_rows integer;
begin
  if p_grain not in ('15m', 'day') then
    raise exception 'unknown grain %', p_grain;
  end if;
  delete from public.kpi_rollups where grain = p_grain and bucket_start >= v_from and bucket_start < p_to;

  insert into public.kpi_rollups (
    grain, bucket_start, zone_id, category_id, requests, matched, started, completed_requests,
    cancelled_passenger, cancelled_driver, cancelled_admin, no_driver, failed_requests, match_p50_s, match_p90_s,
    completed_trips, gross_bookings, platform_revenue, discounts, contribution, driver_earnings, distance_m, duration_s,
    active_drivers, flagged_fares)
  with f as (
    select private.kpi_bucket(p_grain, r.requested_at) as b, r.zone_id, r.category_id,
           count(*) as requests,
           count(*) filter (where r.matched_at is not null) as matched,
           count(*) filter (where exists (select 1 from public.trips t where t.request_id = r.id and t.started_at is not null)) as started,
           count(*) filter (where r.status = 'completed') as completed_requests,
           count(*) filter (where r.status = 'cancelled_by_passenger') as cancelled_passenger,
           count(*) filter (where r.status = 'cancelled_by_driver') as cancelled_driver,
           count(*) filter (where r.status = 'cancelled_by_admin') as cancelled_admin,
           count(*) filter (where r.status = 'no_driver_found') as no_driver,
           count(*) filter (where r.status = 'failed') as failed_requests,
           percentile_cont(0.5) within group (order by extract(epoch from r.matched_at - r.requested_at)) filter (where r.matched_at is not null) as p50,
           percentile_cont(0.9) within group (order by extract(epoch from r.matched_at - r.requested_at)) filter (where r.matched_at is not null) as p90
    from public.ride_requests r
    where r.requested_at >= v_from and r.requested_at < p_to
    group by 1, 2, 3
  ), m as (
    select private.kpi_bucket(p_grain, t.completed_at) as b, rq.zone_id, rq.category_id,
           count(*) as completed_trips,
           sum(fb.total_amount + fb.discount_amount) as gross,
           sum(fb.platform_commission + fb.booking_fee) as revenue,
           sum(fb.discount_amount) as discounts,
           sum(coalesce(e.net_earning, 0)) as earnings,
           sum(coalesce(t.actual_distance_m, 0)) as distance_m,
           sum(coalesce(t.actual_duration_s, 0)) as duration_s,
           count(distinct t.driver_id) as active_drivers,
           count(*) filter (where t.fare_review_required) as flagged
    from public.trips t
    join public.ride_requests rq on rq.id = t.request_id
    join public.trip_fare_breakdowns fb on fb.trip_id = t.id
    left join public.driver_earnings e on e.trip_id = t.id
    where t.status = 'completed' and t.completed_at >= v_from and t.completed_at < p_to
    group by 1, 2, 3
  )
  select p_grain, coalesce(f.b, m.b), coalesce(f.zone_id, m.zone_id), coalesce(f.category_id, m.category_id),
         coalesce(f.requests, 0), coalesce(f.matched, 0), coalesce(f.started, 0), coalesce(f.completed_requests, 0),
         coalesce(f.cancelled_passenger, 0), coalesce(f.cancelled_driver, 0), coalesce(f.cancelled_admin, 0),
         coalesce(f.no_driver, 0), coalesce(f.failed_requests, 0), round(f.p50::numeric, 1), round(f.p90::numeric, 1),
         coalesce(m.completed_trips, 0), coalesce(m.gross, 0), coalesce(m.revenue, 0), coalesce(m.discounts, 0),
         coalesce(m.revenue, 0) - coalesce(m.discounts, 0), coalesce(m.earnings, 0),
         coalesce(m.distance_m, 0), coalesce(m.duration_s, 0), coalesce(m.active_drivers, 0), coalesce(m.flagged, 0)
  from f full join m on m.b = f.b and m.zone_id = f.zone_id and m.category_id = f.category_id;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

select cron.schedule('rollup-kpi-15m', '*/5 * * * *',
  'select private.rollup_kpi(''15m'', now() - interval ''45 minutes'', now() + interval ''15 minutes'')');
select cron.schedule('rollup-kpi-day', '*/10 * * * *',
  'select private.rollup_kpi(''day'', now() - interval ''2 days'', now() + interval ''1 day'')');

select private.rollup_kpi('day', '2020-01-01', now() + interval '1 day');
select private.rollup_kpi('15m', now() - interval '2 days', now() + interval '1 hour');

-- ---------------------------------------------------------------------------
-- Dashboard and analytics reads. Ranges are inclusive Asia/Dhaka dates.
-- ---------------------------------------------------------------------------
create function private.range_bounds(p_from date, p_to date, out v_from timestamptz, out v_to timestamptz, out v_pfrom timestamptz)
language plpgsql stable set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"range","message":"Choose a range of up to 366 days."}]}');
  end if;
  v_from := p_from::timestamp at time zone 'Asia/Dhaka';
  v_to := (p_to + 1)::timestamp at time zone 'Asia/Dhaka';
  v_pfrom := v_from - (v_to - v_from);
end $$;

-- Totals for one window from the day rollups.
create function private.kpi_totals(p_from timestamptz, p_to timestamptz, p_zone uuid, p_category uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'requests', coalesce(sum(requests), 0), 'matched', coalesce(sum(matched), 0), 'started', coalesce(sum(started), 0),
    'completed_requests', coalesce(sum(completed_requests), 0),
    'cancelled_passenger', coalesce(sum(cancelled_passenger), 0), 'cancelled_driver', coalesce(sum(cancelled_driver), 0),
    'cancelled_admin', coalesce(sum(cancelled_admin), 0), 'no_driver', coalesce(sum(no_driver), 0), 'failed', coalesce(sum(failed_requests), 0),
    'completed_trips', coalesce(sum(completed_trips), 0), 'gross_bookings', coalesce(sum(gross_bookings), 0),
    'platform_revenue', coalesce(sum(platform_revenue), 0), 'discounts', coalesce(sum(discounts), 0),
    'contribution', coalesce(sum(contribution), 0), 'driver_earnings', coalesce(sum(driver_earnings), 0),
    'distance_m', coalesce(sum(distance_m), 0), 'duration_s', coalesce(sum(duration_s), 0),
    'flagged_fares', coalesce(sum(flagged_fares), 0))
  from public.kpi_rollups
  where grain = 'day' and bucket_start >= p_from and bucket_start < p_to
    and (p_zone is null or zone_id = p_zone) and (p_category is null or category_id = p_category);
$$;

-- Match time percentiles straight from the requests (medians cannot be averaged across buckets).
create function private.match_percentiles(p_from timestamptz, p_to timestamptz, p_zone uuid, p_category uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'p50', round((percentile_cont(0.5) within group (order by extract(epoch from matched_at - requested_at)))::numeric, 1),
    'p90', round((percentile_cont(0.9) within group (order by extract(epoch from matched_at - requested_at)))::numeric, 1))
  from public.ride_requests
  where matched_at is not null and requested_at >= p_from and requested_at < p_to
    and (p_zone is null or zone_id = p_zone) and (p_category is null or category_id = p_category);
$$;

create function private.pct_delta(p_now numeric, p_prev numeric) returns numeric
language sql immutable set search_path = '' as $$
  select case when p_prev is null or p_prev = 0 then null else round((p_now - p_prev) / abs(p_prev) * 100, 1) end;
$$;

create function private.kpi_cards(p_from timestamptz, p_to timestamptz, p_zone uuid, p_category uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t jsonb := private.kpi_totals(p_from, p_to, p_zone, p_category);
  m jsonb := private.match_percentiles(p_from, p_to, p_zone, p_category);
  v_trips numeric := (t ->> 'completed_trips')::numeric;
  v_req numeric := (t ->> 'requests')::numeric;
  v_sub numeric;
  v_unsub numeric;
begin
  select avg(fb.platform_commission + fb.booking_fee - fb.discount_amount) filter (where fb.discount_amount > 0),
         avg(fb.platform_commission + fb.booking_fee) filter (where fb.discount_amount = 0)
  into v_sub, v_unsub
  from public.trips tr join public.ride_requests rq on rq.id = tr.request_id join public.trip_fare_breakdowns fb on fb.trip_id = tr.id
  where tr.status = 'completed' and tr.completed_at >= p_from and tr.completed_at < p_to
    and (p_zone is null or rq.zone_id = p_zone) and (p_category is null or rq.category_id = p_category);
  return jsonb_build_object(
    'completed_trips', v_trips,
    'requests', v_req,
    'match_rate', case when v_req > 0 then round((t ->> 'matched')::numeric / v_req * 100, 1) end,
    'match_p50_s', m -> 'p50', 'match_p90_s', m -> 'p90',
    'gross_bookings', (t ->> 'gross_bookings')::numeric,
    'platform_revenue', (t ->> 'platform_revenue')::numeric,
    'discounts', (t ->> 'discounts')::numeric,
    'contribution', (t ->> 'contribution')::numeric,
    'contribution_per_ride', case when v_trips > 0 then round((t ->> 'contribution')::numeric / v_trips, 2) end,
    'contribution_subsidised', round(v_sub, 2),
    'contribution_unsubsidised', round(v_unsub, 2));
end $$;

create function api.dashboard(p_from date, p_to date, p_zone uuid default null, p_category uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  b record;
  v_now jsonb;
  v_prev jsonb;
  v_totals jsonb;
  v_days jsonb;
  v_intraday jsonb;
  v_zones jsonb;
  v_attention jsonb;
begin
  perform private.require_permission('dashboard.view');
  select * into b from private.range_bounds(p_from, p_to);
  v_now := private.kpi_cards(b.v_from, b.v_to, p_zone, p_category);
  v_prev := private.kpi_cards(b.v_pfrom, b.v_from, p_zone, p_category);
  v_totals := private.kpi_totals(b.v_from, b.v_to, p_zone, p_category);

  select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'completed_trips', coalesce(x.trips, 0), 'gross_bookings', coalesce(x.gross, 0),
      'requests', coalesce(x.reqs, 0), 'matched', coalesce(x.matched, 0)) order by d), '[]') into v_days
  from generate_series(p_from, p_to, interval '1 day') d
  left join (
    select (bucket_start at time zone 'Asia/Dhaka')::date as day, sum(completed_trips) trips, sum(gross_bookings) gross, sum(requests) reqs, sum(matched) matched
    from public.kpi_rollups where grain = 'day' and bucket_start >= b.v_from and bucket_start < b.v_to
      and (p_zone is null or zone_id = p_zone) and (p_category is null or category_id = p_category) group by 1) x on x.day = d::date;

  select coalesce(jsonb_agg(jsonb_build_object('at', bucket_start, 'requests', reqs, 'matched', matched, 'completed', done) order by bucket_start), '[]') into v_intraday
  from (select bucket_start, sum(requests) reqs, sum(matched) matched, sum(completed_requests) done
        from public.kpi_rollups where grain = '15m' and bucket_start >= now() - interval '12 hours'
          and (p_zone is null or zone_id = p_zone) and (p_category is null or category_id = p_category) group by 1) q;

  select coalesce(jsonb_agg(jsonb_build_object(
      'zone_id', z.id, 'name', z.name, 'requests', coalesce(k.reqs, 0), 'matched', coalesce(k.matched, 0),
      'match_rate', case when coalesce(k.reqs, 0) > 0 then round(k.matched::numeric / k.reqs * 100, 1) end,
      'median_match_s', k.p50,
      'online_drivers', (select count(*) from public.driver_live_locations l join public.driver_profiles d on d.id = l.driver_id
                         where d.availability = 'online' and l.updated_at > now() - interval '120 seconds'
                           and extensions.st_intersects(z.boundary::extensions.geometry, l.location::extensions.geometry)),
      'health', case when coalesce(k.reqs, 0) < 5 then 'idle'
                     when k.matched::numeric / k.reqs >= 0.85 then 'good'
                     when k.matched::numeric / k.reqs >= 0.70 then 'watch' else 'bad' end) order by z.name), '[]') into v_zones
  from public.service_zones z
  left join (
    select r.zone_id, count(*) reqs, count(*) filter (where r.matched_at is not null) matched,
           round((percentile_cont(0.5) within group (order by extract(epoch from r.matched_at - r.requested_at)) filter (where r.matched_at is not null))::numeric, 1) p50
    from public.ride_requests r
    where r.requested_at >= b.v_from and r.requested_at < b.v_to and (p_category is null or r.category_id = p_category)
    group by r.zone_id) k on k.zone_id = z.id
  where z.active and (p_zone is null or z.id = p_zone);

  v_attention := jsonb_build_object(
    'documents_pending', (select count(*) from public.driver_documents where review_status = 'pending' and superseded_at is null),
    'documents_expiring', (select count(*) from public.driver_documents where review_status = 'approved' and superseded_at is null
                           and expires_at is not null and expires_at <= (now() + interval '30 days')::date and expires_at >= now()::date),
    'refunds_waiting', (select count(*) from public.refunds_adjustments where status in ('requested', 'awaiting_second_approval')),
    'tickets_breaching', (select count(*) from public.support_tickets where status in ('open', 'in_progress') and sla_due_at < now() and first_response_at is null),
    'incidents_open', (select count(*) from public.safety_incidents where status not in ('resolved', 'closed')),
    'fare_flags', (select count(*) from public.trips where fare_review_required and completed_at > now() - interval '7 days'),
    'cash_mismatches', (select count(*) from public.payments where status = 'succeeded' and collected_amount is distinct from amount and reconciled_at is null),
    'alerts_open', (select count(*) from public.ops_alerts where status = 'open'));

  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'current', v_now, 'previous', v_prev,
    'delta', jsonb_build_object(
      'completed_trips', private.pct_delta((v_now ->> 'completed_trips')::numeric, (v_prev ->> 'completed_trips')::numeric),
      'match_rate', private.pct_delta((v_now ->> 'match_rate')::numeric, (v_prev ->> 'match_rate')::numeric),
      'gross_bookings', private.pct_delta((v_now ->> 'gross_bookings')::numeric, (v_prev ->> 'gross_bookings')::numeric),
      'platform_revenue', private.pct_delta((v_now ->> 'platform_revenue')::numeric, (v_prev ->> 'platform_revenue')::numeric),
      'contribution_per_ride', private.pct_delta((v_now ->> 'contribution_per_ride')::numeric, (v_prev ->> 'contribution_per_ride')::numeric)),
    'funnel', jsonb_build_object('requests', v_totals -> 'requests', 'matched', v_totals -> 'matched', 'started', v_totals -> 'started', 'completed', v_totals -> 'completed_requests'),
    'cancellations', jsonb_build_object('passenger', v_totals -> 'cancelled_passenger', 'driver', v_totals -> 'cancelled_driver',
                                         'admin', v_totals -> 'cancelled_admin', 'no_driver', v_totals -> 'no_driver', 'failed', v_totals -> 'failed'),
    'days', v_days, 'intraday', v_intraday, 'zones', v_zones, 'attention', v_attention,
    'online_drivers_now', (select count(*) from public.driver_profiles where availability = 'online'),
    'generated_at', now());
end $$;

-- One RPC per analytics page keeps each query focused and independently permission-checked.
create function api.analytics(p_page text, p_from date, p_to date, p_zone uuid default null, p_category uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  b record;
  t jsonb;
  v jsonb;
begin
  perform private.require_permission('analytics.view');
  if p_page is null or p_page not in ('funnel', 'economics', 'drivers', 'passengers', 'finance') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"page","message":"Unknown analytics page."}]}');
  end if;
  select * into b from private.range_bounds(p_from, p_to);
  t := private.kpi_totals(b.v_from, b.v_to, p_zone, p_category);

  if p_page = 'funnel' then
    return jsonb_build_object('totals', t, 'match', private.match_percentiles(b.v_from, b.v_to, p_zone, p_category),
      'by_zone', (select coalesce(jsonb_agg(jsonb_build_object('zone', z.name, 'requests', k.reqs, 'matched', k.matched, 'completed', k.done, 'no_driver', k.nd) order by k.reqs desc), '[]')
                  from (select zone_id, sum(requests) reqs, sum(matched) matched, sum(completed_requests) done, sum(no_driver) nd
                        from public.kpi_rollups where grain = 'day' and bucket_start >= b.v_from and bucket_start < b.v_to and (p_category is null or category_id = p_category)
                          and (p_zone is null or zone_id = p_zone) group by zone_id) k join public.service_zones z on z.id = k.zone_id),
      'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', c.name, 'requests', k.reqs, 'matched', k.matched, 'completed', k.done) order by k.reqs desc), '[]')
                  from (select category_id, sum(requests) reqs, sum(matched) matched, sum(completed_requests) done
                        from public.kpi_rollups where grain = 'day' and bucket_start >= b.v_from and bucket_start < b.v_to and (p_zone is null or zone_id = p_zone)
                          and (p_category is null or category_id = p_category) group by category_id) k join public.vehicle_categories c on c.id = k.category_id));
  elsif p_page = 'economics' then
    select jsonb_build_object(
      'subsidised', jsonb_build_object('trips', count(*) filter (where fb.discount_amount > 0), 'revenue', coalesce(sum(fb.platform_commission + fb.booking_fee) filter (where fb.discount_amount > 0), 0),
                                       'discounts', coalesce(sum(fb.discount_amount), 0), 'contribution', coalesce(sum(fb.platform_commission + fb.booking_fee - fb.discount_amount) filter (where fb.discount_amount > 0), 0)),
      'unsubsidised', jsonb_build_object('trips', count(*) filter (where fb.discount_amount = 0), 'revenue', coalesce(sum(fb.platform_commission + fb.booking_fee) filter (where fb.discount_amount = 0), 0),
                                         'contribution', coalesce(sum(fb.platform_commission + fb.booking_fee) filter (where fb.discount_amount = 0), 0)),
      'avg_fare', round(avg(fb.total_amount + fb.discount_amount), 2),
      'median_fare', round((percentile_cont(0.5) within group (order by fb.total_amount + fb.discount_amount))::numeric, 2),
      'avg_distance_km', round(avg(coalesce(tr.actual_distance_m, 0)) / 1000, 2),
      'avg_duration_min', round(avg(coalesce(tr.actual_duration_s, 0)) / 60, 1),
      'commission_share_pct', case when sum(fb.total_amount + fb.discount_amount) > 0 then round(sum(fb.platform_commission + fb.booking_fee) / sum(fb.total_amount + fb.discount_amount) * 100, 1) end)
    into v
    from public.trips tr join public.ride_requests rq on rq.id = tr.request_id join public.trip_fare_breakdowns fb on fb.trip_id = tr.id
    where tr.status = 'completed' and tr.completed_at >= b.v_from and tr.completed_at < b.v_to
      and (p_zone is null or rq.zone_id = p_zone) and (p_category is null or rq.category_id = p_category);
    return jsonb_build_object('totals', t, 'detail', v,
      'days', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'gross', gross, 'revenue', rev, 'discounts', disc, 'contribution', contrib) order by day), '[]')
               from (select (bucket_start at time zone 'Asia/Dhaka')::date as day, sum(gross_bookings) gross, sum(platform_revenue) rev, sum(discounts) disc, sum(contribution) contrib
                     from public.kpi_rollups where grain = 'day' and bucket_start >= b.v_from and bucket_start < b.v_to
                       and (p_zone is null or zone_id = p_zone) and (p_category is null or category_id = p_category) group by 1) q));
  elsif p_page = 'drivers' then
    return jsonb_build_object('totals', t,
      'active_drivers', (select count(distinct tr.driver_id) from public.trips tr join public.ride_requests rq on rq.id = tr.request_id
                         where tr.status = 'completed' and tr.completed_at >= b.v_from and tr.completed_at < b.v_to
                           and (p_zone is null or rq.zone_id = p_zone) and (p_category is null or rq.category_id = p_category)),
      'newly_approved', (select count(*) from public.driver_profiles where approved_at >= b.v_from and approved_at < b.v_to),
      'drivers', (select coalesce(jsonb_agg(row_to_json(q) order by q.trips desc), '[]') from (
        select d.id as driver_id, pr.full_name as name, count(*) filter (where tr.status = 'completed') as trips,
               coalesce(sum(e.net_earning), 0) as earnings,
               d.rating_avg as rating,
               (select case when count(*) > 0 then round(count(*) filter (where o.response = 'accepted')::numeric / count(*) * 100, 1) end
                from public.dispatch_offers o where o.driver_id = d.id and o.offered_at >= b.v_from and o.offered_at < b.v_to) as acceptance_pct,
               count(*) filter (where tr.status = 'cancelled_by_driver') as cancelled
        from public.trips tr
        join public.ride_requests rq on rq.id = tr.request_id
        join public.driver_profiles d on d.id = tr.driver_id join public.profiles pr on pr.id = d.user_id
        left join public.driver_earnings e on e.trip_id = tr.id
        where tr.accepted_at >= b.v_from and tr.accepted_at < b.v_to
          and (p_zone is null or rq.zone_id = p_zone) and (p_category is null or rq.category_id = p_category)
        group by d.id, pr.full_name, d.rating_avg order by count(*) filter (where tr.status = 'completed') desc limit 100) q));
  elsif p_page = 'passengers' then
    return jsonb_build_object('totals', t,
      'match_buckets', (select jsonb_build_object('lt30', count(*) filter (where s < 30), 'lt60', count(*) filter (where s >= 30 and s < 60),
                                'lt120', count(*) filter (where s >= 60 and s < 120), 'gte120', count(*) filter (where s >= 120))
                        from (select extract(epoch from matched_at - requested_at) as s from public.ride_requests
                              where matched_at is not null and requested_at >= b.v_from and requested_at < b.v_to
                                and (p_zone is null or zone_id = p_zone) and (p_category is null or category_id = p_category)) x),
      'match', private.match_percentiles(b.v_from, b.v_to, p_zone, p_category),
      'ratings', (select jsonb_build_object('1', count(*) filter (where score = 1), '2', count(*) filter (where score = 2), '3', count(*) filter (where score = 3),
                          '4', count(*) filter (where score = 4), '5', count(*) filter (where score = 5), 'avg', round(avg(score), 2))
                  from public.ratings where reviewer_role = 'passenger' and hidden_at is null and created_at >= b.v_from and created_at < b.v_to),
      'tickets', (select count(*) from public.support_tickets where created_at >= b.v_from and created_at < b.v_to and requester_role = 'passenger'),
      'repeat_riders_pct', (select case when count(*) > 0 then round(count(*) filter (where n >= 2)::numeric / count(*) * 100, 1) end
                            from (select tr.passenger_id, count(*) n from public.trips tr join public.ride_requests rq on rq.id = tr.request_id
                                  where tr.status = 'completed' and tr.completed_at >= b.v_from and tr.completed_at < b.v_to
                                    and (p_zone is null or rq.zone_id = p_zone) and (p_category is null or rq.category_id = p_category) group by 1) x));
  else
    return jsonb_build_object('totals', t,
      'refunds', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)) from public.refunds_adjustments
                  where kind = 'refund' and status = 'processed' and updated_at >= b.v_from and updated_at < b.v_to),
      'payments', (select jsonb_build_object('pending', count(*) filter (where status = 'pending'),
                          'unreconciled', count(*) filter (where status in ('succeeded', 'partially_refunded', 'refunded') and reconciled_at is null),
                          'mismatches', count(*) filter (where status = 'succeeded' and collected_amount is distinct from amount))
                   from public.payments where created_at >= b.v_from and created_at < b.v_to),
      'cash_owed_by_drivers', (select coalesce(-sum(bal.balance), 0) from public.ledger_accounts a join public.ledger_account_balances bal on bal.account_id = a.id
                               where a.owner_type = 'driver' and bal.balance < 0),
      'payouts', (select jsonb_build_object('paid', count(*) filter (where status = 'paid'), 'failed', count(*) filter (where status = 'failed'), 'total', count(*))
                  from public.payouts where created_at >= b.v_from and created_at < b.v_to),
      'ledger', (select jsonb_build_object('ran_at', ran_at, 'ok', ok) from public.ledger_verification_runs order by id desc limit 1),
      'flagged_fares', t -> 'flagged_fares');
  end if;
end $$;
