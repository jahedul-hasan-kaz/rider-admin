-- M0: generic change log, forced RLS, auth event logging, batch permission
-- changes and the read RPCs used by the Admins and Audit screens.
-- Spec: docs/spec/03-database.md §3, docs/spec/06-admin-ui.md §5.22–5.25.

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- audit.change_log: every row change on business tables (partitioned monthly)
-- ---------------------------------------------------------------------------
create schema if not exists audit;
revoke all on schema audit from public;

create table audit.change_log (
  id bigint generated always as identity,
  table_name text not null,
  record_id text,
  op text not null,
  old_row jsonb,
  new_row jsonb,
  changed_cols text[],
  actor_id uuid,
  actor_role text,
  request_id text,
  created_at timestamptz not null default now(),
  primary key (id, created_at),
  constraint chk_change_log_op check (op in ('INSERT', 'UPDATE', 'DELETE'))
) partition by range (created_at);

create table audit.change_log_default partition of audit.change_log default;

create index idx_change_log_record on audit.change_log (table_name, record_id, created_at desc);
create index idx_change_log_created on audit.change_log (created_at desc, id desc);

create trigger trg_change_log_append_only before update or delete on audit.change_log
  for each row execute function private.forbid_update_delete();

-- Creates monthly partitions from the current month through p_months_ahead.
create function private.ensure_change_log_partitions(p_months_ahead integer default 3) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', now())::date;
  v_end date;
  v_name text;
begin
  for i in 0 .. p_months_ahead loop
    v_end := (v_month + interval '1 month')::date;
    v_name := 'change_log_' || to_char(v_month, 'YYYY_MM');
    if to_regclass('audit.' || v_name) is null then
      execute format(
        'create table audit.%I partition of audit.change_log for values from (%L) to (%L)',
        v_name, v_month, v_end);
    end if;
    v_month := v_end;
  end loop;
end $$;

select private.ensure_change_log_partitions(3);
select cron.schedule('ensure-change-log-partitions', '15 0 * * *', 'select private.ensure_change_log_partitions(3)');

create function audit.log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_changed text[];
  v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}') into v_changed
    from jsonb_object_keys(v_new) k
    where v_new -> k is distinct from v_old -> k;
    if cardinality(v_changed) = 0 then
      return null;
    end if;
  end if;

  insert into audit.change_log (table_name, record_id, op, old_row, new_row, changed_cols, actor_id, actor_role, request_id)
  values (
    tg_table_schema || '.' || tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id'),
    tg_op, v_old, v_new, v_changed,
    auth.uid(),
    coalesce(v_claims ->> 'app_role', v_claims ->> 'role'),
    left(v_headers ->> 'x-request-id', 64)
  );
  return null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'admin_profiles', 'admin_invitations', 'admin_template_assignments',
    'admin_permission_overrides', 'permission_templates', 'permission_template_items', 'permissions'
  ] loop
    execute format(
      'create trigger trg_%s_change_log after insert or update or delete on public.%I
         for each row execute function audit.log_change()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Forced RLS on every public table (docs/spec/03-database.md §5)
-- ---------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I force row level security', t.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- System invitations (no inviting admin) bootstrap environments without one.
-- Only the database owner can insert them; there is no client write path.
-- ---------------------------------------------------------------------------
alter table public.admin_invitations alter column invited_by drop not null;

-- ---------------------------------------------------------------------------
-- Auth events: sign-in, MFA, password change (docs/spec/07-security.md §2.1)
-- ---------------------------------------------------------------------------
create function api.record_admin_auth_event(p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_ip text := btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1));
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  if not private.is_active_admin(auth.uid()) then
    perform private.raise_error('FORBIDDEN');
  end if;
  if p_event not in ('sign_in', 'mfa_enrolled', 'mfa_verified', 'mfa_failed', 'password_changed', 'sign_out') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"event","message":"Unknown event."}]}');
  end if;

  insert into public.admin_profiles (id) values (auth.uid()) on conflict (id) do nothing;

  update public.admin_profiles set
    last_login_at = case when p_event = 'sign_in' then now() else last_login_at end,
    last_login_ip = case when p_event = 'sign_in' and v_ip ~ '^[0-9a-fA-F:.]+$' then v_ip::inet else last_login_ip end,
    mfa_enrolled_at = case when p_event = 'mfa_enrolled' then coalesce(mfa_enrolled_at, now()) else mfa_enrolled_at end,
    must_change_password = case when p_event = 'password_changed' then false else must_change_password end
  where id = auth.uid();

  perform private.log_admin_action('auth.' || p_event, 'admin', auth.uid(), null, null, null);
