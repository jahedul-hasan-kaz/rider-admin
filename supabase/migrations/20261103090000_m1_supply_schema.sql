-- M1 supply onboarding: schema, PII helpers, storage bucket and RLS.
-- Spec: docs/spec/03-database.md §4.2–4.3, §5, §6; docs/spec/04-business-logic.md §1–2.

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.driver_onboarding_status as enum ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'suspended');
create type public.driver_availability as enum ('offline', 'online', 'on_trip');
create type public.document_type as enum (
  'national_id', 'driving_licence', 'profile_photo',
  'vehicle_registration', 'fitness_certificate', 'tax_token', 'insurance', 'route_permit'
);
create type public.review_status as enum ('pending', 'approved', 'rejected', 'expired');
create type public.vehicle_status as enum ('pending', 'active', 'inactive', 'suspended');

-- ---------------------------------------------------------------------------
-- app_settings (versioned operational configuration; UI arrives in M4)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

create trigger trg_app_settings_stamp before insert or update on public.app_settings
  for each row execute function private.stamp_row();
create trigger trg_app_settings_no_delete before delete on public.app_settings
  for each row execute function private.forbid_delete();

insert into public.app_settings (key, value, description) values
  ('onboarding.required_documents',
   '{"driver":["profile_photo","national_id","driving_licence"],"vehicle":["vehicle_registration","fitness_certificate","tax_token","insurance"]}',
   'Documents that must be approved and unexpired before a driver or vehicle can be approved.'),
  ('documents.expiry_warning_days', '30', 'Days before expiry when drivers and admins are warned.'),
  ('documents.max_upload_bytes', '10485760', 'Maximum driver document size.'),
  ('location.stale_after_s', '120', 'Online drivers with an older location are taken offline.');

create function private.setting(p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select value from public.app_settings where key = p_key;
$$;

-- ---------------------------------------------------------------------------
-- PII helpers: column encryption with a key held in Supabase Vault, masking
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'pii_encryption_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'pii_encryption_key',
      'Symmetric key for column-level PII encryption (licence numbers).');
  end if;
end $$;

create function private.pii_key() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'pii_encryption_key';
$$;

create function private.encrypt_pii(p_value text) returns bytea
language sql stable security definer set search_path = '' as $$
  select case when p_value is null then null else extensions.pgp_sym_encrypt(p_value, private.pii_key()) end;
$$;

create function private.decrypt_pii(p_value bytea) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_value is null then null else extensions.pgp_sym_decrypt(p_value, private.pii_key()) end;
$$;

-- +8801712345421 -> +88017•••••421
create function private.mask_phone(p_phone text) returns text
language sql immutable set search_path = '' as $$
  select case when p_phone is null then null
              when length(p_phone) <= 7 then repeat('•', length(p_phone))
              else left(p_phone, 6) || repeat('•', length(p_phone) - 9) || right(p_phone, 3) end;
$$;

-- rahim.uddin@example.com -> r•••@example.com
create function private.mask_email(p_email text) returns text
language sql immutable set search_path = '' as $$
  select case when p_email is null then null
              when position('@' in p_email) < 2 then '•••'
              else left(p_email, 1) || '•••' || substring(p_email from position('@' in p_email)) end;
$$;

-- DK-1234567 -> •••••567
create function private.mask_tail(p_value text, p_keep integer default 3) returns text
language sql immutable set search_path = '' as $$
  select case when p_value is null then null
              when length(p_value) <= p_keep then repeat('•', length(p_value))
              else repeat('•', least(length(p_value) - p_keep, 6)) || right(p_value, p_keep) end;
$$;

-- ---------------------------------------------------------------------------
-- vehicle_categories
-- ---------------------------------------------------------------------------
create table public.vehicle_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  name_bn text,
  description text,
  passenger_capacity integer not null,
  icon text not null default 'car',
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  constraint chk_vehicle_categories_code check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  constraint chk_vehicle_categories_name check (length(btrim(name)) between 1 and 60),
  constraint chk_vehicle_categories_capacity check (passenger_capacity between 1 and 20),
  constraint chk_vehicle_categories_icon check (icon in ('bike', 'car', 'cng', 'microbus', 'ambulance', 'truck'))
);

