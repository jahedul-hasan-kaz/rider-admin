-- Account deletion and anonymisation (docs/spec/07 §5, 05 `/me/deactivate`).
-- A person asks to delete their account: it is deactivated at once (they are signed out and cannot sign in), and after a
-- grace period their personal details are anonymised. Financial, safety and audit records are kept, pointing at the
-- anonymised profile, as the law requires.

insert into public.app_settings (key, value, description, schema) values
  ('privacy.anonymise_after_days', '30', 'Days between an account deletion request and the anonymisation of the person''s details.',
   '{"group":"Security","type":"integer","min":7,"max":365,"default":30,"unit":"days"}')
on conflict (key) do nothing;

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  role public.app_role not null,
  reason text check (length(reason) <= 500),
  status text not null default 'pending' check (status in ('pending', 'restored', 'completed')),
  requested_at timestamptz not null default now(),
  anonymise_after timestamptz not null,
  restored_by uuid references public.profiles (id),
  restored_at timestamptz,
  completed_at timestamptz
);
create unique index uq_deletion_one_pending on public.account_deletion_requests (user_id) where status = 'pending';
create index idx_deletion_due on public.account_deletion_requests (anonymise_after) where status = 'pending';
alter table public.account_deletion_requests enable row level security;
alter table public.account_deletion_requests force row level security;
revoke all on public.account_deletion_requests from public, anon, authenticated;
grant select on public.account_deletion_requests to authenticated;
create policy deletion_requests_read on public.account_deletion_requests for select to authenticated
  using ((select private.has_permission('passengers.update') or private.has_permission('drivers.update')));
create trigger trg_deletion_requests_no_delete before delete on public.account_deletion_requests
  for each row execute function private.forbid_delete();

-- Files in Storage that must go with an anonymised account (the Next.js job removes them, then marks them done).
create table public.storage_purge_queue (
  id bigint generated always as identity primary key,
  bucket text not null,
  path text not null,
  queued_at timestamptz not null default now(),
  purged_at timestamptz,
  constraint uq_purge_object unique (bucket, path)
);
create index idx_purge_pending on public.storage_purge_queue (queued_at) where purged_at is null;
alter table public.storage_purge_queue enable row level security;
alter table public.storage_purge_queue force row level security;
revoke all on public.storage_purge_queue from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The person asks
-- ---------------------------------------------------------------------------
create function api.request_account_deletion(p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := private.current_app_role();
  v_days integer := coalesce((private.setting('privacy.anonymise_after_days'))::int, 30);
  v_balance numeric;
  v_due timestamptz := now() + make_interval(days => v_days);
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  if v_role = 'admin' then
    perform private.raise_error('ROLE_NOT_ALLOWED');
  end if;
  perform private.require_role(v_role);
  if exists (select 1 from public.trips t where (t.passenger_id = auth.uid() or t.driver_id = private.my_driver_id())
             and t.status in ('driver_assigned', 'driver_arriving', 'arrived', 'in_progress'))
     or exists (select 1 from public.ride_requests r where r.passenger_id = auth.uid() and r.status in ('requested', 'searching', 'matched')) then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"finish or cancel your current ride first"}');
  end if;
  -- Money owed either way must be settled first: a passenger's unpaid fee, a driver's undeposited cash.
  select coalesce(b.balance, 0) into v_balance from public.ledger_accounts a left join public.ledger_account_balances b on b.account_id = a.id
  where a.code = case when v_role = 'driver' then 'driver:' || coalesce(private.my_driver_id()::text, '-') || ':wallet' else 'passenger:' || auth.uid() || ':wallet' end;
  if coalesce(v_balance, 0) < 0 then
    perform private.raise_error('ACCOUNT_HAS_DUES', jsonb_build_object('amount', -v_balance));
  end if;
  if exists (select 1 from public.payouts where driver_id = private.my_driver_id() and status in ('pending', 'approved')) then
    perform private.raise_error('ACCOUNT_HAS_DUES', '{"reason":"a payout is still being processed"}');
  end if;

  insert into public.account_deletion_requests (user_id, role, reason, anonymise_after)
  values (auth.uid(), v_role, left(nullif(btrim(p_reason), ''), 500), v_due)
  on conflict (user_id) where status = 'pending' do nothing;
  update public.profiles set status = 'deactivated', deleted_at = now(), deleted_by = auth.uid(), delete_reason = 'Account deletion requested' where id = auth.uid();
  update public.driver_profiles set availability = 'offline' where user_id = auth.uid() and availability = 'online';
  delete from public.push_devices where user_id = auth.uid();
  -- Block sign-in at the auth layer too; existing access tokens stop working because the profile is deleted.
  update auth.users set banned_until = 'infinity' where id = auth.uid();
  return jsonb_build_object('status', 'deactivated', 'anonymise_after', v_due);
