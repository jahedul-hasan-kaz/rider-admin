-- Staging batch: account deletion and anonymisation, saved views, bulk ticket assignment, automatic surge,
-- and the service-role worker interfaces for Storage.
begin;
create extension if not exists pgtap with schema extensions;
select plan(58);

\set inviter '''00000000-0000-0000-0000-00000006a000'''
\set sa      '''00000000-0000-0000-0000-00000006a001'''
\set support '''00000000-0000-0000-0000-00000006a002'''
\set p1  '''00000000-0000-0000-0000-00000006b001'''
\set p2  '''00000000-0000-0000-0000-00000006b002'''
\set p3  '''00000000-0000-0000-0000-00000006b003'''
\set p4  '''00000000-0000-0000-0000-00000006b004'''
\set zone '''00000000-0000-0000-0000-00000006e001'''

insert into auth.users (id, email) values (:inviter, 'inv.m6@test.local');
insert into public.admin_invitations (email, full_name, template_ids, reason, invited_by)
select e.email, e.name, array(select id from public.permission_templates where code = e.tpl), 'fixture', :inviter
from (values ('sa.m6@test.local', 'Super M6', 'super_admin'), ('support.m6@test.local', 'Support M6', 'support')) e(email, name, tpl);
insert into auth.users (id, email) values (:sa, 'sa.m6@test.local'), (:support, 'support.m6@test.local'),
  (:p1, 'p1.m6@test.local'), (:p2, 'p2.m6@test.local'), (:p3, 'p3.m6@test.local'), (:p4, 'p4.m6@test.local');
select private.promote_user_role(x, 'passenger') from unnest(array[:p1::uuid, :p2::uuid, :p3::uuid, :p4::uuid]) x;

insert into public.service_zones (id, code, name, boundary, area_km2, active)
values (:zone, 'm6_zone', 'M6 Zone',
  extensions.st_multi(extensions.st_geomfromtext('POLYGON((80.55 12.75,80.65 12.75,80.65 12.85,80.55 12.85,80.55 12.75))', 4326))::extensions.geography, 100, true);

create function pg_temp.as_user(p_id uuid, p_aal text default 'aal2') returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

-- ---------------------------------------------------------------------------
-- Account deletion
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(:sa);
select throws_ok($$select api.request_account_deletion('x')$$, 'P0001', 'ROLE_NOT_ALLOWED', 'an admin cannot delete their own account this way');
select pg_temp.as_user(:p1, 'aal1');
select is(api.request_account_deletion('Not using it') ->> 'status', 'deactivated', 'a passenger who asks is deactivated at once');
select throws_ok($$select api.request_account_deletion('again')$$, 'P0001', 'UNAUTHENTICATED', 'once deactivated the account can no longer act');
select throws_ok($$select api.list_deletion_requests()$$, 'P0001', 'FORBIDDEN', 'a passenger cannot list deletion requests');
reset role;
select is((select status from public.profiles where id = :p1), 'deactivated', 'the profile is deactivated');
select ok((select banned_until is not null from auth.users where id = :p1), 'and sign-in is blocked');
select is((select count(*)::int from public.account_deletion_requests where user_id = :p1 and status = 'pending'), 1, 'only one pending request exists');
select is((select (anonymise_after > now() + interval '29 days') from public.account_deletion_requests where user_id = :p1), true, 'details are kept for the 30-day grace period');

set local role authenticated;
select pg_temp.as_user(:sa);
select is((select count(*)::int from jsonb_array_elements(api.list_deletion_requests()) r where r ->> 'user_id' = :p1 and (r ->> 'can_restore')::boolean), 1, 'staff see the request and can restore it');
select throws_ok(format($$select api.restore_account(%L, '')$$, (select id from public.account_deletion_requests where user_id = :p1)), 'P0001', null, 'restoring needs a reason');
select api.restore_account((select id from public.account_deletion_requests where user_id = :p1), 'Asked by mistake');
reset role;
select is((select status from public.profiles where id = :p1), 'active', 'a restored account is active again');
select ok((select banned_until is null from auth.users where id = :p1), 'and can sign in');
select is((select status from public.account_deletion_requests where user_id = :p1), 'restored', 'the request is closed as restored');
select ok(exists (select 1 from public.admin_audit_logs where action = 'account.restore' and entity_id = :p1), 'the restore is in the audit log');
set local role authenticated;
select pg_temp.as_user(:sa);
select throws_ok(format($$select api.restore_account(%L, 'Again')$$, (select id from public.account_deletion_requests where user_id = :p1)), 'P0001', 'INVALID_STATE_TRANSITION', 'a closed request cannot be restored twice');
reset role;

