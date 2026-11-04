-- Foundation: schemas, shared trigger helpers, profiles with immutable role,
-- admin audit log, notifications.
-- Spec: docs/spec/02-roles-permissions.md, docs/spec/03-database.md §1, §3, §4.1.

create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Schemas
--   api      RPC functions exposed through PostgREST (the only write path)
--   private  helpers, never exposed through PostgREST
-- ---------------------------------------------------------------------------
create schema if not exists api;
create schema if not exists private;

revoke all on schema api from public;
revoke all on schema private from public;
grant usage on schema api to authenticated, service_role;
-- RLS policies call private helpers as the requesting role, so it needs USAGE.
-- The schema is not in the exposed API schemas, so clients cannot call it.
grant usage on schema private to authenticated, service_role;

-- Functions are not executable by default; each one is granted explicitly.
alter default privileges in schema api revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'driver', 'passenger', 'user');
create type public.account_status as enum ('active', 'suspended', 'deactivated');
create type public.actor_type as enum ('passenger', 'driver', 'admin', 'system');

-- ---------------------------------------------------------------------------
-- Shared trigger helpers
-- ---------------------------------------------------------------------------

-- Maintains updated_at / created_by / updated_by and bumps version.
create function private.stamp_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := new.created_at;
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := new.created_by;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.version := old.version + 1;
  end if;
  return new;
end $$;

-- Append-only tables: any UPDATE or DELETE is rejected.
create function private.forbid_update_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'APPEND_ONLY' using errcode = 'P0001',
    detail = json_build_object('table', tg_table_name)::text;
end $$;

-- Soft-delete tables: DELETE is rejected unless an audited archival function
-- enables it for the current transaction.
create function private.forbid_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.allow_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception 'DELETE_FORBIDDEN' using errcode = 'P0001',
    detail = json_build_object('table', tg_table_name)::text;
end $$;

-- Business validation errors raised from SQL use this so messages stay uniform.
create function private.raise_error(p_code text, p_detail jsonb default '{}'::jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception '%', p_code using errcode = 'P0001', detail = p_detail::text;
end $$;

create function private.require_reason(p_reason text) returns text
language plpgsql set search_path = '' as $$
begin
  if p_reason is null or length(btrim(p_reason)) < 5 or length(p_reason) > 1000 then
    perform private.raise_error('VALIDATION_FAILED',
      '{"fields":[{"path":"reason","message":"A reason of 5 to 1000 characters is required."}]}');
  end if;
  return btrim(p_reason);
end $$;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  role public.app_role not null,
  status public.account_status not null default 'active',
  full_name text not null,
  email extensions.citext,
  phone text,
  preferred_language text not null default 'en',
  avatar_path text,
  suspended_reason text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  version integer not null default 1,
  constraint chk_profiles_full_name check (length(btrim(full_name)) between 1 and 120),
  constraint chk_profiles_phone check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint chk_profiles_language check (preferred_language in ('en', 'bn')),
  constraint chk_profiles_suspended_reason check (status <> 'suspended' or suspended_reason is not null)
);

create unique index uq_profiles_email on public.profiles (email) where email is not null;
create unique index uq_profiles_phone on public.profiles (phone) where phone is not null;
create index idx_profiles_role_status on public.profiles (role, status);

create trigger trg_profiles_stamp before insert or update on public.profiles
  for each row execute function private.stamp_row();
create trigger trg_profiles_no_delete before delete on public.profiles
  for each row execute function private.forbid_delete();

-- Role is immutable. The only allowed change is the one-way onboarding
-- promotion user -> passenger | driver, performed by private.promote_user_role().
create function private.profiles_role_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.role is distinct from old.role then
    if old.role = 'user'
       and new.role in ('passenger', 'driver')
       and coalesce(current_setting('app.role_promotion', true), '') = 'on' then
      return new;
    end if;
    perform private.raise_error('ROLE_IMMUTABLE');
  end if;
  return new;
end $$;

create trigger trg_profiles_role_guard before update of role on public.profiles
  for each row execute function private.profiles_role_guard();

create function private.promote_user_role(p_user_id uuid, p_role public.app_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_role not in ('passenger', 'driver') then
    perform private.raise_error('ROLE_IMMUTABLE');
  end if;
  perform set_config('app.role_promotion', 'on', true);
  update public.profiles set role = p_role where id = p_user_id and role = 'user';
  if not found then
    perform private.raise_error('ROLE_IMMUTABLE');
  end if;
  perform set_config('app.role_promotion', 'off', true);
end $$;

-- ---------------------------------------------------------------------------
-- account_status_events (append-only)
-- ---------------------------------------------------------------------------
create table public.account_status_events (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id),
  old_status public.account_status,
  new_status public.account_status not null,
  reason text not null,
  actor_id uuid references public.profiles (id),
  actor_type public.actor_type not null,
  created_at timestamptz not null default now()
);

create index idx_account_status_events_profile on public.account_status_events (profile_id, created_at desc);

create trigger trg_account_status_events_append_only before update or delete on public.account_status_events
  for each row execute function private.forbid_update_delete();

-- ---------------------------------------------------------------------------
-- admin_audit_logs (append-only)
-- Low volume (admin actions only), so a plain table with targeted indexes.
-- ---------------------------------------------------------------------------
create table public.admin_audit_logs (
  id bigint generated always as identity primary key,
  admin_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  reason text,
  ip inet,
  user_agent text,
  request_id text,
  created_at timestamptz not null default now()
);

create index idx_admin_audit_logs_entity on public.admin_audit_logs (entity_type, entity_id, created_at desc);
create index idx_admin_audit_logs_admin on public.admin_audit_logs (admin_id, created_at desc);
create index idx_admin_audit_logs_created on public.admin_audit_logs (created_at desc);

create trigger trg_admin_audit_logs_append_only before update or delete on public.admin_audit_logs
  for each row execute function private.forbid_update_delete();

-- Writes an audit row with request context taken from PostgREST headers.
create function private.log_admin_action(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_before jsonb,
  p_after jsonb,
  p_reason text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_ip text := btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1));
begin
  insert into public.admin_audit_logs
    (admin_id, action, entity_type, entity_id, before_data, after_data, reason, ip, user_agent, request_id)
  values (
    auth.uid(), p_action, p_entity_type, p_entity_id, p_before, p_after, p_reason,
    case when v_ip ~ '^[0-9a-fA-F:.]+$' then v_ip::inet end,
    left(v_headers ->> 'user-agent', 500),
    left(v_headers ->> 'x-request-id', 64)
  );
end $$;

-- ---------------------------------------------------------------------------
-- notifications (admin in-app inbox)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id),
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint chk_notifications_link check (link is null or link ~ '^/[^/\\]')
);

create index idx_notifications_recipient on public.notifications (recipient_id, created_at desc);
create index idx_notifications_unread on public.notifications (recipient_id) where read_at is null;

create trigger trg_notifications_no_delete before delete on public.notifications
  for each row execute function private.forbid_delete();

create function private.notify(p_recipient uuid, p_kind text, p_title text, p_body text, p_link text)
returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (recipient_id, kind, title, body, link)
  values (p_recipient, p_kind, p_title, p_body, p_link);
$$;
