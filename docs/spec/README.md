# Rider Admin — Backend & Admin Specification

**Status:** Draft v1.0 · 2026-11-02
**Source:** *Ride-Sharing Platform Blueprint* (20 pp., business & technical planning document)
**Scope:** Backend (database, business logic, mobile-facing API) + Admin web panel.
**Out of scope (this phase):** Passenger and driver mobile UIs (React Native / Expo). The backend APIs they will call **are** in scope, so the mobile apps can be built later against a finished, tested backend.

---

## 1. Product in one paragraph

A Pathao/Uber-style two-sided ride-hailing marketplace for Bangladesh. Passengers request rides, independent drivers supply them. The platform matches demand and supply, sets transparent fares, keeps trips safe, records every taka that moves, and resolves disputes. The **admin panel is the operational control room**: it manages people, vehicles, pricing, trips, payments, safety and performance. It must **never silently rewrite completed financial history**. Corrections are separate, auditable adjustment records.

## 2. Non-negotiable quality goals

| Goal | What it means in this spec | Where it is specified |
|---|---|---|
| **Top-notch, user-friendly UI/UX** | A consistent design system, keyboard-first power-user flows, a command palette, server-side tables with saved views, clear empty/loading/error states, WCAG 2.2 AA, English and Bengali | [06-admin-ui.md](06-admin-ui.md) |
| **Never lose information** | No hard deletes. Soft-delete everywhere, append-only event and ledger tables, a generic row-level change log on every table, idempotency keys, PITR backups, archive instead of purge | [03-database.md](03-database.md) §3, [08-quality-ops.md](08-quality-ops.md) §4 |
| **No security vulnerabilities** | RLS on every table with default deny, permission-checked RPCs for all writes, MFA (AAL2) for admins, server-only secrets, private storage with short-lived signed URLs, PII masking with logged reveal, CSP/HSTS, rate limiting, audit trail | [07-security.md](07-security.md), [02-roles-permissions.md](02-roles-permissions.md) |
| **Best API performance** | In-region compute next to the DB, business logic inside Postgres (one round trip per command), PostGIS GiST indexes, keyset pagination, KPI rollup tables, Realtime Broadcast instead of `postgres_changes`, cached reference data, explicit p95 budgets | [01-architecture.md](01-architecture.md) §5, [08-quality-ops.md](08-quality-ops.md) §2 |

## 3. Document map

| # | Document | Contents |
|---|---|---|
| 01 | [Architecture](01-architecture.md) | Stack, layers, request flows, project structure, environments, performance strategy |
| 02 | [Roles & permissions](02-roles-permissions.md) | The 4 fixed roles, admin permission catalogue, permission templates (Super admin, Operations, Support, Finance, Safety, Analyst), enforcement |
| 03 | [Database](03-database.md) | Conventions, enums, every table, constraints, indexes, partitioning, RLS, audit, storage buckets |
| 04 | [Business logic](04-business-logic.md) | Ride and trip state machines, dispatch, fares, cancellations, ledger postings, refunds, payouts, promotions, background jobs |
| 05 | [API](05-api.md) | Conventions (auth, envelope, errors, idempotency, pagination, rate limits) and the full endpoint catalogue |
| 06 | [Admin UI/UX](06-admin-ui.md) | Design system, app shell, interaction patterns, page-by-page specs for every module |
| 07 | [Security](07-security.md) | Threat model and the control checklist |
| 08 | [Quality & operations](08-quality-ops.md) | Testing strategy, performance budgets, observability, backup and DR, CI/CD |
| 09 | [Roadmap](09-roadmap.md) | Milestones, exit criteria, and the decisions still open |

## 4. Fixed inputs from the client

- **Stack:** Next.js (App Router, TypeScript) + Supabase (Postgres + PostGIS, Auth, Realtime, Storage, pg_cron).
- **Supabase project:** `https://nhjwfxbmuplfodmrxjag.supabase.co`
- **Bootstrap super admin:** `admin@yopmail.com`, an existing auth user. The password is **never** stored in the repo, migrations or seed files. See [07-security.md](07-security.md) §2.4 for first-login hardening.
- **User roles (fixed set):** `admin`, `driver`, `passenger`, `user`.
- **Role rule:** nobody can change a user's role from the UI, including super admins. Admin *capabilities* are controlled by **permissions**, which super admins can edit. See [02-roles-permissions.md](02-roles-permissions.md).

> ⚠️ **Credentials hygiene:** the DB password was shared in plain text while the project was being set up. Rotate it in Supabase (Project Settings → Database) before any real data goes in, and keep every secret only in `.env.local` and the hosting provider's secret store. See [07-security.md](07-security.md) §6.

## 5. Assumptions (confirm or correct)

| # | Assumption | Default used in this spec |
|---|---|---|
| A1 | Meaning of the `user` role | A registered account that has not finished onboarding as a passenger or a driver. The backend promotes it one way only, `user → passenger` or `user → driver`, when onboarding completes. Admins never change it. |
| A2 | Launch market | One city zone (Dhaka) and one vehicle category (bike). Both are configurable, so more can be added without code changes. |
| A3 | Currency and timezone | BDT (`numeric(12,2)`), all instants stored as `timestamptz` (UTC), displayed in `Asia/Dhaka`. |
| A4 | Payments at launch | Cash only. Digital providers (bKash, Nagad, card) plug in through a provider interface and signed webhooks later. |
| A5 | Commission | 15% of the commissionable fare (base + distance + time + waiting + surge). Booking fee goes 100% to the platform. Configurable per fare rule. |
| A6 | Maps and routing | Admin maps use MapLibre GL with a configurable style URL. Routing/ETA sits behind a `RoutingProvider` interface (Barikoi or Google). A straight-line distance × road-factor fallback covers dev and outages. |
| A7 | Supabase region | Singapore (`ap-southeast-1`). Next.js server functions are deployed in the same region (e.g. Vercel `sin1`). |
| A8 | Admin languages | English first, Bengali second (full i18n plumbing from day one). |

The complete list of business decisions to lock before launch (blueprint Appendix B) is in [09-roadmap.md](09-roadmap.md) §3.
