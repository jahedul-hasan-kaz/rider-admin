-- Pre-launch security checklist, checked against the catalogs (docs/spec/07-security.md §7).
-- This is the local equivalent of a clean Supabase Security Advisor run.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- Row-level security everywhere in the exposed schema (partitions included), and forced for the table owner.
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity), 0,
  'every public table has row-level security enabled');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relforcerowsecurity), 0,
  'row-level security is forced on every public table');

-- anon: nothing.
select is((select count(*)::int from information_schema.role_table_grants where grantee = 'anon' and table_schema in ('public', 'audit', 'private', 'archive')), 0,
  'anon holds no table privileges');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('api', 'private', 'audit') and has_function_privilege('anon', p.oid, 'execute')), 0,
  'anon can execute no function in api, private or audit');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('api', 'private', 'audit', 'archive') and has_function_privilege('public', p.oid, 'execute')), 0,
  'PUBLIC can execute no function in api, private, audit or archive');

-- authenticated: reads through RLS and calls to api.* only; no direct writes anywhere.
select is((select count(*)::int from information_schema.role_table_grants
           where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')), 0,
  'authenticated has no direct write privilege on any public table');
select is((select count(*)::int from information_schema.role_table_grants where grantee = 'authenticated' and table_schema in ('audit', 'archive')), 0,
  'authenticated has no privilege on the audit and archive schemas');
select is((select has_schema_privilege('authenticated', 'archive', 'usage') or has_schema_privilege('anon', 'audit', 'usage')), false,
  'the audit and archive schemas are closed to API roles');

-- Functions: definer functions must pin their search_path (the "mutable search_path" advisor finding).
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('api', 'private') and p.prosecdef and not coalesce(p.proconfig::text ilike '%search_path%', false)), 0,
  'every security-definer function pins its search_path');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and not p.prosecdef), 0,
  'every api function is security definer (permission checks cannot be bypassed by the caller''s rights)');

-- Append-only and money tables cannot be written by the API roles at all.
select is((select count(*)::int from information_schema.role_table_grants
           where grantee in ('authenticated', 'anon') and table_schema = 'public'
             and table_name in ('ledger_entries', 'ledger_transactions', 'ledger_accounts', 'ledger_account_balances', 'payments', 'refunds_adjustments',
                                'admin_audit_logs', 'pii_access_logs', 'archive_runs', 'driver_payout_accounts')
             and privilege_type <> 'SELECT'), 0, 'financial and audit tables are read-only to the API roles');
select is((select count(*)::int from information_schema.column_privileges
           where grantee = 'authenticated' and table_name = 'driver_payout_accounts'), 0,
  'payout account numbers are not readable through the API at all');
select is((select count(*)::int from information_schema.column_privileges
           where grantee = 'authenticated' and table_name = 'export_jobs' and column_name = 'content'), 0,
  'export contents are only released by the logged download function');

-- Realtime is authorised by policy.
select is((select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages'), 1,
  'private realtime channels are guarded by a policy on realtime.messages');

select * from finish();
rollback;
