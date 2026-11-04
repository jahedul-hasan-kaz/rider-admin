# 05 · API

Two server surfaces:

1. **Admin:** Server Components (reads) and **Server Actions** (mutations) under `src/server/actions/*`. They are not a public API. Each action is the thin wrapper described in [01-architecture.md](01-architecture.md) §3.1.
2. **Mobile/public REST API:** `/api/v1/*` Route Handlers for the passenger and driver apps (to be built later), plus `/api/webhooks/*` and `/api/internal/jobs/*`.

## 1. Conventions (REST)

| Topic | Rule |
|---|---|
| Base path | `/api/v1`. Breaking changes → `/api/v2`. `Sunset` header on deprecated routes |
| Auth | `Authorization: Bearer <Supabase access token>`. Verified with `supabase.auth.getClaims()` (local JWKS verification, no network hop). The role comes from the claim and is re-checked in the DB |
| Content | `application/json; charset=utf-8`. Request body limit 64 KB (uploads go directly to Storage) |
| Validation | Zod schema per route. Unknown keys rejected (`.strict()`). Coordinates validated (lat −90..90, lng −180..180) |
| Idempotency | **Required** (`Idempotency-Key: <uuid v4>`) on every `POST` that creates or changes state. Stored per (user, route, key) with a request hash: the same key + same body returns the stored response; same key + different body → `409 IDEMPOTENCY_KEY_REUSED` |
| Concurrency | Admin updates use `expected_version`. Trip and offer commands rely on DB locks and return `409` on lost races |
| Pagination | Cursor: `?limit=20&cursor=<opaque>`. Response `meta.next_cursor`. Max limit 100 |
| Time | ISO-8601 UTC in the API (`2026-11-02T08:15:00Z`). Clients localise |
| Money | Decimal **strings** (`"190.00"`) plus `currency`. Never JSON floats |
| Request ID | `X-Request-Id` accepted or generated, echoed in the response and logs, forwarded to Postgres |
| Rate limits | Fixed window per user + route class in Postgres (`api.check_rate_limit`; swap for Redis when needed). `429` with `Retry-After` |
| Role claim | `app_role` in the JWT is used to route requests. After onboarding promotes `user → passenger | driver`, a token issued earlier still says `user`; the API then re-reads the role from the database, so clients don't have to refresh first |
| Caching | `Cache-Control: no-store` on all authenticated responses. Reference data (`/categories`) `private, max-age=60` |
| CORS | Not enabled. Mobile apps aren't browsers, and the admin panel is same-origin |

### Envelope
```json
// success
{ "data": { ... }, "meta": { "request_id": "01J…", "next_cursor": null } }
// error
{ "error": { "code": "OFFER_NO_LONGER_AVAILABLE", "message": "This ride was taken by another driver.", "details": {} },
  "meta": { "request_id": "01J…" } }
```

