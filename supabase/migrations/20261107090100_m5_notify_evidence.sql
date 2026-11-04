-- Follow-ups: notification outbox (email, SMS, push) with SOS and critical-alert hooks, and SOS evidence uploads.

-- ---------------------------------------------------------------------------
-- Notification outbox
-- ---------------------------------------------------------------------------
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('email', 'sms', 'push')),
  recipient_id uuid not null references public.profiles (id),
  to_address text,
  subject text not null check (length(subject) <= 200),
  body text not null check (length(body) <= 1000),
  link text check (link is null or link ~ '^/[^/\\]'),
  dedupe_key text,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index uq_outbox_dedupe on public.notification_outbox (dedupe_key, channel, recipient_id) where dedupe_key is not null;
create index idx_outbox_queue on public.notification_outbox (next_attempt_at) where status in ('queued', 'sending');
create index idx_outbox_created on public.notification_outbox (created_at desc);
alter table public.notification_outbox enable row level security;
alter table public.notification_outbox force row level security;
revoke all on public.notification_outbox from public, anon, authenticated;
grant select (id, channel, recipient_id, subject, status, attempts, last_error, created_at, sent_at) on public.notification_outbox to authenticated;
create policy outbox_admin_read on public.notification_outbox for select to authenticated using ((select private.has_permission('settings.view')));
create trigger trg_outbox_no_delete before delete on public.notification_outbox
  for each row execute function private.forbid_delete();

create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  platform text not null check (platform in ('android', 'ios', 'web')),
  token text not null check (length(token) between 20 and 4096),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint uq_push_devices_token unique (token)
);
create index idx_push_devices_user on public.push_devices (user_id);
alter table public.push_devices enable row level security;
alter table public.push_devices force row level security;
revoke all on public.push_devices from public, anon, authenticated;

create function api.register_device(p_platform text, p_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  if p_platform is null or p_platform not in ('android', 'ios', 'web') or p_token is null or length(btrim(p_token)) not between 20 and 4096 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"token","message":"Send the device token and platform."}]}');
  end if;
  -- A token belongs to whoever registered it last (a shared phone changes hands).
  insert into public.push_devices (user_id, platform, token) values (auth.uid(), p_platform, btrim(p_token))
  on conflict (token) do update set user_id = auth.uid(), platform = excluded.platform, last_seen_at = now();
end $$;

create function api.unregister_device(p_token text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_devices where token = p_token and user_id = auth.uid();
$$;

-- Queues one message per channel for a recipient; channels without an address (no phone, no device) are skipped silently.
create function private.enqueue_notification(p_channel text, p_recipient uuid, p_subject text, p_body text, p_link text, p_dedupe text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_address text;
begin
  if p_channel = 'email' then
    select email into v_address from public.profiles where id = p_recipient;
  elsif p_channel = 'sms' then
    select phone into v_address from public.profiles where id = p_recipient;
  else
    if not exists (select 1 from public.push_devices where user_id = p_recipient) then
      return;
    end if;
  end if;
  if p_channel <> 'push' and v_address is null then
    return;
  end if;
  insert into public.notification_outbox (channel, recipient_id, to_address, subject, body, link, dedupe_key)
  values (p_channel, p_recipient, v_address, left(p_subject, 200), left(p_body, 1000), p_link, p_dedupe)
  on conflict (dedupe_key, channel, recipient_id) where dedupe_key is not null do nothing;
end $$;

create function private.enqueue_for_holders(p_permission text, p_channels text[], p_subject text, p_body text, p_link text, p_dedupe text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a record;
  c text;
begin
  for a in select p.id from public.profiles p where p.role = 'admin' and p.status = 'active' and private.admin_holds(p.id, p_permission) loop
    foreach c in array p_channels loop
      perform private.enqueue_notification(c, a.id, p_subject, p_body, p_link, p_dedupe);
    end loop;
  end loop;
end $$;

-- Delivery worker interface: callable only with the service-role key (the Next.js job route).
create function private.require_service_role() returns void
language plpgsql stable set search_path = '' as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role' then
    perform private.raise_error('FORBIDDEN');
  end if;
end $$;

create function api.claim_notifications(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  perform private.require_service_role();
  select coalesce(array_agg(id), '{}') into v_ids from (
    select id from public.notification_outbox
    where (status = 'queued' and next_attempt_at <= now()) or (status = 'sending' and next_attempt_at <= now() - interval '5 minutes')
    order by created_at limit least(greatest(coalesce(p_limit, 20), 1), 100) for update skip locked) q;
  update public.notification_outbox set status = 'sending', attempts = attempts + 1, next_attempt_at = now() where id = any (v_ids);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'channel', o.channel, 'to', o.to_address, 'subject', o.subject, 'body', o.body, 'link', o.link, 'attempts', o.attempts,
      'tokens', case when o.channel = 'push' then (select coalesce(jsonb_agg(d.token), '[]') from public.push_devices d where d.user_id = o.recipient_id) end)
      order by o.created_at), '[]')
    from public.notification_outbox o where o.id = any (v_ids));
