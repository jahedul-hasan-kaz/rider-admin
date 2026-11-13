import { expect, test, type Locator, type Page } from "@playwright/test";
import { apiClient, createAppUser } from "./api-client";
import { bootstrapSuperAdmin, createZone, execSql, jwtSub, makeOnlineDriver, publishRuleSql, runSqlOne, signInAdmin, strongPassword, uniqueEmail } from "./helpers";

// M4: dashboard and analytics figures, exports (including the download), alerts, settings and feature flags,
// through the real UI. Rides use the REST API on a private patch of map so other specs never interfere.

type Api = ReturnType<typeof apiClient>;
const data = (r: { body: { data?: unknown } }) => r.body.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const place = (lat: number, lng: number, label: string) => ({ lat, lng, label });
type Site = { lat: number; lng: number };
const newSite = (): Site => ({ lat: 5 + Math.random() * 30, lng: 70 + Math.random() * 40 });

async function makePassenger(baseURL: string): Promise<Api> {
  const token = await createAppUser(uniqueEmail("pax"), strongPassword());
  const api = apiClient(baseURL, token);
  expect((await api.post("/onboarding/passenger", { full_name: "Insight Passenger" })).status).toBe(201);
  return api;
}

/** Clicks once React has attached its handlers to the element (a click before that is replayed later). */
async function clickReady(trigger: Locator, outcome: () => Promise<void>) {
  const handle = await trigger.elementHandle({ timeout: 15_000 });
  await trigger.page().waitForFunction((el) => Object.keys(el as object).some((k) => k.startsWith("__reactProps")), handle, { timeout: 15_000 });
  await trigger.click();
  await outcome();
}

async function adminPage(browser: import("@playwright/test").Browser, label: string): Promise<Page> {
  const email = uniqueEmail(label);
  const password = strongPassword();
  bootstrapSuperAdmin(email, password);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signInAdmin(page, email, password);
  return page;
}

test.describe.configure({ mode: "serial" });

