# Paying drivers automatically

**Status: the approval and bookkeeping are built; the money movement is manual.**

## How it works today

1. A finance admin creates a payout batch for drivers with a withdrawable balance (Payouts → New batch).
2. A second admin approves it (maker–checker). Approval books the ledger entries.
3. The batch is exported as CSV (masked account references only in the file; full numbers stay encrypted in the database and
   are shown to authorised staff one at a time, each view audited).
4. Someone pays those drivers outside the system (bKash/Nagad merchant portal or the bank's bulk-payment upload) and then
   marks each payout **paid** with the provider's transaction reference, or **failed** with a reason.
5. Failed payouts return the money to the driver's wallet and raise the `payout_failures` alert if they pile up
   ([runbook](../runbooks/payout-failure.md)).

This is correct and safe, and it is enough for staging and a small pilot.

## What an automatic payout needs

| Need | Why |
|---|---|
| A **disbursement account** with the provider (for example bKash Disbursement / Nagad merchant payout, or a bank's API for bulk transfers) | Without it there is no API to call |
| Their **API document and sandbox credentials** | The adapter follows their request and error formats |
| The **file format** if you stay with bulk upload instead of an API | We can generate the exact CSV/XLSX the bank or portal expects |
| Rules: minimum payout, fees, daily limits, payout day | These become Settings entries |
| Who may approve (permission `payouts.approve`), and the approval limit | Already supported; confirm the numbers |

## What we will build

- `src/server/services/payouts/{provider}.ts`: sends approved payouts one at a time with an idempotency key, records the
  provider reference, and maps provider errors to `failed` with a readable reason.
- A job step (in the scheduler's endpoint) that picks up approved payouts and a reconciliation step that checks their status
  with the provider until they settle.
- A bank-file export if a bulk upload is the chosen route (smaller job: a formatter and a test).

The payout state machine (`pending → approved → paid | failed`), idempotency and ledger postings already exist and do not change.
