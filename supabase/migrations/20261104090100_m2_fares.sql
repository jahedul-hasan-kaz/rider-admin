-- Fare engine and fare-rule administration.
-- Spec: docs/spec/04-business-logic.md §3 (all arithmetic is NUMERIC in SQL).

-- ---------------------------------------------------------------------------
-- compute_fare: one function used by quotes, completion and the simulator.
-- p_rule is a fare_rules row as jsonb (a live rule, a stored snapshot, or draft values).
-- ---------------------------------------------------------------------------
create function private.compute_fare(
  p_rule jsonb, p_distance_m numeric, p_duration_s numeric, p_waiting_s numeric, p_surge numeric, p_discount numeric default 0
) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_base numeric := (p_rule ->> 'base_fare')::numeric;
  v_per_km numeric := (p_rule ->> 'per_km')::numeric;
  v_per_min numeric := (p_rule ->> 'per_minute')::numeric;
  v_min numeric := (p_rule ->> 'minimum_fare')::numeric;
  v_booking numeric := (p_rule ->> 'booking_fee')::numeric;
  v_wait_rate numeric := (p_rule ->> 'waiting_per_minute')::numeric;
  v_free_wait numeric := (p_rule ->> 'free_waiting_minutes')::numeric;
  v_pct numeric := (p_rule ->> 'platform_commission_pct')::numeric;
  v_components text[] := array(select jsonb_array_elements_text(p_rule -> 'commissionable_components'));
  v_surge numeric := greatest(1, least(coalesce(p_surge, 1), (p_rule ->> 'max_surge_multiplier')::numeric));
  v_distance numeric;
  v_time numeric;
  v_waiting numeric;
  v_subtotal numeric;
  v_surge_amount numeric;
  v_pre numeric;
  v_min_adj numeric;
  v_rounded numeric;
  v_rounding numeric;
  v_before_discount numeric;
  v_discount numeric;
  v_total numeric;
  v_commissionable numeric;
  v_commission numeric;
begin
  v_distance := round(v_per_km * greatest(p_distance_m, 0) / 1000, 2);
  v_time := round(v_per_min * greatest(p_duration_s, 0) / 60, 2);
  v_waiting := round(v_wait_rate * greatest(0, coalesce(p_waiting_s, 0) / 60 - v_free_wait), 2);
  v_subtotal := v_base + v_distance + v_time;
  v_surge_amount := round(v_subtotal * (v_surge - 1), 2);
  v_pre := v_subtotal + v_surge_amount + v_waiting;
  v_min_adj := greatest(0, v_min - v_pre);
  v_rounded := round(v_pre + v_min_adj, 0);
  v_rounding := v_rounded - (v_pre + v_min_adj);
  v_before_discount := v_rounded + v_booking;
  v_discount := least(greatest(coalesce(p_discount, 0), 0), v_before_discount);
  v_total := v_before_discount - v_discount;

  v_commissionable :=
    (case when 'base' = any (v_components) then v_base else 0 end)
    + (case when 'distance' = any (v_components) then v_distance else 0 end)
    + (case when 'time' = any (v_components) then v_time else 0 end)
    + (case when 'waiting' = any (v_components) then v_waiting else 0 end)
    + (case when 'surge' = any (v_components) then v_surge_amount else 0 end)
    + v_min_adj + v_rounding;
  v_commission := round(v_commissionable * v_pct, 2);

  return jsonb_build_object(
    'base_amount', v_base, 'distance_amount', v_distance, 'time_amount', v_time, 'surge_amount', v_surge_amount,
    'waiting_amount', v_waiting, 'minimum_adjustment', v_min_adj, 'rounding_amount', v_rounding,
    'booking_fee', v_booking, 'discount_amount', v_discount, 'cancellation_amount', 0, 'tax_amount', 0,
    'total_amount', v_total, 'commissionable_amount', v_commissionable, 'platform_commission', v_commission,
    'driver_earning', v_commissionable - v_commission, 'commission_pct', v_pct, 'surge_multiplier', v_surge,
    'distance_m', round(greatest(p_distance_m, 0)), 'duration_s', round(greatest(p_duration_s, 0))
  );
