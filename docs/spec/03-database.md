# 03 · Database

Supabase Postgres with `postgis`, `pg_cron`, `pgcrypto`, `citext`, `btree_gist`, `pg_trgm`. This extends the blueprint's table catalogue (§3) with the governance, idempotency and performance tables a commercial system needs.

## 1. Conventions

| Topic | Rule |
|---|---|
| Schemas | `public` (tables + `security_invoker` views; exposed to PostgREST), `api` (RPC functions exposed to PostgREST), `private` (helpers, **not** exposed), `audit` (change log, not exposed) |
| Keys | `id uuid primary key default gen_random_uuid()`. High-volume append tables use `id bigint generated always as identity` |
| Timestamps | `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` (maintained by trigger `set_updated_at`) |
| Actor columns | `created_by uuid`, `updated_by uuid` → `profiles(id)`, filled from `auth.uid()` by trigger |
| Soft delete | `deleted_at timestamptz`, `deleted_by uuid`, `delete_reason text`. RLS hides soft-deleted rows. **No `DELETE` privilege is granted on any business table** |
| Money | `numeric(12,2)` with `CHECK (x >= 0)` where applicable. Currency `char(3) not null default 'BDT'` with `CHECK (currency ~ '^[A-Z]{3}$')`. Rates and percentages `numeric(6,4)` |
| Enums | Postgres `enum` types for closed state sets (listed in §2). Adding a value is a migration |
| Geo | `geography(Point,4326)` and `geography(MultiPolygon,4326)` with GiST indexes |
| Text | `citext` for email. Phone stored in E.164 (`CHECK (phone ~ '^\+[1-9][0-9]{7,14}$')`) |
| Naming | snake_case, plural tables, `fk_<table>_<col>`, `idx_<table>_<cols>`, `chk_<table>_<rule>` |
| Optimistic concurrency | Mutable admin-edited rows carry `version int not null default 1`. Update RPCs take `expected_version` and raise `STALE_VERSION` on mismatch, so two admins can't silently overwrite each other |

## 2. Enum types

```
app_role                 admin | driver | passenger | user
account_status           active | suspended | deactivated
driver_onboarding_status draft | submitted | under_review | approved | rejected | suspended
driver_availability      offline | online | on_trip
document_type            national_id | driving_licence | vehicle_registration | fitness_certificate |
                         tax_token | insurance | route_permit | profile_photo
review_status            pending | approved | rejected | expired
vehicle_status           pending | active | inactive | suspended
fare_rule_status         draft | scheduled | active | retired
ride_request_status      requested | searching | matched | no_driver_found | cancelled_by_passenger |
                         cancelled_by_admin | failed
trip_status              driver_assigned | driver_arriving | arrived | in_progress | completed |
                         cancelled_by_passenger | cancelled_by_driver | cancelled_by_admin | failed
offer_response           pending | accepted | rejected | expired | withdrawn
actor_type               passenger | driver | admin | system
payment_method           cash | bkash | nagad | card
payment_status           pending | authorized | succeeded | failed | cancelled | refunded | partially_refunded
earning_payout_status    unpaid | in_payout | paid | held
payout_status            pending | approved | processing | paid | failed | cancelled
adjustment_kind          refund | ledger_adjustment
approval_status          requested | approved | rejected | processed | failed
promo_discount_type      percent | fixed
redemption_status        reserved | applied | released
ticket_status            open | in_progress | pending_user | resolved | closed
ticket_priority          low | normal | high | urgent
incident_severity        low | medium | high | critical
incident_status          reported | acknowledged | investigating | escalated | resolved | closed
```

## 3. "Never lose information": data-preservation mechanics

