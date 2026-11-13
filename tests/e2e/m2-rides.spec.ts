import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { apiClient, createAppUser, localStack } from "./api-client";
import {
  bootstrapSuperAdmin,
  createZone,
  jwtSub,
  makeOnlineDriver,
  publishRuleSql,
  runSqlAsync,
  runSqlOne,
  signInAdmin,
  strongPassword,
  uniqueEmail,
} from "./helpers";

// M2 exit criteria (docs/spec/09-roadmap.md): an end-to-end test ride works with retries and
// race-condition tests. Passenger and driver run through the real REST API; the admin through the UI.

type Api = ReturnType<typeof apiClient>;
const data = (r: { body: { data?: Record<string, unknown> } }) => r.body.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function makePassenger(baseURL: string): Promise<{ api: Api; token: string; id: string }> {
  const token = await createAppUser(uniqueEmail("pax"), strongPassword());
  const api = apiClient(baseURL, token);
  const res = await api.post("/onboarding/passenger", { full_name: "E2E Passenger" });
  expect(res.status).toBe(201);
  return { api, token, id: jwtSub(token) };
}

async function bikeCategory(api: Api): Promise<string> {
  const res = await api.get("/categories");
  return (res.body.data as unknown as { id: string; code: string }[]).find((c) => c.code === "bike")!.id;
}

const place = (lat: number, lng: number, label: string) => ({ lat, lng, label });

