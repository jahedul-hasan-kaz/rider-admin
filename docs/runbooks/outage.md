# Runbook: outage or slowness

**You find out by:** the external uptime check on `/api/health/ready` (1-minute interval), the `dispatch_lag` alert
("the dispatch tick has stopped"), `no_supply` or `match_rate` alerts, or drivers and passengers reporting errors.

## Triage in this order

1. **Is it us or Supabase?** Open `/api/health/ready`. `{"auth":false}` or `{"rest":false}` means Supabase is not answering:
   check the Supabase status page and the project's health in its dashboard. Nothing in this app fixes that: wait,
   and tell staff.
2. **Is the dispatch loop alive?** Alerts → `dispatch_lag`. The loop is a database job (`dispatch-tick`, every 5 s).
   If it stopped, offers stop expiring and new requests stop being offered. In the SQL editor:
   `select jobname, active from cron.job;` then `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'dispatch-tick') order by start_time desc limit 5;`.
   Re-enable with `update cron.job set active = true where jobname = 'dispatch-tick';` if it was switched off, and
   check that the `pg_cron` extension is enabled for the project.
3. **Slow, not down?** Supabase dashboard → Reports → Database: CPU, connections, slow queries
   (`pg_stat_statements`). The candidate search, the location ingest and the accept path have measured budgets
   (spec 08 §2): anything over them is the lead.
4. **Application errors only?** Sentry for the release and request id. The request id is in every error response and
   log line, so a user's reference code finds their request.

## While it is down

- Tell drivers and passengers through your usual channel. Cash trips already running can finish; the settlement runs
  when the driver completes the trip again.
- Do not hand-edit data to "help". If money looks wrong afterwards, use the ledger verification and the reversal flow.

## After

- Alerts page: everything open should clear on its own within minutes of recovery. Acknowledge what does not and note why.
- Write the timeline (when it started, what you saw, what fixed it, how long) and add the missing alert or check.
