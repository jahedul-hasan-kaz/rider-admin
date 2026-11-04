# 04 · Business Logic

All logic in this document runs **server-side inside `api.*` / `private.*` Postgres functions**, in one transaction per command. Clients can never move a state directly (blueprint §1.3, §4.3, §8.1).

## 1. Driver onboarding

```
draft ──submit──▶ submitted ──review starts──▶ under_review ──▶ approved ──▶ suspended ──reactivate──▶ approved
                                                   └──▶ rejected ──resubmit──▶ submitted
```
- **Submit** (`api.driver_submit_application`): requires a profile photo, national ID, driving licence, and at least one vehicle with registration, fitness, tax token and insurance documents (the required set is configurable in `app_settings.onboarding.required_documents`).
- **Document review** (`api.review_driver_document`, `documents.review`): approve, or reject with a mandatory reason. A rejection notifies the driver, who re-uploads; the new row `supersedes_id` the old one.
- **Approve driver** (`api.approve_driver`, `drivers.approve`): allowed only when every required document is `approved` and unexpired and the vehicle is `active`. Sets `approved_at/by` and writes `driver_status_events`.
- **Document expiry job** (daily, 06:00 Asia/Dhaka): documents expiring in ≤ 30 days → driver and admin notifications. Expired → `review_status = expired`. If a required document expired, the driver is forced `offline` and moved to `suspended` with reason `DOCUMENT_EXPIRED`. Shown in the admin "Expiring documents" view.
- **Suspend/reactivate** (`drivers.suspend`): reason required. Suspension forces the driver offline and is blocked while they are on an active trip, unless `trips.resolve` is also held (safety override).

## 2. Driver availability

- `api.driver_set_availability(online bool)`: going online requires `onboarding_status = approved`, profile `active`, `current_vehicle_id` active, a vehicle category active in the current zone, and a fresh location (< `location.stale_after_s`). Writes `driver_status_events` (the source for online hours).
- **Stale guard (job, every 30 s):** online drivers whose location is older than 120 s are set `offline` with reason `LOCATION_STALE`.
- `on_trip` is set and cleared only by trip transitions.

## 3. Fare quote

`api.create_quote(pickup, destination, category_id)`, called by the API after it gets route distance and duration from the `RoutingProvider`:

1. Resolve the zone: `ST_Covers(boundary, pickup)` over active zones. No zone → `OUT_OF_SERVICE_AREA`.
2. Pick the active fare rule for (category, zone) at `now()`, falling back to the category default rule. None → `PRICING_UNAVAILABLE`.
3. Surge multiplier: `least(zone.manual_surge_multiplier, rule.max_surge_multiplier)` (v1 is manual surge only; automatic demand surge is a later feature flag).
4. Compute with **numeric arithmetic in SQL**, rounding each component to 2 dp and the total to the nearest whole taka (`round(x, 0)`, configurable):

```
distance_amount = per_km      × distance_km
time_amount     = per_minute  × duration_min
subtotal        = base_fare + distance_amount + time_amount
surge_amount    = subtotal × (surge − 1)
fare_before_discount = max(minimum_fare, subtotal + surge_amount) + booking_fee
discount        = promo (validated, capped by max_discount)            -- §8
passenger_payable = fare_before_discount − discount (+ tax if configured)
commissionable  = sum(components listed in rule.commissionable_components)
platform_commission = round(commissionable × commission_pct, 2)
driver_earning  = commissionable − platform_commission (+ incentives later)
```
5. Store `fare_quotes` with `breakdown` and the full `pricing_rule_snapshot`. TTL 5 minutes.

The blueprint's worked example (§6.2) becomes a **golden test**: fare 200, platform-funded discount 10, commission 15% → passenger pays 190, commission 30, driver 170, platform contribution after 5 payment cost and 5 incentive = 10.

## 4. Ride request & dispatch

### 4.1 Request
`api.create_ride_request(quote_id, payment_method, promo_code?, pickup_note?, idempotency_key)`:
- The quote must be unexpired and owned by the caller, and the passenger must have no other open request (partial unique index).
- Reserve the promotion if any (§8). Insert `ride_requests(status='searching', expires_at = now() + request_ttl)`. Write the event. Call `private.dispatch_next(request_id)` in the same transaction so the first offer goes out immediately.

