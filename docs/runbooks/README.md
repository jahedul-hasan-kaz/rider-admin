# Runbooks

Short, tested-by-reading procedures for the things that go wrong in a ride-sharing pilot. Each one starts with how
you find out, then what to do in the first ten minutes, then how to confirm it is fixed.

| Runbook | When |
|---|---|
| [sos.md](sos.md) | A passenger or driver pressed SOS, or the safety alert fired |
| [payout-failure.md](payout-failure.md) | A payout was rejected by the provider, or the failure-rate alert fired |
| [outage.md](outage.md) | The app, the database, or the dispatch loop is down or slow |
| [restore-drill.md](restore-drill.md) | Quarterly: prove a backup restores |
| [release-checklist.md](release-checklist.md) | Before every production release and before the closed pilot |

External accounts and keys (email, SMS, scheduler, payments) are in [../integrations](../integrations/README.md).

Where to look first, always: **Alerts** page in the admin panel (everything below raises one), then the
**Audit log** for who changed what.
