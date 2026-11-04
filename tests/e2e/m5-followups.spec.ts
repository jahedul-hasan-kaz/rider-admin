import { expect, test } from "@playwright/test";
import { apiClient, createAppUser } from "./api-client";
import { bootstrapSuperAdmin, createZone, execSql, jwtSub, makeOnlineDriver, publishRuleSql, runSql, runSqlOne, strongPassword, uniqueEmail } from "./helpers";

// Follow-ups through the real REST API: pickup PIN, cancellation fee collected on the next ride, SOS delivery through
// the internal job route, and SOS evidence upload. Needs the server started with INTERNAL_JOBS_SECRET set.

type Api = ReturnType<typeof apiClient>;

/** fetch that retries when the connection is reset: the suite runs several specs against one server at once. */
async function retryFetch(input: URL | string, init?: RequestInit, attempts = 3): Promise<Response> {
  for (let i = 1; ; i += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      if (i >= attempts) throw error;
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
}
const data = (r: { body: { data?: unknown } }) => r.body.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const place = (lat: number, lng: number, label: string) => ({ lat, lng, label });
type Site = { lat: number; lng: number };
const newSite = (): Site => ({ lat: 5 + Math.random() * 30, lng: 70 + Math.random() * 40 });
const JOBS_SECRET = process.env.INTERNAL_JOBS_SECRET;

async function makePassenger(baseURL: string): Promise<{ api: Api; id: string }> {
  const token = await createAppUser(uniqueEmail("pax"), strongPassword());
  const api = apiClient(baseURL, token);
  expect((await api.post("/onboarding/passenger", { full_name: "Follow-up Passenger" })).status).toBe(201);
  return { api, id: jwtSub(token) };
}

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex");

test.describe.configure({ mode: "serial" });

test("pickup PIN, cancellation fee on the next ride, SOS delivery and evidence", async ({ baseURL }) => {
  test.setTimeout(240_000);
  const suffix = Date.now().toString(36);
  const site = newSite();
  bootstrapSuperAdmin(uniqueEmail("m5oncall"), strongPassword()); // someone on the safety team to alert
  const zoneId = createZone(`m5_${suffix}`, site.lat, site.lng);
  publishRuleSql(zoneId);
  const pax = await makePassenger(baseURL!);
  const driver = apiClient(baseURL!, await makeOnlineDriver(createAppUser, site.lat + 0.003, site.lng + 0.003));
  const { id: bike } = runSqlOne<{ id: string }>("select id from public.vehicle_categories where code = 'bike'");
  const quoteBody = { category_id: bike, pickup: place(site.lat, site.lng, "Start"), destination: place(site.lat + 0.03, site.lng + 0.03, "End") };
  const request = async () => data(await pax.api.post("/rides", { quote_id: data(await pax.api.post("/quotes", quoteBody)).id, payment_method: "cash" })).id as string;
  const accept = async () => data(await driver.post(`/driver/offers/${data(await driver.get("/driver/offers/current")).offer_id}/accept`)).id as string;

  // --- A late cancellation leaves a fee that the next fare collects -----------------------------------
  const req1 = await request();
  const trip1 = await accept();
  execSql(`update public.trips set accepted_at = now() - interval '5 minutes', accepted_pickup_eta_s = 600 where id = '${trip1}'`);
  expect((await pax.api.post(`/rides/${req1}/cancel`, { reason: "changed my mind" })).status).toBe(200);
  const owed = await pax.api.get("/wallet");
  expect(Number(data(owed).outstanding_fee)).toBe(30);

  // --- Pickup PIN (feature flag on) -----------------------------------------------------------------
  // Scoped to this test's zone so rides in other specs (running at the same time) are not asked for a PIN.
  execSql(`update public.feature_flags set enabled = true, rules = jsonb_build_object('zone_ids', jsonb_build_array('${zoneId}')) where key = 'pickup_pin'`);
  try {
    const req2 = await request();
    const trip2 = await accept();
    await driver.post(`/driver/trips/${trip2}/arriving`);
    await driver.post(`/driver/trips/${trip2}/arrived`, { override: true });

    const shown = await pax.api.get(`/rides/${req2}/pin`);
    const pin = data(shown).pin as string;
    expect(data(shown).required).toBe(true);
    expect(pin).toMatch(/^[0-9]{4}$/);
    const wrong = pin === "0000" ? "1111" : "0000";

    const missing = await driver.post(`/driver/trips/${trip2}/start`, {});
    expect(missing.status).toBe(422);
    expect(missing.body.error?.code).toBe("PIN_REQUIRED");
    const bad = await driver.post(`/driver/trips/${trip2}/start`, { pin: wrong });
    expect(bad.status).toBe(422);
    expect(bad.body.error?.code).toBe("INVALID_PIN");
    expect((await driver.post(`/driver/trips/${trip2}/start`, { pin: "12" })).status).toBe(400); // strict input
    expect((await driver.get("/driver/trips/current")).status).toBe(200);

    const ok = await driver.post(`/driver/trips/${trip2}/start`, { pin });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(data(ok).status).toBe("in_progress");

    // --- Complete it: the fee owed is collected with the fare -------------------------------------
    await driver.post("/driver/location", {
      points: Array.from({ length: 8 }, (_, i) => ({ lat: site.lat + i * 0.004, lng: site.lng + i * 0.004, speed: 16, accuracy: 8, recorded_at: new Date(Date.now() - (160 - i * 20) * 1000).toISOString() })),
    });
    const done = await driver.post(`/driver/trips/${trip2}/complete`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const paid = runSqlOne<{ amount: number; fee: number; fare: number }>(
      `select p.amount::float8 as amount, p.fee_collected::float8 as fee, t.final_fare::float8 as fare from public.payments p join public.trips t on t.id = p.trip_id where p.trip_id = '${trip2}'`,
    );
    expect(paid.fee).toBe(30);
    expect(paid.amount).toBeCloseTo(paid.fare + 30, 2);
    expect(Number(data(await pax.api.get("/wallet")).outstanding_fee)).toBe(0);
    expect(Number(data(await driver.post(`/driver/trips/${trip2}/cash-collected`, {})).amount)).toBeCloseTo(paid.amount, 2);

    // --- SOS on a ride in progress: queued, delivered by the job, evidence attached ------------------
    const req3 = await request();
    const trip3 = await accept();
    await driver.post(`/driver/trips/${trip3}/arriving`);
    await driver.post(`/driver/trips/${trip3}/arrived`, { override: true });
    const pin3 = data(await pax.api.get(`/rides/${req3}/pin`)).pin as string;
    expect((await driver.post(`/driver/trips/${trip3}/start`, { pin: pin3 })).status).toBe(200);
  } finally {
    execSql("update public.feature_flags set enabled = false where key = 'pickup_pin'");
  }

  const live = runSqlOne<{ id: string }>(`select t.id from public.trips t where t.passenger_id = '${pax.id}' and t.status = 'in_progress'`).id;
  const sos = await pax.api.post(`/trips/${live}/sos`, { note: "Driver is taking a strange route" });
  expect(sos.status, JSON.stringify(sos.body)).toBe(200);
  const incident = data(sos).id as string;
  expect((await pax.api.post(`/trips/${live}/sos`, {})).body.data).toMatchObject({ repeat: true });

  const queued = runSql<{ channel: string }>(`select channel from public.notification_outbox where dedupe_key = 'sos:${incident}'`);
  // Everyone with safety.view is emailed once, however many times SOS was pressed.
  expect(queued.filter((q) => q.channel === "email").length).toBeGreaterThanOrEqual(1);
  expect(new Set(runSql<{ recipient_id: string; channel: string }>(`select recipient_id, channel from public.notification_outbox where dedupe_key = 'sos:${incident}'`).map((r) => `${r.recipient_id}:${r.channel}`)).size).toBe(queued.length);

  // The job route: refuses the wrong secret, delivers with the right one (log provider).
  expect((await retryFetch(new URL("/api/internal/jobs/notify", baseURL!), { method: "POST" })).status).toBe(JOBS_SECRET ? 401 : 503);
  if (JOBS_SECRET) {
    expect((await retryFetch(new URL("/api/internal/jobs/notify", baseURL!), { method: "POST", headers: { Authorization: "Bearer wrong-secret-wrong-secret-wrong-secret!" } })).status).toBe(401);
    const run = await retryFetch(new URL("/api/internal/jobs/notify", baseURL!), { method: "POST", headers: { Authorization: `Bearer ${JOBS_SECRET}` } });
    expect(run.status).toBe(200);
    const result = (await run.json()) as { claimed: number; sent: number; failed: number };
    expect(result.failed).toBe(0);
    expect(runSqlOne<{ n: number }>(`select count(*)::int as n from public.notification_outbox where dedupe_key = 'sos:${incident}' and status = 'sent'`).n).toBeGreaterThanOrEqual(1);
  }

  // Evidence: the reporter uploads a photo; a stranger cannot; a wrong file type is refused.
  const stranger = (await makePassenger(baseURL!)).api;
  expect((await stranger.post(`/incidents/${incident}/evidence/upload-url`, { content_type: "image/png" })).status).toBe(404);
  expect((await pax.api.post(`/incidents/${incident}/evidence/upload-url`, { content_type: "text/html" })).status).toBe(400);
  const reserved = await pax.api.post(`/incidents/${incident}/evidence/upload-url`, { content_type: "image/png" });
  expect(reserved.status, JSON.stringify(reserved.body)).toBe(201);
  const { upload_url, path } = data(reserved) as { upload_url: string; path: string };

  // A file whose bytes are not a PNG is rejected at completion.
  const fakeReserved = await pax.api.post(`/incidents/${incident}/evidence/upload-url`, { content_type: "image/png" });
  const fake = data(fakeReserved) as { upload_url: string; path: string };
  await retryFetch(fake.upload_url, { method: "PUT", headers: { "Content-Type": "image/png", "x-upsert": "false" }, body: new Uint8Array(Buffer.from("<script>alert(1)</script>")) });
  const rejected = await pax.api.post(`/incidents/${incident}/evidence/complete`, { path: fake.path, content_type: "image/png" });
  expect(rejected.status).toBe(400);

  const put = await retryFetch(upload_url, { method: "PUT", headers: { "Content-Type": "image/png", "x-upsert": "false" }, body: new Uint8Array(PNG) });
  expect(put.ok, await put.text()).toBe(true);
  const completed = await pax.api.post(`/incidents/${incident}/evidence/complete`, { path, content_type: "image/png", description: "Photo of the street" });
  expect(completed.status, JSON.stringify(completed.body)).toBe(201);
  const stored = runSqlOne<{ sha: string; size: number }>(`select sha256 as sha, size_bytes as size from public.safety_evidence where incident_id = '${incident}'`);
  expect(stored.sha).toMatch(/^[0-9a-f]{64}$/);
  expect(stored.size).toBe(PNG.length);
  expect((await stranger.post(`/incidents/${incident}/evidence/complete`, { path, content_type: "image/png" })).status).toBe(404);
});

test("devices and client config", async ({ baseURL }) => {
  const pax = await makePassenger(baseURL!);
  const token = `device-token-${Date.now().toString(36)}-abcdefghij`;
  expect((await pax.api.put("/me/devices", { platform: "android", token })).status).toBe(200);
  expect((await pax.api.put("/me/devices", { platform: "toaster", token })).status).toBe(400);
  expect((await pax.api.put("/me/devices", { platform: "ios", token: "short" })).status).toBe(400);
  expect(runSqlOne<{ n: number }>(`select count(*)::int as n from public.push_devices where token = '${token}'`).n).toBe(1);
  expect((await pax.api.delete("/me/devices", { token })).status).toBe(200);
  expect(runSqlOne<{ n: number }>(`select count(*)::int as n from public.push_devices where token = '${token}'`).n).toBe(0);
  const flags = data(await pax.api.get("/config")).flags as Record<string, boolean>;
  expect(flags).toHaveProperty("pickup_pin");
});
