# Later: product decisions, not missing pieces

These were left out on purpose. Each is a project with its own design questions, so we should decide together before
anyone builds them.

## Mobile apps (driver and passenger)

The REST API under `/api/v1` is the mobile contract ([docs/spec/05-api.md](../spec/05-api.md)): quotes, rides, offers, trips,
wallet, tickets, SOS, devices, account deletion. Both apps can be built against it today. Decisions needed: native vs.
React Native/Flutter, one app with two roles or two apps, store accounts, and push (see [notifications.md](notifications.md)).
Background location on drivers' phones is the hard part; the API already accepts batched location updates and has a load
script for it.

## Passenger web booking

Same API, a web client. Needs a decision on whether passengers book on the web at all and on a separate sign-in screen (the
admin sign-in only accepts admins by design).

## Corporate accounts and subscriptions

Company wallets, invoicing, monthly passes. Requires billing rules (credit terms, tax invoices, VAT for Bangladesh) and
probably digital payments first ([digital-payments.md](digital-payments.md)).

## Batch or broadcast dispatch

Today each request is offered to one driver at a time, nearest first, with a timeout. Offering to several at once or
batching requests to optimise pickups changes fairness and acceptance rules. Worth doing only after real dispatch data
shows where the single-offer approach is slow (Analytics → Operations has the acceptance and time-to-assign numbers).

## Dedicated dispatch and location worker

Location updates and dispatch run inside Postgres functions, which is fast and simple at pilot scale. If load tests on a
bigger database tier show a bottleneck, the location ingest can move to a small worker service writing in batches. The load
scripts give the baseline to compare against.
