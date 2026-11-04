# Road routing

Quotes need distance and time for the trip. Today the server estimates them (straight-line distance × a road factor ÷ an
average speed, both tunable in Settings). That is good enough for staging and for fares to be consistent, but it
overstates short direct routes and understates winding ones.

## Google Routes (built)

```
ROUTING_PROVIDER=google
ROUTING_API_KEY=...
```

Enable the **Routes API** in a Google Cloud project, create a server key and restrict it to that API. The provider has a two
second timeout and falls back to the estimate on any error, so an outage degrades accuracy, never availability. The result
is frozen into the quote, so a passenger always pays what they were shown.

Cost: one Routes call per quote. Quotes are rate-limited per passenger, and the estimate is used whenever the key is empty.

## Barikoi (not built)

`ROUTING_PROVIDER=barikoi` is accepted but currently logs a warning and uses the estimate. Barikoi has Bangladesh-specific
road and address data. To finish it we need a Barikoi API key and their route endpoint documentation; the change is one
provider function in `src/server/services/routing.ts` next to the Google one, plus a unit test with a recorded response.

## Map tiles for the admin maps

The maps use free OpenFreeMap tiles by default. To use your own style or a paid provider set `NEXT_PUBLIC_MAP_STYLE_URL`
to its MapLibre style JSON URL.