1. **Generic change log.** Trigger `audit.log_change()` is attached `AFTER INSERT OR UPDATE` on every business table. It writes `audit.change_log(id bigint, table_name, record_id uuid, op, old_row jsonb, new_row jsonb, changed_cols text[], actor_id, actor_role, request_id, created_at)`. The table is partitioned monthly. `request_id` comes from the `x-request-id` header (`current_setting('request.headers', true)::json->>'x-request-id'`), so DB changes join to app logs.
2. **Append-only tables** (trigger `private.forbid_update_delete` + privileges revoked): `audit.change_log`, `admin_audit_logs`, `pii_access_logs`, `ledger_entries`, `trip_status_events`, `ride_request_events`, `driver_status_events`, `account_status_events`, `trip_location_points`, `payment_events`, `support_ticket_messages`, `safety_incident_events`.
3. **Soft delete only** for everything else. `DELETE` is revoked from `anon` and `authenticated`, and a `BEFORE DELETE` trigger raises unless `app.allow_purge = on` is set inside a dedicated, audited archival function.
4. **Financial immutability.** Ledger entries are never updated. Corrections are reversal entries plus new entries in a new transaction group linked by `reverses_group_id`. Completed `trip_fare_breakdowns` are frozen (trigger rejects updates once the trip is `completed`).
5. **Snapshots.** Quotes and trips store `pricing_rule_snapshot jsonb`, so later fare-rule edits never change history. Fare rules themselves are versioned and immutable once published.
6. **Idempotency records** keep request hash and response for 7 days, so retried requests never create duplicates.
7. **Archival, not purge.** Old partitions of high-volume tables are detached and exported (Parquet/CSV.gz) to the private `archive` bucket before any removal. Retention periods are app settings. See [08-quality-ops.md](08-quality-ops.md) §4.
8. **Backups:** Supabase daily backups + **PITR** add-on in production.

## 4. Tables

`PK` = primary key, `FK` = foreign key, `U` = unique. Standard columns (`created_at`, `updated_at`, `created_by`, `updated_by`, soft-delete columns, `version`) are implied for mutable tables and omitted below unless notable.

### 4.1 Identity & access

**profiles**: one row per auth user
| Column | Type | Notes |
|---|---|---|
| id | uuid PK, FK `auth.users(id)` | |
| role | app_role not null | immutable (see 02 §1) |
| status | account_status not null default `active` | |
| full_name | text not null | `CHECK (length(trim(full_name)) between 1 and 120)` |
| email | citext U (partial, where not null) | |
| phone | text U (partial) | E.164 |
| preferred_language | text default `'en'` | `CHECK in ('en','bn')` |
| avatar_path | text | storage path |
| suspended_reason | text | required when status = suspended |
| last_seen_at | timestamptz | |

**account_status_events** (append-only): `id bigint`, `profile_id`, `old_status`, `new_status`, `reason text not null`, `actor_id`, `actor_type`, `created_at`.

**permissions**: `code text PK` (e.g. `refunds.approve`), `module text`, `description text`, `is_high_impact boolean`.
**permission_templates**: `id`, `code text U`, `name`, `description`, `is_builtin boolean`.
**permission_template_items**: `template_id FK`, `permission_code FK`, PK (both).
**admin_template_assignments**: `admin_id FK profiles`, `template_id FK`, `assigned_by`, `reason`, `created_at`, PK (admin_id, template_id). Removal is a soft delete (`revoked_at`, `revoked_by`, `revoke_reason`) so history is kept.
**admin_permission_overrides**: `id`, `admin_id`, `permission_code`, `effect text CHECK in ('grant','deny')`, `reason`, `granted_by`, `revoked_at`, `revoked_by`. Partial U `(admin_id, permission_code) where revoked_at is null`.
**admin_effective_permissions** (view): `admin_id`, `permission_code`. Backed by an index on `admin_template_assignments(admin_id) where revoked_at is null`.
**admin_profiles**: `id PK FK profiles`, `title text`, `department text`, `mfa_enrolled_at`, `must_change_password boolean`, `last_login_at`, `last_login_ip inet`.

