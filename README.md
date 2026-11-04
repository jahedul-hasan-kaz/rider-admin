# Rider Admin

Backend and admin panel for the ride-sharing platform. Next.js 16 + Supabase.
The full specification lives in [docs/spec](docs/spec/README.md); the roadmap is in [09-roadmap.md](docs/spec/09-roadmap.md).

**Status:** Milestones M0–M4 are complete, plus the follow-ups and a staging batch (account deletion, saved views and bulk actions, automatic surge, files in Storage). We are working on **staging only**. Things that need an outside account or a decision (real email/SMS, digital payments, payout provider, mobile apps) are described in [docs/integrations](docs/integrations/README.md).

## Demo accounts (staging)

When the server starts it creates, if missing, and sets up: `admin@yopmail.com` (super admin, every permission),
`rider@yopmail.com` (approved driver with a bike) and `customer@yopmail.com` (passenger), all with `Abcd@001`
(override with `DEMO_PASSWORD`; existing passwords are never overwritten). It is on everywhere except
`NEXT_PUBLIC_APP_ENV=production`; `SEED_DEMO_USERS=false` turns it off. It needs the `api.seed_demo_users` migration
applied to that database. Two-factor authentication is optional: turn it on or off in **Profile → Security**. To make it mandatory for every admin, switch on the feature flag `require_admin_mfa` in Settings.

### Demo data (staging)

Set `SEED_DEMO_DATA=true` in `.env.local` and start the app: once, it fills every feature with realistic data
(migration `20261111090000_demo_data_seed.sql`, about 10 seconds). Restarting never duplicates it. All accounts use
`Abcd@001` (or `DEMO_PASSWORD`); two-factor authentication is optional (Profile → Security).

| Account | Role / templates | Try |
|---|---|---|
| admin@yopmail.com | Super admin | Everything |
| ops@yopmail.com | Operations | Approve drivers, live ops, cancel trips |
| ops.trainee@yopmail.com | Operations, **denied** approve drivers, intervene, cancel trips, delete drivers | Same pages, buttons missing |
| support@yopmail.com | Support agent | Tickets, request refunds (cannot approve) |
| support.lead@yopmail.com | Support, **granted** approve refunds, assign tickets, reveal passenger PII | Approve the pending refund |
| finance@yopmail.com | Finance (maker) | Payouts, deposits, adjustments |
| finance.checker@yopmail.com | Finance (checker) | Approve what finance@ requested |
| safety@yopmail.com | Safety reviewer | The live SOS incident |
| analyst@yopmail.com | Analyst | Dashboards and exports only |
| multi@yopmail.com | Operations + Finance | Two templates combined |
| nusrat@, farhana@, arif@ … @yopmail.com | Passengers (12) | One suspended, one asked to delete |
| rider@, kamal.driver@ … @yopmail.com | Drivers (13) | Approved, submitted, under review, draft, rejected, suspended, one licence expiring |

What is in it: 5 Dhaka zones with live fares for bike, car and CNG; ~90 rides over the last ~11 days (completed,
cancelled by passenger/driver/staff, no driver found) with cash, promotions, ratings; one trip in progress with an SOS
and one driver on the way; refunds and adjustments in every state, a payout batch, cash deposits; support tickets in
every state; a suspended passenger, a deletion request, a manual alert and shared saved views.

## Local development

Requires Node 22+, pnpm and Docker Desktop.

```bash
pnpm install
pnpm db:start                      # local Supabase (Postgres, Auth, Mailpit …) + all migrations
DEV_ADMIN_PASSWORD='…' pnpm dev:bootstrap-admin admin@yopmail.com   # local super admin
pnpm with-local next dev           # app against the LOCAL stack, ignoring .env.local
```

Open http://localhost:3000 and sign in. Two-factor is optional: add it any time in Profile → Security with any authenticator app.
Invitation and password emails land in Mailpit at http://127.0.0.1:54324.

