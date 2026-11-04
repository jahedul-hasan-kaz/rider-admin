# 06 · Admin UI/UX

The admin panel is a control room. People work in it all shift, often under time pressure (SOS, failed matches, angry callers). UX priorities, in order: **speed to the right record → clarity of state → safety of actions → comfort over long sessions.**

## 1. Design principles

1. **Find anything in two keystrokes.** `⌘K / Ctrl K` command palette searches people (name, masked phone suffix), plates, trip IDs, ticket and incident numbers, and pages and actions ("Approve documents", "New promotion").
2. **State is always visible.** Every entity shows a coloured status badge, the time since the last change, and a timeline. Live views show a "Last updated 3 s ago" freshness indicator. Stale data turns amber after 30 s.
3. **Safe by default.** Destructive or high-impact actions are never one click. They open a **Reason dialog** with a preview of the consequence ("Driver will be taken offline and cannot accept rides"). The most critical actions (suspend admin, publish fare, approve payout batch) also require **type-to-confirm**.
4. **No dead ends.** Every empty state explains why and offers the next action. Every error says what happened, what to do, and shows a copyable reference ID.
5. **Progressive disclosure.** Lists show what is needed to decide. Detail pages use tabs, and raw JSON (snapshots, audit before/after) sits behind "Show technical details".
6. **Respect permissions quietly.** Controls a user can't use are hidden, not disabled-with-no-explanation. Read-only screens show a subtle "View only" badge.
7. **Consistency over novelty.** One table component, one form pattern, one detail-page layout used everywhere.

## 2. Visual design system

| Token | Value |
|---|---|
| Font | **Inter** (Latin), **Hind Siliguri** (Bengali). Tabular numerals (`font-variant-numeric: tabular-nums`) in tables and money |
| Type scale | 12 / 13 (table) / 14 (body) / 16 / 20 / 24 / 30 |
| Spacing | 4-pt grid. Density toggle: **Comfortable** (row 48 px) / **Compact** (row 36 px), remembered per user |
| Radius | 8 px for cards and inputs, 6 px for badges |
| Brand | Primary `emerald-600` (light) / `emerald-500` (dark), neutral `zinc` |
| Themes | Light, dark, system. All colours are CSS variables, contrast ≥ 4.5:1 for text |
| Elevation | Borders over shadows. Shadows only for popovers and dialogs |
| Motion | 150–200 ms ease-out. Respects `prefers-reduced-motion` |
| Icons | lucide, 16 px in tables, 20 px in nav |

**Status colour semantics** (used by `<StatusBadge>` for every enum):
- **Green:** success or healthy (`approved`, `active`, `completed`, `paid`, `succeeded`)
- **Blue:** in progress (`searching`, `in_progress`, `driver_arriving`, `processing`, `under_review`)
- **Amber:** needs attention (`pending`, `submitted`, `expiring`, `pending_user`, `requested`)
- **Red:** failed, blocked or critical (`rejected`, `suspended`, `failed`, `critical`, `no_driver_found`)
- **Grey:** inactive or final-neutral (`offline`, `retired`, `closed`, `cancelled_*`)

Badges always pair colour with a text label and an icon, never colour alone.

**Formatting:** money `৳1,250.00` (tabular, right-aligned); dates `02 Nov 2026, 14:05` in Asia/Dhaka with a relative hint ("5 min ago") and an absolute tooltip that includes UTC; distances `3.4 km`; durations `12 min 30 s`; phones masked `+880 17•• •••421` with a **Reveal** button (permission + reason, logged).

## 3. App shell

