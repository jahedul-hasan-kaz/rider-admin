# 02 · Roles & Permissions

Access control has two layers that must not be confused:

| Layer | What it is | Who can change it |
|---|---|---|
| **Role** (`profiles.role`) | The *kind* of account: `admin`, `driver`, `passenger`, `user`. Decides which product surface the account can use at all. | **Nobody via the UI.** Set when the account is created. The only change allowed after that is the one-way system promotion `user → passenger \| driver` during onboarding. Enforced by a DB trigger. |
| **Permissions** (admins only) | Fine-grained capabilities inside the admin panel, e.g. `refunds.approve`. Grouped into **templates** that mirror the blueprint's admin roles. | Admins holding `admins.manage_permissions`, within the guardrails in §5. |

## 1. Roles

| Role | Surface | Created by | Notes |
|---|---|---|---|
| `admin` | Admin web panel | Invitation by an admin with `admins.invite` (auth admin API, server-side) | MFA (TOTP) is mandatory. An admin with zero permissions can sign in but sees only their profile page. |
| `driver` | Driver API (`/api/v1/driver/*`) | System, when a `user` submits a driver application | Can't go online until onboarding is `approved` and an `active` vehicle is attached |
| `passenger` | Passenger API (`/api/v1/*`) | System, when a `user` completes the passenger profile | |
| `user` | Onboarding endpoints only | Sign-up | Assumption A1. Promoted one way by the backend. |

### Enforcement
- `profiles.role` is an enum `app_role`. Trigger `profiles_role_guard` raises `ROLE_IMMUTABLE` on any `UPDATE` that changes `role`, unless the transition is `user → passenger | driver` **and** it is performed by `private.promote_user_role()` (the function sets the transaction-local flag `app.role_promotion = on`).
- No API endpoint, Server Action or RPC accepts `role` as input except account creation paths.
- The role is copied into the JWT by a **Custom Access Token Hook** (`private.custom_access_token_hook`) as `app_role`. The proxy (`src/proxy.ts`) uses it for cheap routing. The DB never trusts the claim for authorisation; it re-reads `profiles` through `private.current_app_role()`.
- An account can hold only one role. A person who is both a driver and a passenger uses two accounts. This keeps RLS simple and auditing unambiguous. (Revisit if the product wants a single account later.)

## 2. Permission catalogue

Format: `module.action`. **High-impact** permissions (★) need a reason when used, are always written to `admin_audit_logs`, and are highlighted in the permission editor.