### 4.2 Candidate selection: `private.find_candidates(request_id, radius_m)`
```sql
select d.id, ST_Distance(l.location, r.pickup_point) as dist
from driver_live_locations l
join driver_profiles d on d.id = l.driver_id
join vehicles v on v.id = d.current_vehicle_id
where d.availability = 'online'
  and d.onboarding_status = 'approved'
  and v.status = 'active' and v.category_id = r.category_id
  and l.updated_at > now() - make_interval(secs => stale_after_s)
  and ST_DWithin(l.location, r.pickup_point, radius_m)
  and not exists (select 1 from dispatch_offers o where o.request_id = r.id and o.driver_id = d.id)
  and not exists (select 1 from dispatch_offers o where o.driver_id = d.id and o.response = 'pending')
order by dist, d.acceptance_rate_30d desc nulls last
limit 10
for update of d skip locked;
```
Ranking v1: straight-line distance, then acceptance rate. ETA comes from distance ÷ average zone speed (setting). The ranking function is isolated so it can later use routed ETA.

### 4.3 Offer loop (sequential offers)
- `dispatch_next`: pick the top candidate and insert `dispatch_offers(response='pending', expires_at = now() + offer_timeout_s)`, then broadcast on `driver:{driver_id}`. No candidate in the current radius → widen the radius (`search_radius_m` steps) and increment `dispatch_round`. All radii exhausted, or `expires_at` passed → `no_driver_found`, release the promo, notify the passenger.
- **Accept** (`api.accept_offer(offer_id)`):
  1. `SELECT … FOR UPDATE` on the offer and its ride request.
  2. Require offer `pending` and unexpired, request `searching`, caller = offer driver, driver `online` with no active trip.
  3. Offer → `accepted`. Request → `matched`. Insert `trips(status='driver_assigned')` (the unique `request_id` makes double assignment impossible even if a lock were bypassed). Driver → `on_trip`. Events + broadcasts.
  4. Any failed check → `OFFER_NO_LONGER_AVAILABLE` (HTTP 409).
- **Reject** → `rejected` with reason, then `dispatch_next`.
- **Expiry:** `private.dispatch_tick()` runs via pg_cron **every 5 seconds**. It expires pending offers past `expires_at` (`FOR UPDATE SKIP LOCKED`, batch 100), calls `dispatch_next` for their requests, and expires requests past TTL. It is idempotent and safe to run concurrently.

### 4.4 Admin intervention (`dispatch.intervene`)
Re-dispatch (withdraw the current offer and continue), expire a request, or force a driver offline. Every one needs a reason and is audited.

## 5. Trip state machine

```
driver_assigned → driver_arriving → arrived → in_progress → completed
       │                │              │            │
       └────────────────┴──────────────┴────────────┴──→ cancelled_by_passenger | cancelled_by_driver | cancelled_by_admin | failed
```

| Transition | Who | Guard |
|---|---|---|
| driver_assigned → driver_arriving | driver | automatic on accept, or explicit "start navigation" |
| → arrived | driver | driver location within `arrival_radius_m` (default 150 m) of pickup, or an override flag that is logged and visible to admins |
| arrived → in_progress | driver | optional passenger PIN (feature flag). Sets `started_at`, starts `trip_location_points` sampling |
| in_progress → completed | driver | computes the final fare (§6), creates breakdown, payment, earnings and ledger in one transaction |
| any active → cancelled_by_passenger | passenger | cancellation fee rules (§7) |
| driver_assigned / arriving / arrived → cancelled_by_driver | driver | reason required. Counts toward the driver cancellation rate |
| any active → cancelled_by_admin | admin `trips.cancel` | reason required |
| any active → failed | system / admin `trips.resolve` | e.g. driver offline > 10 min during a trip (alert first) |

`private.transition_trip(trip_id, to_status, actor, reason, data)` is the **single** function that changes `trips.status`. It holds the transition table, validates it, sets timestamps, writes `trip_status_events`, updates driver availability and broadcasts. A `BEFORE UPDATE` trigger on `trips` rejects status changes not made through it (checks a transaction-local flag).

## 6. Trip completion & final fare

