# Runbook: payout failures

**You find out by:** a failed payout on the batch page, or the `payout_failures` alert (more than 2% of payouts in the
last 30 days failed, minimum 5 payouts), or a driver saying they were not paid.

## First ten minutes

1. **Open the batch** (Payouts → the batch). Each payout shows its status, the masked account and the reference.
2. **Pick the right action per payout:**
   - *Approved, transfer rejected or bounced* → **Mark failed** with the provider's reason. The money returns to the
     driver's wallet through a ledger reversal and they become eligible for the next batch.
   - *Approved, transferred but not marked* → **Mark paid** with the provider's reference.
   - *Pending, not yet approved* → a different admin from the one who created the batch approves it, or **Cancel batch**
     (nothing has moved yet).
3. **Wrong account number?** Ask the driver to submit the account again in the app. Finance verifies the new account
   under Payouts → Accounts to verify before the next batch.

## Rules that protect you

- The person who created a batch can never approve it, and nobody edits a ledger entry: corrections are reversals.
- Never "fix" a balance by hand. Use a ledger adjustment (needs a second approver).

## Confirm it is fixed

- Ledger page → "Ledger verified" after clicking **Verify now**.
- The driver's wallet balance equals what they are owed (Ledger → Accounts → search the driver).
- The `payout_failures` alert clears when the failure rate is back under target.