### Error codes → HTTP
| HTTP | Codes |
|---|---|
| 400 | `VALIDATION_FAILED` (details: field errors), `IDEMPOTENCY_KEY_REQUIRED` |
| 401 | `UNAUTHENTICATED`, `SESSION_EXPIRED` |
| 403 | `FORBIDDEN`, `ACCOUNT_SUSPENDED`, `ROLE_NOT_ALLOWED`, `DRIVER_NOT_APPROVED` |
| 404 | `NOT_FOUND` (also returned for resources the caller may not see, so existence isn't leaked) |
| 409 | `INVALID_STATE_TRANSITION`, `OFFER_NO_LONGER_AVAILABLE`, `ACTIVE_REQUEST_EXISTS`, `STALE_VERSION`, `IDEMPOTENCY_KEY_REUSED`, `QUOTE_EXPIRED` |
| 422 | `OUT_OF_SERVICE_AREA`, `PRICING_UNAVAILABLE`, `PROMO_INVALID`, `LOCATION_STALE`, `TOO_FAR_FROM_PICKUP` |
| 429 | `RATE_LIMITED` |
| 500 / 503 | `INTERNAL` (no internals leaked; Sentry event id in `details.ref`), `UPSTREAM_UNAVAILABLE` |

DB functions raise `SQLSTATE 'P0001'` with `MESSAGE = '<CODE>'` and optional JSON `DETAIL`. `src/server/http/errors.ts` maps codes to HTTP status and localised messages (en/bn).

### Rate-limit classes (defaults)
| Class | Limit |
|---|---|
| auth-adjacent (onboarding, OTP-adjacent) | 10/min/user, 30/min/IP |
| read | 120/min/user |
| write | 30/min/user |
| quote | 20/min/user |
| driver location | 1 req / 2 s / driver (batched points allowed, ≤ 20 per request) |
| SOS | never rate-limited (logged only) |

## 2. Endpoint catalogue

### 2.1 Account & onboarding
| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/me` | any | Profile, role, status, onboarding state |
| PATCH | `/me` | any | Update name, language, avatar path |
| POST | `/onboarding/passenger` | user | Complete the passenger profile → role `passenger` |
| POST | `/onboarding/driver` | user | Start a driver application → role `driver`, onboarding `draft` |
| POST | `/me/deactivate` | passenger, driver | Request account deletion: deactivates and anonymises PII after the retention period. Financial records are kept (legal) |

### 2.2 Reference
| GET | `/categories?lat=&lng=` | passenger | Active categories in the zone at that point, with ETA of the nearest drivers |
| GET | `/zones/check?lat=&lng=` | any | Whether the point is in a service area |

### 2.3 Passenger rides
| Method | Path | Purpose |
|---|---|---|
| POST | `/quotes` | `{pickup:{lat,lng,label}, destination:{…}, category_id}` → quote id, breakdown, estimated fare, ETA, `expires_at` |
| POST | `/rides` | `{quote_id, payment_method, promo_code?, pickup_note?}` → ride request (`searching`) |
| GET | `/rides/{id}` | Request + trip state, driver/vehicle summary (masked phone, plate, rating), ETA |
| POST | `/rides/{id}/cancel` | `{reason}` → fee preview is applied per policy |
| GET | `/rides/{id}/cancel-preview` | Fee that *would* apply now |
| GET | `/rides?cursor=` | History |
| GET | `/trips/{id}/receipt` | Itemised fare breakdown |
| POST | `/trips/{id}/rating` | `{score, tags[], comment?}` |
| POST | `/trips/{id}/share` | Create a share link (token hashed in the DB, expires at trip end + 1 h) |
| POST | `/trips/{id}/sos` | Create a critical incident `{lat,lng,note?}` |
| POST | `/promotions/validate` | `{code, quote_id}` → discount preview |

### 2.4 Driver
| Method | Path | Purpose |
|---|---|---|
| GET | `/driver/onboarding` | Checklist: required documents, statuses, rejection reasons |
| PATCH | `/driver/details` | `{licence_number?, licence_expiry?, home_zone_id?}`. The licence number is stored encrypted (Vault key) and masked everywhere else |
| POST | `/driver/documents/upload-url` | `{document_type, vehicle_id?, content_type, size}` → signed upload URL + `document_id` (path decided server-side) |
| POST | `/driver/documents/{id}/complete` | `{document_number?, issued_at?, expires_at?}`. The server downloads the object, checks its real type by magic bytes and size, and computes the SHA-256 itself (client hashes are never trusted) → `pending`. Document numbers are stored masked only |
| POST | `/driver/vehicles` · PATCH `/driver/vehicles/{id}` | Register or edit a vehicle (edits to verified fields reset verification) |
| POST | `/driver/application/submit` | Submit for review |
| POST | `/driver/availability` | `{online: bool, lat, lng}` |
| POST | `/driver/location` | `{points:[{lat,lng,heading,speed,accuracy,recorded_at}]}` (≤ 20). The newest point upserts the live location (out-of-order points are ignored). Trip trail points are added in M2. Online drivers with no location for 120 s are taken offline |
| GET | `/driver/offers/current` | Pending offer (also pushed through Realtime) |
| POST | `/driver/offers/{id}/accept` | Atomic accept |
| POST | `/driver/offers/{id}/reject` | `{reason}` |
| POST | `/driver/trips/{id}/arriving` · `/arrived` · `/start` · `/complete` · `/cancel` | State transitions (`/start` takes `{pin?}`, `/cancel` takes `{reason}`) |
| POST | `/driver/trips/{id}/cash-collected` | `{amount}` |
| GET | `/driver/trips?cursor=` · `/driver/trips/{id}` | History and detail |
| GET | `/driver/earnings?from=&to=&group=day\|week` | Gross, commission, incentives, adjustments, net, online hours |
| GET | `/driver/wallet` | Balance, dues, recent ledger lines (driver-friendly labels) |
| GET | `/driver/payouts?cursor=` | Payouts with status and reference |
| POST | `/driver/payout-accounts` | Add a payout account (masked in responses) |

### 2.5 Support
| POST | `/support/tickets` | `{category, subject, body, trip_id?}` |
| GET | `/support/tickets?cursor=` · `/support/tickets/{id}` | Own tickets with non-internal messages |
| POST | `/support/tickets/{id}/messages` | Reply (attachments through a signed upload URL) |
| POST | `/support/attachments/upload-url` | |

### 2.6 Realtime channels (private, RLS-authorised)
| Channel | Subscribers | Events |
|---|---|---|
| `ride:{request_id}` | that passenger, assigned driver | `status_changed`, `driver_location` (throttled 1/3 s, only during an active trip), `fare_finalised` |
| `driver:{driver_id}` | that driver | `offer_created`, `offer_withdrawn`, `trip_cancelled`, `account_status_changed` |
| `ops:live` | admins with `dispatch.view` | request/trip/driver status deltas |
| `ops:safety` | admins with `safety.view` | `incident_created`, `incident_updated` |
| `admin:{admin_id}` | that admin | notifications, permission changes (forces client refresh) |

### 2.7 Webhooks & internal
| POST | `/api/webhooks/{provider}` | Raw body read **before** parsing. HMAC/signature verified with a constant-time compare. Timestamp tolerance 5 min. Deduplicated by `webhook_receipts(provider, event_id)`. Processing is idempotent and returns 2xx quickly |
| POST | `/api/internal/jobs/{job}` | Bearer job secret + IP allow-list. Idempotent per run id |
| GET | `/api/health` | Liveness (no DB). `/api/health/ready` checks DB with a 1 s timeout |

## 3. Admin Server Actions (catalogue)

Each action: `requirePermission` → Zod → one RPC → `revalidateTag` → `{ok, data?} | {ok:false, error}`. Every high-impact action takes `reason: string (min 5 chars)`.

| Module | Actions → RPC |
|---|---|
| Passengers | `updatePassenger`, `suspendPassenger`, `reactivatePassenger`, `revealPii` |
| Drivers | `updateDriver`, `approveDriver`, `rejectDriver`, `suspendDriver`, `reactivateDriver`, `forceDriverOffline` |
| Documents | `reviewDocument(approve\|reject)`, `getDocumentSignedUrl` |
| Vehicles | `createVehicle`, `updateVehicle`, `verifyVehicle`, `suspendVehicle`, `setCurrentVehicle` |
| Categories | `upsertCategory`, `toggleCategory` |
| Zones | `createZone`, `updateZoneBoundary`, `toggleZone`, `setManualSurge` |
| Fares | `createFareDraft`, `updateFareDraft`, `cloneFareRule`, `publishFareRule(effective_from)`, `retireFareRule`, `simulateFare` (read) |
| Dispatch/Trips | `redispatchRequest`, `expireRequest`, `cancelTrip`, `resolveTrip`, `addTripNote` |
| Payments | `reconcileCash`, `recordCashDeposit`, `markPaymentReviewed` |
| Ledger | `requestAdjustment`, `approveAdjustment`, `rejectAdjustment` |
| Refunds | `requestRefund`, `approveRefund`, `rejectRefund` |
| Payouts | `createPayoutBatch`, `approvePayoutBatch`, `markPayoutPaid`, `markPayoutFailed` |
| Promotions | `createPromotion`, `updatePromotion`, `activatePromotion`, `pausePromotion`, `endPromotion` |
| Support | `createTicket`, `replyTicket`, `addInternalNote`, `assignTicket`, `changeTicketStatus` |
| Safety | `acknowledgeIncident`, `updateIncidentStatus`, `addIncidentNote`, `uploadEvidence`, `getEvidenceSignedUrl` |
| Analytics | `requestExport` |
| Admins | `inviteAdmin`, `assignTemplate`, `revokeTemplate`, `grantPermission`, `denyPermission`, `revokeOverride`, `suspendAdmin`, `reactivateAdmin`, `updateTemplate` (super admin) |
| Settings | `updateSetting(key, value, expected_version)`, `toggleFeatureFlag` |
| Self | `updateOwnProfile`, `changePassword`, `enrollMfa`, `verifyMfa`, `markNotificationsRead`, `saveView` |

Server Actions inherit Next.js's built-in Origin/Host check (CSRF protection), and `serverActions.allowedOrigins` is restricted to the production domain.

## Implementation addenda (as built)

Routes added after the original list (all under `/api/v1`, same envelope, rate limits and idempotency rules):

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/quotes`, `/rides`, `/rides/{id}/cancel`, `/rides/{id}/promo` | passenger | Quote, request, cancel (free window or fee), apply a promotion code |
| GET | `/rides/{id}/pin`, POST `/rides/{id}/pin/renew` | passenger | Pickup PIN (flag `pickup_pin`) |
| GET | `/wallet` | passenger | Balance and any cancellation fee still owed |
| POST | `/trips/{id}/rate`, `/trips/{id}/sos` | passenger, driver | Rating within 7 days; SOS (no idempotency key required) |
| POST | `/incidents/{id}/evidence/upload-url`, `/incidents/{id}/evidence/complete` | passenger, driver | SOS evidence upload (signed URL, server-verified) |
| GET, POST | `/support/tickets`, `/support/tickets/{id}`, `/support/tickets/{id}/messages` | user, passenger, driver | Own tickets; internal notes are never returned |
| GET | `/driver/wallet`, `/driver/earnings` | driver | Wallet (negative = cash owed) and earnings |
| POST | `/driver/trips/{id}/cash-collected` | driver | Confirm the cash; a different amount opens a ticket |
| POST | `/driver/trips/{id}/start` | driver | Takes `pin` when the flag applies (`PIN_REQUIRED`, `INVALID_PIN`, `PIN_LOCKED`) |
| PUT | `/driver/payout-account` | driver | Stored encrypted, shown masked, verified by finance |
| PUT, DELETE | `/me/devices` | user, passenger, driver | Register or remove a push device |
| GET | `/config` | user, passenger, driver | Flags evaluated for the caller plus a few safe settings |

Non-versioned: `GET /api/exports/{id}` (admin session, logged CSV download), `POST /api/internal/jobs/notify` (bearer secret), `GET /api/health/ready`.
