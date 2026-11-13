# 01 · Architecture

## 1. Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Next.js** (latest stable, App Router), **TypeScript** `strict` | React Server Components for reads, Server Actions for admin mutations, Route Handlers for the mobile API and webhooks |
| Database | **Supabase Postgres 15+** with `postgis`, `pg_cron`, `pgcrypto`, `citext`, `btree_gist`, `pg_trgm` | All schema changes go through Supabase CLI migrations in `supabase/migrations` |
| Auth | **Supabase Auth** | Admins: email + password + **TOTP MFA (AAL2 mandatory)**. Mobile: phone OTP (later). Cookie sessions via `@supabase/ssr` |
| Realtime | **Supabase Realtime: Broadcast on private channels** | DB triggers call `realtime.send()`; channel access is authorised by RLS on `realtime.messages` |
| Files | **Supabase Storage**, private buckets only | Short-lived signed URLs (60 s), every view logged |
| UI | **Tailwind CSS v4**, **shadcn/ui** (Radix primitives), **lucide-react** icons | Design tokens in CSS variables, light and dark themes |
| Tables | **TanStack Table v8** | Server-side sorting, filtering and pagination |
| Forms | **React Hook Form** + **Zod** | Zod schemas are shared between client, Server Actions and Route Handlers |
| Client data | **TanStack Query** | Only for live widgets and polling; everything else is server-rendered |
| Charts | **Recharts** (via shadcn charts) | |
| Maps | **MapLibre GL JS** + **terra-draw** | Zone polygon drawing, live driver/trip map |
| i18n | **next-intl** | `en`, `bn` |
| Dates and money | `date-fns` + `date-fns-tz`; `Intl.NumberFormat('en-BD', {currency:'BDT'})` | Money never touches JS floats for arithmetic. The DB computes, the UI only formats |
| Validation | **Zod** at every trust boundary | |
| Testing | **Vitest**, **Playwright**, **pgTAP** (DB/RLS), **k6** (load) | See [08-quality-ops.md](08-quality-ops.md) |
| Observability | **Sentry** (errors and traces), **pino** structured logs with PII redaction | |
| Package manager | **pnpm** | Exact versions pinned, lockfile committed, Renovate for updates |