| Module | Permission | Grants |
|---|---|---|
| Dashboard | `dashboard.view` | Overview dashboard |
| Live ops | `dispatch.view` | Live map, queue of searching requests, offer history |
| | `dispatch.intervene` ★ | Manually re-dispatch or expire a request, take a driver offline |
| Passengers | `passengers.view` | Lists and profiles (PII masked) |
| | `passengers.view_pii` ★ | Reveal phone/email (each reveal logged) |
| | `passengers.update` | Edit name, language, notes |
| | `passengers.suspend` ★ | Suspend or reactivate an account |
| Drivers | `drivers.view` | Lists and profiles (PII masked) |
| | `drivers.view_pii` ★ | Reveal phone, licence number, NID |
| | `drivers.update` | Edit operating details |
| | `drivers.approve` ★ | Approve or reject onboarding |
| | `drivers.suspend` ★ | Suspend or reactivate |
| Documents | `documents.view` | View document metadata and files (signed URL, logged) |
| | `documents.review` ★ | Approve or reject documents |
| Vehicles | `vehicles.view` | |
| | `vehicles.manage` | Create and edit vehicles, attach to driver |
| | `vehicles.verify` ★ | Verify, suspend or reactivate |
| Catalogue | `categories.manage` | Vehicle categories |
| Zones | `zones.view` | |
| | `zones.manage` ★ | Create and edit zone boundaries and status |
| Fares | `fares.view` | |
| | `fares.manage` | Create and edit draft fare rules |
| | `fares.publish` ★ | Schedule or activate a fare rule version, set surge |
| Requests & trips | `trips.view` | Requests, trips, timelines, fare breakdowns |
| | `trips.view_location` ★ | Route trails and precise pickup/drop points (logged) |
| | `trips.note` | Add internal notes |
| | `trips.cancel` ★ | Admin-cancel an active request or trip |
| | `trips.resolve` ★ | Resolve exceptions: force-complete with corrected values, mark failed |
| Payments | `payments.view` | Payment records |
| | `payments.reconcile` ★ | Mark cash/settlement reconciled, record driver cash deposits |
| Ledger | `ledger.view` | Ledger entries and balances |
| | `ledger.adjust_request` ★ | Request a manual adjustment |
| | `ledger.adjust_approve` ★ | Approve or reject adjustments (maker ≠ checker) |
| Refunds | `refunds.request` ★ | Request a refund |
| | `refunds.approve` ★ | Approve or reject refunds (maker ≠ checker) |
| Payouts | `payouts.view` | |
| | `payouts.create` ★ | Create payout batches |
| | `payouts.approve` ★ | Approve and mark payouts paid or failed (maker ≠ checker) |
| Promotions | `promotions.view` | |
| | `promotions.manage` ★ | Create, edit, activate or pause campaigns and budgets |
| Support | `support.view` | Tickets |
| | `support.manage` | Reply, change status, resolve |
| | `support.assign` | Assign tickets to agents |
| Safety | `safety.view` | Incident queue (summary only) |
| | `safety.manage` ★ | Acknowledge, investigate, escalate, close |
| | `safety.view_evidence` ★ | Access evidence files and full details (logged) |
| Analytics | `analytics.view` | KPI dashboards (aggregated data only) |
| | `analytics.export` ★ | CSV exports (async, logged) |
| Audit | `audit.view` | Admin audit log and change log |
| Settings | `settings.view` | |
| | `settings.manage` ★ | App settings and feature flags |
| Admins | `admins.view` | Admin list |
| | `admins.invite` ★ | Invite new admins |
| | `admins.manage_permissions` ★ | Assign templates and grant or revoke permissions |
| | `admins.suspend` ★ | Suspend or reactivate admin accounts |

The catalogue is seeded into `permissions` by migration. Code refers to permissions through a generated TS union type (`src/lib/permissions.ts`), so a typo is a compile error.

## 3. Permission templates (blueprint "Admin roles")

Templates are **named permission bundles**. Assigning a template copies a link (`admin_template_assignments`), so editing a template updates every admin who has it. Individual grants (`admin_permission_overrides`, effect `grant` or `deny`) adjust one admin. **Effective permissions = (union of template permissions ∪ grants) − denies.**

| Permission | Super admin | Operations | Support | Finance | Safety | Analyst |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| dashboard.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| dispatch.view / intervene | ✓/✓ | ✓/✓ | ✓/– | –/– | ✓/– | –/– |
| passengers.view / view_pii / update / suspend | ✓✓✓✓ | ✓–✓✓ | ✓–✓– | ✓––– | ✓✓–✓ | –––– |
| drivers.view / view_pii / update / approve / suspend | ✓✓✓✓✓ | ✓✓✓✓✓ | ✓–––– | ✓–––– | ✓✓––✓ | ––––– |
| documents.view / review | ✓✓ | ✓✓ | –– | –– | ✓– | –– |
| vehicles.view / manage / verify | ✓✓✓ | ✓✓✓ | ✓–– | ––– | ✓–– | ––– |
| categories.manage | ✓ | ✓ | – | – | – | – |
| zones.view / manage | ✓✓ | ✓✓ | ✓– | ✓– | ✓– | ✓– |
| fares.view / manage / publish | ✓✓✓ | ✓✓– | ✓–– | ✓–✓ | ––– | ✓–– |
| trips.view / view_location / note / cancel / resolve | ✓✓✓✓✓ | ✓✓✓✓✓ | ✓–✓–– | ✓–✓–– | ✓✓✓✓– | ✓–––– |
| payments.view / reconcile | ✓✓ | ✓– | ✓– | ✓✓ | –– | –– |
| ledger.view / adjust_request / adjust_approve | ✓✓✓ | ––– | ––– | ✓✓✓ | ––– | ––– |
| refunds.request / approve | ✓✓ | ✓– | ✓– | ✓✓ | –– | –– |
| payouts.view / create / approve | ✓✓✓ | ––– | ––– | ✓✓✓ | ––– | ––– |
| promotions.view / manage | ✓✓ | ✓✓ | ✓– | ✓– | –– | ✓– |
| support.view / manage / assign | ✓✓✓ | ✓✓✓ | ✓✓– | ✓–– | ✓✓– | ––– |
| safety.view / manage / view_evidence | ✓✓✓ | ✓–– | ✓–– | ––– | ✓✓✓ | ––– |
| analytics.view / export | ✓✓ | ✓– | –– | ✓✓ | –– | ✓✓ |
| audit.view | ✓ | – | – | ✓ | ✓ | – |
| settings.view / manage | ✓✓ | ✓– | –– | ✓– | –– | –– |
| admins.view / invite / manage_permissions / suspend | ✓✓✓✓ | ✓––– | –––– | –––– | –––– | –––– |