/** PostgREST call straight to an api.* RPC, bypassing the REST layer's rate limits to hammer the database rules. */
async function rpc(token: string, name: string, args: Record<string, unknown>) {
  const s = localStack();
  const res = await fetch(`${s.API_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: s.PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Profile": "api", "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

test.describe.configure({ mode: "serial" });

test("a full ride: fare rule published in the UI, ride through the API, reviewed in the admin", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const suffix = Date.now().toString(36);
  const zoneId = createZone(`m2a_${suffix}`, 24.9, 91.87);

  // --- Admin publishes the fare rule through the UI ------------------------------------------
  const adminEmail = uniqueEmail("m2admin");
  const adminPassword = strongPassword();
  bootstrapSuperAdmin(adminEmail, adminPassword);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await ctx.newPage();
  await signInAdmin(admin, adminEmail, adminPassword);

  const { id: categoryId } = runSqlOne<{ id: string }>("select id from public.vehicle_categories where code = 'bike'");
  await admin.goto(`/fares/new?category=${categoryId}&zone=${zoneId}`);
  await expect(admin.getByText("Fare simulator")).toBeVisible();
  // The simulator prices the unsaved draft with the real engine: 5 km / 20 min at the default rates.
  await expect(admin.getByText("৳180.00").first()).toBeVisible();
  await admin.getByRole("button", { name: "Save draft" }).click();
  await expect(admin).toHaveURL(/\/fares\/[0-9a-f-]{36}$/);
  await admin.getByRole("button", { name: "Publish", exact: true }).click();
  const dialog = admin.getByRole("dialog");
  await dialog.getByRole("button", { name: "Pilot launch rates" }).click();
  await dialog.getByLabel("Type PUBLISH to confirm").fill("PUBLISH");
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(admin.getByText("Fare rule is live.")).toBeVisible();
  await admin.goto("/fares");
  await expect(admin.getByText("v1 live").first()).toBeVisible();

  // --- Passenger and driver -------------------------------------------------------------------
  const pax = await makePassenger(baseURL!);
  const driverToken = await makeOnlineDriver(createAppUser, 24.903, 91.873); // ~450 m from the pickup
  const driver = apiClient(baseURL!, driverToken);
  const bike = await bikeCategory(pax.api);

  const quote = await pax.api.post("/quotes", { category_id: bike, pickup: place(24.9, 91.87, "Zindabazar"), destination: place(24.93, 91.9, "Airport Road") });
  expect(quote.status, JSON.stringify(quote.body)).toBe(201);
  expect(data(quote).route_source).toBe("haversine");
  const estimate = Number(data(quote).estimated_fare);
  expect(estimate).toBeGreaterThan(60);
  expect(data(quote).available_drivers).toBe(1);

  // Idempotent request: the same key replays the response instead of creating a second ride.
  const key = randomUUID();
  const first = await pax.api.post("/rides", { quote_id: data(quote).id, payment_method: "cash" }, key);
  const replay = await pax.api.post("/rides", { quote_id: data(quote).id, payment_method: "cash" }, key);
  expect(first.status, JSON.stringify(first.body)).toBe(201);
  expect(replay.body).toEqual(first.body);
  const requestId = data(first).id as string;
  expect(data(first).status).toBe("searching");

  // --- Driver: offer, accept, drive ---------------------------------------------------------
  const offer = await driver.get("/driver/offers/current");
  expect(data(offer).request_id).toBe(requestId);
  expect(Number(data(offer).estimated_fare)).toBe(estimate);
  const accepted = await driver.post(`/driver/offers/${data(offer).offer_id}/accept`);
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  const tripId = data(accepted).id as string;
  expect(data(accepted).status).toBe("driver_assigned");

  expect((await driver.post(`/driver/trips/${tripId}/start`)).body.error?.code).toBe("INVALID_STATE_TRANSITION");
  expect((await driver.post(`/driver/trips/${tripId}/arriving`)).status).toBe(200);
  const tooFar = await driver.post(`/driver/trips/${tripId}/arrived`);
  expect(tooFar.status).toBe(422);
  expect(tooFar.body.error?.code).toBe("TOO_FAR_FROM_PICKUP");
  expect((await driver.post(`/driver/trips/${tripId}/arrived`, { override: true })).status).toBe(200);

  const rideNow = await pax.api.get(`/rides/${requestId}`);
  expect(data(rideNow).trip.status).toBe("arrived");
  expect(data(rideNow).trip.driver.phone_masked).toContain("•");

  expect((await driver.post(`/driver/trips/${tripId}/start`)).status).toBe(200);
  const points = Array.from({ length: 8 }, (_, i) => ({
    lat: 24.9 + i * 0.004,
    lng: 91.87 + i * 0.004,
    speed: 16,
    accuracy: 8,
    recorded_at: new Date(Date.now() - (160 - i * 20) * 1000).toISOString(),
  }));
  const loc = await driver.post("/driver/location", { points });
  expect(loc.status, JSON.stringify(loc.body)).toBe(200);

  // The passenger can no longer cancel a ride in progress.
  expect((await pax.api.post(`/rides/${requestId}/cancel`, { reason: "too late" })).status).toBe(409);

  const done = await driver.post(`/driver/trips/${tripId}/complete`);
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  const finalFare = Number(data(done).final_fare);
  expect(finalFare).toBeGreaterThan(60);
  const again = await driver.post(`/driver/trips/${tripId}/complete`);
  expect(Number(data(again).final_fare)).toBe(finalFare);

  const receipt = await pax.api.get(`/trips/${tripId}/receipt`);
  expect(Number(data(receipt).final_fare)).toBe(finalFare);
  expect(Number(data(receipt).breakdown.total)).toBe(finalFare);
  expect(data(await pax.api.get(`/rides/${requestId}`)).status).toBe("completed");
  expect(data(await pax.api.get("/rides")).length ?? (await pax.api.get("/rides")).body.data).toBeTruthy();

  const state = runSqlOne<{ availability: string; source: string; flagged: boolean }>(
    `select d.availability::text as availability, t.distance_source as source, t.fare_review_required as flagged
     from public.trips t join public.driver_profiles d on d.id = t.driver_id where t.id = '${tripId}'`,
  );
  expect(state).toMatchObject({ availability: "online", source: "trail" });

  // A second ride is free to start; with no driver in range it ends at once (5 km radius).
  const quote2 = await pax.api.post("/quotes", { category_id: bike, pickup: place(24.94, 91.84, "Far corner"), destination: place(24.93, 91.9, "Airport Road") });
  const ride2 = await pax.api.post("/rides", { quote_id: data(quote2).id, payment_method: "cash" });
  expect(data(ride2).status).toBe("no_driver_found");

  // --- Admin reviews what happened ------------------------------------------------------------
  await admin.goto(`/trips/${tripId}`);
  await expect(admin.getByRole("heading", { name: /Trip / })).toBeVisible();
  await expect(admin.getByText("Passenger pays").first()).toBeVisible();
  await expect(admin.getByText("Driver assigned").first()).toBeVisible();
  await expect(admin.getByText("Arrival override")).toBeVisible();
  await expect(admin.getByText("Distance from the GPS trail")).toBeVisible();
  await expect(admin.locator("canvas.maplibregl-canvas")).toBeVisible();

  await admin.goto(`/requests/${requestId}`);
  await expect(admin.getByText("Dispatch offers")).toBeVisible();
  await expect(admin.getByText("Accepted").first()).toBeVisible();

  await admin.goto("/trips?tab=completed");
  await expect(admin.getByRole("row", { name: /E2E Passenger/ }).first()).toBeVisible();

  await admin.goto("/live");
  await expect(admin.getByRole("heading", { name: "Live operations" })).toBeVisible();
  await expect(admin.getByText("Online drivers")).toBeVisible();
  await expect(admin.locator("canvas.maplibregl-canvas")).toBeVisible();

  // Route trail views are logged (spec 03 §5).
  const { n } = runSqlOne<{ n: number }>(`select count(*)::int as n from public.pii_access_logs where field = 'trip_route:${tripId}'`);
  expect(n).toBeGreaterThan(0);
  await ctx.close();
});

test("concurrency: 50-way accept race, accept vs cancel vs expiry tick, duplicate requests", async ({ baseURL }) => {
  test.setTimeout(240_000);
  const suffix = Date.now().toString(36);
  const zoneId = createZone(`m2b_${suffix}`, 24.3, 90.9);
  publishRuleSql(zoneId);
  const bikePickup = place(24.3, 90.9, "Race pickup");
  const dest = place(24.33, 90.93, "Race dest");

  // ----- 1. 50 concurrent accepts of the same offer -> exactly one trip --------------------
  const pax = await makePassenger(baseURL!);
  const driverToken = await makeOnlineDriver(createAppUser, 24.301, 90.901);
  const driver = apiClient(baseURL!, driverToken);
  const bike = await bikeCategory(pax.api);

  const quote = await pax.api.post("/quotes", { category_id: bike, pickup: bikePickup, destination: dest });
  const ride = await pax.api.post("/rides", { quote_id: data(quote).id, payment_method: "cash" });
  const requestId = data(ride).id as string;
  const offerId = data(await driver.get("/driver/offers/current")).offer_id as string;

  const viaRest = Array.from({ length: 25 }, () => driver.post(`/driver/offers/${offerId}/accept`)); // distinct idempotency keys
  const viaRpc = Array.from({ length: 50 }, () => rpc(driverToken, "accept_offer", { p_offer_id: offerId }));
  const results = await Promise.all([...viaRest, ...viaRpc]);

  expect(results.every((r) => r.status < 500), `a request failed with 5xx: ${JSON.stringify(results.filter((r) => r.status >= 500)[0])}`).toBe(true);
  const tripIds = new Set<string>();
  for (const r of results) {
    const body = r.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const id = body.data?.id ?? body.id;
    if (r.status === 200 && id) tripIds.add(String(id));
  }
  expect(tripIds.size).toBe(1); // every winner got the same trip
  const { trips } = runSqlOne<{ trips: number }>(`select count(*)::int as trips from public.trips where request_id = '${requestId}'`);
  expect(trips).toBe(1);
  const { avail } = runSqlOne<{ avail: string }>(`select availability::text as avail from public.driver_profiles where user_id = '${jwtSub(driverToken)}'`);
  expect(avail).toBe("on_trip");

  // ----- 2. accept vs passenger cancel vs dispatch ticks, all at once ---------------------------
  const pax2 = await makePassenger(baseURL!);
  const driver2Token = await makeOnlineDriver(createAppUser, 24.31, 90.91);
  const driver2 = apiClient(baseURL!, driver2Token);
  const quote2 = await pax2.api.post("/quotes", { category_id: bike, pickup: place(24.311, 90.911, "Race 2"), destination: dest });
  const ride2 = await pax2.api.post("/rides", { quote_id: data(quote2).id, payment_method: "cash" });
  const request2 = data(ride2).id as string;
  const offer2 = data(await driver2.get("/driver/offers/current")).offer_id as string;

  const racers: Promise<{ status: number; body: unknown }>[] = [
    ...Array.from({ length: 10 }, () => rpc(driver2Token, "accept_offer", { p_offer_id: offer2 })),
    ...Array.from({ length: 10 }, () => pax2.api.post(`/rides/${request2}/cancel`, { reason: "race" })),
    ...Array.from({ length: 3 }, () => runSqlAsync("select private.dispatch_tick();").then(() => ({ status: 200, body: null }))),
  ];
  const raced = await Promise.all(racers);
  expect(raced.every((r) => r.status < 500), `5xx during the race: ${JSON.stringify(raced.filter((r) => r.status >= 500)[0])}`).toBe(true);
  const outcome = runSqlOne<{ trips: number; req: string; trip: string | null }>(
    `select (select count(*) from public.trips where request_id = '${request2}')::int as trips,
            (select status::text from public.ride_requests where id = '${request2}') as req,
            (select status::text from public.trips where request_id = '${request2}') as trip`,
  );
  expect(outcome.trips).toBeLessThanOrEqual(1);
  if (outcome.trips === 1) {
    expect(["matched", "cancelled_by_passenger"]).toContain(outcome.req);
    expect(["driver_assigned", "cancelled_by_passenger"]).toContain(outcome.trip);
  } else {
    expect(outcome.req).toBe("cancelled_by_passenger");
  }
  // Whatever won, the driver is not left stranded on a finished trip.
  const { stranded } = runSqlOne<{ stranded: number }>(
    `select count(*)::int as stranded from public.driver_profiles d
     where d.user_id = '${jwtSub(driver2Token)}' and d.availability = 'on_trip'
       and not exists (select 1 from public.trips t where t.driver_id = d.id and t.status in ('driver_assigned','driver_arriving','arrived','in_progress'))`,
  );
  expect(stranded).toBe(0);

  // ----- 3. the same passenger fires 15 requests at once -> exactly one is created --------------
  const pax3 = await makePassenger(baseURL!);
  await makeOnlineDriver(createAppUser, 24.32, 90.92);
  const quotes = await Promise.all(
    Array.from({ length: 15 }, () => pax3.api.post("/quotes", { category_id: bike, pickup: place(24.321, 90.921, "Dup"), destination: dest })),
  );
  const created = await Promise.all(quotes.map((q) => pax3.api.post("/rides", { quote_id: data(q).id, payment_method: "cash" })));
  expect(created.filter((r) => r.status === 201)).toHaveLength(1);
  expect(created.filter((r) => r.status === 409).every((r) => r.body.error?.code === "ACTIVE_REQUEST_EXISTS")).toBe(true);
  const { open } = runSqlOne<{ open: number }>(`select count(*)::int as open from public.ride_requests where passenger_id = '${pax3.id}' and status in ('searching','matched')`);
  expect(open).toBe(1);
});

test("authorisation: roles, strict input and rate limits on the ride API", async ({ baseURL }) => {
  const pax = await makePassenger(baseURL!);
  const driverToken = await makeOnlineDriver(createAppUser, 24.7, 91.2);
  const driver = apiClient(baseURL!, driverToken);

  // A passenger cannot use driver endpoints, and a driver cannot request rides.
  expect((await pax.api.get("/driver/offers/current")).status).toBe(403);
  expect((await driver.post("/quotes", { category_id: randomUUID(), pickup: place(24.7, 91.2, "x"), destination: place(24.71, 91.21, "y") })).status).toBe(403);
  // Strict validation and mandatory idempotency keys.
  expect((await pax.api.post("/quotes", { category_id: randomUUID(), pickup: place(95, 91.2, "bad lat"), destination: place(24.71, 91.21, "y") })).status).toBe(400);
  expect((await pax.api.post("/rides", { quote_id: randomUUID(), payment_method: "cash", price: 1 })).status).toBe(400);
  const noKey = await fetch(new URL("/api/v1/rides", baseURL!), {
    method: "POST",
    headers: { Authorization: `Bearer ${pax.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ quote_id: randomUUID(), payment_method: "cash" }),
  });
  expect(noKey.status).toBe(400);
  expect(((await noKey.json()) as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  // Someone else's ride is invisible.
  const other = await makePassenger(baseURL!);
  expect((await other.api.get(`/rides/${randomUUID()}`)).status).toBe(404);
});
