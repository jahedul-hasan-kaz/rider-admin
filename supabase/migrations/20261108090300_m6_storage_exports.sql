-- Exports and archived partitions move to private Storage buckets (the Next.js job does the uploading).
--  * Generated CSVs: built in the database as before, then uploaded to the `exports` bucket and dropped from the table.
--  * Archived partitions: exported as gzip NDJSON to the `archive` bucket with a checksum and a verified row count.
-- Both buckets are private and have no client policies: only the server (service role) reads or writes them.

insert into storage.buckets (id, name, public, file_size_limit)
values ('exports', 'exports', false, 52428800), ('archive', 'archive', false, 1073741824)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

alter table public.export_jobs add column storage_path text;

create table public.archive_exports (
  run_id bigint primary key references public.archive_runs (id),
  storage_path text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes bigint not null check (bytes > 0),
  row_count bigint not null,
  exported_at timestamptz not null default now()
);
create trigger trg_archive_exports_append_only before update or delete on public.archive_exports
  for each row execute function private.forbid_update_delete();
alter table public.archive_exports enable row level security;
alter table public.archive_exports force row level security;
revoke all on public.archive_exports from public, anon, authenticated;
grant select on public.archive_exports to authenticated;
create policy archive_exports_read on public.archive_exports for select to authenticated using ((select private.has_permission('audit.view')));

-- Worker interface (service role only) ---------------------------------------------------------
create function api.claim_exports_for_storage(p_limit integer default 5) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_service_role();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'requested_by', requested_by, 'kind', kind, 'content', content) order by finished_at), '[]')
          from (select * from public.export_jobs where status = 'ready' and content is not null and storage_path is null
                order by finished_at limit least(greatest(coalesce(p_limit, 5), 1), 20) for update skip locked) j);
end $$;

create function api.finish_export_storage(p_id uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_service_role();
  update public.export_jobs set storage_path = p_path, content = null where id = p_id and status = 'ready' and storage_path is null;
end $$;

create function api.claim_archive_exports(p_limit integer default 3) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_service_role();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'source', r.source, 'partition', r.partition_name, 'row_count', r.row_count) order by r.id), '[]')
          from (select * from public.archive_runs where kind = 'partition' and not exists (select 1 from public.archive_exports e where e.run_id = archive_runs.id)
                order by id limit least(greatest(coalesce(p_limit, 3), 1), 10)) r);
end $$;

-- Rows of one archived partition, a page at a time (the partition name always comes from the archive log, never from the caller).
create function api.read_archive_chunk(p_run_id bigint, p_offset bigint, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v jsonb;
begin
  perform private.require_service_role();
  select partition_name into v_name from public.archive_runs where id = p_run_id and kind = 'partition';
  if v_name is null or to_regclass(format('archive.%I', v_name)) is null then
    perform private.raise_error('NOT_FOUND');
  end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]'') from (select * from archive.%I order by ctid offset $1 limit $2) t', v_name)
    into v using greatest(p_offset, 0), least(greatest(coalesce(p_limit, 1000), 1), 5000);
  return v;
end $$;

create function api.finish_archive_export(p_run_id bigint, p_path text, p_sha256 text, p_bytes bigint, p_rows bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_expected bigint;
begin
  perform private.require_service_role();
  select row_count into v_expected from public.archive_runs where id = p_run_id;
  if v_expected is distinct from p_rows then
    perform private.raise_error('VALIDATION_FAILED', jsonb_build_object('reason', 'row count mismatch', 'expected', v_expected, 'got', p_rows));
  end if;
  insert into public.archive_exports (run_id, storage_path, sha256, bytes, row_count) values (p_run_id, p_path, p_sha256, p_bytes, p_rows) on conflict do nothing;
end $$;

revoke execute on function api.claim_exports_for_storage(integer), api.finish_export_storage(uuid, text), api.claim_archive_exports(integer),
  api.read_archive_chunk(bigint, bigint, integer), api.finish_archive_export(bigint, text, text, bigint, bigint) from authenticated;
grant execute on function api.claim_exports_for_storage(integer), api.finish_export_storage(uuid, text), api.claim_archive_exports(integer),
  api.read_archive_chunk(bigint, bigint, integer), api.finish_archive_export(bigint, text, text, bigint, bigint) to service_role;

create or replace function api.get_export_content(p_id uuid) returns jsonb
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
  return jsonb_build_object('filename', j.kind || '-' || (j.params ->> 'from') || '-' || (j.params ->> 'to') || '.csv', 'content', j.content, 'storage_path', j.storage_path);
end $$;

create or replace function private.process_exports() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  j record;
  n integer := 0;
begin
  for j in select id from public.export_jobs where status = 'queued' order by created_at limit 5 loop
    perform private.process_export(j.id);
    n := n + 1;
  end loop;
  -- Expired exports lose their contents; files in Storage are queued for removal.
  insert into public.storage_purge_queue (bucket, path) select 'exports', storage_path from public.export_jobs
    where status = 'ready' and expires_at < now() and storage_path is not null on conflict do nothing;
  update public.export_jobs set status = 'expired', content = null, storage_path = null where status = 'ready' and expires_at < now();
  return n;
end $$;

-- The archive log shows where each partition's file is.
create or replace function api.list_archive_runs() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('audit.view');
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'source', r.source, 'partition', r.partition_name,
      'range_from', r.range_from, 'range_to', r.range_to, 'row_count', r.row_count, 'checksum', r.checksum, 'ran_at', r.ran_at,
      'exported', e.run_id is not null, 'file_sha256', e.sha256, 'file_bytes', e.bytes) order by r.id desc), '[]')
    from (select * from public.archive_runs order by id desc limit 50) r left join public.archive_exports e on e.run_id = r.id);
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
           and p.proname not in ('claim_notifications', 'finish_notification', 'claim_storage_purges', 'finish_storage_purge',
                                 'claim_exports_for_storage', 'finish_export_storage', 'claim_archive_exports', 'read_archive_chunk', 'finish_archive_export') loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