`api.complete_trip(trip_id, idempotency_key)`:
1. Lock the trip. Require `in_progress` and caller = driver.
2. `actual_distance_m` = the sum of `ST_Distance` between consecutive accepted `trip_location_points` (points with accuracy > 50 m or implied speed > 120 km/h are dropped). If the points are insufficient (< 3, or coverage gaps > 50%), fall back to the routed distance between start and end and set `event_data.distance_source = 'fallback'`, which flags the trip for review.
3. `actual_duration_s` = `completed_at − started_at`. Waiting = `started_at − arrived_at − free_waiting`.
4. Re-price with the **trip's snapshot rule**, not the current one. **Variance guard:** if the final fare exceeds the estimate by more than 30% (setting), keep the computed fare but flag `fare_review_required` for support, and show it in the admin exceptions queue.
5. Insert `trip_fare_breakdowns`, apply the promotion redemption, insert `payments` (cash: `status = pending` until the driver confirms collection; digital: provider flow), `driver_earnings`, and the **ledger postings** (§9).
6. Driver → `online` (or `offline` if they asked to go offline after the trip).

`api.confirm_cash_collected(trip_id, amount)` → payment `succeeded`, `collected_by_driver_id` set. A mismatch with `passenger_payable` creates a support ticket automatically.

## 7. Cancellation policy (defaults, configurable)

| Scenario | Fee | Who gets it |
|---|---|---|
| Passenger cancels while `searching`, or within `free_window_s` (120 s) of assignment | 0 | – |
| Passenger cancels after the free window, or after driver `arrived` | `cancellation_fee` from the rule | Driver (minus commission), recorded as a receivable on the passenger account. Collected on the next ride |
| Driver doesn't arrive within `max(ETA×2, 10 min)` and the passenger cancels | 0 | – |
| Driver cancels | 0 to passenger | Counts toward the driver's cancellation rate. Repeated cancellations → ops alert |
| Passenger no-show (driver waited ≥ `no_show_wait_min` after `arrived`) | `cancellation_fee` | Driver |
| Admin cancels | 0 unless admin sets otherwise (`trips.resolve`) | – |

Fees are waivable by support through a refund or adjustment (never by editing the trip).

## 8. Promotions

- Validation at quote/request time: active, inside the date window, zone and category match, `min_fare`, `new_users_only`, `per_user_limit`, `total_redemption_limit`, budget remaining.
- **Budget reservation** is atomic (conditional `UPDATE … WHERE budget_spent + x <= budget_limit`). Applied on completion with the actual discount (≤ reserved). Released on cancellation or no driver.
- The ROI view per campaign shows redemptions, discount spend, rides, contribution after promo, and new-passenger count.

## 9. Ledger postings (double entry)

Accounts: `platform:commission_revenue` (revenue), `platform:promo_expense`, `platform:incentive_expense`, `platform:payment_fees` (expense), `platform:gateway_clearing`, `platform:cash_on_hand`, `platform:payouts_clearing` (asset/clearing), `driver:{id}:wallet` (liability: a positive balance means the platform owes the driver), `passenger:{id}:wallet` (liability: credits and refunds; a negative balance means the passenger owes cancellation fees).

| Event | Debit | Credit |
|---|---|---|
| Cash trip completed (fare 200, platform promo 10, commission 30, passenger pays 190 cash) | `driver:wallet` 190 (cash the driver holds for the platform) · `platform:promo_expense` 10 | `driver:wallet` 170 (earning) · `platform:commission_revenue` 30 |
| Digital trip completed (same numbers) | `platform:gateway_clearing` 190 · `platform:promo_expense` 10 | `driver:wallet` 170 · `platform:commission_revenue` 30 |
| Gateway settlement received (fee 5) | `platform:cash_on_hand` 185 · `platform:payment_fees` 5 | `platform:gateway_clearing` 190 |
| Driver incentive | `platform:incentive_expense` | `driver:wallet` |
| Driver deposits cash dues | `platform:cash_on_hand` | `driver:wallet` |
| Payout approved / paid | `driver:wallet` → `platform:payouts_clearing`; on paid: `platform:payouts_clearing` → `platform:cash_on_hand` | |
| Refund to passenger wallet | `platform:promo_expense` or the configured refund expense | `passenger:wallet` |
| Correction | A `reversal` transaction mirroring the original, then a new correct transaction | |

Rules: `private.post_transaction(kind, reference, lines[])` is the only writer. It enforces balance, currency consistency and idempotency (`U(kind, reference)`), and updates `ledger_account_balances`. The cash example nets the driver wallet to −20 (the driver owes the platform 20), which matches the blueprint's illustration.

## 10. Refunds & adjustments (maker–checker)

