-- M4 · Async exports, business-health alerts, validated settings and feature flags
-- (docs/spec/03 §4.8, 06 §5.21 and §5.24, 07 §8, 08 §3).

insert into public.app_settings (key, value, description) values
  ('exports.alert_rows', '10000', 'An export with at least this many rows alerts the super admins.'),
  ('exports.max_rows', '100000', 'Hard cap on rows in one export.'),
  ('retention.exports_days', '7', 'Days a generated export stays downloadable.'),
  ('retention.quotes_days', '7', 'Days an unused, expired fare quote is kept.'),
  ('retention.trip_points_days', '365', 'Trip GPS points older than this are archived.'),
  ('retention.change_log_days', '730', 'Audit change-log rows older than this are archived.'),
  ('alerts.match_rate_min_pct', '70', 'A zone with a match rate below this (last 30 minutes) raises an alert.'),
  ('alerts.sos_unacked_s', '120', 'An SOS not acknowledged within this many seconds raises an alert.'),
  ('alerts.payout_failure_max_pct', '2', 'Payout failure rate (last 30 days) above this raises an alert.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Settings: validation schema per key
-- ---------------------------------------------------------------------------
alter table public.app_settings add column schema jsonb;

update public.app_settings s set schema = x.schema::jsonb from (values
  ('dispatch.offer_timeout_s', '{"group":"Dispatch","type":"integer","min":5,"max":60,"default":15,"unit":"s"}'),
  ('dispatch.search_radius_m', '{"group":"Dispatch","type":"number_list","min":200,"max":20000,"minItems":1,"maxItems":6,"default":[1500,3000,5000],"unit":"m"}'),
  ('dispatch.request_ttl_s', '{"group":"Dispatch","type":"integer","min":60,"max":900,"default":180,"unit":"s"}'),
  ('dispatch.avg_speed_kmh', '{"group":"Dispatch","type":"number","min":5,"max":80,"default":25,"unit":"km/h"}'),
  ('location.stale_after_s', '{"group":"Dispatch","type":"integer","min":15,"max":600,"default":120,"unit":"s"}'),
  ('quote.ttl_s', '{"group":"Dispatch","type":"integer","min":60,"max":1800,"default":300,"unit":"s"}'),
  ('cancellation.free_window_s', '{"group":"Cancellation","type":"integer","min":0,"max":900,"default":120,"unit":"s"}'),
  ('cancellation.no_show_wait_min', '{"group":"Cancellation","type":"integer","min":1,"max":30,"default":5,"unit":"min"}'),
  ('trips.arrival_radius_m', '{"group":"Dispatch","type":"integer","min":50,"max":1000,"default":150,"unit":"m"}'),
  ('trips.fare_variance_pct', '{"group":"Finance","type":"integer","min":5,"max":200,"default":30,"unit":"%"}'),
  ('trips.road_factor', '{"group":"Dispatch","type":"number","min":1,"max":2.5,"default":1.35}'),
  ('payments.enabled_methods', '{"group":"Payments","type":"enum_list","values":["cash"],"default":["cash"]}'),
  ('payments.cash_collection_grace_h', '{"group":"Payments","type":"integer","min":1,"max":168,"default":24,"unit":"h"}'),
  ('finance.dual_approval_threshold', '{"group":"Finance","type":"number","min":0,"max":10000000,"default":5000,"unit":"৳"}'),
  ('payouts.minimum_amount', '{"group":"Payouts","type":"number","min":0,"max":1000000,"default":500,"unit":"৳"}'),
  ('ratings.window_days', '{"group":"Support","type":"integer","min":1,"max":60,"default":7,"unit":"days"}'),
  ('support.auto_close_days', '{"group":"Support","type":"integer","min":1,"max":60,"default":7,"unit":"days"}'),
  ('documents.expiry_warning_days', '{"group":"Onboarding","type":"integer","min":1,"max":120,"default":30,"unit":"days"}'),
  ('documents.max_upload_bytes', '{"group":"Onboarding","type":"integer","min":102400,"max":26214400,"default":10485760,"unit":"bytes"}'),
  ('onboarding.required_documents', '{"group":"Onboarding","type":"json","editable":false}'),
  ('exports.alert_rows', '{"group":"Security","type":"integer","min":100,"max":1000000,"default":10000}'),
  ('exports.max_rows', '{"group":"Security","type":"integer","min":1000,"max":1000000,"default":100000}'),
  ('retention.exports_days', '{"group":"Retention","type":"integer","min":1,"max":30,"default":7,"unit":"days"}'),
  ('retention.quotes_days', '{"group":"Retention","type":"integer","min":1,"max":90,"default":7,"unit":"days"}'),
  ('retention.trip_points_days', '{"group":"Retention","type":"integer","min":90,"max":3650,"default":365,"unit":"days"}'),
  ('retention.change_log_days', '{"group":"Retention","type":"integer","min":180,"max":3650,"default":730,"unit":"days"}'),
  ('alerts.match_rate_min_pct', '{"group":"Alerts","type":"integer","min":10,"max":100,"default":70,"unit":"%"}'),
  ('alerts.sos_unacked_s', '{"group":"Alerts","type":"integer","min":30,"max":1800,"default":120,"unit":"s"}'),
  ('alerts.payout_failure_max_pct', '{"group":"Alerts","type":"integer","min":0,"max":100,"default":2,"unit":"%"}')
) as x(key, schema) where s.key = x.key;

create function private.validate_setting(p_schema jsonb, p_value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  v_type text := p_schema ->> 'type';
  v_min numeric := (p_schema ->> 'min')::numeric;
  v_max numeric := (p_schema ->> 'max')::numeric;
  e jsonb;
  v_prev numeric := null;
begin
  if v_type in ('integer', 'number') then
    if jsonb_typeof(p_value) <> 'number' then return false; end if;
    if v_type = 'integer' and (p_value #>> '{}')::numeric <> trunc((p_value #>> '{}')::numeric) then return false; end if;
    return (v_min is null or (p_value #>> '{}')::numeric >= v_min) and (v_max is null or (p_value #>> '{}')::numeric <= v_max);
  elsif v_type = 'number_list' then
    if jsonb_typeof(p_value) <> 'array' then return false; end if;
    if jsonb_array_length(p_value) < coalesce((p_schema ->> 'minItems')::int, 1) or jsonb_array_length(p_value) > coalesce((p_schema ->> 'maxItems')::int, 20) then return false; end if;
    for e in select * from jsonb_array_elements(p_value) loop
      if jsonb_typeof(e) <> 'number' then return false; end if;
      if (v_min is not null and (e #>> '{}')::numeric < v_min) or (v_max is not null and (e #>> '{}')::numeric > v_max) then return false; end if;
      if v_prev is not null and (e #>> '{}')::numeric <= v_prev then return false; end if; -- strictly ascending
      v_prev := (e #>> '{}')::numeric;
    end loop;
    return true;
  elsif v_type = 'enum_list' then
    if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) < 1 then return false; end if;
    for e in select * from jsonb_array_elements(p_value) loop
      if jsonb_typeof(e) <> 'string' or not (p_schema -> 'values') ? (e #>> '{}') then return false; end if;
    end loop;
    return true;
  end if;
  return false;
end $$;

create function api.list_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('settings.view');
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'key', s.key, 'value', s.value, 'description', s.description, 'schema', s.schema, 'version', s.version,
      'updated_at', s.updated_at, 'updated_by_name', (select full_name from public.profiles p where p.id = s.updated_by),
      'is_default', s.schema ? 'default' and s.value = s.schema -> 'default') order by coalesce(s.schema ->> 'group', 'Other'), s.key), '[]')
    from public.app_settings s);
end $$;

create function api.update_setting(p_key text, p_value jsonb, p_expected_version integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.app_settings;
  v_reason text := private.require_reason(p_reason);
  v_before jsonb;
begin
  perform private.require_permission('settings.manage');
  select * into s from public.app_settings where key = p_key for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if s.schema is null or coalesce((s.schema ->> 'editable')::boolean, true) = false then
    perform private.raise_error('IMMUTABLE_ROW', '{"reason":"this setting is not editable here"}');
  end if;
  if p_expected_version is not null and s.version <> p_expected_version then
    perform private.raise_error('STALE_VERSION');
  end if;
  if not private.validate_setting(s.schema, p_value) then
    perform private.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array(jsonb_build_object('path', 'value', 'message', 'That value is outside the allowed range.'))));
  end if;
  v_before := to_jsonb(s.value);
  update public.app_settings set value = p_value where key = p_key returning * into s;
  perform private.log_admin_action('setting.update', 'setting', null, jsonb_build_object('key', p_key, 'value', v_before),
    jsonb_build_object('key', p_key, 'value', p_value), v_reason);
  return jsonb_build_object('key', s.key, 'value', s.value, 'version', s.version);
end $$;

create function api.setting_history(p_key text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('settings.view');
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'at', a.created_at, 'admin', (select full_name from public.profiles p where p.id = a.admin_id),
      'before', a.before_data -> 'value', 'after', a.after_data -> 'value', 'reason', a.reason) order by a.created_at desc), '[]')
    from (select * from public.admin_audit_logs where action = 'setting.update' and after_data ->> 'key' = p_key order by created_at desc limit 30) a);
end $$;

-- ---------------------------------------------------------------------------
-- Feature flags
-- ---------------------------------------------------------------------------
create table public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{2,40}$'),
  enabled boolean not null default false,
  rules jsonb not null default '{}',
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  constraint chk_feature_flags_rules check (jsonb_typeof(rules) = 'object')
);
create trigger trg_feature_flags_stamp before insert or update on public.feature_flags
  for each row execute function private.stamp_row();