end $$;

create function api.finish_notification(p_id uuid, p_ok boolean, p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o public.notification_outbox;
begin
  perform private.require_service_role();
  select * into o from public.notification_outbox where id = p_id for update;
  if not found then
    return;
  end if;
  if p_ok then
    update public.notification_outbox set status = 'sent', sent_at = now(), last_error = null where id = p_id;
  elsif o.attempts >= 5 then
    update public.notification_outbox set status = 'failed', last_error = left(p_error, 300) where id = p_id;
  else
    -- Exponential back-off: 1, 2, 4, 8 minutes.
    update public.notification_outbox set status = 'queued', last_error = left(p_error, 300),
      next_attempt_at = now() + make_interval(mins => power(2, o.attempts - 1)::int) where id = p_id;
  end if;
end $$;

create function api.outbox_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('settings.view');
  return jsonb_build_object(
    'counts', (select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'status', status, 'count', n)), '[]')
               from (select channel, status, count(*) n from public.notification_outbox where created_at > now() - interval '7 days' group by 1, 2) c),
    'recent_failures', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'channel', channel, 'subject', subject, 'error', last_error, 'attempts', attempts, 'created_at', created_at) order by created_at desc), '[]')
                        from (select * from public.notification_outbox where status = 'failed' order by created_at desc limit 20) f),
    'queued', (select count(*) from public.notification_outbox where status in ('queued', 'sending')));
end $$;

-- Critical alerts also go out by email and SMS to the people who hold the alert's audience permission.
create or replace function private.raise_alert(p_key text, p_severity text, p_title text, p_detail jsonb, p_audience text default 'dashboard.view') returns void
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
    if p_severity = 'critical' then
      perform private.enqueue_for_holders(p_audience, array['email', 'sms', 'push'], p_title, left(p_detail::text, 300), '/alerts', 'alert:' || v_id);
    end if;
  end if;
end $$;

-- SOS: the in-app alert already exists; this adds the out-of-app channels.
create or replace function api.trigger_sos(p_trip_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
  v_role public.app_role := private.current_app_role();
  v_loc extensions.geography;
  v_id uuid;
  v_no bigint;
  v_note text := left(nullif(btrim(p_note), ''), 2000);
begin
  if v_role not in ('passenger', 'driver') then
    perform private.raise_error('ROLE_NOT_ALLOWED');
  end if;
  select * into t from public.trips where id = p_trip_id and (passenger_id = auth.uid() or driver_id = private.my_driver_id());
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if t.status not in ('driver_assigned', 'driver_arriving', 'arrived', 'in_progress') then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', t.status));
  end if;
  select id, incident_no into v_id, v_no from public.safety_incidents
  where trip_id = t.id and reporter_id = auth.uid() and kind = 'sos' and status not in ('resolved', 'closed');
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'incident_no', v_no, 'status', 'reported', 'repeat', true);
  end if;

  select location into v_loc from public.driver_live_locations where driver_id = t.driver_id;
  insert into public.safety_incidents (trip_id, reporter_id, reporter_role, kind, severity, description, location)
  values (t.id, auth.uid(), v_role, 'sos', 'critical', v_note, v_loc) returning id, incident_no into v_id, v_no;
  insert into public.safety_incident_events (incident_id, to_status, actor_id, note) values (v_id, 'reported', auth.uid(), v_note);

  perform private.broadcast('ops:safety', 'sos', jsonb_build_object('id', v_id, 'incident_no', v_no, 'trip_id', t.id));
  perform private.notify_holders('safety.view', 'sos', 'SOS #' || v_no, 'A ' || v_role || ' triggered SOS on an active trip.', '/safety/' || v_id);
  -- Out-of-app alerts to everyone on the safety team: email, SMS and push (each only where an address or device exists).
  perform private.enqueue_for_holders('safety.view', array['email', 'sms', 'push'], 'SOS #' || v_no,
    'A ' || v_role || ' triggered SOS on an active trip. Open the safety queue now.', '/safety/' || v_id, 'sos:' || v_id);
  return jsonb_build_object('id', v_id, 'incident_no', v_no, 'status', 'reported', 'repeat', false);
end $$;