```
┌──────────────┬──────────────────────────────────────────────────────────────────┐
│  ◉ Rider     │ Breadcrumbs › Drivers › Rahim Uddin        [⌘K Search…]  🔔 3  ◐  👤 │
│  Admin  PROD │──────────────────────────────────────────────────────────────────│
│──────────────│                                                                  │
│ ▣ Dashboard  │   Page header: title · status badge · primary actions · ⋯ menu   │
│ ◎ Live ops   │   ───────────────────────────────────────────────────────────    │
│ OPERATIONS   │                                                                  │
│  Requests    │   Content                                                        │
│  Trips       │                                                                  │
│ PEOPLE       │                                                                  │
│  Passengers  │                                                                  │
│  Drivers  12 │  ← count badge = pending work (e.g. documents awaiting review)   │
│  Documents   │                                                                  │
│  Vehicles    │                                                                  │
│ PRICING      │                                                                  │
│  Fare rules  │                                                                  │
│  Zones       │                                                                  │
│  Categories  │                                                                  │
│  Promotions  │                                                                  │
│ FINANCE      │                                                                  │
│  Payments    │                                                                  │
│  Ledger      │                                                                  │
│  Refunds   2 │                                                                  │
│  Payouts     │                                                                  │
│ CARE         │                                                                  │
│  Support   8 │                                                                  │
│  Safety  🔴1 │                                                                  │
│ INSIGHTS     │                                                                  │
│  Analytics   │                                                                  │
│  Exports     │                                                                  │
│ ADMIN        │                                                                  │
│  Admins      │                                                                  │
│  Audit log   │                                                                  │
│  Settings    │                                                                  │
│──────────────│                                                                  │
│ « Collapse   │                                                                  │
└──────────────┴──────────────────────────────────────────────────────────────────┘
```
- Sidebar: grouped and collapsible (icon rail at < 1280 px, drawer on mobile). Count badges show pending work for the user's permissions (polled every 60 s, plus realtime for safety).
- **Environment ribbon:** `PROD` red, `STAGING` amber, `LOCAL` grey, so nobody confuses environments.
- **Safety alert:** a new critical incident shows a persistent red banner across all pages, with "Acknowledge" and a sound (user-mutable) until someone acknowledges it.
- Notifications drawer: approvals waiting for me, permission changes, export ready, SLA breaches.
- Profile menu: theme, density, language, MFA devices, change password, sign out.
- **Idle timeout:** after 30 min idle, a modal with a 60 s countdown, then sign-out.

## 4. Shared interaction patterns

### 4.1 List page (`<DataTable>`)
- Toolbar: search (debounced 300 ms, server-side), **filter chips** (status, zone, category, date range with presets *Today / 7 d / 30 d / Custom*), column visibility, density, **Saved views** (personal or shared), Export (permission-gated, async).
- Server-side sort, filter and **cursor pagination**. All table state is **synced to the URL**, so views are shareable and the back button works.
- Row click → detail page. `⌘/Ctrl-click` → new tab. Rows are keyboard navigable (`j/k`, `Enter`).
- Bulk actions only where safe and reversible (assign tickets, export selection). **No bulk financial or suspension actions.**
- Skeleton rows while loading, preserving the previous data during refetch (no layout jump).
- Empty states: "No pending documents 🎉, all caught up" vs "No results for these filters. Clear filters."

### 4.2 Detail page
- Header: avatar or icon, name or ID (copy button), status badge, key facts (rating, zone, joined), **primary action** (one), secondary actions in a `⋯` menu.
- Tabs (URL-synced). A right rail shows the **Activity timeline**: status events + admin actions + notes, newest first, filterable.
- An internal notes composer is always available (permission-gated).

### 4.3 Forms
- React Hook Form + Zod with the same schema as the server. Inline validation on blur, and the summary at the top on submit links to the fields.
- Money inputs: `৳` prefix, 2 dp, no negative unless the field allows it. Percent inputs show both % and the effect ("15% → ৳30 on a ৳200 fare").
- **Unsaved-changes guard** on navigation. Submit buttons show a pending state and are disabled while submitting (no double submits). Every Server Action also carries an idempotency key.
- A `STALE_VERSION` conflict shows a diff dialog ("Updated by Karim 2 min ago") with options *Reload* or *Review changes*.

