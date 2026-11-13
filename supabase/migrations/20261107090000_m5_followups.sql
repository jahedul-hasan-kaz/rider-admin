-- Follow-ups to M2-M4:
--   1. Cancellation fees owed by a passenger are collected on their next ride.
--   2. Online time is rolled up from the driver status history.
--   3. Feature flags take effect: promo_codes gates promotions, pickup_pin gates starting a trip.

-- ---------------------------------------------------------------------------
-- 1. Cancellation fee collection (settle_trip is re-declared by the splice at the end of this file)
-- ---------------------------------------------------------------------------
alter table public.payments add column fee_collected numeric(12, 2) not null default 0 check (fee_collected >= 0);

-- What a passenger owes the platform (a negative wallet balance, e.g. an unpaid cancellation fee) and their wallet.
create function api.passenger_wallet() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_balance numeric;
begin
  perform private.require_role('passenger');
  select coalesce(b.balance, 0) into v_balance from public.ledger_accounts a
    left join public.ledger_account_balances b on b.account_id = a.id where a.code = 'passenger:' || auth.uid() || ':wallet';
  return jsonb_build_object('balance', coalesce(v_balance, 0), 'currency', 'BDT',
    'outstanding_fee', greatest(-coalesce(v_balance, 0), 0), 'credit', greatest(coalesce(v_balance, 0), 0));
end $$;

-- ---------------------------------------------------------------------------
-- 2. Online time
-- ---------------------------------------------------------------------------
create table public.kpi_online (
  grain text not null check (grain in ('15m', 'day')),
  bucket_start timestamptz not null,
  online_s bigint not null default 0,
  on_trip_s bigint not null default 0,
  drivers integer not null default 0,
  computed_at timestamptz not null default now(),
  primary key (grain, bucket_start)
);
alter table public.kpi_online enable row level security;
alter table public.kpi_online force row level security;
revoke all on public.kpi_online from public, anon, authenticated;
grant select on public.kpi_online to authenticated;
create policy kpi_online_read on public.kpi_online for select to authenticated
  using ((select private.has_permission('analytics.view')) or (select private.has_permission('dashboard.view')));

-- Online time per bucket from the availability history: a driver is "online" (idle) or "on trip" between events.
-- Recomputed from the events, never incremented, so a rerun cannot double count.
create function private.rollup_online(p_grain text, p_from timestamptz, p_to timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_from timestamptz := private.kpi_bucket(p_grain, p_from);
  v_step interval := case when p_grain = '15m' then interval '15 minutes' else interval '1 day' end;
  v_rows integer;
begin
  delete from public.kpi_online where grain = p_grain and bucket_start >= v_from and bucket_start < p_to;
  insert into public.kpi_online (grain, bucket_start, online_s, on_trip_s, drivers)
  with ev as (
    select driver_id, new_status, created_at as t_start,
           coalesce(lead(created_at) over (partition by driver_id order by id), now()) as t_end
    from public.driver_status_events where kind = 'availability' and created_at < p_to
  ), seg as (
    select * from ev where new_status in ('online', 'on_trip') and t_end > v_from
  ), buckets as (
    select b as bucket_start from generate_series(v_from, p_to - interval '1 second', v_step) b
  )
  select p_grain, bk.bucket_start,
         coalesce(round(sum(extract(epoch from least(s.t_end, bk.bucket_start + v_step) - greatest(s.t_start, bk.bucket_start))) filter (where s.new_status = 'online')), 0),
         coalesce(round(sum(extract(epoch from least(s.t_end, bk.bucket_start + v_step) - greatest(s.t_start, bk.bucket_start))) filter (where s.new_status = 'on_trip')), 0),
         count(distinct s.driver_id)
  from buckets bk
  left join seg s on s.t_start < bk.bucket_start + v_step and s.t_end > bk.bucket_start
  group by bk.bucket_start;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

select cron.schedule('rollup-online-15m', '*/5 * * * *',
  'select private.rollup_online(''15m'', now() - interval ''45 minutes'', now() + interval ''15 minutes'')');
select cron.schedule('rollup-online-day', '*/10 * * * *',
  'select private.rollup_online(''day'', now() - interval ''2 days'', now() + interval ''1 day'')');
select private.rollup_online('day', now() - interval '30 days', now() + interval '1 day');
select private.rollup_online('15m', now() - interval '2 days', now() + interval '1 hour');

-- Average drivers online and on a trip per 15 minutes over the last 12 hours, for the dashboard chart.
create function api.intraday_supply() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_any_permission(array['dashboard.view', 'analytics.view']) then
    perform private.raise_error('FORBIDDEN');
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('at', bucket_start, 'online', round(online_s / 900.0, 1), 'on_trip', round(on_trip_s / 900.0, 1)) order by bucket_start), '[]')
          from public.kpi_online where grain = '15m' and bucket_start >= now() - interval '12 hours' and bucket_start <= now());
end $$;

