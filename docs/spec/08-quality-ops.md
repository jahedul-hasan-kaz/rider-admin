# 08 · Quality & Operations

## 1. Testing strategy

| Layer | Tool | What is covered | Gate |
|---|---|---|---|
| Database | **pgTAP** (`supabase test db`) | RLS matrix per role; every `api.*` function's happy path and each error code; state machines (all legal transitions pass, every illegal one raises); ledger balance invariant; maker-checker; role immutability; permission guardrails; fare calculation incl. the **blueprint §6.2 golden example** | CI, required |
| Concurrency | pgTAP + `dblink` / Node script with parallel connections | 50 drivers accept the same offer at once → exactly 1 trip; parallel promo redemptions never exceed budget; duplicate idempotency keys → one record | CI, required |
| Unit | **Vitest** | Zod schemas, error mapping, money/date formatters, permission helpers, routing fallback | CI, required |
| Integration | Vitest against local Supabase | Route Handlers end-to-end: auth, idempotency replay, rate limit, envelope | CI, required |
| E2E | **Playwright** | Admin critical paths: login + MFA, approve driver onboarding, publish fare rule, cancel trip, refund maker-checker, payout batch, permission edit, SOS acknowledge. Run in light and dark themes, `en` and `bn` | CI on PR (smoke) + nightly (full) |
| Accessibility | `@axe-core/playwright` | Every page: no serious or critical violations | CI, required |
| Load | **k6** | Location ingest, nearby-driver query, quote, accept race, admin list pages | Before pilot, then monthly |
| Security | ZAP baseline, gitleaks, `pnpm audit` | | CI |

Coverage targets: DB functions 100% of error paths, TS server code ≥ 85% lines.

**Test data:** a deterministic fixture generator (`pnpm db:fixtures`) creates zones, 500 drivers, 5,000 passengers and 50,000 historical trips with consistent ledgers for local and staging use. Real PII never leaves production.

## 2. Performance budgets (p95, in-region, production-sized data)

| Operation | Budget |
|---|---|
| Admin list page server render (TTFB) | ≤ 300 ms |
| Admin detail page TTFB | ≤ 250 ms (widgets stream after) |
| Dashboard full render | ≤ 1.2 s (cards ≤ 400 ms) |
| `POST /quotes` (excluding routing provider) | ≤ 150 ms |
| `POST /rides` | ≤ 200 ms |
| `POST /driver/location` | ≤ 80 ms |
| `POST /driver/offers/{id}/accept` | ≤ 150 ms |
| `POST /driver/trips/{id}/complete` | ≤ 300 ms |
| Nearby-driver candidate query @ 10k online drivers | ≤ 20 ms |
| Dispatch tick @ 1k open requests | ≤ 500 ms |
| Realtime event to admin UI | ≤ 1 s |
| Web Vitals (admin) | LCP ≤ 2.0 s, INP ≤ 200 ms, CLS ≤ 0.05 |

How we hold them: `EXPLAIN (ANALYZE, BUFFERS)` review for every new query on list pages (no seq scans on tables > 10k rows), `pg_stat_statements` top-20 review weekly, Sentry performance tracing, and k6 thresholds that fail the run when a budget is missed.

**Scale-out triggers** (blueprint §8.2): move dispatch and location ingest to a dedicated worker when location writes exceed ~500/s sustained, dispatch tick p95 exceeds 1 s, or DB CPU stays above 60% at peak.

## 3. Observability
- **Logs:** pino JSON. Fields `request_id`, `user_id` (hashed), `route`, `status`, `duration_ms`, `rpc`. PII redaction. Shipped to the host log drain.
- **Errors and traces:** Sentry for server, client and edge, with release tracking and source maps uploaded privately.
- **DB:** Supabase reports + `pg_stat_statements`, slow query log (> 200 ms), Realtime and Storage logs.
- **Business health alerts** (from KPI rollups): match rate < 70% for 30 min in any zone, no online drivers in an active zone at peak, SOS unacknowledged > 2 min, reconciliation variance ≠ 0, ledger verification failure, payout failures > 2%, dispatch tick lag > 15 s.
- **Uptime:** external checks on `/api/health/ready` every minute.

## 4. Backup, retention & disaster recovery
- **PITR** (Supabase add-on) in production, plus daily logical backup (`pg_dump`) to separate cloud storage with 30-day retention, encrypted.
- Targets: **RPO ≤ 5 min, RTO ≤ 2 h**. A restore drill runs quarterly into a scratch project, with checksums of ledger totals compared.
- **Retention (defaults, settings-driven; validate legally):**

| Data | Hot | Then |
|---|---|---|
| Trips, payments, ledger, fare breakdowns | forever (online) | – |
| Audit change log, admin audit logs | 24 months online | archive to the `archive` bucket (kept 7 years) |
| trip_location_points | 12 months online | archive (kept 3 years), then delete under a documented policy |
| driver_status_events | 24 months | archive |
| Idempotency keys, expired quotes | 7 days | archive 90 days |
| Exports | 7 days | deleted (regenerable) |

Archival = export the partition to compressed files plus a manifest with row count and checksum, verify, then detach the partition. Every archival run is logged.

## 5. CI/CD
1. **PR:** typecheck, lint (ESLint incl. `no-restricted-imports` for the admin client in client components), unit and integration tests, `supabase db lint`, pgTAP, Playwright smoke, axe, gitleaks, build. A preview deployment is wired to a staging Supabase branch.
2. **Main:** migrations to staging → full E2E → manual approval → migrations to production → deploy.
3. **Migrations** must be backward compatible with the currently deployed app (expand/contract). No destructive change without a two-step release.
4. **Release notes** generated from conventional commits. Database types regenerated (`supabase gen types`) and committed. CI fails if they are stale.

## 6. Coding standards
- TypeScript `strict`, `noUncheckedIndexedAccess`. No `any` in `src/server`.
- Every server file that touches secrets imports `server-only`.
- One Zod schema per input, colocated in `src/lib/schemas`, shared by client forms and the server.
- Money is handled as strings in TS. Arithmetic happens only in SQL.
- No direct table writes from TS. A lint rule flags `.insert/.update/.delete/.upsert` on supabase clients outside an allow-list (idempotency store).
- Conventional commits. Reviews are mandatory for `supabase/migrations/**` and `src/server/auth/**`.