### 4.4 Reason dialog (high-impact actions)
Title = action. Body = plain-language consequence. Required reason (textarea, min 5 chars, with reason presets per action such as "Document expired", "Customer complaint verified"). Optional "Notify user" toggle. Confirm button in red for destructive actions. Type-to-confirm for critical ones.

### 4.5 Feedback
- Toasts (sonner) for success, with an **Undo** where the action is reversible within 10 s (e.g. assign ticket). Never for financial actions.
- Errors: inline for forms, toast + reference ID for actions, error boundary per widget (one failed chart never breaks the page).

### 4.6 Accessibility & i18n
WCAG 2.2 AA. Full keyboard support with visible focus rings. Radix-based ARIA. Charts include a data-table alternative. Each live region announces new incidents. All strings go through `next-intl` (en and bn), including number and date locales. Bengali digits are an optional preference.

### 4.7 Responsiveness
Designed for 1280–1920 px desktop. Fully usable on tablet. **On-call essentials** (safety queue, incident detail, trip detail, driver suspend) work on a 375 px phone.

### 4.8 Keyboard shortcuts
`⌘K` palette · `g d` dashboard · `g l` live · `g t` trips · `g s` support · `/` focus search · `j/k` move · `Enter` open · `?` shortcut help · `Esc` close.

## 5. Pages

Each page lists: **purpose · content · actions (permission)**.

### 5.1 Auth
- **Login:** email, password, "Forgot password". Generic error messages (no user enumeration). Lockout messaging after rate limit.
- **MFA:** enrolment (QR + manual key + verify, with recovery guidance) and the challenge screen (6-digit input with auto-submit and paste support).
- **Forced password change** on first login or when an admin resets it. Strength meter, policy hints.

### 5.2 Dashboard (`dashboard.view`)
Filters: date range, zone, category (URL-synced).
- **Row 1, KPI cards** (value, delta vs previous period, sparkline): Completed rides · Request-to-match rate · Median / P90 time to match · Gross bookings · Platform revenue · Contribution per ride.
- **Row 2:** Marketplace funnel (requests → matched → started → completed, with drop-off %) | Cancellation reasons (by passenger/driver/admin).
- **Row 3:** Online drivers vs open requests by 15-min bucket (area chart) | Zone health table (match rate, ETA, supply, flagged red/amber/green against targets in blueprint §7.2).
- **Row 4, Attention panel:** documents pending, documents expiring ≤ 30 d, refunds awaiting approval, tickets breaching SLA, open incidents, fare-variance flags, reconciliation variance. Every item deep-links into a filtered list.
- Guard against misleading averages (blueprint §7.3): medians and P90 are shown, and subsidised vs non-subsidised contribution are both displayed.

### 5.3 Live operations (`dispatch.view`)
- Full-height **map** (MapLibre): zone polygons, online drivers (dot coloured by status: online / on trip; clustered when zoomed out), open requests (pulsing amber pin, timer since requested), active trips (line from driver to pickup or destination).
- Left panel tabs: **Searching** (requests sorted by wait time, offer round, candidates tried), **Active trips**, **Exceptions** (no driver found in the last hour, offers expiring repeatedly, drivers stale on trip, fare variance).
- Click a request → drawer with offer history (driver, rank, distance, ETA, response, response time) and actions: Re-dispatch, Expire (`dispatch.intervene`).
- Header metrics: online drivers, searching, active trips, median match (15 min). Freshness indicator.

### 5.4 Passengers (`passengers.view`)
- **List:** name, masked phone, status, rides (completed), last ride, rating given avg, complaints, joined. Filters: status, joined range, has open ticket.
- **Detail tabs:** Overview (stats, wallet balance) · Rides · Payments · Tickets · Ratings · Activity.
- Actions: Edit (`update`), Suspend/Reactivate (`suspend`, reason), Reveal phone/email (`view_pii`, reason), Create ticket, Issue refund (`refunds.request`).

