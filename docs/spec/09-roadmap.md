# 09 · Roadmap, Exit Criteria & Open Decisions

Mapped onto the blueprint's delivery phases (§9). Mobile UI is excluded. Each milestone ships the backend and the admin screens for its scope.

## 1. Milestones

### M0: Foundation (week 1–2)
- Next.js app scaffold, design system (tokens, shell, DataTable, forms, ReasonDialog, StatusBadge, Timeline), i18n, theming.
- Supabase: extensions, enums, conventions, `profiles`, permissions tables, change log, append-only guards, soft-delete guards, RLS helpers, Custom Access Token Hook, bootstrap super admin migration.
- Auth: login, MFA enrolment and challenge, forced password change, idle timeout, proxy gates, security headers and CSP.
- Admins module: list, invite, permission editor with all guardrails, templates, audit log viewer.
- CI pipeline (lint, types, pgTAP, Playwright smoke, gitleaks).

**Exit:** super admin can sign in with MFA, invite an Operations admin, edit their permissions, and see every action in the audit log. RLS test matrix is green. Role is immutable (tests prove it).

### M1: Supply onboarding (week 3–4)
- Categories, zones (map editor), drivers, documents (review viewer), vehicles, passengers (list/detail, PII masking and reveal), document expiry job.
- Driver and onboarding APIs (`/onboarding/*`, `/driver/documents/*`, `/driver/vehicles`, `/driver/application/submit`), storage buckets and policies.

**Exit:** only approved drivers with active vehicles can go online. Unauthorised data access is tested (blueprint Phase 1 exit criterion).

### M2: Pricing & ride lifecycle (week 5–7)
- Fare rules (versioning, simulator, publish), quotes, ride requests, dispatch (candidates, offers, tick), trip state machine, cancellations, location ingest, realtime channels.
- Admin: live operations map, requests, trips (detail with timeline, map, breakdown), dispatch intervention.
- Load tests for location, candidates and accept.

**Exit:** an end-to-end test ride (scripted API client acting as passenger and driver) works with retries and race-condition tests. 50-way accept race → exactly one trip (blueprint Phase 2 exit criterion).

### M3: Money & support (week 8–10)
- Fare breakdowns, cash payments, ledger and balances, driver earnings, cash deposits and reconciliation, refunds and adjustments (maker-checker), payouts, promotions (budget reservation), ratings, support tickets, safety incidents and SOS.
- Admin: payments, ledger, refunds, payouts, promotions, support inbox, safety queue.

**Exit:** reconciliation and reversal flows are tested. Nightly ledger verification is green. Nothing allows a silent financial edit (blueprint Phase 3 exit criterion).

### M4: Insight & pilot readiness (week 11–12)
- KPI rollups, dashboard, analytics pages, async exports, alerts, settings and feature flags UI, retention and archival jobs.
- Security hardening: Security Advisor clean, ZAP, external pen test, restore drill, runbooks (SOS, payout failure, outage).

**Exit:** KPI definitions are verified against hand-computed fixtures with no double counting (blueprint launch checklist "Analytics"). Pre-launch security checklist ([07-security.md](07-security.md) §7) is complete.

### Later (post-pilot)
Digital payments (bKash/Nagad/card) with webhooks, a payout-provider API, batch/broadcast dispatch, corporate accounts and subscriptions, a dedicated dispatch/location worker, the mobile apps and the passenger web booking flow. Each needs an outside account or a product decision first: see [docs/integrations](../integrations/README.md).

## 2. Definition of done (every feature)
- RPC with permission check, validation, audit and events, plus pgTAP tests (positive and negative per role).
- Server Action / Route Handler with Zod, error mapping and idempotency where it mutates.
- UI with loading, empty, error and permission-hidden states, keyboard access, en and bn strings, dark mode.
- Playwright test for the main path. Query plans reviewed for list pages.
- Docs: this spec updated if behaviour differs.

## 3. Decisions to lock (blueprint Appendix B)

The defaults below are in the spec and work without an answer. Business owners should confirm or change them before the pilot.

