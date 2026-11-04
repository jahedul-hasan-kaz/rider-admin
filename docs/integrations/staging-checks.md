# Checks to run on the deployed staging

The automatic tests (unit, database, browser) run from the repository and are already green. These checks need a
deployed staging and a person; they produce evidence, not code. Production readiness items are deliberately **not** here:
they are listed in [../runbooks/release-checklist.md](../runbooks/release-checklist.md) for when you decide to go live.

## 1. Smoke test (15 minutes)

- Sign in as the seed super admin, open every page in the sidebar, none should show an error.
- Create a zone and a fare rule, invite a second admin, accept the invitation in a private window.
- Using the REST API (see [docs/spec/05-api.md](../spec/05-api.md)), run one ride with the three seed users: quote → request → driver
  accepts → arrives → starts → completes → cash confirmed. Then Payments → Reconcile and Ledger → Verify show no drift.
- Ask for an export, wait a minute, download it. It should come from the `exports` bucket.

## 2. Load check (optional)

`tests/load/k6/` holds three scripts (ride flow, a race for one offer, driver location bursts) and a seeding script. See its
README for the commands and the targets (`p95` under 300 ms for reads, 500 ms for writes). Run them against staging with
a small number of virtual users first. Staging on a small database tier will not hit production numbers; use the
results to find slow queries, not to prove capacity.

## 3. Security scan (optional now)

- OWASP ZAP baseline: `docker run --rm -t zaproxy/zap-stable zap-baseline.py -t https://YOUR-STAGING-URL` and read the report.
- Supabase dashboard → Advisors: Security and Performance. Anything flagged on tables or functions we created is a bug we
  want to hear about.

## 4. Things that only look wrong on a real host

- Sign-in redirects: Supabase → Authentication → URL configuration must list the staging URL as site URL and redirect URL.
- `APP_BASE_URL` matches the staging URL (links in emails).
- Realtime: open Live operations in two browsers; a driver location update should move the marker in both.