### 5.5 Drivers (`drivers.view`)
- **List:** name, masked phone, onboarding status, availability (live dot), vehicle (plate · category), zone, rating, acceptance 30 d, cancellation 30 d, wallet balance (if `ledger.view`). Tabs: *All · Applications · Approved · Suspended*.
- **Onboarding review screen** (core workflow, built for speed): split view with the required-document checklist on the left and the **document viewer** on the right (zoom, rotate, PDF pages, side-by-side compare with the previous version). Per document: **Approve** (`A`) / **Reject** (`R`, reason presets) / next (`→`). The "Approve driver" button activates only when the checklist is complete, and a summary explains any blocker.
- **Detail tabs:** Overview (KPIs: online hours, rides, net earnings per online hour, per km, acceptance, cancellations) · Documents · Vehicles · Trips · Earnings & wallet · Payouts · Tickets & incidents · Activity.
- Actions: Approve/Reject application, Suspend/Reactivate, Force offline, Reveal PII, Add vehicle, Record cash deposit (`payments.reconcile`).

### 5.6 Documents (`documents.view`)
A queue across all drivers: *Pending review* (oldest first, SLA timer) · *Expiring ≤ 30 d* · *Expired* · *Rejected*. Opens the same review viewer. Signed URLs are fetched on demand, expire in 60 s, and each view is logged.

### 5.7 Vehicles (`vehicles.view`)
List (plate, make/model/colour/year, category, driver, status, verified at) and detail (documents, history). Verify/Suspend (`vehicles.verify`).

### 5.8 Categories (`categories.manage`)
A simple sortable list with drag reorder, active toggle, and an edit sheet (name en/bn, capacity, icon).

### 5.9 Zones (`zones.view`)
Map + list. **Zone editor** (`zones.manage`): draw or edit polygons (terra-draw) with snapping and vertex editing, upload GeoJSON, an overlap warning, an area readout, active toggle, manual surge slider (1.0–3.0×, `fares.publish`). Saving shows a diff overlay of old vs new boundary.

### 5.10 Fare rules (`fares.view`)
- Matrix view: rows = categories, columns = zones. Each cell shows the active version, the next scheduled version and its effective date.
- **Rule editor** (`fares.manage`): grouped fields (Base · Distance & time · Fees · Commission · Surge cap · Commissionable components) with a live **Fare simulator** panel. Enter a distance, duration and wait time to see the full breakdown (passenger pays, commission, driver earning) and a comparison against the current active version (Δ per component). Presets: 2 km / 5 km / 10 km trips.
- **Publish** (`fares.publish`): choose *Now* or a scheduled datetime. Review screen with the diff vs the current rule and the simulator results. Type-to-confirm. Published versions are read-only; "Clone to new draft" is the only way to change them.
- Version history timeline per cell.

### 5.11 Ride requests (`trips.view`)
List: ID, passenger, category, zone, status, requested at, wait/match time, offers sent, outcome. Detail: map (pickup/destination), quote snapshot, offer history, events timeline.

### 5.12 Trips (`trips.view`)
- **List:** trip ID, status, passenger, driver, vehicle, zone, requested → completed, distance, duration, fare, payment method + status, flags (variance, fallback distance, complaint, incident).
- **Detail:** header (status, fare, payment), **timeline** (every state with actor, time and location), **map** with planned vs actual route (`trips.view_location`, reveal logged), **fare breakdown** card (estimate vs final, per component, commission, driver earning, promo), payment and ledger lines, rating, linked tickets and incidents, internal notes.
- Actions: Cancel (`trips.cancel`), Resolve exception (`trips.resolve`: corrected distance/duration → creates an adjustment, never edits the frozen breakdown), Refund (`refunds.request`), Open ticket, Add note.

### 5.13 Payments (`payments.view`)
List with filters (method, status, provider, date, reconciled?). **Cash reconciliation** view (`payments.reconcile`): per driver, cash collected vs deposited vs dues, with a "Record deposit" action. Daily **reconciliation report**: expected vs confirmed by method, variance highlighted.