end $$;

-- The rule in force for (category, zone) at a time: zone-specific first, then the category default.
create function private.live_fare_rule(p_category_id uuid, p_zone_id uuid, p_at timestamptz default now())
returns public.fare_rules
language sql stable security definer set search_path = '' as $$
  select r.* from public.fare_rules r
  where r.category_id = p_category_id and r.status in ('scheduled', 'active') and r.deleted_at is null
    and (r.zone_id = p_zone_id or r.zone_id is null)
    and r.effective_from <= p_at and (r.effective_to is null or r.effective_to > p_at)
  order by (r.zone_id is null), r.rule_version desc
  limit 1;
$$;

-- Snapshot stored with quotes and trips: the rule columns that drive pricing.
create function private.rule_snapshot(p_rule public.fare_rules) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'fare_rule_id', p_rule.id, 'rule_version', p_rule.rule_version, 'category_id', p_rule.category_id, 'zone_id', p_rule.zone_id,
    'base_fare', p_rule.base_fare, 'per_km', p_rule.per_km, 'per_minute', p_rule.per_minute, 'minimum_fare', p_rule.minimum_fare,
    'booking_fee', p_rule.booking_fee, 'waiting_per_minute', p_rule.waiting_per_minute,
    'free_waiting_minutes', p_rule.free_waiting_minutes, 'cancellation_fee', p_rule.cancellation_fee,
    'platform_commission_pct', p_rule.platform_commission_pct, 'max_surge_multiplier', p_rule.max_surge_multiplier,
    'commissionable_components', to_jsonb(p_rule.commissionable_components)
  );
$$;

-- Validates and normalises draft values (jsonb) into typed columns.
create function private.fare_values(p_values jsonb) returns public.fare_rules
language plpgsql stable set search_path = '' as $$
declare
  v public.fare_rules;
  k text;
  n numeric;
begin
  -- Optional fields default; the five core rates are required.
  p_values := jsonb_build_object('booking_fee', 0, 'waiting_per_minute', 0, 'cancellation_fee', 0,
                                 'max_surge_multiplier', 1, 'free_waiting_minutes', 3) || coalesce(p_values, '{}');
  foreach k in array array['base_fare', 'per_km', 'per_minute', 'minimum_fare', 'booking_fee', 'waiting_per_minute',
                           'cancellation_fee', 'platform_commission_pct', 'max_surge_multiplier'] loop
    begin
      n := (p_values ->> k)::numeric;
    exception when others then
      n := null;
    end;
    if n is null or n < 0 then
      perform private.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array(jsonb_build_object('path', k, 'message', 'Enter a number of 0 or more.'))));
    end if;
  end loop;
  v.base_fare := round((p_values ->> 'base_fare')::numeric, 2);
  v.per_km := round((p_values ->> 'per_km')::numeric, 2);
  v.per_minute := round((p_values ->> 'per_minute')::numeric, 2);
  v.minimum_fare := round((p_values ->> 'minimum_fare')::numeric, 2);
  v.booking_fee := round((p_values ->> 'booking_fee')::numeric, 2);
  v.waiting_per_minute := round((p_values ->> 'waiting_per_minute')::numeric, 2);
  v.cancellation_fee := round((p_values ->> 'cancellation_fee')::numeric, 2);
  v.platform_commission_pct := round((p_values ->> 'platform_commission_pct')::numeric, 4);
  v.max_surge_multiplier := round((p_values ->> 'max_surge_multiplier')::numeric, 2);
  v.free_waiting_minutes := coalesce((p_values ->> 'free_waiting_minutes')::integer, 3);
  -- A missing list means "all components"; array(select ...) over a missing key would be empty, not null.
  v.commissionable_components := case
    when jsonb_typeof(p_values -> 'commissionable_components') = 'array'
      then array(select jsonb_array_elements_text(p_values -> 'commissionable_components'))
    else array['base', 'distance', 'time', 'waiting', 'surge'] end;

  if v.platform_commission_pct > 0.5 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"platform_commission_pct","message":"Commission cannot exceed 50%."}]}');
  end if;
  if v.max_surge_multiplier < 1 or v.max_surge_multiplier > 3 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"max_surge_multiplier","message":"Surge cap must be between 1 and 3."}]}');
  end if;
  if v.free_waiting_minutes < 0 or v.free_waiting_minutes > 60 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"free_waiting_minutes","message":"Use 0 to 60 minutes."}]}');
  end if;
  if not (v.commissionable_components <@ array['base', 'distance', 'time', 'waiting', 'surge']) then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"commissionable_components","message":"Unknown fare component."}]}');
  end if;
  return v;