create trigger trg_feature_flags_no_delete before delete on public.feature_flags
  for each row execute function private.forbid_delete();
alter table public.feature_flags enable row level security;
alter table public.feature_flags force row level security;
revoke all on public.feature_flags from public, anon, authenticated;
grant select on public.feature_flags to authenticated;
create policy feature_flags_read on public.feature_flags for select to authenticated using ((select private.has_permission('settings.view')));

insert into public.feature_flags (key, enabled, description) values
  ('pickup_pin', false, 'Ask the passenger for a PIN before the driver can start the trip.'),
  ('auto_surge', false, 'Automatic demand-based surge (manual zone surge only while off).'),
  ('digital_payments', false, 'Allow bKash, Nagad and card payments (needs a provider).'),
  ('promo_codes', true, 'Passengers can apply promotion codes to a ride.');

-- Rules: {"zone_ids": [...], "category_ids": [...], "percentage": 0-100}. Empty rules mean everyone.
create function private.flag_enabled(p_key text, p_zone uuid default null, p_category uuid default null, p_subject uuid default null) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  f public.feature_flags;
  v_pct numeric;
begin
  select * into f from public.feature_flags where key = p_key;
  if not found or not f.enabled then
    return false;
  end if;
  if jsonb_array_length(coalesce(f.rules -> 'zone_ids', '[]')) > 0 and (p_zone is null or not (f.rules -> 'zone_ids') ? p_zone::text) then
    return false;
  end if;
  if jsonb_array_length(coalesce(f.rules -> 'category_ids', '[]')) > 0 and (p_category is null or not (f.rules -> 'category_ids') ? p_category::text) then
    return false;
  end if;
  v_pct := (f.rules ->> 'percentage')::numeric;
  if v_pct is not null and v_pct < 100 then
    return p_subject is not null and (abs(hashtextextended(p_key || p_subject::text, 0)) % 100) < v_pct;
  end if;
  return true;