**admin_audit_logs** (append-only; not partitioned, since admin actions are low volume): `id bigint`, `admin_id`, `action text` (e.g. `driver.suspend`), `entity_type`, `entity_id uuid`, `before_data jsonb`, `after_data jsonb`, `reason text`, `ip inet`, `user_agent text`, `request_id text`, `created_at`. Index `(entity_type, entity_id, created_at desc)`, `(admin_id, created_at desc)`.

**pii_access_logs** (append-only): `id bigint`, `admin_id`, `subject_profile_id`, `field text` (`phone`, `email`, `licence_number`, `document:<id>`, `trip_route:<id>`…), `reason text`, `created_at`.

### 4.2 Drivers, documents & vehicles

**driver_profiles**
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid U FK profiles | role must be `driver` (trigger check) |
| onboarding_status | driver_onboarding_status | |
| availability | driver_availability default `offline` | |
| licence_number_enc | bytea | `pgcrypto` encrypted; key in Vault (`vault.secrets`) |
| licence_number_masked | text | e.g. `DK-*****-421` |
| licence_expiry | date | |
| verification_status | review_status | |
| current_vehicle_id | uuid FK vehicles | must belong to the driver and be `active` |
| home_zone_id | uuid FK service_zones | |
| rating_avg | numeric(3,2) | maintained by trigger on `ratings` |
| rating_count | int default 0 | |
| acceptance_rate_30d / cancellation_rate_30d | numeric(5,4) | refreshed by job |
| payout_method_status | text | `missing`, `pending`, `verified` |
| approved_at, approved_by | | |
| suspended_reason | text | |

Constraint: `CHECK (availability = 'offline' OR onboarding_status = 'approved')`.
Index: `(onboarding_status)`, `(availability) where availability <> 'offline'`.

**driver_status_events** (append-only, partitioned): `id bigint`, `driver_id`, `kind text CHECK in ('availability','onboarding')`, `old_status`, `new_status`, `reason`, `location geography(Point)`, `actor_id`, `actor_type`, `created_at`. This feeds the *online hours* KPI.

**driver_payout_accounts**: `id`, `driver_id`, `method text CHECK in ('bkash','nagad','bank')`, `account_ref_enc bytea`, `account_ref_masked`, `status review_status`, `is_default boolean`. Partial U `(driver_id) where is_default and deleted_at is null`.

**driver_documents**
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| driver_id | FK driver_profiles | |
| vehicle_id | FK vehicles, nullable | for vehicle documents |
| document_type | document_type | |
| storage_path | text not null | in the private `driver-documents` bucket; `CHECK (storage_path like 'drivers/%')` |
| file_sha256 | text | integrity and duplicate detection |
| document_number_masked | text | |
| issued_at, expires_at | date | `CHECK (expires_at is null or expires_at > issued_at)` |
| review_status | review_status default `pending` | |
| reviewer_id, reviewed_at, rejection_reason | | rejection_reason required when rejected |
| supersedes_id | FK driver_documents | re-uploads keep history |

Index `(review_status, created_at) where review_status='pending'`, `(expires_at) where review_status='approved'`.

**vehicle_categories**: `id`, `code text U` (`bike`, `car`, `cng`), `name`, `name_bn`, `description`, `passenger_capacity int CHECK > 0`, `icon text`, `sort_order int`, `active boolean`.

**vehicles**: `id`, `driver_id FK`, `category_id FK`, `make`, `model`, `color`, `registration_number text` (normalised upper-case, U partial where not deleted), `year int CHECK between 1990 and extract(year from now())+1`, `status vehicle_status`, `verified_at`, `verified_by`, `suspended_reason`.

### 4.3 Zones, pricing & location

**service_zones**: `id`, `name`, `code text U`, `boundary geography(MultiPolygon,4326) not null`, `timezone text default 'Asia/Dhaka'`, `active boolean`, `effective_from`, `effective_to`, `manual_surge_multiplier numeric(4,2) default 1.00 CHECK between 1 and 3`. GiST on `boundary`.