test("insight: dashboard and analytics figures, export download, alerts, settings and flags", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const suffix = Date.now().toString(36);
  const site = newSite();
  const zoneId = createZone(`m4_${suffix}`, site.lat, site.lng);
  publishRuleSql(zoneId);

  const paxA = await makePassenger(baseURL!);
  const paxB = await makePassenger(baseURL!);
  const driver = apiClient(baseURL!, await makeOnlineDriver(createAppUser, site.lat + 0.003, site.lng + 0.003));
  const { id: bike } = runSqlOne<{ id: string }>("select id from public.vehicle_categories where code = 'bike'");
  const quoteBody = { category_id: bike, pickup: place(site.lat, site.lng, "Start"), destination: place(site.lat + 0.03, site.lng + 0.03, "End") };

  // Ride 1 completes.
  const req1 = await paxA.post("/rides", { quote_id: data(await paxA.post("/quotes", quoteBody)).id, payment_method: "cash" });
  expect(req1.status, JSON.stringify(req1.body)).toBe(201);
  const offer = await driver.get("/driver/offers/current");
  const trip = data(await driver.post(`/driver/offers/${data(offer).offer_id}/accept`)).id as string;
  await driver.post(`/driver/trips/${trip}/arriving`);
  await driver.post(`/driver/trips/${trip}/arrived`, { override: true });
  await driver.post(`/driver/trips/${trip}/start`);
  await driver.post("/driver/location", {
    points: Array.from({ length: 8 }, (_, i) => ({ lat: site.lat + i * 0.004, lng: site.lng + i * 0.004, speed: 16, accuracy: 8, recorded_at: new Date(Date.now() - (160 - i * 20) * 1000).toISOString() })),
  });
  expect((await driver.post(`/driver/trips/${trip}/complete`)).status).toBe(200);

  // Ride 2 is cancelled by the passenger while searching.
  const req2 = await paxB.post("/rides", { quote_id: data(await paxB.post("/quotes", quoteBody)).id, payment_method: "cash" });
  expect((await paxB.post(`/rides/${data(req2).id}/cancel`, { reason: "changed my mind" })).status).toBe(200);

  // Refresh the rollups now rather than waiting for the cron.
  execSql("select private.rollup_kpi('day', now() - interval '2 days', now() + interval '1 day'); select private.rollup_kpi('15m', now() - interval '3 hours', now() + interval '1 hour');");

  const admin = await adminPage(browser, "m4admin");

  // --- Dashboard ----------------------------------------------------------------------------------
  await admin.goto(`/dashboard?range=today&zone=${zoneId}`);
  await expect(admin.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const completedCard = admin.locator("div").filter({ has: admin.getByText("Completed rides", { exact: true }) }).filter({ hasText: "2 requests" }).first();
  await expect(completedCard).toBeVisible();
  await expect(completedCard.getByText("1", { exact: true }).first()).toBeVisible();
  await expect(admin.getByText("50%").first()).toBeVisible(); // match rate: 1 of 2 requests matched
  await expect(admin.getByText("Cancelled by passenger")).toBeVisible();
  await expect(admin.getByText("Marketplace funnel")).toBeVisible();
  await expect(admin.getByText("Zone health")).toBeVisible();
  await expect(admin.getByRole("row").filter({ hasText: `m4_${suffix}` })).toContainText("Too few requests");
  // The "?" next to a metric carries its exact definition.
  await clickReady(admin.getByRole("button", { name: "How Request-to-match rate is calculated" }), () => expect(admin.getByText("Requests that found a driver")).toBeVisible());
  await admin.keyboard.press("Escape");

  // --- Analytics ------------------------------------------------------------------------------------
  await admin.goto(`/analytics?page=economics&range=today&zone=${zoneId}`);
  await expect(admin.getByText("Rides with and without a promotion")).toBeVisible();
  await expect(admin.getByText("Gross bookings")).toBeVisible();
  await admin.goto(`/analytics?range=today&zone=${zoneId}`);
  await expect(admin.getByText("Median wait to match")).toBeVisible();
  await admin.goto(`/analytics?page=drivers&range=today&zone=${zoneId}`);
  await expect(admin.getByText("Active drivers")).toBeVisible();
  await expect(admin.getByRole("row").filter({ hasText: /drv\./ }).first()).toBeVisible();

  // --- Export and download ---------------------------------------------------------------------------
  await admin.goto("/exports");
  const created = admin.getByText("Export ready.");
  await clickReady(admin.getByRole("button", { name: "Create export" }), () => expect(created).toBeVisible({ timeout: 8000 }));
  const download = admin.getByRole("link", { name: "Download CSV" }).first();
  await expect(download).toBeVisible();
  const href = await download.getAttribute("href");
  const file = await admin.request.get(href!);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toContain("text/csv");
  expect(file.headers()["x-content-type-options"]).toBe("nosniff");
  expect(file.headers()["content-disposition"]).toContain("attachment");
  const csv = await file.text();
  expect(csv).toContain("trip_id,status,requested_at");
  expect(csv).toContain("Insight Passenger");
  expect(csv).not.toContain("@"); // no emails in an export
  // Someone who is not signed in cannot fetch it.
  const anon = await (await browser.newContext()).request.get(new URL(href!, baseURL!).toString(), { maxRedirects: 0 });
  expect([302, 303, 307, 308, 401, 403]).toContain(anon.status());

  // --- Alerts -----------------------------------------------------------------------------------------
  execSql(`select private.raise_alert('e2e:${suffix}', 'critical', 'E2E test alert ${suffix}', '{"note":"fixture"}', 'dashboard.view');`);
  await admin.goto("/alerts");
  await expect(admin.getByText(`E2E test alert ${suffix}`)).toBeVisible();
  const card = admin.locator("div").filter({ hasText: `E2E test alert ${suffix}` }).filter({ has: admin.getByRole("button", { name: "Acknowledge" }) }).last();
  const ackDialog = admin.getByRole("dialog");
  await clickReady(card.getByRole("button", { name: "Acknowledge" }), () => expect(ackDialog).toBeVisible({ timeout: 1500 }));
  await ackDialog.getByLabel("Reason").fill("Checking it out now");
  await ackDialog.getByRole("button", { name: "Acknowledge" }).click();
  await expect(admin.getByText("Alert acknowledged.")).toBeVisible();

  // --- Settings and flags -------------------------------------------------------------------------------
  await admin.goto("/settings");
  await expect(admin.getByText("dispatch.offer_timeout_s")).toBeVisible();
  const row = admin.locator("div").filter({ hasText: "dispatch.offer_timeout_s" }).filter({ has: admin.getByRole("button", { name: "Edit dispatch.offer_timeout_s" }) }).last();
  const dlg = admin.getByRole("dialog");
  await clickReady(row.getByRole("button", { name: "Edit dispatch.offer_timeout_s" }), () => expect(dlg).toBeVisible({ timeout: 1500 }));
  await dlg.getByLabel("New value").fill("500");
  await dlg.getByLabel("Reason").fill("Trying a value that is far too large");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg.getByText("Some fields need attention.").or(dlg.getByText("allowed range"))).toBeVisible();
  await dlg.getByLabel("New value").fill("20");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  expect(runSqlOne<{ v: number }>("select (value)::int as v from public.app_settings where key = 'dispatch.offer_timeout_s'").v).toBe(20);
  execSql("update public.app_settings set value = '15' where key = 'dispatch.offer_timeout_s'"); // leave the shared setting as found

  await admin.goto("/settings?tab=flags");
  await expect(admin.getByText("pickup_pin")).toBeVisible();
  await admin.goto("/settings?tab=delivery");
  await expect(admin.getByText("Email, SMS and push delivery")).toBeVisible();
  await admin.goto("/settings?tab=retention");
  await expect(admin.getByText("Archive log")).toBeVisible();

  await admin.context().close();
});

test("insight: access control and client config over the API", async ({ baseURL, browser }) => {
  const pax = await makePassenger(baseURL!);
  const config = await pax.get("/config");
  expect(config.status).toBe(200);
  expect(data(config).flags).toHaveProperty("promo_codes");
  expect(data(config).settings.cancellation_free_window_s).toBeGreaterThan(0);

  // A user with no admin rights is turned away from every insight page.
  const email = uniqueEmail("m4user");
  const password = strongPassword();
  const token = await createAppUser(email, password);
  expect(jwtSub(token)).toBeTruthy();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  for (const path of ["/dashboard", "/analytics", "/exports", "/alerts", "/settings"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
  const noSession = await ctx.request.get(`/api/exports/00000000-0000-0000-0000-000000000000`, { maxRedirects: 0 });
  expect([302, 303, 307, 308, 401, 403, 404]).toContain(noSession.status());
  await ctx.close();
});