end $$;

create function api.list_flags() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('settings.view');
  return (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'enabled', enabled, 'rules', rules, 'description', description,
      'version', version, 'updated_at', updated_at, 'updated_by_name', (select full_name from public.profiles p where p.id = f.updated_by)) order by key), '[]')
    from public.feature_flags f);
end $$;

create function api.set_flag(p_key text, p_enabled boolean, p_rules jsonb, p_expected_version integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  f public.feature_flags;
  v_reason text := private.require_reason(p_reason);
  v_rules jsonb := coalesce(p_rules, '{}');
  k text;
begin
  perform private.require_permission('settings.manage');
  select * into f from public.feature_flags where key = p_key for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if p_expected_version is not null and f.version <> p_expected_version then
    perform private.raise_error('STALE_VERSION');
  end if;
  if jsonb_typeof(v_rules) <> 'object' then
    perform private.raise_error('VALIDATION_FAILED');
  end if;
  for k in select jsonb_object_keys(v_rules) loop
    if k not in ('zone_ids', 'category_ids', 'percentage') then
      perform private.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array(jsonb_build_object('path', k, 'message', 'Unknown rule.'))));
    end if;
  end loop;
  if v_rules ? 'percentage' and (jsonb_typeof(v_rules -> 'percentage') <> 'number' or (v_rules ->> 'percentage')::numeric not between 0 and 100) then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"percentage","message":"Use a number from 0 to 100."}]}');
  end if;
  update public.feature_flags set enabled = coalesce(p_enabled, enabled), rules = v_rules where key = p_key returning * into f;
  perform private.log_admin_action('flag.update', 'feature_flag', null, null, jsonb_build_object('key', p_key, 'enabled', f.enabled, 'rules', f.rules), v_reason);
  return jsonb_build_object('key', f.key, 'enabled', f.enabled, 'version', f.version);