-- After the grace period the details are removed, financial rows stay.
set local role authenticated;
select pg_temp.as_user(:p2, 'aal1');
select api.request_account_deletion(null);
reset role;
update public.profiles set full_name = 'Real Name', email = 'p2.real@example.com', phone = '+8801700000062' where id = :p2;
select is(private.anonymise_due_accounts(), 0, 'nothing is anonymised before its time');
update public.account_deletion_requests set anonymise_after = now() - interval '1 minute' where user_id = :p2;
select cmp_ok(private.anonymise_due_accounts(), '>=', 1, 'the daily job anonymises accounts that are due');
select is((select full_name from public.profiles where id = :p2), 'Deleted user', 'the name is removed');
select ok((select email is null and phone is null from public.profiles where id = :p2), 'and so are the email and phone');
select ok((select email like 'deleted-%@deleted.invalid' from auth.users where id = :p2), 'the sign-in identity no longer holds the address');
select is((select status from public.account_deletion_requests where user_id = :p2), 'completed', 'the request is marked completed');
select is(private.anonymise_due_accounts(), 0, 'and it is never anonymised twice');

-- ---------------------------------------------------------------------------
-- Storage worker interfaces (service role only)
-- ---------------------------------------------------------------------------
insert into public.storage_purge_queue (bucket, path) values ('driver-documents', 'm6/test-file.jpg');
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select pg_temp.as_user(:sa);
select throws_ok($$select api.claim_storage_purges(10)$$, '42501', null, 'an admin cannot read the purge queue');
select throws_ok($$select api.finish_storage_purge(array[1::bigint])$$, '42501', null, 'nor mark files removed');
select throws_ok($$select api.claim_exports_for_storage(1)$$, '42501', null, 'nor claim exports for upload');
select throws_ok($$select api.claim_archive_exports(1)$$, '42501', null, 'nor claim archives');
select throws_ok($$select api.read_archive_chunk(1, 0, 10)$$, '42501', null, 'nor read archived rows');
select throws_ok($$select api.finish_archive_export(1, 'a', 'b', 1, 1)$$, '42501', null, 'nor record an archive file');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select ok((select count(*) from jsonb_array_elements(api.claim_storage_purges(200)) f where f ->> 'path' = 'm6/test-file.jpg') = 1, 'the worker sees files waiting to be removed');
select api.finish_storage_purge(array[(select id from public.storage_purge_queue where path = 'm6/test-file.jpg')]);
select ok((select purged_at is not null from public.storage_purge_queue where path = 'm6/test-file.jpg'), 'and marks them removed');
select ok((select count(*) from jsonb_array_elements(api.claim_storage_purges(200)) f where f ->> 'path' = 'm6/test-file.jpg') = 0, 'removed files are not offered again');
select throws_ok($$select api.finish_archive_export(-1, 'x/y.ndjson.gz', repeat('a', 64), 1, 1)$$, 'P0001', null, 'a file for an unknown archive run is refused');
select set_config('request.jwt.claims', '', true);