1. **Request** (`refunds.request` / `ledger.adjust_request`): amount, reason (required), linked trip/payment, evidence notes. Status `requested`. Notifies approvers.
2. **Approve or reject** (`refunds.approve` / `ledger.adjust_approve`): a different admin (DB CHECK). Approval posts the ledger transaction and, for digital payments, calls the provider refund API through a background job with its own idempotency key. Status → `processed` or `failed` (retryable).
3. Thresholds: amounts above `finance.dual_approval_threshold` (setting) need **two** distinct approvers.

## 11. Payouts

- Weekly (setting) job builds a `payout_batch` in `pending` for drivers whose `wallet` balance ≥ `payouts.minimum_amount` and who have a verified payout account. Drivers with negative balances (cash dues) are excluded and listed on a "Dues" report.
- Finance reviews, then approves (≠ creator) → `processing` → marked `paid` (manual reference v1; provider API later) or `failed` with a reason (funds return to the wallet through a reversal).
- KPI: payout on-time rate (target 98%).

## 12. Ratings
After completion, both sides may rate within 7 days. Ratings update `driver_profiles.rating_avg` incrementally. A score of 1–2 with a comment auto-creates a low-priority support ticket. Admins can hide abusive comments (soft hide, with reason).

## 13. Support & safety

- **Tickets:** created by users (API) or admins. SLA from priority (urgent 1 h, high 4 h, normal 24 h, low 72 h). Statuses `open → in_progress → pending_user → resolved → closed` (auto-close 7 days after resolved). Internal notes are never visible to users.
- **SOS** (`POST /api/v1/trips/{id}/sos`): creates a `critical` safety incident with the latest location. It broadcasts on `ops:safety` with an audible alert in the admin panel, and notifies on-call admins by email/SMS (provider). The KPI clock starts at `reported_at` and stops at the first `acknowledged` event.
- **Incident workflow:** `reported → acknowledged → investigating → (escalated) → resolved → closed`, with mandatory notes on each transition. Evidence access is logged.

## 14. Scheduled jobs (pg_cron unless noted)

| Job | Schedule | Function |
|---|---|---|
| Dispatch tick | every 5 s | `private.dispatch_tick()` |
| Stale driver guard | every 30 s | `private.offline_stale_drivers()` |
| KPI 15-min rollup | every 5 min | `private.rollup_kpi_15m()` (recompute last 2 buckets) |
| KPI daily rollup | 00:15 daily | `private.rollup_kpi_daily()` |
| Document expiry | 06:00 daily | `private.process_document_expiry()` |
| Driver 30-day rates | hourly | `private.refresh_driver_rates()` |
| Ledger balance verification | 02:00 daily | `private.verify_ledger_balances()` → alert on drift |
| Payment reconciliation report | 03:00 daily | expected vs confirmed by method |
| Payout batch creation | Mon 09:00 | `private.create_payout_batch()` |
| Partitions maintenance | daily | `private.ensure_partitions()` |
| Archive old partitions | monthly | export → `archive` bucket → detach (Next.js job, needs storage) |
| Idempotency / quotes cleanup | hourly | archive expired rows |
| Ticket auto-close and SLA breach alerts | every 10 min | |

Jobs that call external services (email, SMS, push, payment provider, storage export) run as authenticated Next.js Route Handlers under `/api/internal/jobs/*`, triggered by the host's cron (or by `pg_net` from pg_cron). They are protected by a bearer secret plus an IP allow-list and are idempotent.

## Implementation addenda (as built)

- **Trip completion (§6)** posts payment, driver earning and ledger entries in the same transaction as the fare breakdown. Non-commissionable fare items pass through to the driver; the booking fee is platform revenue. Digital payments are not enabled (cash only).
- **Cancellation fees (§7)** post a receivable on the passenger wallet and credit the driver minus commission. The passenger's next fare collects the amount owed: the payment is the fare plus `fee_collected`, and the same ledger posting clears the wallet debt. A passenger or driver cannot cancel a trip that is in progress (admin or system only).
- **Pickup PIN (§5)** is behind the `pickup_pin` flag: every trip gets a 4-digit PIN at assignment, and when the flag applies the driver must supply it to start; five wrong guesses lock it until the passenger renews it.
- **Promotions (§8)** are behind the `promo_codes` flag. The reservation is released by a one-minute job when a request ends without a completed ride.
- **Lock order** everywhere is request, offers, trip, driver. `transition_trip` is the only writer of trip status.
- **Jobs (§14)**: the notification worker is `POST /api/internal/jobs/notify` (bearer secret, optional IP allow-list); alerts, exports, rollups, archival and cleanup run in `pg_cron` (see the migrations for schedules).