end $$;

-- What a client app needs at start-up: flags evaluated for the caller, and a few safe settings.
create function api.client_config() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  return jsonb_build_object(
    'flags', (select coalesce(jsonb_object_agg(key, private.flag_enabled(key, null, null, auth.uid())), '{}') from public.feature_flags),
    'settings', jsonb_build_object(
      'cancellation_free_window_s', private.setting('cancellation.free_window_s'),
      'quote_ttl_s', private.setting('quote.ttl_s'),
      'payment_methods', private.setting('payments.enabled_methods'),
      'rating_window_days', private.setting('ratings.window_days')));
end $$;

-- ---------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------
create table public.ops_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  title text not null,
  detail jsonb not null default '{}',
  audience text not null default 'dashboard.view',
  status text not null default 'open' check (status in ('open', 'resolved')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  acknowledged_by uuid references public.profiles (id),
  acknowledged_at timestamptz,
  ack_note text
);
create unique index uq_ops_alerts_open on public.ops_alerts (alert_key) where status = 'open';
create index idx_ops_alerts_status on public.ops_alerts (status, last_seen_at desc);
alter table public.ops_alerts enable row level security;
alter table public.ops_alerts force row level security;
revoke all on public.ops_alerts from public, anon, authenticated;
grant select on public.ops_alerts to authenticated;
create policy ops_alerts_read on public.ops_alerts for select to authenticated using ((select private.has_permission('dashboard.view')));
create trigger trg_ops_alerts_no_delete before delete on public.ops_alerts
  for each row execute function private.forbid_delete();

create function private.raise_alert(p_key text, p_severity text, p_title text, p_detail jsonb, p_audience text default 'dashboard.view') returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  update public.ops_alerts set last_seen_at = now(), detail = p_detail, severity = p_severity where alert_key = p_key and status = 'open';
  if found then
    return;
  end if;
  insert into public.ops_alerts (alert_key, severity, title, detail, audience) values (p_key, p_severity, p_title, p_detail, p_audience)
  on conflict (alert_key) where status = 'open' do nothing returning id into v_id;
  if v_id is not null then
    perform private.notify_holders(p_audience, 'ops_alert', p_title, left(p_detail::text, 200), '/alerts');
  end if;
end $$;

create function private.clear_alert(p_key text) returns void
language sql security definer set search_path = '' as $$
  update public.ops_alerts set status = 'resolved', resolved_at = now() where alert_key = p_key and status = 'open';
$$;

-- Evaluated every minute. Each condition raises its own alert (keyed, so it fires once while it holds) and clears when it stops.
create function private.evaluate_alerts() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  z record;
  v_min numeric := coalesce((private.setting('alerts.match_rate_min_pct'))::numeric, 70);
  v_sos integer := coalesce((private.setting('alerts.sos_unacked_s'))::int, 120);
  v_pay numeric := coalesce((private.setting('alerts.payout_failure_max_pct'))::numeric, 2);
  v_n integer;
  v_total integer;
  v_failed integer;
  v_last timestamptz;
  v_ok boolean;
  v_raised integer := 0;