insert into public.vehicle_categories (code, name, name_bn, description, passenger_capacity, icon, sort_order)
values ('bike', 'Bike', 'বাইক', 'Motorbike ride for one passenger.', 1, 'bike', 10);

-- ---------------------------------------------------------------------------
-- service_zones
-- ---------------------------------------------------------------------------
create table public.service_zones (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  boundary extensions.geography(MultiPolygon, 4326) not null,
  area_km2 numeric(10, 3) not null,
  timezone text not null default 'Asia/Dhaka',
  active boolean not null default false,
  manual_surge_multiplier numeric(4, 2) not null default 1.00,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  constraint chk_service_zones_code check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint chk_service_zones_name check (length(btrim(name)) between 1 and 80),
  constraint chk_service_zones_surge check (manual_surge_multiplier between 1 and 3)
);

create index idx_service_zones_boundary on public.service_zones using gist (boundary);
create index idx_service_zones_active on public.service_zones (active);

-- ---------------------------------------------------------------------------
-- driver_profiles
-- ---------------------------------------------------------------------------
create table public.driver_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id),
  onboarding_status public.driver_onboarding_status not null default 'draft',
  availability public.driver_availability not null default 'offline',
  licence_number_enc bytea,
  licence_number_masked text,
  licence_expiry date,
  current_vehicle_id uuid,
  home_zone_id uuid references public.service_zones (id),
  rating_avg numeric(3, 2),
  rating_count integer not null default 0,
  acceptance_rate_30d numeric(5, 4),
  cancellation_rate_30d numeric(5, 4),
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id),
  rejected_reason text,
  suspended_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  constraint chk_driver_online_requires_approval check (availability = 'offline' or onboarding_status = 'approved'),
  constraint chk_driver_suspended_reason check (onboarding_status <> 'suspended' or suspended_reason is not null),
  constraint chk_driver_rejected_reason check (onboarding_status <> 'rejected' or rejected_reason is not null)
);

create index idx_driver_profiles_onboarding on public.driver_profiles (onboarding_status, submitted_at);
create index idx_driver_profiles_online on public.driver_profiles (availability) where availability <> 'offline';

-- ---------------------------------------------------------------------------
-- vehicles
-- ---------------------------------------------------------------------------
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.driver_profiles (id),
  category_id uuid not null references public.vehicle_categories (id),
  make text not null,
  model text not null,
  color text not null,
  registration_number text not null,
  year integer not null,
  status public.vehicle_status not null default 'pending',
  verified_at timestamptz,
  verified_by uuid references public.profiles (id),
  suspended_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  constraint chk_vehicles_registration check (registration_number ~ '^[A-Z0-9][A-Z0-9 -]{2,23}$'),
  constraint chk_vehicles_year check (year between 1990 and 2100),
  constraint chk_vehicles_text check (
    length(btrim(make)) between 1 and 40 and length(btrim(model)) between 1 and 40 and length(btrim(color)) between 1 and 30
  ),
  constraint chk_vehicles_suspended_reason check (status <> 'suspended' or suspended_reason is not null)
);

create unique index uq_vehicles_registration on public.vehicles (registration_number) where status <> 'inactive';
create index idx_vehicles_driver on public.vehicles (driver_id);
create index idx_vehicles_status on public.vehicles (status, created_at desc);

alter table public.driver_profiles
  add constraint fk_driver_profiles_current_vehicle foreign key (current_vehicle_id) references public.vehicles (id);

-- ---------------------------------------------------------------------------
-- driver_documents (history kept: a re-upload supersedes, never overwrites)
-- ---------------------------------------------------------------------------
create table public.driver_documents (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.driver_profiles (id),
  vehicle_id uuid references public.vehicles (id),
  document_type public.document_type not null,
  storage_path text not null unique,
  content_type text not null,
  size_bytes integer,
  file_sha256 text,
  document_number_masked text,
  issued_at date,
  expires_at date,
  uploaded_at timestamptz,
  review_status public.review_status not null default 'pending',
  reviewer_id uuid references public.profiles (id),
  reviewed_at timestamptz,
  rejection_reason text,
  supersedes_id uuid references public.driver_documents (id),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  constraint chk_documents_path check (storage_path like 'drivers/%'),
  constraint chk_documents_content_type check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  constraint chk_documents_dates check (expires_at is null or issued_at is null or expires_at > issued_at),
  constraint chk_documents_rejection check (review_status <> 'rejected' or rejection_reason is not null),
  constraint chk_documents_vehicle check (
    (document_type in ('vehicle_registration', 'fitness_certificate', 'tax_token', 'insurance', 'route_permit')) = (vehicle_id is not null)
  )
);