end $$;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
create function api.list_deletion_requests(p_status text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_any_permission(array['passengers.update', 'drivers.update']) then
    perform private.raise_error('FORBIDDEN');
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'user_id', r.user_id, 'role', r.role, 'name', p.full_name, 'reason', r.reason, 'status', r.status,
      'requested_at', r.requested_at, 'anonymise_after', r.anonymise_after, 'completed_at', r.completed_at, 'restored_at', r.restored_at,
      'can_restore', r.status = 'pending' and private.has_permission(case when r.role = 'driver' then 'drivers.update' else 'passengers.update' end))
      order by r.requested_at desc), '[]')
    from (select * from public.account_deletion_requests where p_status is null or status = p_status order by requested_at desc limit 100) r
    join public.profiles p on p.id = r.user_id);
end $$;

-- Undo a deletion request during the grace period (for example when it was made by mistake).
create function api.restore_account(p_request_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.account_deletion_requests;
  v_reason text := private.require_reason(p_reason);
begin
  select * into r from public.account_deletion_requests where id = p_request_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  perform private.require_permission(case when r.role = 'driver' then 'drivers.update' else 'passengers.update' end);
  if r.status <> 'pending' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', r.status));
  end if;
  update public.profiles set status = 'active', deleted_at = null, deleted_by = null, delete_reason = null where id = r.user_id;
  update auth.users set banned_until = null where id = r.user_id;
  update public.account_deletion_requests set status = 'restored', restored_by = auth.uid(), restored_at = now() where id = r.id;
  perform private.log_admin_action('account.restore', 'profile', r.user_id, null, null, v_reason);
end $$;

-- ---------------------------------------------------------------------------
-- Anonymisation (daily)
-- ---------------------------------------------------------------------------
create function private.anonymise_account(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_driver uuid;
begin
  select id into v_driver from public.driver_profiles where user_id = p_user;

  update public.profiles set full_name = 'Deleted user', email = null, phone = null, avatar_path = null, preferred_language = 'en' where id = p_user;
  update auth.users set email = 'deleted-' || p_user || '@deleted.invalid', phone = null, raw_user_meta_data = '{}'::jsonb,
    raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'provider' - 'providers', banned_until = 'infinity'
  where id = p_user;
  delete from public.push_devices where user_id = p_user;
  update public.notification_outbox set to_address = null, body = '[removed]' where recipient_id = p_user;
  update public.ratings set comment = null where reviewer_id = p_user;
  update public.ride_requests set pickup_label = null, destination_label = null, pickup_note = null where passenger_id = p_user;
  update public.fare_quotes set pickup_label = null, destination_label = null where passenger_id = p_user;

  if v_driver is not null then
    update public.driver_profiles set licence_number_enc = null where id = v_driver;
    update public.driver_documents set document_number_masked = null, rejection_reason = null where driver_id = v_driver;
    insert into public.storage_purge_queue (bucket, path)
    select 'driver-documents', storage_path from public.driver_documents where driver_id = v_driver and storage_path is not null
    on conflict do nothing;
    update public.driver_payout_accounts set account_holder = 'Deleted', account_ref_enc = '\x'::bytea, account_ref_masked = '••••', status = 'rejected', is_default = false where driver_id = v_driver;
  end if;
end $$;

create function private.anonymise_due_accounts() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n integer := 0;
begin
  for r in select id, user_id from public.account_deletion_requests where status = 'pending' and anonymise_after <= now() order by anonymise_after for update skip locked loop
    perform private.anonymise_account(r.user_id);
    update public.account_deletion_requests set status = 'completed', completed_at = now() where id = r.id;
    n := n + 1;
  end loop;
  if n > 0 then
    insert into public.archive_runs (kind, source, row_count, destination) values ('purge', 'accounts anonymised', n, null);
  end if;
  return n;
end $$;
select cron.schedule('anonymise-accounts', '10 3 * * *', 'select private.anonymise_due_accounts()');

-- Worker interface (service role only): files waiting to be removed from Storage.
create function api.claim_storage_purges(p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_service_role();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'bucket', bucket, 'path', path) order by id), '[]')
          from (select * from public.storage_purge_queue where purged_at is null order by id limit least(greatest(coalesce(p_limit, 50), 1), 200)) q);
end $$;

create function api.finish_storage_purge(p_ids bigint[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_service_role();
  update public.storage_purge_queue set purged_at = now() where id = any (p_ids);
end $$;
revoke execute on function api.claim_storage_purges(integer), api.finish_storage_purge(bigint[]) from authenticated;
grant execute on function api.claim_storage_purges(integer), api.finish_storage_purge(bigint[]) to service_role;

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