Notes:
- Support gets **limited personal-data access** (blueprint): no PII reveal, masked phones, and they contact users through in-app ticket replies.
- The Analyst template is **read-only, aggregated** (blueprint): `analytics.*` RPCs return only aggregates, and no PII-bearing list is reachable.
- Finance can request **and** approve refunds and adjustments, but the **maker ≠ checker** DB rule means one person can never approve their own request.

## 4. Enforcement points (defence in depth)

| Layer | Mechanism |
|---|---|
| Middleware | Not signed in → `/login`. `app_role ≠ admin` → `/login?error=forbidden`. `aal ≠ aal2` → `/mfa`. Idle > 30 min → sign out. |
| Navigation | Sidebar items and page actions render only when `can(permission)` is true. Effective permissions are loaded once per request in `getAdminContext()` and passed to the client as a `Set`. **UX only, never a security boundary.** |
| Server Components / Actions | `requirePermission('x')` at the top of every page and action. Throws `FORBIDDEN` → 403 page. |
| Database (authoritative) | Every `api.*` function starts with `perform private.require_permission('x')`. RLS `SELECT` policies on admin-visible tables use `(select private.has_permission('x'))`. Both also require `auth.jwt()->>'aal' = 'aal2'` for admins. |

`private.has_permission(p text)` is `STABLE SECURITY DEFINER` and reads `admin_effective_permissions` (a view over templates, grants and denies, keyed by `admin_id`, permission indexed). Using the table rather than JWT claims means **revocations take effect immediately**, not when the token expires.

## 5. Guardrails for permission management

1. **No self-escalation:** an admin can only grant permissions they currently hold. Only holders of the `super_admin` template can assign the `super_admin` template.
2. **Last super admin protection:** a constraint trigger rejects any change that would leave zero active admins with the `super_admin` template.
3. **No self-demotion lockout:** an admin cannot remove `admins.manage_permissions` from themselves.
4. **Reason required** for every grant, revoke, template assignment, suspension and invitation. The change is written to `admin_audit_logs` with before and after effective-permission sets.
5. **Template edits** (adding or removing a permission) are restricted to super admins, show an impact preview ("affects 7 admins"), and are audited.
6. **Built-in templates** (`super_admin`, `operations`, `support`, `finance`, `safety`, `analyst`) cannot be deleted. Custom templates can be created and soft-deleted only when no admin is assigned to them.
7. **Notifications:** the affected admin gets an in-app notification and an email when their permissions change.
8. **Suspending an admin** blocks access immediately: every `has_permission` check reads `profiles.status`. The Server Action also bans the auth user (`auth.admin.updateUserById(id, { ban_duration })`), so refresh tokens stop working and no new session can start. Reactivation lifts the ban.

## 6. Bootstrap

Migration `0002_bootstrap_super_admin.sql`:
```sql
-- Idempotent. Looks up the existing auth user by email; never creates or stores a password.
insert into public.profiles (id, email, full_name, role, status)
select u.id, u.email, 'Super Admin', 'admin', 'active'
from auth.users u where lower(u.email) = 'admin@yopmail.com'
on conflict (id) do nothing;

insert into public.admin_template_assignments (admin_id, template_id, assigned_by, reason)
select p.id, t.id, null, 'bootstrap'
from public.profiles p join public.permission_templates t on t.code = 'super_admin'
where lower(p.email) = 'admin@yopmail.com'
on conflict do nothing;
```
On first sign-in, the bootstrap admin is forced to (1) enrol TOTP MFA and (2) change the password. See [07-security.md](07-security.md) §2.4.