**fare_rules**: versioned and immutable once published
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| category_id | FK | |
| zone_id | FK nullable | null = default for the category |
| version | int | per (category, zone) |
| status | fare_rule_status | |
| base_fare, per_km, per_minute, minimum_fare, booking_fee, waiting_per_minute, cancellation_fee | numeric(12,2) ≥ 0 | |
| free_waiting_minutes | int default 3 | |
| platform_commission_pct | numeric(6,4) `CHECK between 0 and 0.5` | |
| max_surge_multiplier | numeric(4,2) default 1.00 | |
| commissionable_components | text[] default `{base,distance,time,waiting,surge}` | blueprint §6.1 |
| effective_from | timestamptz not null | |
| effective_to | timestamptz | |
| published_by, published_at, change_note | | |

Constraints: `EXCLUDE USING gist (category_id WITH =, coalesce(zone_id, '00000000-…') WITH =, tstzrange(effective_from, effective_to) WITH &&) WHERE (status in ('scheduled','active'))`, so two rules can never be live for the same window. Trigger: rows with status ≠ `draft` reject updates except `status → retired` and setting `effective_to`.

**fare_quotes**: `id`, `passenger_id`, `category_id`, `zone_id`, `fare_rule_id`, `pickup_point geography`, `pickup_label`, `destination_point`, `destination_label`, `estimated_distance_m int`, `estimated_duration_s int`, `surge_multiplier`, `breakdown jsonb`, `estimated_fare numeric(12,2)`, `pricing_rule_snapshot jsonb`, `expires_at` (now + 5 min). A quote can be used by at most one ride request (`ride_requests.quote_id` U).

**driver_live_locations** (current state, `fillfactor=70`): `driver_id PK FK`, `location geography(Point) not null`, `heading numeric(5,2)`, `speed_mps numeric(6,2)`, `accuracy_m numeric(7,2)`, `recorded_at timestamptz` (device time), `updated_at` (server time). GiST on `location`. Index `(updated_at)`. This is the one table with no change-log trigger (too hot). Its history lives in `trip_location_points` and `driver_status_events`.

**trip_location_points** (append-only, partitioned monthly): `id bigint`, `trip_id`, `actor_type`, `location geography(Point)`, `accuracy_m`, `speed_mps`, `recorded_at`. Index `(trip_id, recorded_at)`.

### 4.4 Ride requests, dispatch & trips

**ride_requests**
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| passenger_id | FK profiles | |
| quote_id | FK fare_quotes U | |
| category_id, zone_id | FK | |
| pickup_point, destination_point | geography(Point) | |
| pickup_label, destination_label, pickup_note | text | |
| estimated_distance_m, estimated_duration_s | int | |
| estimated_fare | numeric(12,2) | |
| quoted_rule_id | FK fare_rules | |
| payment_method | payment_method | |
| promotion_id | FK nullable | |
| status | ride_request_status | |
| dispatch_round | int default 0 | |
| requested_at, expires_at, matched_at, closed_at | timestamptz | |
| cancel_reason | text | |
| idempotency_key | text | U `(passenger_id, idempotency_key)` |

Partial U `(passenger_id) where status in ('requested','searching','matched')`: a passenger can have only one open request. Index `(status, requested_at) where status in ('requested','searching')`, GiST on `pickup_point`.

**ride_request_events** (append-only): `id bigint`, `request_id`, `from_status`, `to_status`, `actor_id`, `actor_type`, `reason`, `event_data jsonb`, `created_at`.

**dispatch_offers**: `id`, `request_id`, `driver_id`, `round int`, `rank int`, `pickup_distance_m int`, `pickup_eta_s int`, `offered_at`, `expires_at`, `response offer_response default 'pending'`, `responded_at`, `rejection_reason`.
- Partial U `(request_id) where response = 'pending'` (one live offer per request in sequential mode).
- Partial U `(driver_id) where response = 'pending'` (a driver sees one offer at a time).
- U `(request_id, driver_id, round)`.
- Trigger: `response` may change only from `pending`, and only once.

