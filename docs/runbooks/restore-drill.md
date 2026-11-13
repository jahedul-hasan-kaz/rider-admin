# Runbook: restore drill (quarterly)

A backup you have not restored is a hope. Do this every quarter and before the closed pilot, and write the result in
the release log.

**Targets:** recovery point of 5 minutes or better (point-in-time recovery), recovery time under 2 hours.

## Steps

1. **Pick a restore point** a few minutes in the past (Supabase dashboard → Database → Backups → Point in time).
   Restore it to a **new, separate project**, never over production.
2. **Check the schema and the migrations:** `supabase migration list` against the restored project shows every
   migration applied.
3. **Run the integrity checks** (SQL editor on the restored project):
   - `select private.verify_ledger_balances();` → `drift` and `unbalanced` are both empty arrays.
   - `select count(*) from public.trips;` and `select count(*) from public.ledger_entries;` are within a few rows of
     production for the chosen minute.
   - `select count(*) from public.profiles where role = 'admin';` is at least 1 and includes your super admin.
4. **Sign in to a staging copy of the app pointed at the restored project** as a super admin and open Payments, Ledger
   and Audit log. Everything should load.
5. **Compare the daily logical backup** (`pg_dump` in the separate cloud storage) the same way: restore it to a scratch
   database and run the same three checks.
6. **Delete the restored project** and record: restore point used, time taken, anything that surprised you.

## Pass criteria

- The ledger verification is clean on the restored copy.
- The time from "start restore" to "super admin signs in" is under 2 hours.
- Row counts match production at the restore point to within the recovery window.

Anything else is a finding: fix it and repeat the drill.