begin
  -- Match rate and supply per zone over the last 30 minutes.
  for z in
    select zn.id, zn.name, count(r.id) as reqs, count(r.id) filter (where r.matched_at is not null) as matched,
           (select count(*) from public.driver_live_locations l join public.driver_profiles d on d.id = l.driver_id
             where d.availability = 'online' and l.updated_at > now() - interval '120 seconds'
               and extensions.st_intersects(zn.boundary::extensions.geometry, l.location::extensions.geometry)) as online
    from public.service_zones zn
    left join public.ride_requests r on r.zone_id = zn.id and r.requested_at > now() - interval '30 minutes' and r.status not in ('requested', 'searching')
    where zn.active group by zn.id, zn.name, zn.boundary
  loop
    if z.reqs >= 5 and z.matched::numeric / z.reqs * 100 < v_min then
      perform private.raise_alert('match_rate:' || z.id, 'warning', 'Low match rate in ' || z.name,
        jsonb_build_object('zone', z.name, 'requests', z.reqs, 'matched', z.matched, 'threshold_pct', v_min), 'dispatch.view');
      v_raised := v_raised + 1;
    else
      perform private.clear_alert('match_rate:' || z.id);
    end if;
    if z.reqs >= 1 and z.online = 0 then
      perform private.raise_alert('no_supply:' || z.id, 'critical', 'No drivers online in ' || z.name,
        jsonb_build_object('zone', z.name, 'requests_last_30m', z.reqs), 'dispatch.view');
      v_raised := v_raised + 1;
    else
      perform private.clear_alert('no_supply:' || z.id);
    end if;
  end loop;

  select count(*) into v_n from public.safety_incidents where status = 'reported' and reported_at < now() - make_interval(secs => v_sos);
  if v_n > 0 then
    perform private.raise_alert('sos_unacked', 'critical', v_n || ' safety incident(s) not acknowledged', jsonb_build_object('count', v_n, 'after_s', v_sos), 'safety.view');
    v_raised := v_raised + 1;
  else
    perform private.clear_alert('sos_unacked');
  end if;

  select count(*) into v_n from public.payments where status = 'succeeded' and collected_amount is distinct from amount and reconciled_at is null;
  if v_n > 0 then
    perform private.raise_alert('recon_variance', 'warning', v_n || ' payment(s) collected a different amount than the fare', jsonb_build_object('count', v_n), 'payments.reconcile');
    v_raised := v_raised + 1;
  else
    perform private.clear_alert('recon_variance');
  end if;

  select ok, ran_at into v_ok, v_last from public.ledger_verification_runs order by id desc limit 1;
  if v_ok is false then
    perform private.raise_alert('ledger_verification', 'critical', 'The last ledger verification failed', jsonb_build_object('ran_at', v_last), 'ledger.view');
    v_raised := v_raised + 1;
  else
    perform private.clear_alert('ledger_verification');
  end if;

  select count(*), count(*) filter (where status = 'failed') into v_total, v_failed from public.payouts where created_at > now() - interval '30 days';
  if v_total >= 5 and v_failed::numeric / v_total * 100 > v_pay then
    perform private.raise_alert('payout_failures', 'warning', 'Payout failure rate is above target', jsonb_build_object('failed', v_failed, 'total', v_total, 'max_pct', v_pay), 'payouts.view');
    v_raised := v_raised + 1;
  else
    perform private.clear_alert('payout_failures');
  end if;

  -- The dispatch tick must keep running (every 5 s); more than 15 s of silence means offers stop expiring.
  begin
    select max(end_time) into v_last from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = 'dispatch-tick' and d.status = 'succeeded';
    if v_last is not null and v_last < now() - interval '15 seconds' then
      perform private.raise_alert('dispatch_lag', 'critical', 'The dispatch tick has stopped', jsonb_build_object('last_run', v_last), 'dispatch.intervene');
      v_raised := v_raised + 1;
    else
      perform private.clear_alert('dispatch_lag');
    end if;
  exception when others then
    null; -- cron history is not readable here: skip rather than fail the whole evaluation
  end;
  return v_raised;
end $$;
select cron.schedule('evaluate-alerts', '* * * * *', 'select private.evaluate_alerts()');

