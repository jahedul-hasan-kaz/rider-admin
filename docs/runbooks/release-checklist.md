# Release checklist

> **Staging only for now.** This list is for when we decide to go to production or run a closed pilot; nothing here is
> needed to keep working on staging. For what to check on staging today see [../integrations/staging-checks.md](../integrations/staging-checks.md).

Run before every production release, and in full before the closed pilot. Items marked **auto** are enforced by the
test suite; the rest are a person's job and need a name and a date next to them.

## Every release

- [ ] **auto** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `node scripts/check-i18n.mjs` pass.
- [ ] **auto** `pnpm db:lint` is clean and `pnpm exec supabase test db` passes (includes `security_posture.test.sql`).
- [ ] **auto** `pnpm test:e2e` passes against a production build.
- [ ] `pnpm db:types` produces no diff.
- [ ] `supabase db push --dry-run` lists only the migrations you expect.
- [ ] No new `NEXT_PUBLIC_` variable carries a secret.

## Before the closed pilot (docs/spec/07-security.md §7)

- [ ] **auto** `anon` has no table privileges; `authenticated` has only `SELECT` and `EXECUTE` on `api.*` (`security_posture.test.sql`).
- [ ] **auto** Row-level security is enabled and forced on every public table, partitions included.
- [ ] **auto** Every `SECURITY DEFINER` function pins its `search_path`.
- [ ] **auto** `private`, `audit` and `archive` are closed to the API roles.
- [ ] **auto** Money and audit tables are read-only to the API roles; payout account numbers and export contents are not selectable.
- [ ] Supabase **Security Advisor** and **Performance Advisor**: zero warnings (Dashboard → Advisors). Record the date.
- [ ] Auth settings: sign-ups off, email confirmations on, MFA (TOTP) on, leaked-password protection on, refresh-token
      reuse detection on, minimum password length 12 (README "Hosted Supabase setup").
- [ ] Custom access token hook set to `private.custom_access_token_hook`.
- [ ] API → exposed schemas are `public` and `api` only.
- [ ] Realtime: private channels only (the policy on `realtime.messages` is in the migrations).
- [ ] Storage: every bucket private (`driver-documents`).
- [ ] **PITR enabled** and a **restore drill** done within the last 3 months ([restore-drill.md](restore-drill.md)).
- [ ] Network restrictions on direct database connections, SSL enforced.
- [ ] The shared `admin@yopmail.com` account suspended after inviting a real super admin.
- [ ] **OWASP ZAP baseline scan** against staging: no high findings. *(Not run from this repository: needs a deployed staging.)*
- [ ] **Third-party penetration test** completed and findings closed. *(External engagement.)*
- [ ] Runbooks read by the on-call people; an on-call rota exists for SOS.
- [ ] Alerts page is empty or every open alert is acknowledged with a reason.
- [ ] A test ride end to end on staging, cash settled, and the ledger verification is green.