### 5.14 Ledger (`ledger.view`)
Accounts list with balances (platform accounts on top, driver wallets searchable). Account detail is a statement (date, transaction kind, reference link, debit, credit, running balance), exportable. Transaction detail shows all lines (balanced indicator ✓) and reversal links. **Request adjustment** (`ledger.adjust_request`) opens a form with a preview of the resulting lines.

### 5.15 Refunds & adjustments (`refunds.*`, `ledger.adjust_*`)
Tabs: *Awaiting my approval* · *Requested by me* · *All*. Detail: request, evidence, linked trip, requester, preview of ledger impact. Approve/Reject buttons are hidden for the requester (with the explanation "You requested this; another approver is needed").

### 5.16 Payouts (`payouts.view`)
Batches list → batch detail (drivers, amounts, payout accounts masked, exclusions with reasons such as negative balance or no verified account). Actions: Create batch, Approve batch (type-to-confirm, shows total), Mark paid (reference) / failed (reason) per payout or in bulk with a CSV import of references.

### 5.17 Promotions (`promotions.view`)
List with status, period, budget progress bar (spent / limit), redemptions, ROI. Editor: code (auto-generate), type and value, caps, eligibility (zones, categories, new users, min fare), per-user and total limits, budget, schedule, funded by. Live preview: "A ৳200 ride → ৳20 off". Pause/Resume/End.

### 5.18 Support (`support.view`)
- **Inbox** layout: list (priority, SLA countdown, status, requester, subject, assignee) | conversation (public replies vs internal notes visually distinct: yellow background, lock icon) | context rail (user summary, linked trip with fare breakdown, past tickets, quick actions: refund, open trip).
- Canned responses (en/bn), assignment, status changes, macros ("Fare complaint → request refund").

### 5.19 Safety (`safety.view`)
- **Queue** sorted by severity then age, with a large SLA timer. SOS incidents pinned with a red border.
- Detail: summary, live trip state and location (if active), parties (masked), timeline, notes, **evidence** locker (`safety.view_evidence`, each open logged), escalation fields. Actions per state transition, each needing a note.

### 5.20 Analytics (`analytics.view`)
Pages matching blueprint §7.1: **Marketplace funnel · Unit economics · Driver health · Passenger experience · Finance & risk**. Common filters (range, zone, category, cohort). Every chart has a "?" popover with the **exact KPI definition** from blueprint §7, so teams calculate metrics consistently. Export (`analytics.export`) creates an async job.

### 5.21 Exports (`analytics.export`)
My exports: kind, parameters, status, rows, expires at, download (signed URL).

### 5.22 Audit log (`audit.view`)
Two tabs: **Admin actions** (who, what, entity link, reason, time, IP) and **Data changes** (table, record, changed columns, actor). Diff viewer for before/after JSON with changed keys highlighted. Filters: admin, action, entity, date. PII access log sub-tab.

### 5.23 Admins (`admins.view`)
- **List:** name, email, templates (chips), MFA status, last login, status.
- **Invite** (`admins.invite`): email, name, templates, reason. The invite email is sent through Supabase Auth, and the user must set a password and enrol MFA on first login.
- **Permission editor** (`admins.manage_permissions`): templates as toggles, then a grouped permission matrix (module rows, action columns) showing *inherited from template* (filled dot), *granted* (green plus), *denied* (red minus). ★ marks high-impact. A sticky footer shows the "**Effective changes:** +2 / −1" summary, and saving requires a reason. Permissions the editor doesn't hold appear locked with a tooltip. **The role field is shown read-only and has no editor anywhere.**
- **Templates** (super admin): edit bundles with an impact preview.

### 5.24 Settings (`settings.view`)
Grouped forms built from `app_settings.schema` (Dispatch, Cancellation, Payouts, Finance, Retention, Security), each with a description and default, versioned, and a "View history" link. Feature flags list with toggle and rules editor (`settings.manage`).

### 5.25 My profile
Name, language, theme, density, password change, MFA devices, active sessions (sign out others), my recent activity.