create function api.list_alerts(p_status text default 'open') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('dashboard.view');
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'key', a.alert_key, 'severity', a.severity, 'title', a.title, 'detail', a.detail, 'status', a.status,
      'first_seen_at', a.first_seen_at, 'last_seen_at', a.last_seen_at, 'resolved_at', a.resolved_at,
      'acknowledged_by_name', (select full_name from public.profiles p where p.id = a.acknowledged_by), 'acknowledged_at', a.acknowledged_at, 'ack_note', a.ack_note)
      order by (a.severity = 'critical') desc, a.last_seen_at desc), '[]')
    from (select * from public.ops_alerts where p_status is null or status = p_status order by last_seen_at desc limit 100) a);
end $$;

create function api.acknowledge_alert(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := private.require_reason(p_note);
begin
  if not private.has_any_permission(array['dispatch.intervene', 'safety.manage', 'ledger.adjust_approve', 'payments.reconcile', 'settings.manage']) then
    perform private.raise_error('FORBIDDEN');
  end if;
  update public.ops_alerts set acknowledged_by = auth.uid(), acknowledged_at = now(), ack_note = v_note where id = p_id and status = 'open';
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  perform private.log_admin_action('alert.acknowledge', 'ops_alert', p_id, null, null, v_note);
end $$;

-- ---------------------------------------------------------------------------
-- Exports
-- ---------------------------------------------------------------------------
create table public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles (id),
  kind text not null check (kind in ('trips', 'payments', 'ledger', 'tickets', 'drivers')),
  params jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'running', 'ready', 'failed', 'expired')),
  row_count integer,
  byte_size integer,
  content text,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  expires_at timestamptz
);
create index idx_export_jobs_requester on public.export_jobs (requested_by, created_at desc);
create index idx_export_jobs_queue on public.export_jobs (created_at) where status = 'queued';
alter table public.export_jobs enable row level security;
alter table public.export_jobs force row level security;
revoke all on public.export_jobs from public, anon, authenticated;
-- The CSV itself is only handed out by api.get_export_content (logged), never by a plain select.
grant select (id, requested_by, kind, params, status, row_count, byte_size, error, created_at, finished_at, expires_at) on public.export_jobs to authenticated;
create policy export_jobs_own on public.export_jobs for select to authenticated
  using (requested_by = (select auth.uid()) and (select private.has_permission('analytics.export')));
create trigger trg_export_jobs_no_delete before delete on public.export_jobs
  for each row execute function private.forbid_delete();