- `pnpm with-local <cmd>` injects the local stack's URL and keys as process env, which beats `.env.local`. Use it so your hosted keys in `.env.local` are never touched.
- `pnpm dev` (without `with-local`) uses `.env.local`, i.e. whatever project you put there.
- `pnpm db:reset` rebuilds the local database from migrations. Run `dev:bootstrap-admin` again afterwards.

## Scripts

| Script | Purpose |
|---|---|
| `pnpm check` | public-env secret scan, lint, typecheck, unit tests |
| `pnpm test` | Vitest unit tests (`tests/unit`) |
| `pnpm db:test` | pgTAP database tests (RLS, roles, permissions guardrails, audit) |
| `pnpm db:lint` | Supabase schema lint |
| `pnpm db:types` | Regenerate `src/types/database.gen.ts` from the local schema |
| `pnpm test:e2e` | Playwright end-to-end tests. Needs the app running against the local stack (`E2E_BASE_URL`, default `http://localhost:3000`) |
| `pnpm dev:bootstrap-admin` | Create a local super admin (refuses to run against a non-local Supabase) |

## Hosted Supabase setup (one time, per environment)

Do these in order before anyone signs in to staging or production.

1. **Rotate the database password** (Project Settings → Database). The old one was shared in chat.
2. **Apply migrations:** `pnpm exec supabase link --project-ref nhjwfxbmuplfodmrxjag`, then `pnpm exec supabase db push`. The bootstrap migration gives the existing `admin@yopmail.com` auth user the super admin template.
3. **Auth settings** (Authentication → Sign In / Providers):
   - Allow new users to sign up: **off**. Email provider: **on**.
   - Minimum password length 12, require lower/upper/digits/symbols, leaked-password protection **on**.
   - MFA → TOTP: **enabled**.
   - JWT expiry: 900 s. Refresh token rotation and reuse detection: **on**.
4. **Custom Access Token Hook** (Authentication → Hooks): Postgres function `private.custom_access_token_hook`.
5. **Email templates** (Authentication → Emails): paste `supabase/templates/invite.html` and `recovery.html` (their links go to `/auth/confirm` with `token_hash`). Set **Site URL** to the app's URL and add `<app>/auth/confirm` to the redirect URLs. Configure custom SMTP for real delivery.
6. **API → Exposed schemas:** `public` and `api` only.
7. **App env** (host secret store): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `APP_BASE_URL`, `NEXT_PUBLIC_APP_ENV`. Optional: `NEXT_PUBLIC_MAP_STYLE_URL` (defaults to the free OpenFreeMap style; use a paid tile provider for production traffic).
   The migrations also create the private `driver-documents` Storage bucket, its policies, and the Vault key used to encrypt licence numbers.
8. **First sign-in** as `admin@yopmail.com`: you'll be forced to change the password (2FA is optional; turn it on in Profile → Security, or enable the `require_admin_mfa` flag to force it for everyone). Then invite a super admin on a company email domain and suspend the yopmail account (anyone can read yopmail inboxes; see docs/spec/07-security.md §2.4).

## Layout

- `src/proxy.ts`: per-request CSP nonce, request id, session refresh, admin/AAL2/idle gates (optimistic)
- `src/server/auth/context.ts`: authoritative admin and API auth (`getAdminContext`, `requirePagePermission`, `requirePermission`, `getApiContext`)
- `src/server/actions/*`: Server Actions (thin: Zod, then one RPC)
- `src/server/queries/*`: typed readers for read RPCs
- `src/components/{shell,data-table,domain,auth}`: app shell, tables, shared domain components
- `supabase/migrations`: schema, RLS, RPCs (`api.*`), helpers (`private.*`), change log (`audit.*`)
- `supabase/tests`: pgTAP suites; `tests/unit`: Vitest; `tests/e2e`: Playwright

Security rules: never commit `.env.local`, never put a secret in a `NEXT_PUBLIC_*` variable, never use the secret-key client outside the reviewed modules, and never write tables directly from TypeScript. Every write is an `api.*` RPC.