end $$;

create function private.fare_rule_json(p_rule public.fare_rules) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_rule.id, 'category_id', p_rule.category_id, 'zone_id', p_rule.zone_id, 'rule_version', p_rule.rule_version,
    'status', p_rule.status,
    'live_state', case
      when p_rule.status = 'draft' then 'draft'
      when p_rule.status = 'retired' or (p_rule.effective_to is not null and p_rule.effective_to <= now()) then 'ended'
      when p_rule.effective_from > now() then 'scheduled'
      else 'active' end,
    'base_fare', p_rule.base_fare, 'per_km', p_rule.per_km, 'per_minute', p_rule.per_minute,
    'minimum_fare', p_rule.minimum_fare, 'booking_fee', p_rule.booking_fee, 'waiting_per_minute', p_rule.waiting_per_minute,
    'free_waiting_minutes', p_rule.free_waiting_minutes, 'cancellation_fee', p_rule.cancellation_fee,
    'platform_commission_pct', p_rule.platform_commission_pct, 'max_surge_multiplier', p_rule.max_surge_multiplier,
    'commissionable_components', to_jsonb(p_rule.commissionable_components),
    'effective_from', p_rule.effective_from, 'effective_to', p_rule.effective_to,
    'published_at', p_rule.published_at,
    'published_by', (select full_name from public.profiles where id = p_rule.published_by),
    'change_note', p_rule.change_note, 'version', p_rule.version, 'created_at', p_rule.created_at
  );
$$;

-- ---------------------------------------------------------------------------
-- Admin RPCs
-- ---------------------------------------------------------------------------
create function api.list_fare_rules() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('fares.view');
  return jsonb_build_object(
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'active', c.active)
                   order by c.sort_order, c.name), '[]') from public.vehicle_categories c),
    'zones', (select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'active', z.active,
                   'manual_surge_multiplier', z.manual_surge_multiplier) order by z.name), '[]') from public.service_zones z),
    'rules', (select coalesce(jsonb_agg(private.fare_rule_json(r) order by r.category_id, r.zone_id nulls first, r.rule_version desc), '[]')
              from public.fare_rules r where r.deleted_at is null)
  );
end $$;