end $$;

-- ---------------------------------------------------------------------------
-- Batch permission changes from the editor: one transaction, one reason.
-- Grants run before removals so intermediate states never lock the editor out.
-- ---------------------------------------------------------------------------
create function api.apply_admin_permission_changes(
  p_admin_id uuid,
  p_add_templates uuid[],
  p_remove_templates uuid[],
  p_overrides jsonb,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_before text[];
  v_item jsonb;
  v_template uuid;
begin
  perform private.require_permission('admins.manage_permissions');
  v_reason := private.require_reason(p_reason);
  perform private.require_admin_target(p_admin_id);

  if jsonb_typeof(coalesce(p_overrides, '[]')) <> 'array' then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"overrides","message":"Must be a list."}]}');
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_overrides, '[]'))
    where value ->> 'effect' is null or value ->> 'effect' not in ('grant', 'deny', 'clear')
  ) then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"overrides","message":"Effect must be grant, deny or clear."}]}');
  end if;

  v_before := private.permission_codes_of(p_admin_id);

  foreach v_template in array coalesce(p_add_templates, '{}') loop
    perform api.assign_permission_template(p_admin_id, v_template, v_reason);
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_overrides, '[]')) where value ->> 'effect' = 'grant' loop
    perform api.set_permission_override(p_admin_id, v_item ->> 'permission', 'grant', v_reason);
  end loop;
  for v_item in select * from jsonb_array_elements(coalesce(p_overrides, '[]')) where value ->> 'effect' = 'clear' loop
    perform api.clear_permission_override(p_admin_id, v_item ->> 'permission', v_reason);
  end loop;
  for v_item in select * from jsonb_array_elements(coalesce(p_overrides, '[]')) where value ->> 'effect' = 'deny' loop
    perform api.set_permission_override(p_admin_id, v_item ->> 'permission', 'deny', v_reason);
  end loop;

  foreach v_template in array coalesce(p_remove_templates, '{}') loop
    perform api.revoke_permission_template(p_admin_id, v_template, v_reason);
  end loop;

  return jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(private.permission_codes_of(p_admin_id)));
end $$;

-- ---------------------------------------------------------------------------
-- Read RPCs for the admin screens
-- ---------------------------------------------------------------------------
create function private.admin_templates_json(p_admin_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name) order by t.name), '[]')
  from public.admin_template_assignments a
  join public.permission_templates t on t.id = a.template_id and t.deleted_at is null
  where a.admin_id = p_admin_id and a.revoked_at is null;
$$;

create function api.list_admins(p_search text default null, p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_search text := nullif(btrim(p_search), '');
begin
  perform private.require_permission('admins.view');
  if p_status is not null and p_status not in ('active', 'suspended', 'deactivated') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"status","message":"Unknown status."}]}');
  end if;

  return coalesce((
    select jsonb_agg(row order by row ->> 'full_name')
    from (
      select jsonb_build_object(
        'id', p.id,
        'full_name', p.full_name,
        'email', p.email,
        'status', p.status,
        'created_at', p.created_at,
        'mfa_enrolled_at', ap.mfa_enrolled_at,
        'last_login_at', ap.last_login_at,
        'templates', private.admin_templates_json(p.id),
        'override_count', (select count(*) from public.admin_permission_overrides o
                           where o.admin_id = p.id and o.revoked_at is null)
      ) as row
      from public.profiles p
      left join public.admin_profiles ap on ap.id = p.id
      where p.role = 'admin' and p.deleted_at is null
        and (p_status is null or p.status::text = p_status)
        and (v_search is null or p.full_name ilike '%' || v_search || '%' or p.email::text ilike '%' || v_search || '%')
      limit 500
    ) s
  ), '[]');
end $$;