**trips**
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| request_id | FK U | one trip per request: **atomic assignment** |
| passenger_id, driver_id, vehicle_id | FK | |
| status | trip_status | |
| accepted_at, arriving_at, arrived_at, started_at, completed_at, cancelled_at | timestamptz | |
| actual_distance_m, actual_duration_s, waiting_s | int | |
| final_fare | numeric(12,2) | set only on completion |
| currency | char(3) | |
| payment_method | payment_method | |
| cancellation_reason, cancelled_by_actor | text / actor_type | |
| start_point, end_point | geography(Point) | |
| fare_rule_id | FK | |
| pricing_rule_snapshot | jsonb | |
| share_token_hash | text | for passenger trip sharing |

Partial U `(driver_id) where status in ('driver_assigned','driver_arriving','arrived','in_progress')`: a driver can't be on two active trips. Index `(status, created_at desc)`, `(passenger_id, created_at desc)`, `(driver_id, created_at desc)`, `(completed_at) where status='completed'`.

**trip_status_events** (append-only, partitioned): as in the blueprint (`from_status`, `to_status`, `actor_id`, `actor_type`, `reason`, `event_data jsonb`, `location geography`, `created_at`).

**trip_notes**: `id`, `trip_id`, `author_id`, `body text CHECK length ≤ 4000`, `visibility text CHECK in ('internal')`. Append-only, so edits create a new note.

### 4.5 Money

**trip_fare_breakdowns**: as in the blueprint, plus `commissionable_amount`, `platform_commission`, `driver_earning`, `promo_funded_by text CHECK in ('platform','driver')`. U `trip_id`. CHECK `total_amount = base_amount + distance_amount + time_amount + booking_fee + surge_amount + waiting_amount + cancellation_amount + tax_amount - discount_amount`. Frozen once the trip completes.

**payments**: as in the blueprint, plus `idempotency_key text U`, `collected_by_driver_id uuid` (cash), `reconciled_at`, `reconciled_by`, `reconciliation_batch_id`. U `(provider, provider_reference)` where not null. `amount > 0`.
**payment_events** (append-only): `id bigint`, `payment_id`, `from_status`, `to_status`, `source text CHECK in ('api','webhook','admin','system')`, `raw jsonb` (webhook body, PII-redacted), `created_at`.
**webhook_receipts**: `id`, `provider`, `event_id text`, `signature_valid boolean`, `payload_sha256`, `processed_at`, `error`. U `(provider, event_id)`.

**ledger_accounts**: `id`, `code text U` (e.g. `platform:commission_revenue`, `driver:<uuid>:wallet`), `owner_type text CHECK in ('platform','driver','passenger')`, `owner_id uuid`, `kind text CHECK in ('asset','liability','revenue','expense','clearing')`, `currency`, `status`.
**ledger_transactions**: `id uuid` (= transaction group), `kind text` (`trip_completion`, `incentive`, `refund`, `adjustment`, `payout`, `cash_deposit`, `reversal`), `trip_id`, `reference text`, `reverses_id FK ledger_transactions`, `memo`, `created_by`, `created_at`. U `(kind, reference)` makes postings idempotent.
**ledger_entries** (append-only, partitioned): `id bigint`, `transaction_id FK`, `account_id FK`, `debit numeric(12,2) default 0`, `credit numeric(12,2) default 0`, `currency`, `created_at`. `CHECK (debit >= 0 and credit >= 0 and (debit = 0) <> (credit = 0))`. A **deferred constraint trigger** verifies `sum(debit) = sum(credit)` per transaction at commit.
**ledger_account_balances**: `account_id PK`, `balance numeric(14,2)`, `debit_total`, `credit_total`, `last_entry_id`, `updated_at`. Maintained in the same transaction as each entry. A nightly job recomputes from entries and raises an alert on any difference.

**driver_earnings**: as in the blueprint, `payout_status earning_payout_status`, `payout_id FK nullable`. U `trip_id`.
**payout_batches**: `id`, `period_start`, `period_end`, `status`, `total_amount`, `created_by`, `approved_by` (`CHECK approved_by <> created_by`).
**payouts**: as in the blueprint, plus `batch_id`, `payout_account_id`, `idempotency_key U`, `approved_by`, `approved_at`.