| # | Decision | Spec default |
|---|---|---|
| D1 | Initial city/zone and vehicle category | Dhaka pilot zone (polygon drawn in admin) · Bike |
| D2 | Commission % and commissionable components | 15% · base + distance + time + waiting + surge (booking fee 100% platform) |
| D3 | Fare components | base, per km, per min, minimum, booking fee, waiting/min after 3 free min, cancellation fee. Tolls and tips not in v1. Tax off (configurable) |
| D4 | Driver eligibility, review, suspension, appeals | Required documents per [04](04-business-logic.md) §1. Appeals via a support ticket category `appeal` |
| D5 | Cash collection & reconciliation | Driver collects cash. Platform share accrues as driver dues and is settled by deposit or payout netting. Finance owns daily reconciliation |
| D6 | Digital payment provider | Deferred (cash only at pilot) |
| D7 | Cancellation rules & no-driver behaviour | Per [04](04-business-logic.md) §7. Request TTL 180 s, radii 1.5 / 3 / 5 km, offer timeout 15 s |
| D8 | Location update frequency, retention, access | Online 1 point / 4 s, on trip 1 point / 2 s (batched). Trail retention 12 months online. `trips.view_location` required |
| D9 | Payout frequency, minimum, failure process | Weekly (Monday), minimum ৳500, failed → reversal to wallet + ticket |
| D10 | Pilot targets & escalation owners | Blueprint §7.2 targets as dashboard thresholds. Owners to be named |
| D11 | Meaning of the `user` role | See README assumption A1 |
| D12 | Bootstrap super admin on yopmail | Replace with a company-domain super admin before go-live ([07](07-security.md) §2.4) |

## 4. Implementation status

- **M0 to M4 are implemented and verified** (pgTAP 606 assertions, 87 unit tests, 13 Playwright tests).
- **M2 deviations from the text above:**
  - Ride requests also carry the terminal statuses `completed` and `cancelled_by_driver`, mirroring the trip.
  - A passenger or driver cannot cancel a trip that is `in_progress`; only an admin (`trips.cancel`) or the system can.
  - Completion computes and freezes the fare breakdown only. Payments, ledger and driver earnings belong to M3, as do cancellation-fee receivables.
  - Promo discounts are always 0 until M3. The Barikoi routing provider is a stub that falls back to the estimate provider with a warning.
  - Realtime channels `ride:`, `driver:` and `ops:live` are live (private, authorised through `realtime.messages` policies).
  - Lock order everywhere is request → offers → trip → driver. `transition_trip` is the only writer of trip status.
  - The dispatch candidate query is geo-first (materialised GiST filter): 8 ms at a 1.5 km ring and 14 ms at 5 km with 10,000 online drivers (`tests/load/bench-candidates.sql`; budget 20 ms).
  - Not yet done: the k6 load script and push notifications.

- **M3 notes and deviations:**
  - Money: double-entry ledger (`private.post_transaction` is the only writer; a deferred constraint trigger rejects unbalanced postings; entries and transactions are append-only; `ledger_account_balances` is checked against the entries nightly and on demand). Settlement runs inside `complete_trip`: payment, driver earning and the ledger posting commit together. Non-commissionable fare items pass through to the driver; the booking fee is platform revenue.
  - Cash only (payments.enabled_methods). Digital payments, gateway clearing postings and webhooks stay post-pilot. Cancellation fees post a passenger receivable; collecting it on the next ride is not built.
  - Maker-checker on refunds, ledger adjustments and reversals, and on payout batches: the requester can never approve (also a CHECK), and amounts at or above `finance.dual_approval_threshold` need two distinct approvers.
  - Promotions: budget reserved atomically when a code is applied to an open request (`POST /rides/{id}/promo`), settled to the real discount at completion, released by a one-minute job when the ride does not happen. The platform funds the discount (`promo_funded_by = platform` only).
  - Ratings, support tickets (SLA targets, auto-close, internal notes) and safety incidents with SOS are in. SOS pushes a banner and optional sound in the admin (polling every 5 s); SMS/email/push to on-call staff and evidence uploads (`safety_evidence`, storage bucket) are not built.
  - Payout accounts are stored encrypted and shown masked; payouts are marked paid manually with the provider reference (no provider API yet).
  - Partitioning of `ledger_entries` is deferred (plain table with the right indexes).
  - Admin: payments (cash dues, deposits, reconciliation), ledger (accounts, transactions, reversal requests, verification), refunds queue, payouts, promotions with ROI, support inbox, ratings moderation, safety queue; the trip page gains a Money card.
  - Fixes found along the way: relative times no longer cause hydration errors, and `DataTable` no longer remounts cells (and closes dialogs) when the page refreshes.