create function api.get_admin(p_admin_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if p_admin_id is distinct from auth.uid() then
    perform private.require_permission('admins.view');
  elsif not private.is_admin() then
    perform private.raise_error('FORBIDDEN');
  end if;

  select jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'email', p.email,
    'status', p.status,
    'suspended_reason', p.suspended_reason,
    'created_at', p.created_at,
    'version', p.version,
    'title', ap.title,
    'department', ap.department,
    'mfa_enrolled_at', ap.mfa_enrolled_at,
    'last_login_at', ap.last_login_at,
    'must_change_password', coalesce(ap.must_change_password, false),
    'is_super_admin', private.is_super_admin(p.id),
    'templates', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'code', t.code, 'name', t.name,
        'assigned_at', a.created_at, 'reason', a.reason,
        'assigned_by', (select full_name from public.profiles x where x.id = a.assigned_by)
      ) order by t.name), '[]')
      from public.admin_template_assignments a
      join public.permission_templates t on t.id = a.template_id and t.deleted_at is null
      where a.admin_id = p.id and a.revoked_at is null
    ),
    'overrides', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'permission', o.permission_code, 'effect', o.effect, 'reason', o.reason, 'created_at', o.created_at,
        'granted_by', (select full_name from public.profiles x where x.id = o.granted_by)
      ) order by o.permission_code), '[]')
      from public.admin_permission_overrides o
      where o.admin_id = p.id and o.revoked_at is null
    ),
    'permissions', to_jsonb(private.permission_codes_of(p.id))
  ) into v_result
  from public.profiles p
  left join public.admin_profiles ap on ap.id = p.id
  where p.id = p_admin_id and p.role = 'admin' and p.deleted_at is null;

  if v_result is null then
    perform private.raise_error('NOT_FOUND');
  end if;
  return v_result;
end $$;

create function api.list_admin_invitations() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('admins.view');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id,
      'email', i.email,
      'full_name', i.full_name,
      'status', case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end,
      'expires_at', i.expires_at,
      'created_at', i.created_at,
      'reason', i.reason,
      'invited_by', (select full_name from public.profiles x where x.id = i.invited_by),
      'templates', (select coalesce(jsonb_agg(t.name order by t.name), '[]')
                    from public.permission_templates t where t.id = any (i.template_ids))
    ) order by i.created_at desc)
    from public.admin_invitations i
    where i.status = 'pending' or i.created_at > now() - interval '30 days'
  ), '[]');
end $$;

create function api.list_permission_catalogue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    perform private.raise_error('FORBIDDEN');
  end if;
  return jsonb_build_object(
    'permissions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', p.code, 'module', p.module, 'description', p.description, 'is_high_impact', p.is_high_impact
      ) order by p.sort_order), '[]')
      from public.permissions p
    ),
    'templates', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'code', t.code, 'name', t.name, 'description', t.description, 'is_builtin', t.is_builtin,
        'permissions', (select coalesce(jsonb_agg(i.permission_code order by i.permission_code), '[]')
                        from public.permission_template_items i
                        where i.template_id = t.id and i.removed_at is null),
        'admin_count', (select count(*) from public.admin_template_assignments a
                        join public.profiles pr on pr.id = a.admin_id and pr.status = 'active'
                        where a.template_id = t.id and a.revoked_at is null)
      ) order by t.is_builtin desc, t.name), '[]')
      from public.permission_templates t
      where t.deleted_at is null
    )
  );
end $$;

-- Keyset pagination on id (monotonic with created_at).
create function api.list_admin_audit_logs(
  p_admin_id uuid default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_action text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 50,
  p_cursor bigint default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_rows jsonb;
begin
  perform private.require_permission('audit.view');

  select coalesce(jsonb_agg(r order by (r ->> 'id')::bigint desc), '[]') into v_rows
  from (
    select jsonb_build_object(
      'id', l.id,
      'created_at', l.created_at,
      'action', l.action,
      'entity_type', l.entity_type,
      'entity_id', l.entity_id,
      'admin_id', l.admin_id,
      'admin_name', pr.full_name,
      'reason', l.reason,
      'before', l.before_data,
      'after', l.after_data,
      'ip', host(l.ip),
      'request_id', l.request_id
    ) as r
    from public.admin_audit_logs l
    left join public.profiles pr on pr.id = l.admin_id
    where (p_cursor is null or l.id < p_cursor)
      and (p_admin_id is null or l.admin_id = p_admin_id)
      and (p_entity_type is null or l.entity_type = p_entity_type)
      and (p_entity_id is null or l.entity_id = p_entity_id)
      and (p_action is null or l.action like p_action || '%')
      and (p_from is null or l.created_at >= p_from)
      and (p_to is null or l.created_at < p_to)
    order by l.id desc
    limit v_limit + 1
  ) s;

  return jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(x), '[]') from (
      select x from jsonb_array_elements(v_rows) with ordinality e(x, n) where n <= v_limit order by n) t),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then v_rows -> (v_limit - 1) -> 'id' end
  );