**refunds_adjustments**: as in the blueprint, plus `kind adjustment_kind`, `target_account_id` (ledger adjustment), `direction text CHECK in ('debit','credit')`, `status approval_status`, `rejection_reason`, `ledger_transaction_id`. **`CHECK (approved_by is null or approved_by <> requested_by)`**. `amount > 0`. For refunds, an RPC check ensures the sum of refunds per payment never exceeds the payment amount.

**cash_deposits**: drivers settling cash dues with the platform. `id`, `driver_id`, `amount`, `method`, `reference`, `received_by`, `ledger_transaction_id`, `notes`.

### 4.6 Ratings, promotions, support & safety

**ratings**: as in the blueprint. `score smallint CHECK between 1 and 5`, `comment CHECK length ≤ 1000`, U `(trip_id, reviewer_id)`. Insert is allowed only for completed trips within 7 days (RPC). `hidden_at`, `hidden_by`, `hidden_reason` for moderation (soft hide, never delete).

**promotions**: as in the blueprint, plus `funded_by text`, `per_user_limit int`, `total_redemption_limit int`, `budget_spent numeric(12,2) default 0` (`CHECK budget_spent <= budget_limit`), `zone_ids uuid[]`, `category_ids uuid[]`, `min_fare numeric`, `new_users_only boolean`, `status text CHECK in ('draft','active','paused','ended')`.
**promotion_redemptions**: as in the blueprint, with `status redemption_status`. A redemption is **reserved** at request time (budget held, `UPDATE … SET budget_spent = budget_spent + x WHERE budget_spent + x <= budget_limit`), **applied** on completion, **released** on cancellation.

**support_tickets**: as in the blueprint, plus `requester_role app_role`, `channel text`, `sla_due_at`, `first_response_at`, `tags text[]`, `ticket_no bigint generated identity U` (human-friendly `#10234`).
**support_ticket_messages** (append-only): `id`, `ticket_id`, `author_id`, `author_type actor_type`, `body`, `is_internal boolean`, `attachments text[]` (storage paths), `created_at`.

**safety_incidents**: as in the blueprint, plus `incident_no bigint U`, `location geography`, `first_response_at`, `escalated_to text`, `resolution text`. SOS-created incidents default to `critical`.
**safety_incident_events** (append-only): status changes, notes and evidence uploads, with actor and timestamp.
**safety_evidence**: `id`, `incident_id`, `storage_path`, `sha256`, `uploaded_by`, `description`. Accessible only with `safety.view_evidence`, and every access is logged.

### 4.7 Platform & governance

**app_settings**: `key text PK`, `value jsonb`, `schema jsonb` (JSON-schema validation), `version int`, `updated_by`, `updated_at`. History via the change log. Example keys: `dispatch.offer_timeout_s` (15), `dispatch.search_radius_m` ([1500, 3000, 5000]), `dispatch.request_ttl_s` (180), `location.stale_after_s` (30), `cancellation.free_window_s` (120), `retention.trip_points_days` (365), `admin.idle_timeout_min` (30).
**feature_flags**: `key PK`, `enabled boolean`, `rules jsonb` (zone/category/percentage), `description`, `updated_by`.
**idempotency_keys**: `key text`, `scope text` (user id + route), `request_sha256`, `status_code int`, `response jsonb`, `created_at`, `locked_until`. PK `(scope, key)`. Rows older than 7 days are archived.
**notifications** (admin inbox): `id`, `recipient_id`, `kind`, `title`, `body`, `link`, `read_at`, `created_at`.
**saved_views**: `id`, `owner_id`, `page text`, `name`, `state jsonb` (filters, sort, columns), `is_shared boolean`.
**export_jobs**: `id`, `requested_by`, `kind`, `params jsonb`, `status`, `row_count`, `storage_path`, `expires_at`, `error`.
**kpi_15m / kpi_daily**: rollups keyed by `(bucket_start, zone_id, category_id)`: requests, matched, completed, cancelled by actor, median and p90 match seconds, gross bookings, platform revenue, discounts, incentives, contribution, online driver-seconds, active drivers, complaints, incidents.
**rate_limits**: `bucket text PK`, `tokens numeric`, `refilled_at`. Postgres token bucket used by `api.check_rate_limit` (swap for Redis if needed).