-- ---------------------------------------------------------------------------
-- 3. Feature flags: promo_codes and pickup_pin
-- ---------------------------------------------------------------------------
alter table public.trips add column start_pin text check (start_pin ~ '^[0-9]{4}$');
alter table public.trips add column start_pin_attempts integer not null default 0;

-- Every trip gets a PIN at assignment; it only has to be entered when the pickup_pin flag is on for that ride.
create function private.assign_start_pin() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.start_pin := lpad((floor(random() * 10000))::int::text, 4, '0');
  return new;
end $$;
create trigger trg_trips_start_pin before insert on public.trips
  for each row execute function private.assign_start_pin();
update public.trips set start_pin = lpad((floor(random() * 10000))::int::text, 4, '0') where start_pin is null and status in ('driver_assigned', 'driver_arriving', 'arrived');

create function api.get_ride_pin(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.ride_requests;
  t public.trips;
  v_on boolean;
begin
  perform private.require_role('passenger');
  select * into r from public.ride_requests where id = p_request_id and passenger_id = auth.uid();
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  v_on := private.flag_enabled('pickup_pin', r.zone_id, r.category_id, r.passenger_id);
  select * into t from public.trips where request_id = r.id;
  return jsonb_build_object('required', v_on,
    'pin', case when v_on and found and t.status in ('driver_assigned', 'driver_arriving', 'arrived') then t.start_pin end,
    'locked', coalesce(t.start_pin_attempts >= 5, false));
end $$;

-- A passenger can renew the PIN (for example after it was locked by wrong guesses).
create function api.renew_ride_pin(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
begin
  perform private.require_role('passenger');
  select t2.* into t from public.trips t2 join public.ride_requests r on r.id = t2.request_id
  where r.id = p_request_id and r.passenger_id = auth.uid() and t2.status in ('driver_assigned', 'driver_arriving', 'arrived') for update of t2;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  update public.trips set start_pin = lpad((floor(random() * 10000))::int::text, 4, '0'), start_pin_attempts = 0 where id = t.id;
  return api.get_ride_pin(p_request_id);
end $$;

-- Starting a trip. With the pickup_pin flag on, the passenger's 4-digit PIN is required; five wrong guesses lock it.
-- A wrong guess is reported in the result (not as an error) so the attempt counter survives the call.
drop function api.driver_trip_start(uuid);
create function api.driver_trip_start(p_trip_id uuid, p_pin text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips := private.driver_trip(p_trip_id);
  r public.ride_requests;
  v_loc extensions.geography;
begin
  if t.status = 'in_progress' then
    return api.get_driver_trip(p_trip_id);
  end if;
  select * into r from public.ride_requests where id = t.request_id;
  if t.status = 'arrived' and private.flag_enabled('pickup_pin', r.zone_id, r.category_id, t.passenger_id) then
    select * into t from public.trips where id = t.id for update;
    if t.start_pin_attempts >= 5 then
      return jsonb_build_object('pin_error', 'PIN_LOCKED', 'attempts_left', 0);
    end if;
    if p_pin is null or p_pin !~ '^[0-9]{4}$' or p_pin <> t.start_pin then
      update public.trips set start_pin_attempts = start_pin_attempts + 1 where id = t.id;
      return jsonb_build_object('pin_error', case when p_pin is null then 'PIN_REQUIRED' else 'INVALID_PIN' end,
        'attempts_left', greatest(4 - t.start_pin_attempts, 0));
    end if;
  end if;
  select location into v_loc from public.driver_live_locations where driver_id = t.driver_id;
  perform private.transition_trip(p_trip_id, 'in_progress', 'driver', null, '{}', v_loc);
  return api.get_driver_trip(p_trip_id);
end $$;

-- Settlement with fee collection, and promotions behind the promo_codes flag.
create or replace function private.settle_trip(p_trip_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
  b public.trip_fare_breakdowns;
  v_before numeric;
  v_pass numeric;
  v_driver_credit numeric;
  v_collect uuid;
  v_lines jsonb := '[]'::jsonb;
  v_payment uuid;
  v_fee numeric := 0;
begin
  select * into t from public.trips where id = p_trip_id;
  select * into b from public.trip_fare_breakdowns where trip_id = p_trip_id;
  v_before := b.total_amount + b.discount_amount;
  v_pass := v_before - b.commissionable_amount - b.booking_fee;
  v_driver_credit := b.driver_earning + v_pass;

  perform private.apply_redemption(t.request_id, t.id, b.discount_amount);

  -- A cancellation fee the passenger still owes (negative wallet) is collected together with this fare.
  select greatest(-coalesce(bal.balance, 0), 0) into v_fee from public.ledger_accounts la
    join public.ledger_account_balances bal on bal.account_id = la.id where la.code = 'passenger:' || t.passenger_id || ':wallet';
  v_fee := coalesce(v_fee, 0);

  if b.total_amount + v_fee > 0 then
    insert into public.payments (trip_id, passenger_id, driver_id, method, amount, fee_collected, currency)
    values (t.id, t.passenger_id, t.driver_id, t.payment_method, b.total_amount + v_fee, v_fee, t.currency)
    on conflict (trip_id) do nothing returning id into v_payment;
    if v_payment is not null then
      insert into public.payment_events (payment_id, from_status, to_status, source, note)
      values (v_payment, null, 'pending', 'system', 'Trip completed');
    end if;
  end if;

  insert into public.driver_earnings (trip_id, driver_id, gross_fare, discount_amount, commission_amount, net_earning)
  values (t.id, t.driver_id, v_before, b.discount_amount, b.platform_commission, v_driver_credit)
  on conflict (trip_id) do nothing;

  v_collect := case when t.payment_method = 'cash' then private.wallet_account('driver', t.driver_id) else private.platform_account('gateway_clearing') end;
  if b.total_amount + v_fee > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', v_collect, 'debit', b.total_amount + v_fee);
  end if;
  if b.discount_amount > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', private.platform_account('promo_expense'), 'debit', b.discount_amount);
  end if;
  if v_driver_credit > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', private.wallet_account('driver', t.driver_id), 'credit', v_driver_credit);
  end if;
  if b.platform_commission > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', private.platform_account('commission_revenue'), 'credit', b.platform_commission);
  end if;
  if b.booking_fee > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', private.platform_account('booking_fee_revenue'), 'credit', b.booking_fee);
  end if;
  if v_fee > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', private.wallet_account('passenger', t.passenger_id), 'credit', v_fee);
  end if;
  if jsonb_array_length(v_lines) > 0 then
    perform private.post_transaction('trip_completion', t.id::text, t.id, 'Trip completed', v_lines);
  end if;
end $$;

create or replace function api.apply_promo(p_request_id uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.ride_requests;
  p public.promotions;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_amount numeric;
  v_updated integer;
begin
  perform private.require_role('passenger');
  select * into r from public.ride_requests where id = p_request_id and passenger_id = auth.uid() for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if not private.flag_enabled('promo_codes', r.zone_id, r.category_id, r.passenger_id) then
    perform private.raise_error('PROMO_INVALID', '{"reason":"promotions are not available right now"}');
  end if;
  if r.status not in ('searching', 'matched') then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', r.status));
  end if;
  if exists (select 1 from public.trips t where t.request_id = r.id and t.status in ('in_progress', 'completed')) then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"the ride has started"}');
  end if;
  if exists (select 1 from public.promotion_redemptions where request_id = r.id and status <> 'released') then
    perform private.raise_error('PROMO_INVALID', '{"reason":"a promotion is already applied"}');
  end if;

  select * into p from public.promotions where code = v_code for update;
  if not found or p.status <> 'active' or now() < p.starts_at or now() >= p.ends_at then
    perform private.raise_error('PROMO_INVALID', '{"reason":"this code is not valid right now"}');
  end if;
  if cardinality(p.zone_ids) > 0 and not (r.zone_id = any (p.zone_ids)) then
    perform private.raise_error('PROMO_INVALID', '{"reason":"not available in this area"}');
  end if;
  if cardinality(p.category_ids) > 0 and not (r.category_id = any (p.category_ids)) then
    perform private.raise_error('PROMO_INVALID', '{"reason":"not available for this vehicle type"}');
  end if;
  if r.estimated_fare < p.min_fare then
    perform private.raise_error('PROMO_INVALID', jsonb_build_object('reason', 'minimum fare is ' || p.min_fare));
  end if;
  if p.new_users_only and exists (select 1 from public.trips t where t.passenger_id = auth.uid() and t.status = 'completed') then
    perform private.raise_error('PROMO_INVALID', '{"reason":"for new passengers only"}');
  end if;
  if (select count(*) from public.promotion_redemptions x where x.promotion_id = p.id and x.passenger_id = auth.uid() and x.status <> 'released') >= p.per_user_limit then
    perform private.raise_error('PROMO_INVALID', '{"reason":"you have used this code the maximum number of times"}');
  end if;
  if p.total_redemption_limit is not null
     and (select count(*) from public.promotion_redemptions x where x.promotion_id = p.id and x.status <> 'released') >= p.total_redemption_limit then
    perform private.raise_error('PROMO_INVALID', '{"reason":"this offer has been fully redeemed"}');
  end if;

  v_amount := private.promo_amount(p, r.estimated_fare);
  -- Budget reservation: one conditional update, so concurrent requests can never overspend.
  update public.promotions set budget_spent = budget_spent + v_amount
  where id = p.id and (budget_limit is null or budget_spent + v_amount <= budget_limit);
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    perform private.raise_error('PROMO_INVALID', '{"reason":"this offer has run out"}');
  end if;

  insert into public.promotion_redemptions (promotion_id, passenger_id, request_id, reserved_amount)
  values (p.id, auth.uid(), r.id, v_amount);
  return jsonb_build_object('code', p.code, 'name', p.name, 'estimated_discount', v_amount, 'estimated_fare', r.estimated_fare);
end $$;

revoke execute on all functions in schema api from public, anon;
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
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