create index idx_documents_driver on public.driver_documents (driver_id, document_type);
create index idx_documents_review_queue on public.driver_documents (uploaded_at)
  where review_status = 'pending' and uploaded_at is not null and superseded_at is null;
create index idx_documents_expiry on public.driver_documents (expires_at)
  where review_status = 'approved' and superseded_at is null;

-- ---------------------------------------------------------------------------
-- driver_status_events (append-only; availability history feeds online hours)
-- ---------------------------------------------------------------------------
create table public.driver_status_events (
  id bigint generated always as identity primary key,
  driver_id uuid not null references public.driver_profiles (id),
  kind text not null,
  old_status text,
  new_status text not null,
  reason text,
  location extensions.geography(Point, 4326),
  actor_id uuid references public.profiles (id),
  actor_type public.actor_type not null,
  created_at timestamptz not null default now(),
  constraint chk_driver_status_events_kind check (kind in ('availability', 'onboarding'))
);

create index idx_driver_status_events_driver on public.driver_status_events (driver_id, created_at desc);

-- ---------------------------------------------------------------------------
-- driver_live_locations (current position only; hot table, no change log)
-- ---------------------------------------------------------------------------
create table public.driver_live_locations (
  driver_id uuid primary key references public.driver_profiles (id),
  location extensions.geography(Point, 4326) not null,
  heading numeric(5, 2),
  speed_mps numeric(6, 2),
  accuracy_m numeric(7, 2),
  recorded_at timestamptz not null,
  updated_at timestamptz not null default now()
) with (fillfactor = 70);

create index idx_driver_live_locations_location on public.driver_live_locations using gist (location);
create index idx_driver_live_locations_updated on public.driver_live_locations (updated_at);

-- ---------------------------------------------------------------------------
-- pii_access_logs (append-only): every reveal of PII, documents or locations
-- ---------------------------------------------------------------------------
create table public.pii_access_logs (
  id bigint generated always as identity primary key,
  admin_id uuid not null references public.profiles (id),
  subject_profile_id uuid references public.profiles (id),
  field text not null,
  reason text,
  created_at timestamptz not null default now()
);

create index idx_pii_access_logs_subject on public.pii_access_logs (subject_profile_id, created_at desc);
create index idx_pii_access_logs_admin on public.pii_access_logs (admin_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers: stamps, soft-delete guards, append-only guards, change log
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['vehicle_categories', 'service_zones', 'driver_profiles', 'vehicles', 'driver_documents'] loop
    execute format('create trigger trg_%s_stamp before insert or update on public.%I for each row execute function private.stamp_row()', t, t);
    execute format('create trigger trg_%s_no_delete before delete on public.%I for each row execute function private.forbid_delete()', t, t);
    execute format('create trigger trg_%s_change_log after insert or update or delete on public.%I for each row execute function audit.log_change()', t, t);
  end loop;
  foreach t in array array['driver_status_events', 'pii_access_logs'] loop
    execute format('create trigger trg_%s_append_only before update or delete on public.%I for each row execute function private.forbid_update_delete()', t, t);
  end loop;
end $$;

create trigger trg_app_settings_change_log after insert or update or delete on public.app_settings
  for each row execute function audit.log_change();

-- A driver profile belongs to a driver account; the current vehicle belongs to that driver.
create function private.driver_profiles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = new.user_id and role = 'driver') then
    perform private.raise_error('ROLE_NOT_ALLOWED', '{"reason":"profile is not a driver"}');
  end if;
  if new.current_vehicle_id is not null and not exists (
    select 1 from public.vehicles where id = new.current_vehicle_id and driver_id = new.id
  ) then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"current_vehicle_id","message":"Vehicle belongs to another driver."}]}');
  end if;
  return new;
end $$;

create trigger trg_driver_profiles_guard before insert or update of user_id, current_vehicle_id on public.driver_profiles
  for each row execute function private.driver_profiles_guard();