create function pg_temp.view_id(p_name text) returns uuid language sql security definer as $$ select id from public.saved_views where name = p_name $$;
create function pg_temp.view_row(p_name text) returns table (query text) language sql security definer as $$ select v.query from public.saved_views v where name = p_name $$;
grant execute on function pg_temp.view_id(text), pg_temp.view_row(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Saved views
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(:sa);
select ok((api.save_view('trips', 'Late trips', '?status=completed&q=abc', false) ->> 'id') is not null, 'an admin saves a view');
select is((select query from pg_temp.view_row('Late trips')), 'status=completed&q=abc', 'the leading ? is dropped');
select throws_ok($$select api.save_view('trips', 'late TRIPS', 'q=1')$$, 'P0001', 'ALREADY_EXISTS', 'names are unique per person and page (ignoring case)');
select throws_ok($$select api.save_view('trips', 'Bad', 'q=<script>')$$, 'P0001', 'VALIDATION_FAILED', 'markup in a query is refused');
select ok((api.save_view('trips', 'Shared view', 'status=cancelled', true) ->> 'id') is not null, 'a view can be shared');
select pg_temp.as_user(:support);
select is((select count(*)::int from jsonb_array_elements(api.list_saved_views('trips')) v where v ->> 'name' = 'Shared view' and not (v ->> 'mine')::boolean), 1, 'a colleague sees the shared view, marked as not theirs');
select is((select count(*)::int from jsonb_array_elements(api.list_saved_views('trips')) v where v ->> 'name' = 'Late trips'), 0, 'but not a private one');
select throws_ok(format($$select api.delete_view(%L)$$, pg_temp.view_id('Shared view')), 'P0001', 'NOT_FOUND', 'and cannot delete it');
select pg_temp.as_user(:sa);
select api.delete_view(pg_temp.view_id('Late trips'));
select is((select count(*)::int from jsonb_array_elements(api.list_saved_views('trips')) v where v ->> 'name' = 'Late trips'), 0, 'a deleted view disappears from the list');
select pg_temp.as_user(:p3, 'aal1');
select throws_ok($$select api.list_saved_views('trips')$$, 'P0001', 'FORBIDDEN', 'a passenger has no saved views');
select pg_temp.as_user(:sa);
select throws_ok($$select api.assign_tickets('{}'::uuid[], null)$$, 'P0001', 'VALIDATION_FAILED', 'bulk assignment needs at least one ticket');
reset role;
select ok(exists (select 1 from public.saved_views where name = 'Late trips' and deleted_at is not null), 'a deleted view is kept (soft delete)');

-- ---------------------------------------------------------------------------
-- Automatic surge
-- ---------------------------------------------------------------------------
select id as bike from public.vehicle_categories where code = 'bike' \gset
set local role authenticated;
select pg_temp.as_user(:sa);
select (api.save_fare_draft(null, :'bike', :zone,
  '{"base_fare":40,"per_km":20,"per_minute":2,"minimum_fare":60,"booking_fee":0,"waiting_per_minute":2,"free_waiting_minutes":3,"cancellation_fee":30,"platform_commission_pct":0.15,"max_surge_multiplier":1.5}',
  'M6 rates', null)) as rule1 \gset
select api.publish_fare_rule(:'rule1', null, 'Go live for the surge tests');
reset role;

update public.feature_flags set enabled = false where key = 'auto_surge';
select private.recompute_surge();
select is((select multiplier from public.zone_surge_state where zone_id = :zone and category_id = :'bike'), 1.00::numeric, 'with the flag off the multiplier stays 1');
select is(private.auto_surge(:zone, :'bike'), 1::numeric, 'and quotes use 1');

-- Three open requests and no drivers.
create function pg_temp.request(p_pax uuid) returns void
language plpgsql security definer as $$
declare v_quote uuid;
begin
  perform pg_temp.as_user(p_pax, 'aal1');
  v_quote := (api.create_quote((select id from public.vehicle_categories where code = 'bike'), 12.80, 80.60, 'Start', 12.83, 80.63, 'End', 5000, 1200) ->> 'id')::uuid;
  perform api.create_ride_request(v_quote, 'cash', null);
end $$;
create function pg_temp.quote_surge(p_pax uuid) returns numeric
language plpgsql security definer as $$
begin
  perform pg_temp.as_user(p_pax, 'aal1');
  return (api.create_quote((select id from public.vehicle_categories where code = 'bike'), 12.80, 80.60, 'Start', 12.83, 80.63, 'End', 5000, 1200) ->> 'surge_multiplier')::numeric;
end $$;
select pg_temp.request(x) from unnest(array[:p1::uuid, :p3::uuid, :p4::uuid]) x;

update public.feature_flags set enabled = true, rules = '{}' where key = 'auto_surge';
select private.recompute_surge();
select is((select demand from public.zone_surge_state where zone_id = :zone and category_id = :'bike'), 3, 'three open requests count as demand');
select is((select supply from public.zone_surge_state where zone_id = :zone and category_id = :'bike'), 0, 'with no idle drivers');
select is((select multiplier from public.zone_surge_state where zone_id = :zone and category_id = :'bike'), 1.10::numeric, 'the multiplier rises one step at a time');
select private.recompute_surge();
select is((select multiplier from public.zone_surge_state where zone_id = :zone and category_id = :'bike'), 1.20::numeric, 'and keeps rising each minute');
select is(private.auto_surge(:zone, :'bike'), 1.20::numeric, 'quotes read the automatic multiplier');

select is(pg_temp.quote_surge(:p3), 1.20::numeric, 'a new quote freezes the multiplier');

update public.zone_surge_state set multiplier = 3 where zone_id = :zone and category_id = :'bike';
update public.service_zones set manual_surge_multiplier = 1.00 where id = :zone;
select is(pg_temp.quote_surge(:p4), 1.50::numeric, 'the rule''s cap limits the multiplier');

update public.zone_surge_state set multiplier = 1.10 where zone_id = :zone and category_id = :'bike';
update public.service_zones set manual_surge_multiplier = 1.40 where id = :zone;
select is(greatest(private.auto_surge(:zone, :'bike'), (select manual_surge_multiplier from public.service_zones where id = :zone)), 1.40::numeric, 'a higher manual surge still wins');

update public.zone_surge_state set computed_at = now() - interval '10 minutes' where zone_id = :zone and category_id = :'bike';
select is(private.auto_surge(:zone, :'bike'), 1::numeric, 'stale data is ignored');

update public.feature_flags set enabled = false where key = 'auto_surge';
select private.recompute_surge();
select is((select multiplier from public.zone_surge_state where zone_id = :zone and category_id = :'bike'), 1.00::numeric, 'turning the flag off steps the multiplier back down');

set local role authenticated;
select pg_temp.as_user(:sa);
select ok(jsonb_typeof(api.surge_overview() -> 'rows') = 'array', 'staff can read the surge overview');
select pg_temp.as_user(:p3, 'aal1');
select throws_ok($$select api.surge_overview()$$, 'P0001', 'FORBIDDEN', 'a passenger cannot');
reset role;

select * from finish();
rollback;