-- ---------------------------------------------------------------------------
-- SOS evidence
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('safety-evidence', 'safety-evidence', false, 15728640,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'audio/mp4', 'video/mp4'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table public.safety_evidence (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.safety_incidents (id),
  storage_path text not null unique,
  content_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  description text check (length(description) <= 500),
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index idx_safety_evidence_incident on public.safety_evidence (incident_id, created_at);
create trigger trg_safety_evidence_append_only before update or delete on public.safety_evidence
  for each row execute function private.forbid_update_delete();
alter table public.safety_evidence enable row level security;
alter table public.safety_evidence force row level security;
revoke all on public.safety_evidence from public, anon, authenticated;
grant select on public.safety_evidence to authenticated;
create policy safety_evidence_read on public.safety_evidence for select to authenticated using ((select private.has_permission('safety.view_evidence')));

-- An object name is '<incident id>/<uuid>.<ext>'. The reporter of that incident, or a safety manager, may upload it.
create function private.can_upload_incident_evidence(p_object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_object_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf|m4a|mp4)$'
    and exists (
      select 1 from public.safety_incidents i
      where i.id::text = split_part(p_object_name, '/', 1) and i.status not in ('closed')
        and (i.reporter_id = auth.uid() or private.has_permission('safety.manage')));
$$;

create policy safety_evidence_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'safety-evidence' and (select private.can_upload_incident_evidence(name)));
create policy safety_evidence_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'safety-evidence' and (select private.has_permission('safety.view_evidence')));
grant execute on function private.can_upload_incident_evidence(text) to authenticated;

-- Step 1: reserve the object path (the caller then uploads straight to storage with a signed URL).
create function api.start_evidence_upload(p_incident_id uuid, p_content_type text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i public.safety_incidents;
  v_ext text;
begin
  select * into i from public.safety_incidents where id = p_incident_id;
  if not found or not (i.reporter_id = auth.uid() or private.has_permission('safety.manage')) then
    perform private.raise_error('NOT_FOUND');
  end if;
  if i.status = 'closed' then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"the incident is closed"}');
  end if;
  v_ext := case p_content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
                               when 'application/pdf' then 'pdf' when 'audio/mp4' then 'm4a' when 'video/mp4' then 'mp4' end;
  if v_ext is null then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"content_type","message":"Upload a photo, PDF, audio or video file."}]}');
  end if;
  if (select count(*) from public.safety_evidence where incident_id = i.id) >= 30 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"file","message":"An incident can hold up to 30 files."}]}');
  end if;
  return jsonb_build_object('path', i.id || '/' || gen_random_uuid() || '.' || v_ext);
end $$;

-- Step 2: after the server verified the uploaded bytes, record the evidence and note it on the timeline.
create function api.complete_evidence_upload(p_incident_id uuid, p_path text, p_content_type text, p_size integer, p_sha256 text, p_description text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i public.safety_incidents;
  v_id uuid;
begin
  select * into i from public.safety_incidents where id = p_incident_id;
  if not found or not (i.reporter_id = auth.uid() or private.has_permission('safety.manage')) then
    perform private.raise_error('NOT_FOUND');
  end if;
  if p_path is null or split_part(p_path, '/', 1) <> i.id::text or not private.can_upload_incident_evidence(p_path) then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"path","message":"That file does not belong to this incident."}]}');
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'safety-evidence' and name = p_path) then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"file","message":"Upload the file before completing."}]}');
  end if;
  insert into public.safety_evidence (incident_id, storage_path, content_type, size_bytes, sha256, description, uploaded_by)
  values (i.id, p_path, p_content_type, p_size, p_sha256, left(nullif(btrim(p_description), ''), 500), auth.uid()) returning id into v_id;
  insert into public.safety_incident_events (incident_id, to_status, actor_id, note)
  values (i.id, i.status, auth.uid(), 'Evidence added' || coalesce(': ' || left(nullif(btrim(p_description), ''), 120), ''));
  perform private.notify_holders('safety.view', 'evidence', 'Evidence added to incident #' || i.incident_no, left(coalesce(p_description, ''), 120), '/safety/' || i.id);
  return jsonb_build_object('id', v_id);
end $$;

create function api.list_evidence(p_incident_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('safety.view');
  return (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'content_type', e.content_type, 'size_bytes', e.size_bytes, 'description', e.description,
      'created_at', e.created_at, 'uploaded_by_name', (select full_name from public.profiles p where p.id = e.uploaded_by)) order by e.created_at), '[]')
    from public.safety_evidence e where e.incident_id = p_incident_id);
end $$;

-- Opening a file is logged first, then the path is released to the server, which signs a 60-second URL.
create function api.open_evidence(p_evidence_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.safety_evidence;
  i public.safety_incidents;
begin
  perform private.require_permission('safety.view_evidence');
  select * into e from public.safety_evidence where id = p_evidence_id;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  select * into i from public.safety_incidents where id = e.incident_id;
  insert into public.pii_access_logs (admin_id, subject_profile_id, field, reason)
  values (auth.uid(), i.reporter_id, 'safety_evidence:' || e.id, 'incident ' || i.incident_no);
  return jsonb_build_object('path', e.storage_path, 'content_type', e.content_type);
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
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- The delivery worker functions are for the service-role key only (the guard inside is a second line of defence).
revoke execute on function api.claim_notifications(integer), api.finish_notification(uuid, boolean, text) from authenticated;
grant execute on function api.claim_notifications(integer), api.finish_notification(uuid, boolean, text) to service_role;
