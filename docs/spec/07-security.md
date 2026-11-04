# 07 · Security

Target: OWASP ASVS **Level 2** for the admin panel and API, with Level 3 controls for financial and safety data. RLS is a defence layer, **not** a replacement for server-side validation (blueprint §8.1).

## 1. Threat model (summary)

| Asset | Threats | Primary controls |
|---|---|---|
| Admin accounts | Credential stuffing, phishing, session theft, insider abuse | MFA (optional per person, mandatory when the `require_admin_mfa` flag is on), rate-limited login, short idle timeout, least privilege, maker-checker, full audit |
| Money (ledger, refunds, payouts) | Fraudulent refunds, double payouts, silent edits | Append-only ledger, balanced-transaction constraint, maker ≠ checker, idempotency, nightly verification |
| Trip integrity | Modified mobile client completing trips or setting fares | Server-authoritative state machine, fares computed in the DB, ownership checks in every RPC |
| PII and location | Data leakage, over-broad staff access | RLS, masked views, logged reveals, private storage + 60 s signed URLs, retention controls |
| Safety evidence | Unauthorised access | Separate bucket, `safety.view_evidence` only, every access logged |
| Secrets | Leaked service key | Server-only module, no `NEXT_PUBLIC_` secrets, CI secret scanning, rotation |
| Availability | Abuse, scraping, DoS on dispatch | Rate limits, idempotency, bounded queries, platform DDoS protection (host/CDN) |

## 2. Authentication

### 2.1 Admins
- Email + password, then **TOTP MFA, optional per person** (Profile → Security: turn on with a code, turn off with a fresh code). `private.has_aal2()` is the single rule used by every admin RLS policy and RPC: a session passes when it was verified with a code (`aal2`), **or** the person has no verified factor and the feature flag `require_admin_mfa` is off. Anyone who has turned MFA on must verify a code every sign-in (a password-only session is locked out, including at the database). With `require_admin_mfa` on, MFA is mandatory for everyone again: admins without a factor are sent to set one up and cannot turn it off. The proxy only pre-routes people whose token says they have a factor (`mfa_enrolled` claim); `getAdminContext` and the database decide. **Trade-off:** with MFA optional, a stolen password alone opens an account that has not turned it on; keep it mandatory in production for super admins and finance.
- Password policy (Supabase Auth settings): min 12 chars, require lower/upper/digit/symbol, **leaked-password protection on**.
- Login rate limit: 5 attempts / 15 min per email and 20 / 15 min per IP, with generic error messages.
- Sessions: JWT expiry 15 min (refresh token rotation on, reuse detection on), app idle timeout 30 min, absolute session lifetime 12 h. Suspending an admin revokes all sessions globally.
- Admin sign-up is **disabled**. Admins exist only by invitation or bootstrap. `api.invite_admin` records a pending row in `admin_invitations` (permission and escalation checks in the DB), then the server sends the Supabase invite email with the secret key. The `auth.users` insert trigger turns only an invited email into an `admin` profile. User-controlled metadata can never set a role.
- Every login, logout, MFA enrolment/challenge failure and password change is recorded in `admin_audit_logs` (via Auth hooks or the sign-in Server Action).

### 2.2 Mobile users (later)
Phone OTP via Supabase Auth with an SMS provider, with OTP rate limits and CAPTCHA (Supabase supports hCaptcha/Turnstile) on OTP request.

### 2.3 Custom Access Token Hook
Adds `app_role` and `status` to the JWT for routing only. Authorisation decisions in the DB always re-read `profiles` (cheap and indexed), so a suspension takes effect immediately.

### 2.4 Bootstrap super admin hardening
`admin@yopmail.com` is a **disposable-mailbox domain**: anyone can read yopmail inboxes, which means password-reset emails sent there are public. Therefore:
1. Before go-live, invite a real super admin on a company-controlled domain, then **suspend** the yopmail account (or change its email to a company mailbox).
2. Until then, the account should turn MFA on in Profile → Security (or the `require_admin_mfa` flag be enabled), and its password must be changed from the shared one (`must_change_password = true`).
3. Never put this password in the repo, seed files, CI variables or tickets.

## 3. Authorisation
- Role and permission model per [02-roles-permissions.md](02-roles-permissions.md). Checked at the proxy (coarse), page/action (`requirePermission`), and **DB (authoritative)**.
- `SECURITY DEFINER` functions: `set search_path = ''`, fully-qualified names, explicit permission check as the first statement, `EXECUTE` revoked from `public`/`anon`. A CI lint (`supabase db lint` + a custom query) fails if a definer function lacks `search_path` or a check.
- **Secret-key usage inventory** (anything else is a review blocker): `inviteAdmin`, `suspendAdmin` (session revoke), driver-document verification (`storage.verify`: the server reads an upload once to check magic bytes and hash it, because drivers cannot read their own files), webhook processing, internal jobs (export/archive, notifications). The module `src/server/supabase/admin-client.ts` imports `server-only` and logs every use.
- IDOR prevention: every RPC derives the actor from `auth.uid()` and checks ownership. IDs from the client are never trusted. Not-visible resources return `NOT_FOUND`.