## 5. Row Level Security

- `alter table … enable row level security` and `force row level security` on **every** table in `public`. No policy means no access (default deny).
- `anon` has **no** grants on any table. Public reference data (active categories) is served through an RPC.
- Policy helpers (all `STABLE SECURITY DEFINER`, `search_path = ''`, in `private`): `current_role()`, `is_admin()` (role = admin, status = active, AAL2), `has_permission(p)`, `driver_id()`.

| Table group | passenger | driver | admin |
|---|---|---|---|
| profiles | own row (select) | own row (select) | `passengers.view` / `drivers.view` / `admins.view` by role of target; PII columns only through masked views |
| driver_profiles, vehicles, driver_documents | – | own rows (select) | `drivers.view` / `vehicles.view` / `documents.view` |
| fare_quotes, ride_requests | own | requests with a pending offer for this driver (limited view) | `trips.view` |
| trips, trip_status_events | own | own | `trips.view` |
| trip_location_points | own active trip only | own trips | `trips.view_location` |
| trip_fare_breakdowns, payments | own | own trips | `payments.view` |
| ledger_*, refunds_adjustments, payouts | – | own wallet balance and own payouts (via view) | `ledger.view` / `payouts.view` |
| support_tickets, messages | own (non-internal messages) | own | `support.view` |
| safety_incidents | own reports (status only) | own reports | `safety.view`; evidence: `safety.view_evidence` |
| admin_*, permissions, audit | – | – | `audit.view` / `admins.view` |

All writes go through `api.*` functions (`SECURITY DEFINER`, `search_path = ''`, fully schema-qualified). Each function starts with an explicit role/permission check and validates ownership. `EXECUTE` is granted per function to `authenticated` only and revoked from `public` and `anon`.

**PII masking:** admin lists read from views such as `v_admin_passengers` (`security_invoker = true`) that expose `phone_masked` (`+88017•••••421`). Raw values come only from `api.reveal_pii(subject, field, reason)`, which checks `*.view_pii` and writes `pii_access_logs`.

## 6. Storage buckets

| Bucket | Public | Contents | Access |
|---|---|---|---|
| `driver-documents` | no | `drivers/{driver_id}/{document_id}.{ext}` | Upload: the driver through a signed upload URL issued by the API (path fixed server-side, max 10 MB, `image/jpeg,png,webp,application/pdf`). Read: admins with `documents.view` through a 60 s signed URL from `api.document_signed_url` (logged) |
| `avatars` | no | profile photos | Owner + admins; 1 MB; images only |
| `support-attachments` | no | ticket attachments | Ticket participants + `support.view` |
| `safety-evidence` | no | incident evidence | `safety.view_evidence` only, logged |
| `exports` | no | generated CSVs | The requesting admin, signed URL, objects expire after 7 days |
| `archive` | no | detached partitions | Service role only |

Storage RLS policies on `storage.objects` mirror these rules. Uploaded files are checked server-side by magic bytes, not by extension.

## 7. Index & partition checklist
- Every FK column is indexed.
- Every RLS predicate column is indexed (`passenger_id`, `driver_id`, `admin_id`, `owner_id`).
- Trigram GIN on `profiles.full_name`, `profiles.phone`, `vehicles.registration_number`, `support_tickets.subject` for the global search.
- Monthly partitions are created 3 months ahead by `pg_cron` (`private.ensure_partitions()` runs daily). Default partitions catch stragglers, and an alert fires if one receives rows.