## 2. Layered design

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Clients                                                                  │
│  Admin browser (cookie session, AAL2)      Mobile apps (Bearer JWT) [later]│
└───────────────┬──────────────────────────────────────┬───────────────────┘
                │ RSC / Server Actions                 │ HTTPS /api/v1/*
┌───────────────▼──────────────────────────────────────▼───────────────────┐
│ Next.js (same region as DB)                                              │
│  middleware.ts   → session refresh, AAL2 gate for /(admin), security hdrs │
│  app/(admin)/*   → pages (RSC), Server Actions (thin)                    │
│  app/api/v1/*    → Route Handlers (thin)                                 │
│  app/api/webhooks/* → provider webhooks (signature-verified)            │
│  src/server/*    → services: auth ctx, validation, RPC calls, routing,   │
│                    notifications, rate limit, idempotency, logging       │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ supabase-js (PostgREST) with the CALLER's JWT
┌───────────────▼──────────────────────────────────────────────────────────┐
│ Supabase Postgres                                                        │
│  public.*  tables (RLS default-deny) + security_invoker views (reads)    │
│  api.*     RPC functions = the ONLY write path (permission + state checks,│
│            one transaction, audit + events written inside)              │
│  private.* helpers not exposed via PostgREST (ledger posting, dispatch)  │
│  audit.*   change_log (partitioned, append-only)                         │
│  pg_cron   dispatch tick, offer/request expiry, KPI rollups, doc expiry  │
└──────────────────────────────────────────────────────────────────────────┘
```

### Core rules

1. **Business logic lives in Postgres functions.** Every state-changing command (accept offer, complete trip, approve refund, publish fare rule, change permissions…) is a single `api.*` function. It (a) checks the caller's role and permission, (b) validates state, (c) writes the change, the status event, the audit record and any ledger entries **in one transaction**, and (d) emits a realtime broadcast. This gives one network round trip per command, atomicity, and no window for races.
2. **Next.js is a thin, trusted edge.** It authenticates, validates input with Zod, enforces rate limits and idempotency, calls one RPC, and maps errors. It holds **no** business state.
3. **The caller's JWT is used for every DB call**, so RLS and `auth.uid()` always apply. The service-role/secret key is used **only** in `src/server/admin-client.ts` (marked `server-only`) for three things: provider webhooks, auth admin calls (inviting an admin), and scheduled jobs that need it. Every use is listed in [07-security.md](07-security.md) §3.
4. **Reads:** admin list and detail pages query `security_invoker` views or `STABLE` RPCs from Server Components. RLS plus column masking (PII) apply automatically.
5. **Clients never write tables directly.** `authenticated` gets `SELECT` (RLS-filtered) on the tables that need it, plus `EXECUTE` on `api.*` functions. `INSERT/UPDATE/DELETE` grants on business tables are revoked.

## 3. Key request flows

### 3.1 Admin mutation (e.g. approve a driver document)
1. User clicks **Approve** → confirmation dialog (reason optional for approve, required for reject).
2. Server Action `approveDocument(input)` runs: Zod parse, then `getAdminContext()` (session, AAL2, profile active), then `supabase.rpc('review_driver_document', {...})`.
3. The RPC checks `private.has_permission('documents.review')`, locks the row (`FOR UPDATE`), validates `review_status = 'pending'`, updates it, inserts `admin_audit_logs`, and recomputes the driver's onboarding readiness. All in one transaction.
4. The Server Action calls `revalidateTag('driver:'+id)` and returns `{ok:true}`. The UI shows a toast and the row updates.

### 3.2 Mobile command (e.g. driver accepts an offer)
1. `POST /api/v1/driver/offers/{id}/accept` with `Authorization: Bearer <jwt>` and `Idempotency-Key`.
2. Route Handler: verify the JWT (`supabase.auth.getClaims()`), apply the rate limit, look up the idempotency key (a replay returns the stored response), then call `rpc('accept_offer', {offer_id})`.
3. The RPC takes `SELECT … FOR UPDATE` on the ride request and the offer, so only one acceptance can win. It creates the trip, updates driver availability, writes events, and broadcasts on `ride:{request_id}` and `driver:{driver_id}`.
4. The response is stored against the idempotency key and returned.

### 3.3 Live data in the admin panel
- DB triggers on `trips`, `ride_requests`, `driver_profiles.availability` and `safety_incidents` call `realtime.send(payload, event, 'ops:live', true)`.
- The live operations page subscribes to the private channel `ops:live`. RLS on `realtime.messages` allows only admins holding `dispatch.view`.
- Driver positions are **not** broadcast per update. The live map polls a lightweight RPC `ops_live_snapshot(bbox)` every 5 s (≈ one query, GiST indexed), which caps fan-out cost regardless of fleet size.

## 4. Project structure

```
rider-admin/
├─ docs/spec/                      # this specification
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/                  # ordered SQL migrations (schema, RLS, functions, cron)
│  ├─ seed.sql                     # reference data only (categories, permissions, templates) — no secrets, no passwords
│  └─ tests/                       # pgTAP: RLS, permissions, state machines, ledger
├─ src/
│  ├─ app/
│  │  ├─ (auth)/login, mfa, forgot-password, reset-password
│  │  ├─ (admin)/layout.tsx        # app shell; AAL2 + admin role gate
│  │  ├─ (admin)/dashboard, live, passengers, drivers, documents, vehicles,
│  │  │   categories, zones, fares, requests, trips, payments, ledger, refunds,
│  │  │   payouts, promotions, support, safety, analytics, exports, audit,
│  │  │   admins, settings, profile
│  │  ├─ api/v1/...                # mobile-facing REST API
│  │  ├─ api/webhooks/[provider]/route.ts
│  │  └─ api/health/route.ts
│  ├─ components/
│  │  ├─ ui/                       # shadcn primitives
│  │  ├─ data-table/               # DataTable, toolbar, filters, saved views, bulk bar
│  │  ├─ forms/                    # Field wrappers, MoneyInput, GeoPicker, ReasonDialog
│  │  ├─ shell/                    # Sidebar, Topbar, CommandPalette, Breadcrumbs
│  │  └─ domain/                   # StatusBadge, Timeline, FareBreakdown, LedgerTable, MaskedField…
│  ├─ server/
│  │  ├─ supabase/{server,route,admin}-client.ts
│  │  ├─ auth/context.ts           # getAdminContext(), requirePermission(), getApiContext()
│  │  ├─ actions/                  # Server Actions grouped by module
│  │  ├─ services/                 # routing, notifications, payments providers, exports
│  │  ├─ http/                     # envelope, errors, idempotency, rate-limit, request-id
│  │  └─ log.ts                    # pino with redaction
│  ├─ lib/{schemas,money,dates,permissions,format}.ts
│  ├─ i18n/{en,bn}.json
│  ├─ types/database.ts            # generated by `supabase gen types`
│  └─ middleware.ts
├─ tests/{unit,e2e,load}/
├─ .env.example                    # names only, no values
└─ package.json
```

## 5. Performance strategy

| Technique | Applied to |
|---|---|
| **Co-location:** Next.js functions in the same region as Supabase (target < 5 ms RTT) | All server work |
| **One RPC per command:** no chatty multi-query writes from Node | Every mutation |
| **`(select auth.uid())` / `(select private.has_permission(...))`** in RLS so Postgres evaluates them once per statement (initPlan), and index every column a policy filters on | All RLS policies |
| **Keyset (cursor) pagination** on `(created_at desc, id desc)`. No `OFFSET` on large tables. Totals use `count=estimated` above 10k rows | Lists: trips, requests, ledger, audit, payments |
| **GiST indexes** on all `geography` columns; nearby search with `ST_DWithin` on `driver_live_locations` filtered by availability first | Dispatch, live map |
| **Partitioning (monthly, declarative)** with pg_cron creating future partitions | `audit.change_log`, `trip_location_points`, `driver_status_events`, `trip_status_events`, `ledger_entries` |
| **Rollup tables** (`kpi_15m`, `kpi_daily`) refreshed incrementally by pg_cron every 5 minutes. Dashboards never scan raw trips | Dashboard, analytics |
| **Maintained balances:** `ledger_account_balances` updated in the same transaction as each entry, so a balance read is O(1) | Driver wallet, finance |
| **Next.js caching:** reference data (categories, zones, active fare rules, settings, permission catalogue) cached with `unstable_cache` / `'use cache'` + tags, invalidated by the Server Action that changes it | Forms, filters, quotes |
| **Streaming RSC + Suspense:** page shell renders immediately, each widget streams independently with skeletons | Dashboard, detail pages |
| **Realtime Broadcast** from triggers (not `postgres_changes`), plus polling snapshots for high-frequency data | Live ops |
| **Location ingest** is an upsert into `driver_live_locations` (one row per driver, `fillfactor=70` for HOT updates). Sampled history goes to the partitioned `trip_location_points` only during an active trip | Driver API |
| **Connection handling:** supabase-js over HTTP (PostgREST). Direct `pg` only for jobs, through the Supavisor pooler in transaction mode | Jobs, exports |
| **Async exports:** large CSV exports run as jobs and stream into a private bucket. The user gets a notification with a signed link | Analytics, audit, ledger |

Performance budgets are in [08-quality-ops.md](08-quality-ops.md) §2.

### Scale caveat (blueprint §8.2)
Dispatch ticking and location ingest start inside Postgres + pg_cron + Next.js. When load tests show the measured limits (see budgets), move them to a dedicated worker (e.g. a Node service on Fly/Railway or Supabase Edge Functions plus a queue). The `private.dispatch_*` functions are written so a worker can call them unchanged.

## 6. Environments

| Env | Supabase | Next.js | Data |
|---|---|---|---|
| `local` | `supabase start` (Docker) | `pnpm dev` | seed reference data + synthetic fixtures |
| `staging` | separate Supabase project | preview deployment | synthetic only, never production PII |
| `production` | `nhjwfxbmuplfodmrxjag` | production deployment | real |

Migrations are applied by CI (`supabase db push`) staging-first, then production after approval. Nobody edits the production schema by hand in the dashboard.

### Environment variables (`.env.example`, names only)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=      # publishable/anon key — safe for browser
SUPABASE_SECRET_KEY=                       # secret/service-role key — server only, never NEXT_PUBLIC_
SUPABASE_DB_URL=                           # pooler URL, jobs/migrations only
WEBHOOK_SECRET_<PROVIDER>=
ROUTING_PROVIDER=barikoi|google|haversine
ROUTING_API_KEY=
NEXT_PUBLIC_MAP_STYLE_URL=
SENTRY_DSN=
APP_BASE_URL=
```
`src/server/env.ts` validates them with Zod at boot and fails fast. CI fails if any `NEXT_PUBLIC_*` variable name contains `SECRET`, `SERVICE` or `KEY` other than the publishable key.
