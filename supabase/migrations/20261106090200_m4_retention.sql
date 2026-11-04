-- M4 · Retention and archival (docs/spec/08 §4, 03 §3.7).
-- Old partitions of the high-volume tables are verified (row count + checksum), recorded, detached from the live
-- table and moved to the private `archive` schema. Nothing is purged. Every run is logged.

create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;

create table public.archive_runs (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('partition', 'purge')),
  source text not null,
  partition_name text,
  range_from timestamptz,
  range_to timestamptz,
  row_count bigint not null default 0,
  checksum text,
  destination text,
  ran_at timestamptz not null default now()
);
create index idx_archive_runs_ran on public.archive_runs (ran_at desc);
create trigger trg_archive_runs_append_only before update or delete on public.archive_runs
  for each row execute function private.forbid_update_delete();
alter table public.archive_runs enable row level security;
alter table public.archive_runs force row level security;
revoke all on public.archive_runs from public, anon, authenticated;
grant select on public.archive_runs to authenticated;
create policy archive_runs_read on public.archive_runs for select to authenticated using ((select private.has_permission('audit.view')));

-- Detaches and archives the partitions of one parent that lie wholly before the retention horizon.
create function private.archive_partitions_of(p_parent regclass, p_retention_days integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  p record;
  v_from timestamptz;
  v_to timestamptz;
  v_bound text;
  v_rows bigint;
  v_sum text;
  v_name text;
  v_done integer := 0;
begin
  for p in
    select c.oid, c.relname, n.nspname, pg_get_expr(c.relpartbound, c.oid) as bound
    from pg_inherits i join pg_class c on c.oid = i.inhrelid join pg_namespace n on n.oid = c.relnamespace
    where i.inhparent = p_parent
    order by c.relname
  loop
    v_bound := p.bound;
    continue when v_bound is null or v_bound = 'DEFAULT';
    v_from := (regexp_match(v_bound, 'FROM \(''([^'']+)''\)'))[1]::timestamptz;
    v_to := (regexp_match(v_bound, 'TO \(''([^'']+)''\)'))[1]::timestamptz;
    continue when v_to is null or v_to > now() - make_interval(days => p_retention_days);

    v_name := format('%I.%I', p.nspname, p.relname);
    execute format('select count(*), coalesce(md5(string_agg(t::text, '''' order by t::text)), ''empty'') from %s t', v_name) into v_rows, v_sum;
    insert into public.archive_runs (kind, source, partition_name, range_from, range_to, row_count, checksum, destination)
    values ('partition', p_parent::text, p.relname, v_from, v_to, v_rows, v_sum, 'archive.' || p.relname);
    execute format('alter table %s detach partition %s', p_parent, v_name);
    execute format('alter table %s set schema archive', v_name);
    v_done := v_done + 1;
  end loop;
  return v_done;
end $$;

create function private.archive_old_partitions() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer := 0;
begin
  n := n + private.archive_partitions_of('public.trip_location_points'::regclass, coalesce((private.setting('retention.trip_points_days'))::int, 365));
  n := n + private.archive_partitions_of('audit.change_log'::regclass, coalesce((private.setting('retention.change_log_days'))::int, 730));
  return n;
end $$;
select cron.schedule('archive-old-partitions', '30 3 1 * *', 'select private.archive_old_partitions()');

-- Unused, expired quotes are short-lived working data (idempotency keys are already purged hourly).
create function private.cleanup_expired() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_days integer := coalesce((private.setting('retention.quotes_days'))::int, 7);
  n integer;
begin
  delete from public.fare_quotes q
  where q.expires_at < now() - make_interval(days => v_days)
    and not exists (select 1 from public.ride_requests r where r.quote_id = q.id);
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.archive_runs (kind, source, row_count, destination) values ('purge', 'fare_quotes', n, null);
  end if;
  return n;
end $$;
select cron.schedule('cleanup-expired', '40 * * * *', 'select private.cleanup_expired()');

create function api.list_archive_runs() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('audit.view');
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'source', source, 'partition', partition_name,
      'range_from', range_from, 'range_to', range_to, 'row_count', row_count, 'checksum', checksum, 'ran_at', ran_at) order by id desc), '[]')
    from (select * from public.archive_runs order by id desc limit 50) r);
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
