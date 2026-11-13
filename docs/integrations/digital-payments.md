# Digital payments (bKash, Nagad, card)

**Status: not built, by design.** Staging and the pilot run cash only (`payments.enabled_methods = ["cash"]`). Building a
payment integration without the provider's sandbox and API documents would be guesswork, so this page lists what the system
is ready for and what we need from you to finish it.

## What is already in place

- `payments.method` already allows `cash | bkash | nagad | card`; quotes and ride requests carry the chosen method.
- The ledger has a `platform:gateway_clearing` account and the trip-completion posting for a digital trip is defined in
  [docs/spec/04-business-logic.md](../spec/04-business-logic.md) §9 (same numbers as cash, clearing account instead of the driver's cash debt).
- Refunds already have maker–checker approval and a `processed | failed (retryable)` status; for digital payments the
  approval is meant to enqueue a provider refund with its own idempotency key.
- Feature flag `digital_payments` (Settings → Feature flags) and the setting `payments.enabled_methods` gate it.
- `payments.provider_ref`, idempotency keys and the append-only ledger are there so a webhook can be applied exactly once.

## What we need from you

1. **Which providers first.** bKash, Nagad and cards (SSLCommerz, aamarPay or another aggregator) are different integrations.
   One aggregator that covers all three is usually the quickest route.
2. **A merchant account and sandbox credentials** for each, plus the provider's API document (tokenised checkout, execute,
   query, refund). Merchant onboarding can take weeks; start early.
3. **Business rules**: who pays gateway fees (platform or driver), whether partial refunds are allowed, settlement day
   with the provider, what happens when a payment fails after the trip (fall back to cash? block the next ride?).
4. A public **HTTPS callback URL** for each provider (the deployed staging URL works).

## What we will build when we have those

| Piece | Where | Notes |
|---|---|---|
| Provider adapter (create payment, execute, query, refund) | `src/server/services/payments/` | One file per provider behind one interface; all calls have timeouts and idempotency keys. |
| Webhook routes | `src/app/api/webhooks/{provider}/route.ts` | Verify the signature or re-query the provider before trusting; store the raw event; apply through a `service_role` RPC that is idempotent on the provider's reference. |
| `api.settle_digital_payment` RPC | new migration | Posts the ledger transaction with `private.post_transaction`; refuses a second application of the same event. |
| Passenger flow | REST | `POST /rides/{id}/pay` returns the provider's redirect or token; the mobile app opens it. |
| Reconciliation | existing Payments → Reconcile | Add provider settlement files as an input; unmatched items raise the existing `reconciliation_gap` alert. |
| Refund job | notify job | Calls the provider refund API for approved digital refunds; failures stay `failed` and retryable. |

Plan for about one to two weeks per provider once sandbox access exists, mostly in tests: the money paths must be as well
covered as the cash ones (see `supabase/tests/money.test.sql`).

## Security notes for whoever configures it

- Provider secrets go only in server environment variables, never `NEXT_PUBLIC_*`.
- Webhook endpoints must not trust the request body alone; they confirm with the provider's query API or a signature.
- Card numbers must never touch this system: use the provider's hosted page or tokens only.