-- ---------------------------------------------------------------------------
-- Role helpers for driver/passenger RPCs
-- ---------------------------------------------------------------------------
create function private.require_role(p_role public.app_role) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_profile public.profiles;
begin
  if auth.uid() is null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  select * into v_profile from public.profiles where id = auth.uid();
  if not found or v_profile.deleted_at is not null then
    perform private.raise_error('UNAUTHENTICATED');
  end if;
  if v_profile.status = 'suspended' then
    perform private.raise_error('ACCOUNT_SUSPENDED');
  end if;
  if v_profile.status <> 'active' or v_profile.role <> p_role then
    perform private.raise_error('ROLE_NOT_ALLOWED', jsonb_build_object('required', p_role));
  end if;
end $$;

create function private.my_driver_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select d.id from public.driver_profiles d where d.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Column privileges: PII columns are never readable directly by clients.
-- Masked values and audited reveals come from RPCs only.
-- ---------------------------------------------------------------------------
revoke all on table
  public.app_settings, public.vehicle_categories, public.service_zones, public.driver_profiles, public.vehicles,
  public.driver_documents, public.driver_status_events, public.driver_live_locations, public.pii_access_logs
from anon, authenticated;

revoke select on table public.profiles from authenticated;
grant select (id, role, status, full_name, preferred_language, avatar_path, suspended_reason, last_seen_at,
              created_at, updated_at, version) on public.profiles to authenticated;

grant select on table public.vehicle_categories, public.service_zones, public.vehicles, public.driver_documents,
  public.driver_status_events, public.driver_live_locations, public.pii_access_logs, public.app_settings
to authenticated;
grant select (id, user_id, onboarding_status, availability, licence_number_masked, licence_expiry, current_vehicle_id,
              home_zone_id, rating_avg, rating_count, acceptance_rate_30d, cancellation_rate_30d, submitted_at,
              approved_at, rejected_reason, suspended_reason, created_at, updated_at, version)
  on public.driver_profiles to authenticated;

alter table public.app_settings enable row level security;
alter table public.vehicle_categories enable row level security;
alter table public.service_zones enable row level security;
alter table public.driver_profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.driver_documents enable row level security;
alter table public.driver_status_events enable row level security;
alter table public.driver_live_locations enable row level security;
alter table public.pii_access_logs enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['app_settings', 'vehicle_categories', 'service_zones', 'driver_profiles', 'vehicles',
                           'driver_documents', 'driver_status_events', 'driver_live_locations', 'pii_access_logs'] loop
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

create policy app_settings_select on public.app_settings for select to authenticated
  using ((select private.has_permission('settings.view')));

create policy vehicle_categories_select on public.vehicle_categories for select to authenticated
  using (active or (select private.is_admin()));

create policy service_zones_select on public.service_zones for select to authenticated
  using ((select private.has_permission('zones.view')));

create policy driver_profiles_select on public.driver_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_permission('drivers.view')));

create policy vehicles_select on public.vehicles for select to authenticated
  using (driver_id = (select private.my_driver_id()) or (select private.has_permission('vehicles.view')));

create policy driver_documents_select on public.driver_documents for select to authenticated
  using (driver_id = (select private.my_driver_id()) or (select private.has_permission('documents.view')));

create policy driver_status_events_select on public.driver_status_events for select to authenticated
  using (driver_id = (select private.my_driver_id()) or (select private.has_permission('drivers.view')));

create policy driver_live_locations_select on public.driver_live_locations for select to authenticated
  using (driver_id = (select private.my_driver_id()) or (select private.has_permission('dispatch.view')));

create policy pii_access_logs_select on public.pii_access_logs for select to authenticated
  using ((select private.has_permission('audit.view')));

-- ---------------------------------------------------------------------------
-- Storage: private driver-documents bucket (docs/spec/03-database.md §6)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('driver-documents', 'driver-documents', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- A driver may upload only to the exact path of their own document record that
-- is still awaiting its file. No overwrite, update or delete for anyone.
create function private.can_upload_driver_document(p_object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.driver_documents d
    join public.driver_profiles p on p.id = d.driver_id
    where d.storage_path = p_object_name and d.uploaded_at is null and p.user_id = auth.uid()
  );
$$;

create policy driver_documents_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'driver-documents' and (select private.can_upload_driver_document(name)));

create policy driver_documents_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'driver-documents' and (select private.has_permission('documents.view')));

grant execute on function private.can_upload_driver_document(text), private.my_driver_id() to authenticated;