## 4. Data protection
- **Transport:** HTTPS only, with HSTS `max-age=63072000; includeSubDomains; preload`.
- **At rest:** Supabase encrypts at rest. Additionally, licence and NID numbers and payout account numbers are encrypted at column level (`pgcrypto` `pgp_sym_encrypt`, key in **Supabase Vault**) and stored masked for display.
- **PII minimisation:** only the masked document number is stored by default (blueprint §3 notes). Logs redact `phone`, `email`, `password`, `token`, `authorization`, `licence`, `account` (pino redaction paths + Sentry `beforeSend` scrubber).
- **Location privacy:** live location is visible to admins only on the live map (`dispatch.view`). Historical trails need `trips.view_location`, and each view is logged. Trip points are archived after `retention.trip_points_days`.
- **Storage:** all buckets private, server-generated paths, size and MIME limits, magic-byte validation, 60 s signed URLs, access logged. No public URLs are stored in rows.
- **Account deletion:** deactivate, then anonymise PII after the legal retention period. Financial and safety records are kept with pseudonymised references.

## 5. Web application hardening
| Control | Setting |
|---|---|
| CSP | Nonce-based `script-src 'self' 'nonce-…' 'strict-dynamic'`; `connect-src` self + Supabase URL/WSS + Sentry + map tiles; `frame-ancestors 'none'`; `object-src 'none'`; `base-uri 'self'` |
| Headers | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Cross-Origin-Opener-Policy: same-origin` |
| Cookies | Supabase session cookies `HttpOnly`, `Secure`, `SameSite=Lax` |
| CSRF | Server Actions' built-in origin check + `allowedOrigins`. The REST API uses bearer tokens only (no cookies) |
| XSS | React escaping. `dangerouslySetInnerHTML` banned by lint. User text rendered as text. Markdown not supported in v1 |
| Input | Zod `.strict()` everywhere. Max lengths mirrored in DB CHECKs |
| SSRF | No user-supplied URLs are fetched. Provider endpoints are constants |
| Open redirect | `?next=` restricted to same-origin relative paths |
| Error handling | No stack traces or SQL errors to clients. Mapped codes + reference ID |
| Clickjacking | `frame-ancestors 'none'` |
| Dependencies | Lockfile, `pnpm audit` in CI, Renovate, no unmaintained packages for auth/crypto |

## 6. Secrets management
- `.env*` files are gitignored except `.env.example` (names only). A pre-commit hook (gitleaks) and CI secret scanning are on.
- Production secrets live in the hosting provider's encrypted env store and Supabase Vault (DB-side keys).
- **Rotate immediately:** the database password shared during setup. Rotate the secret key and webhook secrets on any suspected exposure, and on staff offboarding for anyone who had access.
- Separate keys per environment. Staging never holds production keys.

## 7. Supabase-specific checklist
- [ ] RLS enabled + forced on all `public` tables (CI query asserts zero tables without RLS)
- [ ] `anon` has no table grants; `authenticated` has only the `SELECT` grants and `EXECUTE` on `api.*` that are needed
- [ ] `private` and `audit` schemas **not** in the API's exposed schemas
- [ ] Supabase Security Advisor and Performance Advisor: zero warnings before release
- [ ] Auth: email confirmations on, sign-ups disabled for email (admins invite-only), MFA TOTP enabled, leaked-password protection on, refresh token reuse detection on
- [ ] Realtime: private channels only, RLS on `realtime.messages`
- [ ] Storage: all buckets private with explicit policies
- [ ] Network restrictions on direct DB connections (allow-list CI and job runners), SSL enforced
- [ ] PITR enabled in production

## 8. Audit & monitoring
- Every high-impact action → `admin_audit_logs` with a reason. Every row change → `audit.change_log`. Every PII/evidence/location access → `pii_access_logs`.
- Security alerts (email + in-app to super admins): more than 5 failed MFA challenges, a permission granted to a high-impact capability, a new super admin, a large refund, a ledger verification mismatch, an admin login from a new country/IP, an export over N rows.
- Audit logs are append-only and cannot be modified even by super admins (no UPDATE/DELETE privilege, and a trigger enforces it).

## 9. Security testing
- pgTAP suites per role: every table × operation × role, positive and negative.
- Automated tests for maker-checker, self-escalation, last-super-admin, role immutability, and IDOR on every endpoint (using another user's IDs).
- OWASP ZAP baseline scan against staging in CI (nightly).
- A third-party penetration test before the closed pilot (blueprint Phase 4).