- **M4 notes and deviations:**
  - KPI rollups (`kpi_rollups`, 15-minute and day grains) are recomputed from the source tables, never incremented, so a rerun cannot double count. Funnel figures belong to the day the request was made; money and ride figures to the day the trip completed. Tests compare every rollup figure with an independent computation and check that 15-minute buckets add up to the day.
  - Medians and P90 for match time are computed straight from the requests (they cannot be averaged across buckets). The "online drivers vs open requests" chart shows requests and matches per 15 minutes plus the current online count: historical online driver-seconds are not recorded yet.
  - Dashboard (KPI cards with delta and sparkline, funnel, cancellations, zone health, attention panel) and the five analytics pages exist, each metric with a "?" definition popover.
  - Exports are rows in `export_jobs` (7-day expiry; the job then moves the CSV into the private `exports` bucket, see the staging batch below); the content column is not selectable by clients and is released only by a logged download function. Cells that begin with = + - @ are neutralised; no phone numbers, emails or document data are ever exported. Small exports finish immediately, larger ones are picked up by a one-minute job; exports of 10,000 rows or more alert the people who watch the audit log.
  - Alerts (`ops_alerts`, evaluated every minute): low match rate and no supply per zone, unacknowledged SOS, reconciliation variance, failed ledger verification, payout failure rate, dispatch loop stalled. Each fires once while it holds and clears by itself.
  - Settings carry a JSON validation schema per key (type, range, units); changes need a reason, are versioned, optimistic-locked and audited, with a history view. Feature flags support on/off plus zone and percentage rules and are exposed to apps through `GET /api/v1/config`. The flags themselves do not change behaviour yet.
  - Retention: old partitions of `trip_location_points` and `audit.change_log` are verified (row count and checksum), logged in `archive_runs`, detached and moved to the private `archive` schema; nothing is purged. (Exporting them to object storage was added in the staging batch below.) Unused expired quotes are purged hourly.
  - Security: `security_posture.test.sql` checks the pre-launch checklist against the catalogs. The ZAP scan, the external penetration test, the Supabase Advisor run and PITR need a deployed environment and are listed with owners in `docs/runbooks/release-checklist.md`. Runbooks for SOS, payout failure, outage and the restore drill are in `docs/runbooks/`.

- **Follow-ups built after M4** (items first listed as "not built"):
  - Cancellation fees owed by a passenger are collected with their next fare: the payment is the fare plus the fee (`payments.fee_collected`), the driver's cash dues include it, and the passenger wallet debt is cleared in the same ledger posting. `GET /api/v1/wallet` shows the amount owed.
  - Online time is rolled up from the driver status history (`kpi_online`, 15-minute and day grains, recomputed not incremented) and shown on the dashboard as drivers online and on a trip per 15 minutes.
  - Feature flags now act: `promo_codes` gates applying a promotion; `pickup_pin` makes the driver enter the passenger's 4-digit PIN to start the trip (`GET /rides/{id}/pin`, `POST /rides/{id}/pin/renew`, `pin` on `POST /driver/trips/{id}/start`; five wrong guesses lock it until the passenger renews). `digital_payments` stays inert until that feature exists; `auto_surge` was built in the staging batch below.
  - Notification outbox: SOS and critical alerts queue email, SMS and push for everyone holding the permission (only where an address or device exists), deduplicated. A worker (`POST /api/internal/jobs/notify`, bearer secret plus optional IP allow-list, also run right after an SOS) claims messages with row locks, sends through plain-HTTPS providers (email: Resend or Mailpit; SMS: Twilio; push: a relay webhook; "log" by default) and retries with back-off for five attempts. Devices register with `PUT /api/v1/me/devices`. Settings → Delivery shows counts and failures. A direct FCM/APNs adapter is not included: point `PUSH_WEBHOOK_URL` at a small relay.
  - SOS evidence: private `safety-evidence` bucket, signed upload by the reporter or a safety manager, server-side type check (magic bytes) and SHA-256, append-only records, 30 files per incident. Listing needs `safety.view`; opening a file needs `safety.view_evidence`, is written to the access log and returns a 60-second link. Reporters use `POST /api/v1/incidents/{id}/evidence/upload-url` and `/complete`.
  - k6 scripts for location ingest, the accept race and the full ride flow are in `tests/load/k6/`.
  - Still not built: digital payments with webhooks (bKash, Nagad, card), a payout-provider API (payouts are marked paid by hand), and the mobile and passenger-web apps. Each is described in [docs/integrations](../integrations/README.md) with what we need from outside to finish it.