end $$;

create function api.list_change_log(
  p_table text default null,
  p_record_id text default null,
  p_limit integer default 50,
  p_cursor bigint default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_rows jsonb;
begin
  perform private.require_permission('audit.view');

  select coalesce(jsonb_agg(r order by (r ->> 'id')::bigint desc), '[]') into v_rows
  from (
    select jsonb_build_object(
      'id', c.id,
      'created_at', c.created_at,
      'table_name', c.table_name,
      'record_id', c.record_id,
      'op', c.op,
      'changed_cols', c.changed_cols,
      'old_row', c.old_row,
      'new_row', c.new_row,
      'actor_id', c.actor_id,
      'actor_name', pr.full_name,
      'request_id', c.request_id
    ) as r
    from audit.change_log c
    left join public.profiles pr on pr.id = c.actor_id
    where (p_cursor is null or c.id < p_cursor)
      and (p_table is null or c.table_name = p_table)
      and (p_record_id is null or c.record_id = p_record_id)
    order by c.id desc
    limit v_limit + 1
  ) s;

  return jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(x), '[]') from (
      select x from jsonb_array_elements(v_rows) with ordinality e(x, n) where n <= v_limit order by n) t),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then v_rows -> (v_limit - 1) -> 'id' end
  );
end $$;

create function api.list_my_notifications(p_limit integer default 20) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'unread', (select count(*) from public.notifications where recipient_id = auth.uid() and read_at is null),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'link', n.link,
        'read_at', n.read_at, 'created_at', n.created_at
      ) order by n.created_at desc)
      from (select * from public.notifications
            where recipient_id = auth.uid()
            order by created_at desc
            limit least(greatest(coalesce(p_limit, 20), 1), 50)) n
    ), '[]')
  );
$$;

create function api.update_own_profile(p_full_name text, p_preferred_language text, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles;
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  if p_full_name is null or length(btrim(p_full_name)) not between 1 and 120 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"full_name","message":"Enter a name."}]}');
  end if;
  if p_preferred_language not in ('en', 'bn') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"preferred_language","message":"Choose English or Bangla."}]}');
  end if;

  update public.profiles
  set full_name = btrim(p_full_name), preferred_language = p_preferred_language
  where id = auth.uid() and version = p_expected_version
  returning * into v_profile;

  if not found then
    perform private.raise_error('STALE_VERSION');
  end if;
  return jsonb_build_object('version', v_profile.version);
end $$;

revoke execute on all functions in schema api from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema audit from public, anon, authenticated;

grant execute on function
  private.has_permission(text), private.is_admin(), private.has_aal2(), private.current_app_role()
to authenticated;
grant execute on function private.custom_access_token_hook(jsonb) to supabase_auth_admin;

grant execute on function
  api.my_admin_context(),
  api.invite_admin(text, text, uuid[], text),
  api.cancel_admin_invitation(uuid, text),
  api.assign_permission_template(uuid, uuid, text),
  api.revoke_permission_template(uuid, uuid, text),
  api.set_permission_override(uuid, text, text, text),
  api.clear_permission_override(uuid, text, text),
  api.suspend_admin(uuid, text),
  api.reactivate_admin(uuid, text),
  api.create_permission_template(text, text, text, text[], text),
  api.set_template_permissions(uuid, text[], text),
  api.delete_permission_template(uuid, text),
  api.template_impact(uuid),
  api.mark_notifications_read(uuid[]),
  api.record_admin_auth_event(text),
  api.apply_admin_permission_changes(uuid, uuid[], uuid[], jsonb, text),
  api.list_admins(text, text),
  api.get_admin(uuid),
  api.list_admin_invitations(),
  api.list_permission_catalogue(),
  api.list_admin_audit_logs(uuid, text, uuid, text, timestamptz, timestamptz, integer, bigint),
  api.list_change_log(text, text, integer, bigint),
  api.list_my_notifications(integer),
  api.update_own_profile(text, text, integer)
to authenticated;