-- A spreadsheet treats a cell starting with = + - @ as a formula: prefix it so imported data can never execute.
create function private.csv_cell(p_value text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v text := coalesce(p_value, '');
begin
  if v ~ '^[=+@-]' or v ~ '^\s*[\t\r]' then
    v := '''' || v;
  end if;
  if v ~ '[",\n\r]' or v <> btrim(v) then
    return '"' || replace(v, '"', '""') || '"';
  end if;
  return v;
end $$;

create function private.csv_row(variadic p_cells text[]) returns text
language sql immutable set search_path = '' as $$
  select string_agg(private.csv_cell(c), ',' order by n) from unnest(p_cells) with ordinality t(c, n);
$$;

create function private.export_permission(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind when 'trips' then 'trips.view' when 'payments' then 'payments.view' when 'ledger' then 'ledger.view'
                     when 'tickets' then 'support.view' when 'drivers' then 'drivers.view' end;
$$;

create function private.export_count(p_kind text, p_from timestamptz, p_to timestamptz) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare
  n integer;
begin
  execute case p_kind
    when 'trips' then 'select count(*) from public.trips where created_at >= $1 and created_at < $2'
    when 'payments' then 'select count(*) from public.payments where created_at >= $1 and created_at < $2'
    when 'ledger' then 'select count(*) from public.ledger_transactions where created_at >= $1 and created_at < $2'
    when 'tickets' then 'select count(*) from public.support_tickets where created_at >= $1 and created_at < $2'
    else 'select count(*) from public.driver_profiles where created_at >= $1 and created_at < $2' end
  into n using p_from, p_to;
  return n;
end $$;

-- Personal details are limited to names: no phone numbers, emails or document data ever leave in an export.
create function private.build_export(p_kind text, p_from timestamptz, p_to timestamptz, p_max integer, out o_content text, out o_rows integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_header text;
begin
  if p_kind = 'trips' then
    v_header := private.csv_row('trip_id', 'status', 'requested_at', 'completed_at', 'distance_km', 'duration_min', 'fare', 'payment_method', 'cancellation_fee', 'passenger', 'driver');
    select v_header || E'\n' || coalesce(string_agg(private.csv_row(t.id::text, t.status::text, r.requested_at::text, t.completed_at::text,
             round(coalesce(t.actual_distance_m, 0) / 1000.0, 2)::text, round(coalesce(t.actual_duration_s, 0) / 60.0, 1)::text, t.final_fare::text,
             t.payment_method::text, t.cancellation_fee::text, pp.full_name, dp.full_name), E'\n' order by t.created_at, t.id), ''), count(*)::integer
    into o_content, o_rows
    from (select * from public.trips where created_at >= p_from and created_at < p_to order by created_at, id limit p_max) t
    join public.ride_requests r on r.id = t.request_id join public.profiles pp on pp.id = t.passenger_id
    join public.driver_profiles d on d.id = t.driver_id join public.profiles dp on dp.id = d.user_id;
  elsif p_kind = 'payments' then
    v_header := private.csv_row('payment_id', 'trip_id', 'method', 'amount', 'status', 'refunded', 'collected', 'reconciled_at', 'created_at');
    select v_header || E'\n' || coalesce(string_agg(private.csv_row(p.id::text, p.trip_id::text, p.method::text, p.amount::text, p.status::text,
             p.refunded_amount::text, p.collected_amount::text, p.reconciled_at::text, p.created_at::text), E'\n' order by p.created_at, p.id), ''), count(*)::integer
    into o_content, o_rows
    from (select * from public.payments where created_at >= p_from and created_at < p_to order by created_at, id limit p_max) p;
  elsif p_kind = 'ledger' then
    v_header := private.csv_row('transaction_id', 'kind', 'reference', 'trip_id', 'amount', 'memo', 'created_at');
    select v_header || E'\n' || coalesce(string_agg(private.csv_row(t.id::text, t.kind, t.reference, t.trip_id::text,
             (select coalesce(sum(e.debit), 0)::text from public.ledger_entries e where e.transaction_id = t.id), t.memo, t.created_at::text), E'\n' order by t.created_at, t.id), ''), count(*)::integer
    into o_content, o_rows
    from (select * from public.ledger_transactions where created_at >= p_from and created_at < p_to order by created_at, id limit p_max) t;
  elsif p_kind = 'tickets' then
    v_header := private.csv_row('ticket_no', 'category', 'status', 'priority', 'subject', 'created_at', 'first_response_at', 'resolved_at');
    select v_header || E'\n' || coalesce(string_agg(private.csv_row(s.ticket_no::text, s.category, s.status::text, s.priority::text, s.subject,
             s.created_at::text, s.first_response_at::text, s.resolved_at::text), E'\n' order by s.created_at, s.id), ''), count(*)::integer
    into o_content, o_rows
    from (select * from public.support_tickets where created_at >= p_from and created_at < p_to order by created_at, id limit p_max) s;
  else
    v_header := private.csv_row('driver_id', 'name', 'onboarding_status', 'availability', 'rating_avg', 'rating_count', 'approved_at', 'created_at');
    select v_header || E'\n' || coalesce(string_agg(private.csv_row(d.id::text, pr.full_name, d.onboarding_status::text, d.availability::text,
             d.rating_avg::text, d.rating_count::text, d.approved_at::text, d.created_at::text), E'\n' order by d.created_at, d.id), ''), count(*)::integer
    into o_content, o_rows
    from (select * from public.driver_profiles where created_at >= p_from and created_at < p_to order by created_at, id limit p_max) d
    join public.profiles pr on pr.id = d.user_id;
  end if;
end $$;

create function private.process_export(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  j public.export_jobs;
  v_max integer := coalesce((private.setting('exports.max_rows'))::int, 100000);
  v_alert integer := coalesce((private.setting('exports.alert_rows'))::int, 10000);
  v_from timestamptz;
  v_to timestamptz;
  r record;
  v_days integer := coalesce((private.setting('retention.exports_days'))::int, 7);
begin
  select * into j from public.export_jobs where id = p_id and status = 'queued' for update skip locked;
  if not found then
    return;
  end if;
  update public.export_jobs set status = 'running' where id = j.id;
  begin
    v_from := ((j.params ->> 'from')::date)::timestamp at time zone 'Asia/Dhaka';
    v_to := (((j.params ->> 'to')::date) + 1)::timestamp at time zone 'Asia/Dhaka';
    select * into r from private.build_export(j.kind, v_from, v_to, v_max);
    update public.export_jobs set status = 'ready', content = r.o_content, row_count = r.o_rows, byte_size = octet_length(r.o_content),
      finished_at = now(), expires_at = now() + make_interval(days => v_days) where id = j.id;
    if r.o_rows >= v_alert then
      perform private.notify_holders('audit.view', 'export_large', 'Large export: ' || r.o_rows || ' ' || j.kind || ' rows',
        'Requested by ' || coalesce((select full_name from public.profiles p where p.id = j.requested_by), 'an admin'), '/exports');
    end if;
  exception when others then
    update public.export_jobs set status = 'failed', error = 'The export could not be generated.', finished_at = now() where id = j.id;
  end;
end $$;

create function private.process_exports() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  j record;
  n integer := 0;
begin
  for j in select id from public.export_jobs where status = 'queued' order by created_at limit 5 loop
    perform private.process_export(j.id);
    n := n + 1;
  end loop;
  update public.export_jobs set status = 'expired', content = null where status = 'ready' and expires_at < now();
  return n;
end $$;
select cron.schedule('process-exports', '* * * * *', 'select private.process_exports()');

create function api.request_export(p_kind text, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_perm text := private.export_permission(p_kind);
  v_est integer;
begin
  perform private.require_permission('analytics.export');
  if v_perm is null then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"kind","message":"Choose what to export."}]}');
  end if;
  perform private.require_permission(v_perm);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"range","message":"Choose a range of up to 366 days."}]}');
  end if;
  if (select count(*) from public.export_jobs where requested_by = auth.uid() and status in ('queued', 'running')) >= 3 then
    perform private.raise_error('RATE_LIMITED', '{"reason":"three exports are already running"}');
  end if;
  insert into public.export_jobs (requested_by, kind, params) values (auth.uid(), p_kind, jsonb_build_object('from', p_from, 'to', p_to)) returning id into v_id;
  perform private.log_admin_action('export.request', 'export', v_id, null, jsonb_build_object('kind', p_kind, 'from', p_from, 'to', p_to), null);
  -- Small exports finish immediately; bigger ones wait for the minute job.
  v_est := private.export_count(p_kind, p_from::timestamp at time zone 'Asia/Dhaka', (p_to + 1)::timestamp at time zone 'Asia/Dhaka');
  if v_est <= 5000 then
    perform private.process_export(v_id);
  end if;
  return (select jsonb_build_object('id', id, 'status', status, 'row_count', row_count) from public.export_jobs where id = v_id);
end $$;

create function api.list_exports() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('analytics.export');
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'params', params, 'status', status, 'row_count', row_count,
      'byte_size', byte_size, 'error', error, 'created_at', created_at, 'finished_at', finished_at, 'expires_at', expires_at) order by created_at desc), '[]')
    from (select * from public.export_jobs where requested_by = auth.uid() order by created_at desc limit 50) j);
end $$;

create function api.get_export_content(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j public.export_jobs;
begin
  perform private.require_permission('analytics.export');
  select * into j from public.export_jobs where id = p_id and requested_by = auth.uid();
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if j.status <> 'ready' or j.expires_at < now() then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', j.status));
  end if;
  perform private.require_permission(private.export_permission(j.kind));
  perform private.log_admin_action('export.download', 'export', j.id, null, jsonb_build_object('kind', j.kind, 'rows', j.row_count), null);
  return jsonb_build_object('filename', j.kind || '-' || (j.params ->> 'from') || '-' || (j.params ->> 'to') || '.csv', 'content', j.content);
end $$;

-- Zones and vehicle categories for the dashboard and analytics filters (no fares permission needed).
create function api.insight_filters() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_any_permission(array['dashboard.view', 'analytics.view']) then
    perform private.raise_error('FORBIDDEN');
  end if;
  return jsonb_build_object(
    'zones', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]') from public.service_zones where active),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]') from public.vehicle_categories where active));
end $$;

-- ---------------------------------------------------------------------------
-- Grants (functions are not executable by default)
-- ---------------------------------------------------------------------------
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
