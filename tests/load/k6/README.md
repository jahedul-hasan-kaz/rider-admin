# k6 load scripts

Run against a **staging** project, never production. They need real users, so first create test accounts:

```bash
SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… SUPABASE_SECRET_KEY=… node tests/load/k6/seed-load-users.mjs 200 > tokens.json
```

Tokens expire after the project's JWT lifetime (15 minutes by default): regenerate them for long runs.

| Script | What it proves | Budget (docs/spec/08 §2) |
|---|---|---|
| `location.js` | Driver location ingest, one batch per driver every 4 s | p95 < 150 ms, errors < 0.1% |
| `accept-race.js` | Many drivers answer the same offer at once: exactly one trip | one winner, no 5xx |
| `ride-flow.js` | Quote, request, offer, accept, start, complete, cash confirm under concurrency | p95 < 400 ms |

```bash
k6 run -e BASE_URL=https://staging.example.com -e TOKENS=tokens.json tests/load/k6/location.js
k6 run -e BASE_URL=https://staging.example.com -e TOKENS=tokens.json -e CATEGORY_ID=<bike category id> tests/load/k6/ride-flow.js
```

The candidate search is measured in SQL (`tests/load/bench-candidates.sql`, 10,000 drivers, budget 20 ms) and the
50-way accept race is also a Playwright test (`tests/e2e/m2-rides.spec.ts`), so the rules are covered before any load
test is needed. These scripts add latency and error-rate numbers under sustained concurrency.