- **Staging batch (everything else that could be built without an outside party)** (staging only: no production configuration or release work was done in this batch):
  - Account deletion: `POST /me/deactivate` deactivates at once (signed out, sign-in blocked, devices removed, refused while a ride is active or money is owed), then a daily job anonymises personal details after `privacy.anonymise_after_days` (30). Financial, safety and audit records stay and point at the anonymised profile; driver document files are queued for removal from Storage. Staff see requests in Privacy and can restore one during the grace period (audited, reason required).
  - Admin tables: saved views per page (private or shared, up to 50 each), density toggle, column visibility, and bulk "Assign N to me" on support tickets (`api.assign_tickets`, up to 100, each assignment audited).
  - Automatic surge behind the `auto_surge` flag: every minute, per zone and vehicle type, demand (open requests in the last 5 minutes) against supply (idle online drivers) moves a multiplier one step at a time (`surge.auto_*` settings); quotes use the higher of manual and automatic surge, never above the fare rule's cap, and freeze it. The dashboard shows where surge is active.
  - Files in Storage: finished exports move to the private `exports` bucket and are served only through the logged download route; archived partitions are exported as gzip NDJSON to the private `archive` bucket with a SHA-256 recorded in `archive_runs` (Settings shows the status). Worker RPCs are service-role only.
  - One endpoint, `POST /api/internal/jobs/notify`, now runs the message worker, file clean-up, export upload and archive export; call it every minute ([scheduler guide](../integrations/scheduler.md)).
  - Tests: `supabase/tests/m6.test.sql` (58 assertions) covers deletion, restore, anonymisation, the Storage worker permissions, saved views and surge.


- **Staff create / update / delete** (migration `20261110090000_m7_admin_crud.sql`, tests `supabase/tests/admin_crud.test.sql` and `tests/e2e/m7-admin-crud.spec.ts`):
  - New permissions `passengers.create`, `passengers.delete`, `drivers.create`, `drivers.delete`, `documents.manage`, `trips.create`, `alerts.manage` (super admin holds them all).
  - Create: passenger and driver accounts (the server creates the sign-in identity, the database gives it its role as the admin), vehicles, documents uploaded for a driver (`POST /api/admin/documents`), rides booked for a passenger, trips by assigning a chosen online driver, manual alerts, cash recorded as collected.
  - "Create on behalf" calls the same function the passenger or driver app calls, acting as that person for the one call, so pricing, dispatch, state machines and the ledger are never skipped; the admin is written to the audit log and `ride_requests.booked_by`.
  - Update: contact name and phone, vehicle details, document dates, pickup note while searching, the amount of your own pending refund or adjustment.
  - Delete never erases history: accounts are deactivated (restorable for 30 days, then anonymised), vehicles retired, documents withdrawn, requests and trips cancelled, alerts resolved; payments, ledger, refunds and payouts are corrected with refunds, adjustments, reversals and cancelled batches, which already existed.
