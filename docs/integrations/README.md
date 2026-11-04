# Integrations and things that need an outside party

Everything in the admin and the backend that can be built from inside this repository is built. What is left depends on
an account, a key, a contract or a person outside the code. Each item has its own page here saying what the system already
does, what you have to provide, and what the code change will be when you do.

We are on **staging only** for now. Nothing here is needed to run or demo the staging system; with none of it configured
the system runs end to end with cash payments, and messages are written to the server log instead of being sent.

| Page | What it unlocks | Needs from you | Status of the code |
|---|---|---|---|
| [scheduler.md](scheduler.md) | Messages, exports, archives and file clean-up run by themselves | A scheduler that calls one URL every minute | Done: the endpoint exists |
| [notifications.md](notifications.md) | Real email, SMS and push messages | Resend, Twilio (or another SMS gateway), a push relay | Done for Resend, Twilio and a push webhook |
| [routing.md](routing.md) | Road-accurate distance and time for quotes | A Google Routes key (Barikoi is not written yet) | Google done, Barikoi not |
| [digital-payments.md](digital-payments.md) | bKash, Nagad and card payments, provider refunds | Merchant accounts and sandbox credentials | Not built: needs the provider's API |
| [payout-provider.md](payout-provider.md) | Paying drivers automatically | A disbursement account or a bank file format | Not built: payouts are exported and marked by hand |
| [staging-checks.md](staging-checks.md) | Security and load evidence | A deployed staging, a person to run the scans | Scripts exist; running them is manual |
| [later.md](later.md) | Mobile apps, passenger web, corporate accounts, subscriptions, batch dispatch | Product decisions | Not started by design |

The order we suggest: scheduler → email and SMS → routing → everything else. The first three take an afternoon each and
make staging feel real; the rest are projects.
