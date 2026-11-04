-- REST API infrastructure: idempotency keys and rate limits (docs/spec/05-api.md §1).
-- Both live in Postgres so they work across serverless instances. They can move
-- to Redis later without changing the API contract.

-- ---------------------------------------------------------------------------
-- Idempotency: a retried POST with the same key returns the stored response.
-- ---------------------------------------------------------------------------
create table public.idempotency_keys (
  scope text not null,              -- '<user id>:<METHOD route>'
  key text not null,
  request_sha256 text not null,
  status_code integer,
  response jsonb,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (scope, key),
  constraint chk_idempotency_key check (key ~ '^[0-9a-fA-F-]{36}$')
);

create index idx_idempotency_keys_created on public.idempotency_keys (created_at);

alter table public.idempotency_keys enable row level security;
alter table public.idempotency_keys force row level security;
revoke all on table public.idempotency_keys from anon, authenticated;

create function api.idempotency_begin(p_route text, p_key text, p_request_sha256 text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_scope text;
  v_row public.idempotency_keys;
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  if p_key is null or p_key !~ '^[0-9a-fA-F-]{36}$' then
    perform private.raise_error('IDEMPOTENCY_KEY_REQUIRED');
  end if;
  v_scope := auth.uid()::text || ':' || p_route;

  insert into public.idempotency_keys (scope, key, request_sha256, locked_until)
  values (v_scope, p_key, p_request_sha256, now() + interval '30 seconds')
  on conflict (scope, key) do nothing;
  if found then
    return jsonb_build_object('state', 'new');
  end if;

  select * into v_row from public.idempotency_keys where scope = v_scope and key = p_key for update;
  if v_row.request_sha256 <> p_request_sha256 then
    perform private.raise_error('IDEMPOTENCY_KEY_REUSED');
  end if;
  if v_row.completed_at is not null then
    return jsonb_build_object('state', 'replay', 'status', v_row.status_code, 'response', v_row.response);
  end if;
  if v_row.locked_until > now() then
    return jsonb_build_object('state', 'in_progress');
  end if;
  -- The earlier attempt died mid-flight: take over.
  update public.idempotency_keys set locked_until = now() + interval '30 seconds' where scope = v_scope and key = p_key;
  return jsonb_build_object('state', 'new');
end $$;

create function api.idempotency_complete(p_route text, p_key text, p_status integer, p_response jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  update public.idempotency_keys
  set status_code = p_status, response = p_response, completed_at = now(), locked_until = null
  where scope = auth.uid()::text || ':' || p_route and key = p_key;
end $$;

-- Releases the lock without storing a response (server errors stay retryable).
create function api.idempotency_abandon(p_route text, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.idempotency_keys set locked_until = null
  where scope = auth.uid()::text || ':' || p_route and key = p_key and completed_at is null;
end $$;

-- Keys are kept for 7 days (spec 08 §4).
create function private.purge_idempotency_keys() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  delete from public.idempotency_keys where created_at < now() - interval '7 days';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

select cron.schedule('purge-idempotency-keys', '17 * * * *', 'select private.purge_idempotency_keys()');

-- ---------------------------------------------------------------------------
-- Rate limits: fixed window per (user, class). One upsert per request.
-- ---------------------------------------------------------------------------
create unlogged table public.rate_limits (
  bucket text primary key,
  window_start timestamptz not null,
  hits integer not null
);

alter table public.rate_limits enable row level security;
alter table public.rate_limits force row level security;
revoke all on table public.rate_limits from anon, authenticated;

-- Returns 0 when allowed, otherwise the seconds until the window resets.
create function api.check_rate_limit(p_class text, p_limit integer, p_window_s integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_bucket text;
  v_now timestamptz := now();
  v_row public.rate_limits;
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  if p_limit < 1 or p_window_s < 1 or p_window_s > 3600 then
    perform private.raise_error('VALIDATION_FAILED');
  end if;
  v_bucket := auth.uid()::text || ':' || p_class;

  insert into public.rate_limits as r (bucket, window_start, hits) values (v_bucket, v_now, 1)
  on conflict (bucket) do update set
    window_start = case when r.window_start <= v_now - make_interval(secs => p_window_s) then v_now else r.window_start end,
    hits = case when r.window_start <= v_now - make_interval(secs => p_window_s) then 1 else r.hits + 1 end
  returning * into v_row;

  if v_row.hits > p_limit then
    return greatest(1, ceil(extract(epoch from (v_row.window_start + make_interval(secs => p_window_s) - v_now)))::int);
  end if;
  return 0;
end $$;

create function private.purge_rate_limits() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  delete from public.rate_limits where window_start < now() - interval '1 hour';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

select cron.schedule('purge-rate-limits', '*/10 * * * *', 'select private.purge_rate_limits()');

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.has_permission(text), private.is_admin(), private.has_aal2(), private.current_app_role(),
  private.can_upload_driver_document(text), private.my_driver_id()
to authenticated;
grant execute on function private.custom_access_token_hook(jsonb) to supabase_auth_admin;

revoke execute on all functions in schema api from public, anon;
grant execute on function
  api.idempotency_begin(text, text, text), api.idempotency_complete(text, text, integer, jsonb),
  api.idempotency_abandon(text, text), api.check_rate_limit(text, integer, integer)
to authenticated;