create function api.get_fare_rule(p_rule_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.fare_rules;
begin
  perform private.require_permission('fares.view');
  select * into v from public.fare_rules where id = p_rule_id and deleted_at is null;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  return private.fare_rule_json(v);
end $$;

-- Creates (p_id null) or updates a draft. Published rules are never edited.
create function api.save_fare_draft(
  p_id uuid, p_category_id uuid, p_zone_id uuid, p_values jsonb, p_change_note text, p_expected_version integer
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v public.fare_rules;
  v_existing public.fare_rules;
  v_id uuid;
  v_next integer;
begin
  perform private.require_permission('fares.manage');
  v := private.fare_values(p_values);
  if p_id is null then
    if not exists (select 1 from public.vehicle_categories where id = p_category_id) then
      perform private.raise_error('NOT_FOUND', '{"field":"category_id"}');
    end if;
    if p_zone_id is not null and not exists (select 1 from public.service_zones where id = p_zone_id) then
      perform private.raise_error('NOT_FOUND', '{"field":"zone_id"}');
    end if;
    select coalesce(max(rule_version), 0) + 1 into v_next from public.fare_rules
    where category_id = p_category_id and zone_id is not distinct from p_zone_id;
    insert into public.fare_rules (category_id, zone_id, rule_version, status, base_fare, per_km, per_minute, minimum_fare,
      booking_fee, waiting_per_minute, free_waiting_minutes, cancellation_fee, platform_commission_pct, max_surge_multiplier,
      commissionable_components, change_note)
    values (p_category_id, p_zone_id, v_next, 'draft', v.base_fare, v.per_km, v.per_minute, v.minimum_fare, v.booking_fee,
      v.waiting_per_minute, v.free_waiting_minutes, v.cancellation_fee, v.platform_commission_pct, v.max_surge_multiplier,
      v.commissionable_components, nullif(btrim(p_change_note), ''))
    returning id into v_id;
    perform private.log_admin_action('fare_rule.create_draft', 'fare_rule', v_id, null,
      jsonb_build_object('rule_version', v_next, 'category_id', p_category_id, 'zone_id', p_zone_id), null);
    return v_id;
  end if;

  select * into v_existing from public.fare_rules where id = p_id and deleted_at is null for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if v_existing.status <> 'draft' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', v_existing.status));
  end if;
  if v_existing.version <> p_expected_version then
    perform private.raise_error('STALE_VERSION');
  end if;
  update public.fare_rules set base_fare = v.base_fare, per_km = v.per_km, per_minute = v.per_minute,
    minimum_fare = v.minimum_fare, booking_fee = v.booking_fee, waiting_per_minute = v.waiting_per_minute,
    free_waiting_minutes = v.free_waiting_minutes, cancellation_fee = v.cancellation_fee,
    platform_commission_pct = v.platform_commission_pct, max_surge_multiplier = v.max_surge_multiplier,
    commissionable_components = v.commissionable_components, change_note = nullif(btrim(p_change_note), '')
  where id = p_id;
  return p_id;
end $$;

create function api.clone_fare_rule(p_rule_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v public.fare_rules;
  v_id uuid;
  v_next integer;
begin
  perform private.require_permission('fares.manage');
  select * into v from public.fare_rules where id = p_rule_id and deleted_at is null;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  select coalesce(max(rule_version), 0) + 1 into v_next from public.fare_rules
  where category_id = v.category_id and zone_id is not distinct from v.zone_id;
  insert into public.fare_rules (category_id, zone_id, rule_version, status, base_fare, per_km, per_minute, minimum_fare,
    booking_fee, waiting_per_minute, free_waiting_minutes, cancellation_fee, platform_commission_pct, max_surge_multiplier,
    commissionable_components, change_note)
  values (v.category_id, v.zone_id, v_next, 'draft', v.base_fare, v.per_km, v.per_minute, v.minimum_fare, v.booking_fee,
    v.waiting_per_minute, v.free_waiting_minutes, v.cancellation_fee, v.platform_commission_pct, v.max_surge_multiplier,
    v.commissionable_components, 'Cloned from v' || v.rule_version)
  returning id into v_id;
  perform private.log_admin_action('fare_rule.clone', 'fare_rule', v_id, null,
    jsonb_build_object('from', p_rule_id, 'rule_version', v_next), null);
  return v_id;
end $$;

create function api.discard_fare_draft(p_rule_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.fare_rules;
  v_reason text;
begin
  perform private.require_permission('fares.manage');
  v_reason := private.require_reason(p_reason);
  select * into v from public.fare_rules where id = p_rule_id and deleted_at is null for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if v.status <> 'draft' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', v.status));
  end if;
  update public.fare_rules set deleted_at = now(), deleted_by = auth.uid() where id = p_rule_id;
  perform private.log_admin_action('fare_rule.discard_draft', 'fare_rule', p_rule_id, null, null, v_reason);
end $$;

-- Publishes a draft from p_effective_from (null = now). The rule it replaces ends at the same instant.
create function api.publish_fare_rule(p_rule_id uuid, p_effective_from timestamptz, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.fare_rules;
  v_reason text;
  v_from timestamptz;
  v_current public.fare_rules;
  v_status public.fare_rule_status;
begin
  perform private.require_permission('fares.publish');
  v_reason := private.require_reason(p_reason);
  select * into v from public.fare_rules where id = p_rule_id and deleted_at is null for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if v.status <> 'draft' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', v.status));
  end if;
  v_from := greatest(coalesce(p_effective_from, now()), now());
  v_status := (case when v_from <= now() then 'active' else 'scheduled' end)::public.fare_rule_status;

  -- Another rule already scheduled to start at or after this one makes the order ambiguous.
  if exists (select 1 from public.fare_rules r
             where r.category_id = v.category_id and r.zone_id is not distinct from v.zone_id and r.id <> v.id
               and r.status = 'scheduled' and r.deleted_at is null and r.effective_from >= v_from) then
    perform private.raise_error('FARE_RULE_CONFLICT', '{"reason":"a later rule is already scheduled"}');
  end if;

  -- End the rule currently in force for this slot at the new start.
  for v_current in
    select * from public.fare_rules r
    where r.category_id = v.category_id and r.zone_id is not distinct from v.zone_id and r.id <> v.id
      and r.status in ('scheduled', 'active') and r.deleted_at is null
      and (r.effective_to is null or r.effective_to > v_from) and r.effective_from < v_from
    for update
  loop
    update public.fare_rules set effective_to = v_from where id = v_current.id;
  end loop;

  update public.fare_rules set status = v_status, effective_from = v_from, effective_to = null,
    published_by = auth.uid(), published_at = now()
  where id = p_rule_id;

  perform private.log_admin_action('fare_rule.publish', 'fare_rule', p_rule_id,
    jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', v_status, 'effective_from', v_from, 'rule_version', v.rule_version), v_reason);
  return api.get_fare_rule(p_rule_id);
end $$;

create function api.retire_fare_rule(p_rule_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.fare_rules;
  v_reason text;
begin
  perform private.require_permission('fares.publish');
  v_reason := private.require_reason(p_reason);
  select * into v from public.fare_rules where id = p_rule_id and deleted_at is null for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if v.status not in ('scheduled', 'active') then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', v.status));
  end if;
  update public.fare_rules set status = 'retired',
    effective_to = case when effective_from <= now() then greatest(now(), effective_from + interval '1 second') else effective_to end
  where id = p_rule_id;
  perform private.log_admin_action('fare_rule.retire', 'fare_rule', p_rule_id,
    jsonb_build_object('status', v.status), jsonb_build_object('status', 'retired'), v_reason);
  return api.get_fare_rule(p_rule_id);
end $$;

-- Admin simulator: unsaved draft values or a stored rule; optional comparison with a second rule.
create function api.simulate_fare(
  p_values jsonb, p_distance_m integer, p_duration_s integer, p_waiting_s integer, p_surge numeric, p_compare_rule_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.fare_rules;
  v_cmp public.fare_rules;
  v_result jsonb;
begin
  perform private.require_permission('fares.view');
  v := private.fare_values(p_values);
  if p_distance_m is null or p_distance_m < 0 or p_distance_m > 300000 or p_duration_s is null or p_duration_s < 0 or p_duration_s > 86400 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"distance","message":"Enter a realistic distance and time."}]}');
  end if;
  v_result := jsonb_build_object('breakdown', private.compute_fare(
    private.rule_snapshot(v) || jsonb_build_object('commissionable_components', to_jsonb(v.commissionable_components)),
    p_distance_m, p_duration_s, coalesce(p_waiting_s, 0), coalesce(p_surge, 1)));
  if p_compare_rule_id is not null then
    select * into v_cmp from public.fare_rules where id = p_compare_rule_id and deleted_at is null;
    if found then
      v_result := v_result || jsonb_build_object('compare', private.compute_fare(
        private.rule_snapshot(v_cmp), p_distance_m, p_duration_s, coalesce(p_waiting_s, 0), coalesce(p_surge, 1)));
    end if;
  end if;
  return v_result;
end $$;

-- Scheduled rules become active, ended ones retire (lookups use the time window, so this is bookkeeping).
create function private.advance_fare_rules() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer := 0;
  n integer;
begin
  update public.fare_rules set status = 'active' where status = 'scheduled' and effective_from <= now() and deleted_at is null;
  get diagnostics n = row_count;
  v_count := n;
  update public.fare_rules set status = 'retired' where status = 'active' and effective_to is not null and effective_to <= now();
  get diagnostics n = row_count;
  return v_count + n;
end $$;

select cron.schedule('advance-fare-rules', '* * * * *', 'select private.advance_fare_rules()');
